import type { Std140FieldLayout, Std140Layout, Std140Schema } from '../../ubo/Std140Layout';

export type WgslUniformFieldLayout = Std140FieldLayout;

interface WgslStructMember {
    readonly name: string;
    readonly type: string;
    readonly indentation: string;
    readonly start: number;
    readonly end: number;
}

interface WgslStruct {
    readonly name: string;
    readonly members: readonly WgslStructMember[];
}

interface WgslArrayType {
    readonly elementType: string;
    readonly length: string;
}

interface PortableMemberRewrite {
    readonly member: WgslStructMember;
    readonly declaration: string;
    readonly access: 'none' | 'array-element' | 'matrix' | 'matrix-array';
    readonly helperName?: string;
    readonly supportSource?: string;
}

function matchingBrace(source: string, openBrace: number): number {
    let depth = 0;
    for (let offset = openBrace; offset < source.length; offset++) {
        const character = source[offset];
        if (character === '{') depth++;
        else if (character === '}') {
            depth--;
            if (depth === 0) return offset;
        }
    }
    throw new Error(`WGSL structure at offset ${String(openBrace)} has no closing brace`);
}

function splitTopLevelComma(value: string): readonly [string, string] | null {
    let angleDepth = 0;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (character === '<') angleDepth++;
        else if (character === '>') angleDepth--;
        else if (character === ',' && angleDepth === 0) {
            return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
        }
    }
    return null;
}

function parseArrayType(type: string): WgslArrayType | null {
    const trimmed = type.trim();
    if (!trimmed.startsWith('array<') || !trimmed.endsWith('>')) return null;
    const parts = splitTopLevelComma(trimmed.slice(6, -1));
    if (!parts || parts[0] === '' || parts[1] === '') return null;
    return { elementType: parts[0], length: parts[1] };
}

function vectorWidth(type: string): number | null {
    const match = /^vec([2-4])<(?:f32|i32|u32)>$/u.exec(type.trim());
    return match?.[1] === undefined ? null : Number(match[1]);
}

function matrixShape(type: string): readonly [columns: number, rows: number] | null {
    const match = /^mat([2-4])x([2-4])<f32>$/u.exec(type.trim());
    return match?.[1] === undefined || match[2] === undefined
        ? null
        : [Number(match[1]), Number(match[2])];
}

function isScalar(type: string): boolean {
    return /^(?:f32|i32|u32)$/u.test(type.trim());
}

function sanitizeIdentifier(value: string): string {
    return value.replace(/[^A-Za-z0-9_]/gu, '_');
}

function collectStructs(source: string): readonly WgslStruct[] {
    const structs: WgslStruct[] = [];
    const pattern = /\bstruct\s+([A-Za-z_]\w*)\s*\{/gu;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const name = match[1];
        if (!name) continue;
        const openBrace = source.indexOf('{', match.index);
        const closeBrace = matchingBrace(source, openBrace);
        const bodyStart = openBrace + 1;
        const body = source.slice(bodyStart, closeBrace);
        const members: WgslStructMember[] = [];
        const memberPattern =
            /^([ \t]*)(?:@\w+\([^\n)]*\)[ \t]+)*([A-Za-z_]\w*)[ \t]*:[ \t]*(.+)[ \t]*,[ \t]*$/gmu;
        for (
            let memberMatch = memberPattern.exec(body);
            memberMatch;
            memberMatch = memberPattern.exec(body)
        ) {
            const indentation = memberMatch[1] ?? '    ';
            const memberName = memberMatch[2];
            const type = memberMatch[3];
            if (!memberName || !type) continue;
            members.push({
                name: memberName,
                type: type.trim(),
                indentation,
                start: bodyStart + memberMatch.index,
                end: bodyStart + memberPattern.lastIndex
            });
        }
        structs.push({
            name,
            members
        });
        pattern.lastIndex = closeBrace + 1;
    }
    return structs;
}

function uniformVariables(source: string): ReadonlyMap<string, string> {
    const result = new Map<string, string>();
    const pattern = /\bvar\s*<\s*uniform\s*>\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*;/gu;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const variable = match[1];
        const structure = match[2];
        if (variable && structure) result.set(variable, structure);
    }
    return result;
}

function matrixSupportSource(
    structureName: string,
    memberName: string,
    matrixType: string,
    columns: number
): { readonly wrapperName: string; readonly helperName: string; readonly source: string } {
    const suffix = `${sanitizeIdentifier(structureName)}_${sanitizeIdentifier(memberName)}`;
    const wrapperName = `HiloStd140Matrix_${suffix}`;
    const helperName = `hiloLoadStd140Matrix_${suffix}`;
    const columnDeclarations = Array.from(
        { length: columns },
        (_unused, column) => `    @size(16) column${String(column)}: vec2<f32>,`
    ).join('\n');
    const columnsExpression = Array.from(
        { length: columns },
        (_unused, column) => `value.column${String(column)}`
    ).join(', ');
    return {
        wrapperName,
        helperName,
        source: `struct ${wrapperName} {\n${columnDeclarations}\n}\n\nfn ${helperName}(value: ${wrapperName}) -> ${matrixType} {\n    return ${matrixType}(${columnsExpression});\n}\n\n`
    };
}

function elementSupportSource(
    structureName: string,
    memberName: string,
    elementType: string
): { readonly wrapperName: string; readonly source: string } {
    const suffix = `${sanitizeIdentifier(structureName)}_${sanitizeIdentifier(memberName)}`;
    const wrapperName = `HiloStd140Element_${suffix}`;
    return {
        wrapperName,
        source: `struct ${wrapperName} {\n    @size(16) value: ${elementType},\n}\n\n`
    };
}

function portableMemberRewrite(
    structureName: string,
    member: WgslStructMember
): PortableMemberRewrite {
    const array = parseArrayType(member.type);
    if (array) {
        const matrix = matrixShape(array.elementType);
        if (matrix?.[1] === 2) {
            const support = matrixSupportSource(
                structureName,
                member.name,
                array.elementType,
                matrix[0]
            );
            return {
                member,
                declaration: `${member.indentation}@align(16) ${member.name}: array<${support.wrapperName}, ${array.length}>,`,
                access: 'matrix-array',
                helperName: support.helperName,
                supportSource: support.source
            };
        }
        const width = vectorWidth(array.elementType);
        if (isScalar(array.elementType) || width === 2) {
            const support = elementSupportSource(structureName, member.name, array.elementType);
            return {
                member,
                declaration: `${member.indentation}@align(16) ${member.name}: array<${support.wrapperName}, ${array.length}>,`,
                access: 'array-element',
                supportSource: support.source
            };
        }
        if (matrix || width === 3 || width === 4) {
            return {
                member,
                declaration: `${member.indentation}@align(16) ${member.name}: ${member.type},`,
                access: 'none'
            };
        }
        throw new TypeError(
            `WGSL uniform ${structureName}.${member.name} uses unsupported array element type ${array.elementType}`
        );
    }

    const matrix = matrixShape(member.type);
    if (matrix?.[1] === 2) {
        const support = matrixSupportSource(structureName, member.name, member.type, matrix[0]);
        return {
            member,
            declaration: `${member.indentation}@align(16) ${member.name}: ${support.wrapperName},`,
            access: 'matrix',
            helperName: support.helperName,
            supportSource: support.source
        };
    }
    return {
        member,
        declaration: `${member.indentation}${member.name}: ${member.type},`,
        access: 'none'
    };
}

function replaceRanges(
    source: string,
    replacements: readonly {
        readonly start: number;
        readonly end: number;
        readonly value: string;
    }[]
): string {
    let result = source;
    for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
        result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
    }
    return result;
}

function indexedAccessEnd(source: string, openBracket: number): number {
    let depth = 0;
    for (let index = openBracket; index < source.length; index++) {
        const character = source[index];
        if (character === '[') depth++;
        else if (character === ']') {
            depth--;
            if (depth === 0) return index + 1;
        }
    }
    throw new Error(`WGSL array access at offset ${String(openBracket)} has no closing bracket`);
}

function rewriteUniformAccesses(
    source: string,
    variableName: string,
    rewrite: PortableMemberRewrite
): string {
    if (rewrite.access === 'none') return source;
    const escapedVariable = variableName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const escapedMember = rewrite.member.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const accessPattern = new RegExp(`\\b${escapedVariable}\\s*\\.\\s*${escapedMember}\\b`, 'gu');
    if (rewrite.access === 'matrix') {
        const helperName = rewrite.helperName;
        if (!helperName) throw new Error('Portable matrix rewrite is missing its load helper');
        return source.replace(accessPattern, match => `${helperName}(${match})`);
    }

    const replacements: { start: number; end: number; value: string }[] = [];
    for (let match = accessPattern.exec(source); match; match = accessPattern.exec(source)) {
        let bracket = accessPattern.lastIndex;
        while (/\s/u.test(source[bracket] ?? '')) bracket++;
        if (source[bracket] !== '[') {
            throw new Error(
                `WGSL uniform array ${variableName}.${rewrite.member.name} must be accessed by element`
            );
        }
        const end = indexedAccessEnd(source, bracket);
        const access = source.slice(match.index, end);
        replacements.push({
            start: match.index,
            end,
            value:
                rewrite.access === 'array-element'
                    ? `${access}.value`
                    : `${rewrite.helperName ?? ''}(${access})`
        });
        accessPattern.lastIndex = end;
    }
    return replaceRanges(source, replacements);
}

/**
 * Make Naga's storage-layout WGSL portable for the standard `uniform` address space.
 *
 * Naga preserves the GLSL std140 field order but emits natural WGSL types. Default
 * WGSL requires 16-byte array strides and matrix-column strides in uniform buffers.
 * Scalar/vec2 arrays and two-row matrices therefore receive explicit wrapper types,
 * while their generated accesses are rewritten back to the shader's logical type.
 */
export function makeWgslUniformLayoutsPortable(source: string): string {
    const variables = uniformVariables(source);
    if (variables.size === 0) return source;
    const structures = new Map(
        collectStructs(source).map(structure => [structure.name, structure])
    );
    const rewritesByStructure = new Map<string, readonly PortableMemberRewrite[]>();
    const supportSources: string[] = [];
    const declarationReplacements: { start: number; end: number; value: string }[] = [];

    for (const structureName of new Set(variables.values())) {
        const structure = structures.get(structureName);
        if (!structure) throw new Error(`WGSL uniform structure ${structureName} was not emitted`);
        const rewrites = structure.members.map(member =>
            portableMemberRewrite(structure.name, member)
        );
        rewritesByStructure.set(structureName, rewrites);
        for (const rewrite of rewrites) {
            declarationReplacements.push({
                start: rewrite.member.start,
                end: rewrite.member.end,
                value: rewrite.declaration
            });
            if (rewrite.supportSource) supportSources.push(rewrite.supportSource);
        }
    }

    let result = replaceRanges(source, declarationReplacements);
    for (const [variableName, structureName] of variables) {
        const rewrites = rewritesByStructure.get(structureName) ?? [];
        for (const rewrite of rewrites) {
            result = rewriteUniformAccesses(result, variableName, rewrite);
        }
    }
    return `${supportSources.join('')}${result}`;
}

/**
 * WebGL2 and WebGPU share one public std140 ABI. The WebGPU shader rewrite above
 * gives WGSL the same offsets, so uploads stay byte-for-byte identical.
 */
export class WgslUniformLayout<Schema extends Std140Schema = Std140Schema> {
    readonly schema: Schema;
    readonly fields: Readonly<Record<keyof Schema & string, WgslUniformFieldLayout>>;
    readonly alignment = 16;
    readonly byteLength: number;
    readonly std140Layout: Std140Layout<Schema>;

    constructor(std140Layout: Std140Layout<Schema>) {
        this.std140Layout = std140Layout;
        this.schema = std140Layout.schema;
        this.fields = std140Layout.fields;
        this.byteLength = std140Layout.byteLength;
    }

    transcode(std140Buffer: ArrayBuffer): ArrayBuffer {
        if (std140Buffer.byteLength < this.byteLength) {
            throw new RangeError(
                `std140 source is ${String(std140Buffer.byteLength)} bytes; layout requires ${String(this.byteLength)}`
            );
        }
        return std140Buffer.slice(0, this.byteLength);
    }
}

export function createWgslUniformLayout<const Schema extends Std140Schema>(
    std140Layout: Std140Layout<Schema>
): WgslUniformLayout<Schema> {
    return new WgslUniformLayout(std140Layout);
}
