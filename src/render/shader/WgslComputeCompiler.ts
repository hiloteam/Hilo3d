import type {
    RHIShaderBindingReflection,
    RHIShaderOverrideReflection,
    RHIShaderReflection
} from '../rhi/core/RHIResources';
import type {
    default as ComputeShader,
    ComputeShaderBinding,
    ComputeTextureSampleType,
    NormalizedComputeWorkgroupSize,
    ShaderTextureViewDimension
} from '../compute/ComputeShader';
import {
    getInitializedNagaModule,
    initializeNagaModule,
    useNagaResource,
    useNagaShaderModule
} from './NagaModule';

interface SourceToken {
    readonly kind: 'identifier' | 'number' | 'symbol';
    readonly value: string;
    readonly offset: number;
}

interface SourceAttribute {
    readonly name: string;
    readonly arguments: readonly SourceToken[] | null;
    readonly offset: number;
}

interface SourceBinding {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly kind:
        | 'uniform-buffer'
        | 'read-only-storage-buffer'
        | 'storage-buffer'
        | 'sampled-texture'
        | 'sampler'
        | 'comparison-sampler'
        | 'storage-texture';
    readonly sampledComponent?: 'f32' | 'i32' | 'u32' | 'depth';
    readonly viewDimension?: ShaderTextureViewDimension;
    readonly storageTextureAccess?: 'write';
    readonly storageTextureFormat?: string;
    readonly offset: number;
}

interface SourceEntryPoint {
    readonly name: string;
    readonly stage: 'compute' | 'vertex' | 'fragment' | null;
    readonly workgroupSize: NormalizedComputeWorkgroupSize | null;
    readonly offset: number;
}

interface SourceInterface {
    readonly bindings: readonly SourceBinding[];
    readonly entryPoints: readonly SourceEntryPoint[];
}

interface SourceStructMember {
    readonly name: string;
    readonly typeTokens: readonly SourceToken[];
    readonly attributes: readonly SourceAttribute[];
    readonly offset: number;
}

interface SourceStructDeclaration {
    readonly name: string;
    readonly members: readonly SourceStructMember[];
    readonly offset: number;
}

interface SourceWorkgroupVariable {
    readonly name: string;
    readonly typeTokens: readonly SourceToken[];
    readonly offset: number;
}

interface SourceFunctionUsage {
    readonly name: string;
    readonly identifiers: ReadonlySet<string>;
    readonly offset: number;
}

interface SourceOverrideDeclaration {
    readonly declaredName: string;
    readonly typeTokens: readonly SourceToken[];
    readonly attributes: readonly SourceAttribute[];
    readonly required: boolean;
    readonly declarationOffset: number;
    readonly semicolonOffset: number;
    readonly offset: number;
}

interface ComputeModuleMetadata {
    readonly workgroupStorageSize: number;
    readonly overrides: readonly Readonly<RHIShaderOverrideReflection>[];
    readonly requiresF16: boolean;
    readonly nagaValidationSource: string;
    readonly bufferMinBindingSizes: ReadonlyMap<string, number>;
}

interface TypeLayout {
    readonly alignment: number;
    readonly size: number;
}

interface TypeLayoutEnvironment {
    readonly source: string;
    readonly aliases: ReadonlyMap<string, readonly SourceToken[]>;
    readonly structures: ReadonlyMap<string, SourceStructDeclaration>;
    readonly constants: ReadonlyMap<string, readonly SourceToken[]>;
    readonly overrides: ReadonlyMap<string, SourceOverrideDeclaration>;
    readonly runtimeArrayElementCount: number | null;
}

interface SourceBufferVariable {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly typeTokens: readonly SourceToken[];
    readonly offset: number;
}

export interface CompiledWgslComputeShader {
    readonly source: string;
    readonly entryPoint: string;
    readonly workgroupSize: NormalizedComputeWorkgroupSize;
    readonly bindings: readonly ComputeShaderBinding[];
    readonly reflection: Readonly<RHIShaderReflection>;
    readonly cacheKey: number;
}

export class WgslComputeCompilationError extends Error {
    readonly source: string;
    override readonly cause: unknown;

    constructor(source: string, cause: unknown) {
        super(`Naga failed to validate the compute shader: ${String(cause)}`);
        this.name = 'WgslComputeCompilationError';
        this.source = source;
        this.cause = cause;
    }
}

const MAX_U32 = 0xffff_ffff;
const identifierStartPattern = /[A-Za-z_]/u;
const identifierContinuePattern = /[A-Za-z0-9_]/u;

function maskComments(source: string): string {
    const characters = new Array<string>(source.length);
    for (let characterIndex = 0; characterIndex < source.length; characterIndex += 1) {
        characters[characterIndex] = source[characterIndex] ?? '';
    }
    let index = 0;
    while (index < characters.length) {
        const current = characters[index];
        const next = characters[index + 1];
        if (current === '/' && next === '/') {
            characters[index] = ' ';
            characters[index + 1] = ' ';
            index += 2;
            while (index < characters.length && characters[index] !== '\n') {
                characters[index] = ' ';
                index++;
            }
            continue;
        }
        if (current === '/' && next === '*') {
            let depth = 1;
            characters[index] = ' ';
            characters[index + 1] = ' ';
            index += 2;
            while (index < characters.length && depth > 0) {
                const blockCurrent = characters[index];
                const blockNext = characters[index + 1];
                if (blockCurrent === '/' && blockNext === '*') {
                    characters[index] = ' ';
                    characters[index + 1] = ' ';
                    index += 2;
                    depth++;
                    continue;
                }
                if (blockCurrent === '*' && blockNext === '/') {
                    characters[index] = ' ';
                    characters[index + 1] = ' ';
                    index += 2;
                    depth--;
                    continue;
                }
                if (blockCurrent !== '\n') characters[index] = ' ';
                index++;
            }
            continue;
        }
        index++;
    }
    return characters.join('');
}

function tokenize(source: string): readonly SourceToken[] {
    const masked = maskComments(source);
    const tokens: SourceToken[] = [];
    let offset = 0;
    while (offset < masked.length) {
        const character = masked[offset];
        if (character === undefined) break;
        if (/\s/u.test(character)) {
            offset++;
            continue;
        }
        if (identifierStartPattern.test(character)) {
            const start = offset++;
            while (identifierContinuePattern.test(masked[offset] ?? '')) offset++;
            tokens.push({ kind: 'identifier', value: masked.slice(start, offset), offset: start });
            continue;
        }
        if (/[0-9]/u.test(character)) {
            const start = offset++;
            while (/[A-Za-z0-9_]/u.test(masked[offset] ?? '')) offset++;
            tokens.push({ kind: 'number', value: masked.slice(start, offset), offset: start });
            continue;
        }
        tokens.push({ kind: 'symbol', value: character, offset });
        offset++;
    }
    return tokens;
}

function sourceLocation(source: string, offset: number): string {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    return `line ${String(line)}, column ${String(offset - lineStart + 1)}`;
}

function failSource(source: string, offset: number, message: string): never {
    throw new TypeError(`${message} (${sourceLocation(source, offset)})`);
}

function matchingToken(
    source: string,
    tokens: readonly SourceToken[],
    openIndex: number,
    open: string,
    close: string
): number {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index++) {
        const token = tokens[index];
        if (token?.value === open) depth++;
        if (token?.value === close) {
            depth--;
            if (depth === 0) return index;
        }
    }
    failSource(source, tokens[openIndex]?.offset ?? 0, `Unclosed ${open} delimiter`);
}

function parseAttribute(
    source: string,
    tokens: readonly SourceToken[],
    atIndex: number
): { readonly attribute: SourceAttribute; readonly nextIndex: number } {
    const at = tokens[atIndex];
    const name = tokens[atIndex + 1];
    if (name?.kind !== 'identifier') {
        failSource(source, at?.offset ?? 0, 'WGSL attribute requires a name');
    }
    const open = tokens[atIndex + 2];
    if (open?.value !== '(') {
        return {
            attribute: { name: name.value, arguments: null, offset: at?.offset ?? name.offset },
            nextIndex: atIndex + 2
        };
    }
    const closeIndex = matchingToken(source, tokens, atIndex + 2, '(', ')');
    return {
        attribute: {
            name: name.value,
            arguments: Object.freeze(tokens.slice(atIndex + 3, closeIndex)),
            offset: at?.offset ?? name.offset
        },
        nextIndex: closeIndex + 1
    };
}

function attributeNamed(
    source: string,
    attributes: readonly SourceAttribute[],
    name: string
): SourceAttribute | null {
    const matches = attributes.filter(attribute => attribute.name === name);
    if (matches.length > 1) {
        failSource(
            source,
            matches[1]?.offset ?? 0,
            `WGSL declaration repeats the ${name} attribute`
        );
    }
    return matches[0] ?? null;
}

function parseU32Literal(source: string, tokens: readonly SourceToken[], path: string): number {
    if (tokens.length !== 1) {
        failSource(source, tokens[0]?.offset ?? 0, `${path} must be one literal integer`);
    }
    const token = tokens[0];
    const value = token?.value ?? '';
    if (!/^(?:0[xX][0-9A-Fa-f]+|[0-9]+)[iu]?$/u.test(value)) {
        failSource(source, token?.offset ?? 0, `${path} must be an unsigned literal integer`);
    }
    const digits = value.endsWith('u') || value.endsWith('i') ? value.slice(0, -1) : value;
    const parsed = BigInt(digits);
    if (parsed > BigInt(MAX_U32)) {
        failSource(source, token?.offset ?? 0, `${path} exceeds the 32-bit unsigned range`);
    }
    return Number(parsed);
}

function splitArguments(tokens: readonly SourceToken[]): readonly (readonly SourceToken[])[] {
    const result: SourceToken[][] = [[]];
    let nested = 0;
    for (const token of tokens) {
        if (token.value === '(' || token.value === '<' || token.value === '[') nested++;
        if (token.value === ')' || token.value === '>' || token.value === ']') nested--;
        if (token.value === ',' && nested === 0) {
            result.push([]);
        } else {
            result.at(-1)?.push(token);
        }
    }
    return result;
}

function parseLocationAttribute(
    source: string,
    attributes: readonly SourceAttribute[],
    name: 'group' | 'binding'
): number | null {
    const attribute = attributeNamed(source, attributes, name);
    if (attribute === null) return null;
    if (attribute.arguments === null) {
        failSource(source, attribute.offset, `${name} attribute requires an argument`);
    }
    return parseU32Literal(source, attribute.arguments, `${name} attribute`);
}

function parseWorkgroupSize(
    source: string,
    attributes: readonly SourceAttribute[]
): NormalizedComputeWorkgroupSize | null {
    const attribute = attributeNamed(source, attributes, 'workgroup_size');
    if (attribute === null) return null;
    if (attribute.arguments === null) {
        failSource(source, attribute.offset, 'workgroup_size attribute requires arguments');
    }
    const dimensions = splitArguments(attribute.arguments);
    if (
        dimensions.length < 1 ||
        dimensions.length > 3 ||
        dimensions.some(item => item.length === 0)
    ) {
        failSource(source, attribute.offset, 'workgroup_size requires one to three dimensions');
    }
    const values = dimensions.map((tokens, index) =>
        parseU32Literal(source, tokens, `workgroup_size dimension ${String(index)}`)
    );
    if (values.some(value => value < 1)) {
        failSource(source, attribute.offset, 'workgroup_size dimensions must be positive');
    }
    return Object.freeze([values[0] ?? 1, values[1] ?? 1, values[2] ?? 1]);
}

function compactTokens(tokens: readonly SourceToken[]): string {
    return tokens.map(token => token.value).join('');
}

function declarationSemicolon(
    source: string,
    tokens: readonly SourceToken[],
    startIndex: number,
    path: string
): number {
    for (let index = startIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined) break;
        if (token.value === ';') return index;
    }
    failSource(source, tokens[startIndex]?.offset ?? 0, `${path} is missing a semicolon`);
}

function topLevelTokenIndex(
    tokens: readonly SourceToken[],
    startIndex: number,
    endIndex: number,
    value: string
): number | null {
    let angleDepth = 0;
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    for (let index = startIndex; index < endIndex; index += 1) {
        const token = tokens[index];
        if (token === undefined) break;
        if (
            token.value === value &&
            angleDepth === 0 &&
            parenthesisDepth === 0 &&
            bracketDepth === 0
        ) {
            return index;
        }
        if (token.value === '<') angleDepth++;
        if (token.value === '>') angleDepth--;
        if (token.value === '(') parenthesisDepth++;
        if (token.value === ')') parenthesisDepth--;
        if (token.value === '[') bracketDepth++;
        if (token.value === ']') bracketDepth--;
    }
    return null;
}

function parseStructDeclaration(
    source: string,
    tokens: readonly SourceToken[],
    structIndex: number
): { readonly declaration: SourceStructDeclaration; readonly nextIndex: number } {
    const structToken = tokens[structIndex];
    const name = tokens[structIndex + 1];
    const open = tokens[structIndex + 2];
    if (name?.kind !== 'identifier' || open?.value !== '{') {
        failSource(source, structToken?.offset ?? 0, 'WGSL struct declaration is malformed');
    }
    const closeIndex = matchingToken(source, tokens, structIndex + 2, '{', '}');
    const members: SourceStructMember[] = [];
    let cursor = structIndex + 3;
    while (cursor < closeIndex) {
        const attributes: SourceAttribute[] = [];
        while (tokens[cursor]?.value === '@') {
            const parsed = parseAttribute(source, tokens, cursor);
            attributes.push(parsed.attribute);
            cursor = parsed.nextIndex;
        }
        const memberName = tokens[cursor];
        if (memberName?.kind !== 'identifier' || tokens[cursor + 1]?.value !== ':') {
            failSource(
                source,
                memberName?.offset ?? name.offset,
                `WGSL struct ${name.value} contains a malformed member`
            );
        }
        const typeStart = cursor + 2;
        const commaIndex = topLevelTokenIndex(tokens, typeStart, closeIndex, ',');
        const typeEnd = commaIndex ?? closeIndex;
        if (typeStart === typeEnd) {
            failSource(
                source,
                memberName.offset,
                `WGSL member ${memberName.value} requires a type`
            );
        }
        members.push({
            name: memberName.value,
            typeTokens: Object.freeze(tokens.slice(typeStart, typeEnd)),
            attributes: Object.freeze(attributes),
            offset: memberName.offset
        });
        cursor = commaIndex === null ? closeIndex : commaIndex + 1;
    }
    return {
        declaration: {
            name: name.value,
            members: Object.freeze(members),
            offset: name.offset
        },
        nextIndex: closeIndex + 1
    };
}

function parseAliasDeclaration(
    source: string,
    tokens: readonly SourceToken[],
    aliasIndex: number
): {
    readonly name: string;
    readonly typeTokens: readonly SourceToken[];
    readonly nextIndex: number;
} {
    const aliasToken = tokens[aliasIndex];
    const name = tokens[aliasIndex + 1];
    if (name?.kind !== 'identifier' || tokens[aliasIndex + 2]?.value !== '=') {
        failSource(source, aliasToken?.offset ?? 0, 'WGSL alias declaration is malformed');
    }
    const semicolon = declarationSemicolon(
        source,
        tokens,
        aliasIndex + 3,
        `WGSL alias ${name.value}`
    );
    if (semicolon === aliasIndex + 3) {
        failSource(source, name.offset, `WGSL alias ${name.value} requires a type`);
    }
    return {
        name: name.value,
        typeTokens: Object.freeze(tokens.slice(aliasIndex + 3, semicolon)),
        nextIndex: semicolon + 1
    };
}

function parseConstDeclaration(
    source: string,
    tokens: readonly SourceToken[],
    constIndex: number
): {
    readonly name: string;
    readonly valueTokens: readonly SourceToken[];
    readonly nextIndex: number;
} {
    const constToken = tokens[constIndex];
    const name = tokens[constIndex + 1];
    if (name?.kind !== 'identifier') {
        failSource(source, constToken?.offset ?? 0, 'WGSL const declaration requires a name');
    }
    const semicolon = declarationSemicolon(
        source,
        tokens,
        constIndex + 2,
        `WGSL const ${name.value}`
    );
    const equals = topLevelTokenIndex(tokens, constIndex + 2, semicolon, '=');
    if (equals === null || equals + 1 === semicolon) {
        failSource(source, name.offset, `WGSL const ${name.value} requires an initializer`);
    }
    return {
        name: name.value,
        valueTokens: Object.freeze(tokens.slice(equals + 1, semicolon)),
        nextIndex: semicolon + 1
    };
}

function parseOverrideDeclaration(
    source: string,
    tokens: readonly SourceToken[],
    overrideIndex: number,
    attributes: readonly SourceAttribute[]
): { readonly declaration: SourceOverrideDeclaration; readonly nextIndex: number } {
    const overrideToken = tokens[overrideIndex];
    const name = tokens[overrideIndex + 1];
    if (name?.kind !== 'identifier') {
        failSource(source, overrideToken?.offset ?? 0, 'WGSL override declaration requires a name');
    }
    const semicolon = declarationSemicolon(
        source,
        tokens,
        overrideIndex + 2,
        `WGSL override ${name.value}`
    );
    const equals = topLevelTokenIndex(tokens, overrideIndex + 2, semicolon, '=');
    const colon = topLevelTokenIndex(tokens, overrideIndex + 2, equals ?? semicolon, ':');
    if (colon === null) {
        failSource(
            source,
            name.offset,
            `WGSL override ${name.value} requires an explicit scalar type for reflection`
        );
    }
    const typeEnd = equals ?? semicolon;
    if (colon + 1 === typeEnd) {
        failSource(source, name.offset, `WGSL override ${name.value} requires a type`);
    }
    return {
        declaration: {
            declaredName: name.value,
            typeTokens: Object.freeze(tokens.slice(colon + 1, typeEnd)),
            attributes: Object.freeze([...attributes]),
            required: equals === null,
            declarationOffset: overrideToken?.offset ?? name.offset,
            semicolonOffset: tokens[semicolon]?.offset ?? name.offset,
            offset: name.offset
        },
        nextIndex: semicolon + 1
    };
}

function parseWorkgroupVariable(
    source: string,
    tokens: readonly SourceToken[],
    varIndex: number,
    attributes: readonly SourceAttribute[]
): {
    readonly variable: SourceWorkgroupVariable | null;
    readonly bufferVariable: SourceBufferVariable | null;
    readonly nextIndex: number;
} {
    const varToken = tokens[varIndex];
    let cursor = varIndex + 1;
    let addressSpace: string | null = null;
    if (tokens[cursor]?.value === '<') {
        const close = matchingToken(source, tokens, cursor, '<', '>');
        const arguments_ = splitArguments(tokens.slice(cursor + 1, close));
        addressSpace = compactTokens(arguments_[0] ?? []);
        cursor = close + 1;
    }
    const name = tokens[cursor];
    if (name?.kind !== 'identifier' || tokens[cursor + 1]?.value !== ':') {
        failSource(source, varToken?.offset ?? 0, 'WGSL variable declaration is malformed');
    }
    const semicolon = declarationSemicolon(
        source,
        tokens,
        cursor + 2,
        `WGSL variable ${name.value}`
    );
    const equals = topLevelTokenIndex(tokens, cursor + 2, semicolon, '=');
    const typeEnd = equals ?? semicolon;
    if (cursor + 2 === typeEnd) {
        failSource(source, name.offset, `WGSL variable ${name.value} requires a type`);
    }
    const typeTokens = Object.freeze(tokens.slice(cursor + 2, typeEnd));
    const resourceAddressSpace = addressSpace === 'uniform' || addressSpace === 'storage';
    const group = resourceAddressSpace ? parseLocationAttribute(source, attributes, 'group') : null;
    const binding = resourceAddressSpace
        ? parseLocationAttribute(source, attributes, 'binding')
        : null;
    return {
        variable:
            addressSpace === 'workgroup'
                ? { name: name.value, typeTokens, offset: name.offset }
                : null,
        bufferVariable:
            resourceAddressSpace && group !== null && binding !== null
                ? {
                      name: name.value,
                      group,
                      binding,
                      typeTokens,
                      offset: name.offset
                  }
                : null,
        nextIndex: semicolon + 1
    };
}

function parseFunctionUsage(
    source: string,
    tokens: readonly SourceToken[],
    fnIndex: number
): { readonly usage: SourceFunctionUsage; readonly nextIndex: number } {
    const fn = tokens[fnIndex];
    const name = tokens[fnIndex + 1];
    if (name?.kind !== 'identifier') {
        failSource(source, fn?.offset ?? 0, 'WGSL function declaration requires a name');
    }
    let bodyStart = fnIndex + 2;
    while (bodyStart < tokens.length && tokens[bodyStart]?.value !== '{') {
        if (tokens[bodyStart]?.value === ';') {
            failSource(source, name.offset, `WGSL function ${name.value} requires a body`);
        }
        bodyStart++;
    }
    if (tokens[bodyStart]?.value !== '{') {
        failSource(source, name.offset, `WGSL function ${name.value} requires a body`);
    }
    const bodyEnd = matchingToken(source, tokens, bodyStart, '{', '}');
    const identifiers = new Set<string>();
    for (const token of tokens.slice(bodyStart + 1, bodyEnd)) {
        if (token.kind === 'identifier') identifiers.add(token.value);
    }
    return {
        usage: {
            name: name.value,
            identifiers,
            offset: name.offset
        },
        nextIndex: bodyEnd + 1
    };
}

function staticallyUsedWorkgroupVariables(
    entryPoint: string,
    functions: ReadonlyMap<string, SourceFunctionUsage>,
    variables: readonly SourceWorkgroupVariable[]
): ReadonlySet<string> {
    const workgroupNames = new Set(variables.map(variable => variable.name));
    const entry = functions.get(entryPoint);
    if (entry === undefined) {
        // Entry-point validation reports the source error later. Remain conservative here so an
        // invalid descriptor cannot also under-report its module-scope workgroup footprint.
        return workgroupNames;
    }
    const used = new Set<string>();
    const visitedFunctions = new Set<string>();
    const pending: SourceFunctionUsage[] = [entry];
    for (const current of pending) {
        if (visitedFunctions.has(current.name)) continue;
        visitedFunctions.add(current.name);
        for (const identifier of current.identifiers) {
            if (workgroupNames.has(identifier)) used.add(identifier);
            const callee = functions.get(identifier);
            if (callee !== undefined && !visitedFunctions.has(callee.name)) pending.push(callee);
        }
    }
    return used;
}

function checkedAdd(
    source: string,
    offset: number,
    left: number,
    right: number,
    path: string
): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
        failSource(source, offset, `${path} exceeds the safe integer range`);
    }
    return result;
}

function checkedMultiply(
    source: string,
    offset: number,
    left: number,
    right: number,
    path: string
): number {
    const result = left * right;
    if (!Number.isSafeInteger(result)) {
        failSource(source, offset, `${path} exceeds the safe integer range`);
    }
    return result;
}

function roundUpLayout(
    source: string,
    offset: number,
    alignment: number,
    value: number,
    path: string
): number {
    const remainder = value % alignment;
    return remainder === 0 ? value : checkedAdd(source, offset, value, alignment - remainder, path);
}

function evaluateLayoutInteger(
    source: string,
    tokens: readonly SourceToken[],
    constants: ReadonlyMap<string, readonly SourceToken[]>,
    overrides: ReadonlyMap<string, SourceOverrideDeclaration>,
    path: string,
    resolving: ReadonlySet<string> = new Set()
): number {
    if (tokens.length === 1 && tokens[0]?.kind === 'identifier') {
        const identifier = tokens[0];
        if (overrides.has(identifier.value)) {
            failSource(
                source,
                identifier.offset,
                `${path} depends on pipeline override ${identifier.value}; override-dependent workgroup metadata is unsupported`
            );
        }
        const valueTokens = constants.get(identifier.value);
        if (valueTokens === undefined) {
            failSource(
                source,
                identifier.offset,
                `${path} must be a literal integer or const initialized by one`
            );
        }
        if (resolving.has(identifier.value)) {
            failSource(source, identifier.offset, `${path} contains a recursive const reference`);
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(identifier.value);
        return evaluateLayoutInteger(
            source,
            valueTokens,
            constants,
            overrides,
            path,
            nextResolving
        );
    }
    return parseU32Literal(source, tokens, path);
}

function scalarLayout(type: string): TypeLayout | null {
    switch (type) {
        case 'bool':
        case 'i32':
        case 'u32':
        case 'f32':
            return { alignment: 4, size: 4 };
        case 'f16':
            return { alignment: 2, size: 2 };
        default:
            return null;
    }
}

function vectorLayout(componentType: string, width: number): TypeLayout | null {
    const component = scalarLayout(componentType);
    if (component === null || width < 2 || width > 4) return null;
    return {
        alignment: component.alignment * (width === 2 ? 2 : 4),
        size: component.size * width
    };
}

function resolveOverrideType(
    environment: TypeLayoutEnvironment,
    declaration: SourceOverrideDeclaration,
    resolving: ReadonlySet<string> = new Set()
): RHIShaderOverrideReflection['type'] {
    if (declaration.typeTokens.length !== 1 || declaration.typeTokens[0]?.kind !== 'identifier') {
        failSource(
            environment.source,
            declaration.offset,
            `WGSL override ${declaration.declaredName} must use a concrete scalar type`
        );
    }
    const typeName = declaration.typeTokens[0].value;
    if (['bool', 'f16', 'f32', 'i32', 'u32'].includes(typeName)) {
        return typeName as RHIShaderOverrideReflection['type'];
    }
    const alias = environment.aliases.get(typeName);
    if (alias === undefined || resolving.has(typeName)) {
        failSource(
            environment.source,
            declaration.offset,
            `WGSL override ${declaration.declaredName} has unsupported type ${typeName}`
        );
    }
    const synthetic: SourceOverrideDeclaration = {
        ...declaration,
        typeTokens: alias
    };
    const nextResolving = new Set(resolving);
    nextResolving.add(typeName);
    return resolveOverrideType(environment, synthetic, nextResolving);
}

function layoutAttributeValue(
    environment: TypeLayoutEnvironment,
    attributes: readonly SourceAttribute[],
    name: 'align' | 'size',
    path: string
): number | null {
    const attribute = attributeNamed(environment.source, attributes, name);
    if (attribute === null) return null;
    if (attribute.arguments === null) {
        failSource(environment.source, attribute.offset, `${name} attribute requires an argument`);
    }
    return evaluateLayoutInteger(
        environment.source,
        attribute.arguments,
        environment.constants,
        environment.overrides,
        `${path} ${name}`
    );
}

function layoutStruct(
    environment: TypeLayoutEnvironment,
    declaration: SourceStructDeclaration,
    resolving: ReadonlySet<string>
): TypeLayout {
    if (declaration.members.length === 0) {
        failSource(
            environment.source,
            declaration.offset,
            `WGSL struct ${declaration.name} has no fixed layout members`
        );
    }
    let structureAlignment = 1;
    let justPastMember = 0;
    for (const member of declaration.members) {
        const unsupportedAttribute = member.attributes.find(
            attribute => attribute.name !== 'align' && attribute.name !== 'size'
        );
        if (unsupportedAttribute !== undefined) {
            failSource(
                environment.source,
                unsupportedAttribute.offset,
                `WGSL workgroup struct member ${declaration.name}.${member.name} uses unsupported ${unsupportedAttribute.name} layout metadata`
            );
        }
        const natural = layoutType(environment, member.typeTokens, resolving);
        const explicitAlignment = layoutAttributeValue(
            environment,
            member.attributes,
            'align',
            `${declaration.name}.${member.name}`
        );
        const memberAlignment = explicitAlignment ?? natural.alignment;
        if (
            memberAlignment < natural.alignment ||
            (memberAlignment & (memberAlignment - 1)) !== 0
        ) {
            failSource(
                environment.source,
                member.offset,
                `${declaration.name}.${member.name} has an invalid alignment`
            );
        }
        const explicitSize = layoutAttributeValue(
            environment,
            member.attributes,
            'size',
            `${declaration.name}.${member.name}`
        );
        const memberSize = explicitSize ?? natural.size;
        if (memberSize < natural.size) {
            failSource(
                environment.source,
                member.offset,
                `${declaration.name}.${member.name} size is smaller than its type`
            );
        }
        const memberOffset = roundUpLayout(
            environment.source,
            member.offset,
            memberAlignment,
            justPastMember,
            `${declaration.name} layout`
        );
        justPastMember = checkedAdd(
            environment.source,
            member.offset,
            memberOffset,
            memberSize,
            `${declaration.name} layout`
        );
        structureAlignment = Math.max(structureAlignment, memberAlignment);
    }
    return {
        alignment: structureAlignment,
        size: roundUpLayout(
            environment.source,
            declaration.offset,
            structureAlignment,
            justPastMember,
            `${declaration.name} layout`
        )
    };
}

function layoutType(
    environment: TypeLayoutEnvironment,
    tokens: readonly SourceToken[],
    resolving: ReadonlySet<string> = new Set()
): TypeLayout {
    const first = tokens[0];
    if (first?.kind !== 'identifier') {
        failSource(
            environment.source,
            first?.offset ?? 0,
            'WGSL workgroup variable uses an unsupported type expression'
        );
    }
    if (tokens.length === 1) {
        const scalar = scalarLayout(first.value);
        if (scalar !== null) return scalar;

        const shortVector = /^vec([234])([fiuh])$/u.exec(first.value);
        if (shortVector !== null) {
            const component = { f: 'f32', i: 'i32', u: 'u32', h: 'f16' }[shortVector[2] ?? ''];
            const layout = vectorLayout(component ?? '', Number(shortVector[1]));
            if (layout !== null) return layout;
        }
        const shortMatrix = /^mat([234])x([234])([fh])$/u.exec(first.value);
        if (shortMatrix !== null) {
            const columns = Number(shortMatrix[1]);
            const rows = Number(shortMatrix[2]);
            const component = shortMatrix[3] === 'h' ? 'f16' : 'f32';
            const column = vectorLayout(component, rows);
            if (column !== null) {
                const stride = roundUpLayout(
                    environment.source,
                    first.offset,
                    column.alignment,
                    column.size,
                    `WGSL type ${first.value}`
                );
                return {
                    alignment: column.alignment,
                    size: checkedMultiply(
                        environment.source,
                        first.offset,
                        columns,
                        stride,
                        `WGSL type ${first.value}`
                    )
                };
            }
        }

        if (resolving.has(first.value)) {
            failSource(
                environment.source,
                first.offset,
                `WGSL type ${first.value} contains a recursive alias or struct`
            );
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(first.value);
        const alias = environment.aliases.get(first.value);
        if (alias !== undefined) return layoutType(environment, alias, nextResolving);
        const structure = environment.structures.get(first.value);
        if (structure !== undefined) return layoutStruct(environment, structure, nextResolving);
        failSource(
            environment.source,
            first.offset,
            `WGSL workgroup type ${first.value} has no supported fixed layout`
        );
    }

    if (tokens[1]?.value !== '<') {
        failSource(
            environment.source,
            first.offset,
            `WGSL workgroup type ${compactTokens(tokens)} has unsupported syntax`
        );
    }
    const closeIndex = matchingToken(environment.source, tokens, 1, '<', '>');
    if (closeIndex !== tokens.length - 1) {
        failSource(
            environment.source,
            tokens[closeIndex + 1]?.offset ?? first.offset,
            `WGSL workgroup type ${compactTokens(tokens)} has trailing syntax`
        );
    }
    const arguments_ = splitArguments(tokens.slice(2, closeIndex));
    const vector = /^vec([234])$/u.exec(first.value);
    if (vector !== null && arguments_.length === 1) {
        const componentType = compactTokens(arguments_[0] ?? []);
        const layout = vectorLayout(componentType, Number(vector[1]));
        if (layout !== null) return layout;
    }
    const matrix = /^mat([234])x([234])$/u.exec(first.value);
    if (matrix !== null && arguments_.length === 1) {
        const componentType = compactTokens(arguments_[0] ?? []);
        const columns = Number(matrix[1]);
        const rows = Number(matrix[2]);
        if (componentType === 'f32' || componentType === 'f16') {
            const column = vectorLayout(componentType, rows);
            if (column !== null) {
                const stride = roundUpLayout(
                    environment.source,
                    first.offset,
                    column.alignment,
                    column.size,
                    `WGSL type ${first.value}`
                );
                return {
                    alignment: column.alignment,
                    size: checkedMultiply(
                        environment.source,
                        first.offset,
                        columns,
                        stride,
                        `WGSL type ${first.value}`
                    )
                };
            }
        }
    }
    if (first.value === 'atomic' && arguments_.length === 1) {
        const componentType = compactTokens(arguments_[0] ?? []);
        if (componentType === 'i32' || componentType === 'u32') {
            return { alignment: 4, size: 4 };
        }
    }
    if (first.value === 'array') {
        if (
            arguments_.length !== 2 &&
            !(arguments_.length === 1 && environment.runtimeArrayElementCount !== null)
        ) {
            failSource(
                environment.source,
                first.offset,
                'WGSL layout array requires a fixed element count'
            );
        }
        const elementTokens = arguments_[0] ?? [];
        const element = layoutType(environment, elementTokens, resolving);
        const countTokens = arguments_[1];
        const count =
            countTokens === undefined
                ? (environment.runtimeArrayElementCount ?? 0)
                : evaluateLayoutInteger(
                      environment.source,
                      countTokens,
                      environment.constants,
                      environment.overrides,
                      'WGSL array element count'
                  );
        if (count < 1) {
            failSource(
                environment.source,
                countTokens?.[0]?.offset ?? first.offset,
                'WGSL array element count must be positive'
            );
        }
        const stride = roundUpLayout(
            environment.source,
            first.offset,
            element.alignment,
            element.size,
            'WGSL array stride'
        );
        return {
            alignment: element.alignment,
            size: checkedMultiply(
                environment.source,
                first.offset,
                count,
                stride,
                'WGSL array size'
            )
        };
    }
    failSource(
        environment.source,
        first.offset,
        `WGSL workgroup type ${compactTokens(tokens)} has no supported fixed layout`
    );
}

function overrideReflection(
    environment: TypeLayoutEnvironment,
    declaration: SourceOverrideDeclaration
): Readonly<RHIShaderOverrideReflection> {
    const idAttribute = attributeNamed(environment.source, declaration.attributes, 'id');
    const unsupportedAttribute = declaration.attributes.find(attribute => attribute.name !== 'id');
    if (unsupportedAttribute !== undefined) {
        failSource(
            environment.source,
            unsupportedAttribute.offset,
            `WGSL override ${declaration.declaredName} uses unsupported ${unsupportedAttribute.name} metadata`
        );
    }
    let name = declaration.declaredName;
    if (idAttribute !== null) {
        if (idAttribute.arguments === null) {
            failSource(environment.source, idAttribute.offset, 'id attribute requires an argument');
        }
        const id = evaluateLayoutInteger(
            environment.source,
            idAttribute.arguments,
            environment.constants,
            environment.overrides,
            `WGSL override ${declaration.declaredName} id`
        );
        if (id > 65_535) {
            failSource(environment.source, idAttribute.offset, 'WGSL override id exceeds 65535');
        }
        name = String(id);
    }
    return Object.freeze({
        name,
        type: resolveOverrideType(environment, declaration),
        required: declaration.required
    });
}

interface SourceRewrite {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

function blankSourceRange(source: string, start: number, end: number): string {
    return source
        .slice(start, end)
        .split('')
        .map(character => (character === '\n' ? '\n' : ' '))
        .join('');
}

function overrideValidationDefault(type: RHIShaderOverrideReflection['type']): string {
    switch (type) {
        case 'bool':
            return 'false';
        case 'f16':
            return '0.0h';
        case 'f32':
            return '0.0f';
        case 'i32':
            return '0i';
        case 'u32':
            return '0u';
    }
}

function createNagaValidationSource(
    environment: TypeLayoutEnvironment,
    declarations: readonly SourceOverrideDeclaration[]
): string {
    if (declarations.length === 0) return environment.source;
    const rewrites: SourceRewrite[] = [];
    for (const declaration of declarations) {
        const type = resolveOverrideType(environment, declaration);
        rewrites.push({
            start: declaration.declarationOffset,
            end: declaration.declarationOffset + 'override'.length,
            text: 'const'
        });
        const idAttribute = attributeNamed(environment.source, declaration.attributes, 'id');
        if (idAttribute !== null) {
            rewrites.push({
                start: idAttribute.offset,
                end: declaration.declarationOffset,
                text: blankSourceRange(
                    environment.source,
                    idAttribute.offset,
                    declaration.declarationOffset
                )
            });
        }
        if (declaration.required) {
            rewrites.push({
                start: declaration.semicolonOffset,
                end: declaration.semicolonOffset,
                text: ` = ${overrideValidationDefault(type)}`
            });
        }
    }
    rewrites.sort((left, right) => right.start - left.start || right.end - left.end);
    let result = environment.source;
    for (const rewrite of rewrites) {
        result = `${result.slice(0, rewrite.start)}${rewrite.text}${result.slice(rewrite.end)}`;
    }
    return result;
}

/**
 * web-naga 1.0.1 parses modern f16 WGSL but its WGSL writer traps while validating it. Preserve
 * the exact-source frontend parse, then validate an isomorphic f32 specialization through Naga's
 * validator/writer. The exact f16 source remains the native artifact and is capability-gated by
 * the RHI before WebGPU performs its own shader-module and pipeline validation.
 */
function createNagaF16ValidationSource(source: string): string {
    const tokens = tokenize(source);
    const rewrites: SourceRewrite[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined) continue;
        if (
            token.value === 'enable' &&
            tokens[index + 1]?.value === 'f16' &&
            tokens[index + 2]?.value === ';'
        ) {
            const end = (tokens[index + 2]?.offset ?? token.offset) + 1;
            rewrites.push({
                start: token.offset,
                end,
                text: blankSourceRange(source, token.offset, end)
            });
            index += 2;
            continue;
        }
        let replacement: string | null = null;
        if (token.kind === 'identifier') {
            if (token.value === 'f16') replacement = 'f32';
            else if (/^vec[234]h$/u.test(token.value)) {
                replacement = `${token.value.slice(0, -1)}f`;
            } else if (/^mat[234]x[234]h$/u.test(token.value)) {
                replacement = `${token.value.slice(0, -1)}f`;
            }
        } else if (token.kind === 'number' && token.value.endsWith('h')) {
            replacement = `${token.value.slice(0, -1)}f`;
        }
        if (replacement !== null) {
            rewrites.push({
                start: token.offset,
                end: token.offset + token.value.length,
                text: replacement
            });
        }
    }
    rewrites.sort((left, right) => right.start - left.start || right.end - left.end);
    let result = source;
    for (const rewrite of rewrites) {
        result = `${result.slice(0, rewrite.start)}${rewrite.text}${result.slice(rewrite.end)}`;
    }
    return result;
}

function analyzeComputeMetadata(source: string, entryPoint: string): ComputeModuleMetadata {
    const tokens = tokenize(source);
    const requiresF16 = tokens.some(
        token =>
            token.kind === 'identifier' &&
            (token.value === 'f16' ||
                /^vec[234]h$/u.test(token.value) ||
                /^mat[234]x[234]h$/u.test(token.value))
    );
    const aliases = new Map<string, readonly SourceToken[]>();
    const structures = new Map<string, SourceStructDeclaration>();
    const constants = new Map<string, readonly SourceToken[]>();
    const overrides = new Map<string, SourceOverrideDeclaration>();
    const workgroupVariables: SourceWorkgroupVariable[] = [];
    const bufferVariables: SourceBufferVariable[] = [];
    const functions = new Map<string, SourceFunctionUsage>();
    let attributes: SourceAttribute[] = [];
    let braceDepth = 0;
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === undefined) break;
        if (braceDepth > 0) {
            if (token.value === '{') braceDepth++;
            if (token.value === '}') braceDepth--;
            index++;
            continue;
        }
        if (token.value === '@') {
            const parsed = parseAttribute(source, tokens, index);
            attributes.push(parsed.attribute);
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'struct') {
            const parsed = parseStructDeclaration(source, tokens, index);
            structures.set(parsed.declaration.name, parsed.declaration);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'alias') {
            const parsed = parseAliasDeclaration(source, tokens, index);
            aliases.set(parsed.name, parsed.typeTokens);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'const') {
            const parsed = parseConstDeclaration(source, tokens, index);
            constants.set(parsed.name, parsed.valueTokens);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'override') {
            const parsed = parseOverrideDeclaration(source, tokens, index, attributes);
            overrides.set(parsed.declaration.declaredName, parsed.declaration);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'var') {
            const parsed = parseWorkgroupVariable(source, tokens, index, attributes);
            if (parsed.variable !== null) workgroupVariables.push(parsed.variable);
            if (parsed.bufferVariable !== null) bufferVariables.push(parsed.bufferVariable);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'fn') {
            // ComputeShader exposes a fixed workgroup contract. Reject override-driven dimensions
            // before older Naga builds can reach their backend assertion path.
            void parseWorkgroupSize(source, attributes);
            const parsed = parseFunctionUsage(source, tokens, index);
            if (functions.has(parsed.usage.name)) {
                failSource(
                    source,
                    parsed.usage.offset,
                    `WGSL contains duplicate function ${parsed.usage.name}`
                );
            }
            functions.set(parsed.usage.name, parsed.usage);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === '{') {
            braceDepth++;
            attributes = [];
        } else if (token.value === ';' || token.kind === 'identifier') {
            attributes = [];
        }
        index++;
    }

    const environment: TypeLayoutEnvironment = {
        source,
        aliases,
        structures,
        constants,
        overrides,
        runtimeArrayElementCount: null
    };
    let workgroupStorageSize = 0;
    const staticallyUsed = staticallyUsedWorkgroupVariables(
        entryPoint,
        functions,
        workgroupVariables
    );
    for (const variable of workgroupVariables) {
        if (!staticallyUsed.has(variable.name)) continue;
        const layout = layoutType(environment, variable.typeTokens);
        workgroupStorageSize = checkedAdd(
            source,
            variable.offset,
            workgroupStorageSize,
            roundUpLayout(
                source,
                variable.offset,
                16,
                layout.size,
                `WGSL workgroup variable ${variable.name} allocation size`
            ),
            'WGSL workgroup storage size'
        );
    }
    const overrideDeclarations = [...overrides.values()];
    const reflectedOverrides = Object.freeze(
        overrideDeclarations.map(declaration => overrideReflection(environment, declaration))
    );
    const seenOverrideNames = new Set<string>();
    for (const override of reflectedOverrides) {
        if (seenOverrideNames.has(override.name)) {
            throw new TypeError(
                `WGSL contains duplicate pipeline override identifier ${override.name}`
            );
        }
        seenOverrideNames.add(override.name);
    }
    const bufferMinBindingSizes = new Map<string, number>();
    const bufferEnvironment: TypeLayoutEnvironment = {
        ...environment,
        runtimeArrayElementCount: 1
    };
    for (const variable of bufferVariables) {
        const key = `${String(variable.group)}:${String(variable.binding)}`;
        if (bufferMinBindingSizes.has(key)) {
            failSource(source, variable.offset, `WGSL contains duplicate buffer binding ${key}`);
        }
        bufferMinBindingSizes.set(key, layoutType(bufferEnvironment, variable.typeTokens).size);
    }
    return {
        workgroupStorageSize,
        overrides: reflectedOverrides,
        requiresF16,
        nagaValidationSource: createNagaValidationSource(environment, overrideDeclarations),
        bufferMinBindingSizes
    };
}

function sourceViewDimension(value: string): ShaderTextureViewDimension | null {
    switch (value) {
        case '2d':
            return '2d';
        case '2d_array':
            return '2d-array';
        case '3d':
            return '3d';
        case 'cube':
            return 'cube';
        default:
            return null;
    }
}

function classifyHandleBinding(
    source: string,
    type: string,
    base: Omit<SourceBinding, 'kind'>
): SourceBinding {
    if (type === 'sampler') return { ...base, kind: 'sampler' };
    if (type === 'sampler_comparison') return { ...base, kind: 'comparison-sampler' };

    const depth = /^texture_depth_(2d|2d_array|cube)$/u.exec(type);
    if (depth) {
        const viewDimension = sourceViewDimension(depth[1] ?? '');
        if (viewDimension === null) {
            failSource(source, base.offset, `Unsupported sampled texture type ${type}`);
        }
        return { ...base, kind: 'sampled-texture', sampledComponent: 'depth', viewDimension };
    }

    const sampled = /^texture_(2d|2d_array|3d|cube)<(f32|i32|u32)>$/u.exec(type);
    if (sampled) {
        const viewDimension = sourceViewDimension(sampled[1] ?? '');
        const sampledComponent = sampled[2];
        if (
            viewDimension === null ||
            (sampledComponent !== 'f32' && sampledComponent !== 'i32' && sampledComponent !== 'u32')
        ) {
            failSource(source, base.offset, `Unsupported sampled texture type ${type}`);
        }
        return { ...base, kind: 'sampled-texture', sampledComponent, viewDimension };
    }

    const storage = /^texture_storage_(2d|2d_array|3d)<([a-z0-9_]+),(write)>$/u.exec(type);
    if (storage) {
        const viewDimension = sourceViewDimension(storage[1] ?? '');
        const storageTextureFormat = storage[2];
        if (
            viewDimension === null ||
            viewDimension === 'cube' ||
            storageTextureFormat === undefined
        ) {
            failSource(source, base.offset, `Unsupported storage texture type ${type}`);
        }
        return {
            ...base,
            kind: 'storage-texture',
            storageTextureFormat,
            storageTextureAccess: 'write',
            viewDimension
        };
    }

    failSource(source, base.offset, `Unsupported bound WGSL resource type ${type}`);
}

function parseVariable(
    source: string,
    tokens: readonly SourceToken[],
    varIndex: number,
    attributes: readonly SourceAttribute[]
): { readonly binding: SourceBinding | null; readonly nextIndex: number } {
    const varToken = tokens[varIndex];
    let cursor = varIndex + 1;
    let addressSpace: string | null = null;
    let accessMode: string | null = null;
    if (tokens[cursor]?.value === '<') {
        const close = matchingToken(source, tokens, cursor, '<', '>');
        const arguments_ = splitArguments(tokens.slice(cursor + 1, close));
        addressSpace = compactTokens(arguments_[0] ?? []);
        accessMode = arguments_[1] === undefined ? null : compactTokens(arguments_[1]);
        cursor = close + 1;
    }
    const name = tokens[cursor];
    if (name?.kind !== 'identifier') {
        failSource(source, varToken?.offset ?? 0, 'WGSL variable declaration requires a name');
    }
    if (tokens[cursor + 1]?.value !== ':') {
        failSource(source, name.offset, `WGSL variable ${name.value} requires a type`);
    }
    const typeStart = cursor + 2;
    let semicolon = typeStart;
    while (semicolon < tokens.length && tokens[semicolon]?.value !== ';') semicolon++;
    if (tokens[semicolon]?.value !== ';') {
        failSource(source, name.offset, `WGSL variable ${name.value} is missing a semicolon`);
    }
    const type = compactTokens(tokens.slice(typeStart, semicolon));
    const group = parseLocationAttribute(source, attributes, 'group');
    const binding = parseLocationAttribute(source, attributes, 'binding');
    const resourceAddressSpace = addressSpace === 'uniform' || addressSpace === 'storage';
    const recognizedHandle =
        type === 'sampler' || type === 'sampler_comparison' || type.startsWith('texture_');
    if (group === null && binding === null) {
        if (resourceAddressSpace || recognizedHandle) {
            failSource(
                source,
                name.offset,
                `WGSL resource ${name.value} requires group and binding`
            );
        }
        return { binding: null, nextIndex: semicolon + 1 };
    }
    if (group === null || binding === null) {
        failSource(
            source,
            name.offset,
            `WGSL resource ${name.value} requires both group and binding`
        );
    }

    const base = { name: name.value, group, binding, offset: name.offset } as const;
    if (addressSpace === 'uniform') {
        if (accessMode !== null) {
            failSource(
                source,
                name.offset,
                `Uniform buffer ${name.value} cannot declare an access mode`
            );
        }
        return { binding: { ...base, kind: 'uniform-buffer' }, nextIndex: semicolon + 1 };
    }
    if (addressSpace === 'storage') {
        if (accessMode === null || accessMode === 'read') {
            return {
                binding: { ...base, kind: 'read-only-storage-buffer' },
                nextIndex: semicolon + 1
            };
        }
        if (accessMode === 'read_write') {
            return { binding: { ...base, kind: 'storage-buffer' }, nextIndex: semicolon + 1 };
        }
        failSource(source, name.offset, `Unsupported storage access mode ${accessMode}`);
    }
    if (addressSpace !== null) {
        failSource(
            source,
            name.offset,
            `Bound resource ${name.value} uses ${addressSpace} address space`
        );
    }
    return {
        binding: classifyHandleBinding(source, type, base),
        nextIndex: semicolon + 1
    };
}

function parseFunction(
    source: string,
    tokens: readonly SourceToken[],
    fnIndex: number,
    attributes: readonly SourceAttribute[]
): SourceEntryPoint {
    const fn = tokens[fnIndex];
    const name = tokens[fnIndex + 1];
    if (name?.kind !== 'identifier') {
        failSource(source, fn?.offset ?? 0, 'WGSL function declaration requires a name');
    }
    const stages = (['compute', 'vertex', 'fragment'] as const).filter(
        stage => attributeNamed(source, attributes, stage) !== null
    );
    if (stages.length > 1) {
        failSource(source, name.offset, `WGSL function ${name.value} declares multiple stages`);
    }
    const stage = stages[0] ?? null;
    return {
        name: name.value,
        stage,
        workgroupSize: parseWorkgroupSize(source, attributes),
        offset: name.offset
    };
}

function analyzeSource(source: string): SourceInterface {
    const tokens = tokenize(source);
    const bindings: SourceBinding[] = [];
    const entryPoints: SourceEntryPoint[] = [];
    let attributes: SourceAttribute[] = [];
    let braceDepth = 0;
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === undefined) break;
        if (braceDepth > 0) {
            if (token.value === '{') braceDepth++;
            if (token.value === '}') braceDepth--;
            index++;
            continue;
        }
        if (token.value === '@') {
            const parsed = parseAttribute(source, tokens, index);
            attributes.push(parsed.attribute);
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'var') {
            const parsed = parseVariable(source, tokens, index, attributes);
            if (parsed.binding !== null) bindings.push(parsed.binding);
            attributes = [];
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === 'fn') {
            entryPoints.push(parseFunction(source, tokens, index, attributes));
            attributes = [];
            index += 2;
            continue;
        }
        if (token.value === '{') {
            braceDepth++;
            attributes = [];
        } else if (token.value === ';' || token.kind === 'identifier') {
            attributes = [];
        }
        index++;
    }
    return { bindings: Object.freeze(bindings), entryPoints: Object.freeze(entryPoints) };
}

function validateEntryPoint(shader: ComputeShader, sourceInterface: SourceInterface): void {
    const graphicsEntry = sourceInterface.entryPoints.find(
        entry => entry.stage === 'vertex' || entry.stage === 'fragment'
    );
    if (graphicsEntry !== undefined) {
        failSource(
            shader.source,
            graphicsEntry.offset,
            `Direct WGSL compute source cannot contain ${String(graphicsEntry.stage)} entry ${graphicsEntry.name}`
        );
    }
    const named = sourceInterface.entryPoints.filter(entry => entry.name === shader.entryPoint);
    if (named.length !== 1 || named[0] === undefined) {
        throw new TypeError(
            `ComputeShader entry point ${shader.entryPoint} must name exactly one WGSL function`
        );
    }
    const entry = named[0];
    if (entry.stage !== 'compute') {
        failSource(
            shader.source,
            entry.offset,
            `ComputeShader entry ${shader.entryPoint} is not compute`
        );
    }
    if (entry.workgroupSize === null) {
        failSource(
            shader.source,
            entry.offset,
            `ComputeShader entry ${shader.entryPoint} requires workgroup_size`
        );
    }
    if (entry.workgroupSize.some((value, index) => value !== shader.workgroupSize[index])) {
        failSource(
            shader.source,
            entry.offset,
            `ComputeShader workgroupSize ${shader.workgroupSize.join('x')} does not match WGSL ${entry.workgroupSize.join('x')}`
        );
    }
}

function compatibleSampleType(
    descriptor: ComputeTextureSampleType,
    source: NonNullable<SourceBinding['sampledComponent']>
): boolean {
    switch (source) {
        case 'f32':
            return descriptor === 'float' || descriptor === 'unfilterable-float';
        case 'i32':
        case 'u32':
            return false;
        case 'depth':
            return descriptor === 'depth';
    }
}

function validateBindingMetadata(
    shader: ComputeShader,
    descriptor: ComputeShaderBinding,
    source: SourceBinding
): void {
    const path = `ComputeShader binding ${String(descriptor.group)}:${String(descriptor.binding)}`;
    if (descriptor.name !== source.name) {
        failSource(
            shader.source,
            source.offset,
            `${path} names ${descriptor.name}, but WGSL declares ${source.name}`
        );
    }
    const sourceCompatibleKind =
        descriptor.kind === 'non-filtering-sampler' ? 'sampler' : descriptor.kind;
    if (sourceCompatibleKind !== source.kind) {
        failSource(
            shader.source,
            source.offset,
            `${path} is ${descriptor.kind}, but WGSL declares ${source.kind}`
        );
    }
    if (descriptor.kind === 'sampled-texture') {
        if (
            source.sampledComponent === undefined ||
            !compatibleSampleType(descriptor.sampleType, source.sampledComponent)
        ) {
            failSource(
                shader.source,
                source.offset,
                `${path} sampleType ${descriptor.sampleType} does not match WGSL`
            );
        }
        if ((descriptor.viewDimension ?? '2d') !== source.viewDimension) {
            failSource(
                shader.source,
                source.offset,
                `${path} viewDimension ${descriptor.viewDimension ?? '2d'} does not match WGSL ${String(source.viewDimension)}`
            );
        }
    }
    if (descriptor.kind === 'storage-texture') {
        if (source.storageTextureAccess !== 'write') {
            failSource(shader.source, source.offset, `${path} must be write-only in WGSL`);
        }
        if (descriptor.format !== source.storageTextureFormat) {
            failSource(
                shader.source,
                source.offset,
                `${path} format ${descriptor.format} does not match WGSL ${String(source.storageTextureFormat)}`
            );
        }
        if ((descriptor.viewDimension ?? '2d') !== source.viewDimension) {
            failSource(
                shader.source,
                source.offset,
                `${path} viewDimension ${descriptor.viewDimension ?? '2d'} does not match WGSL ${String(source.viewDimension)}`
            );
        }
    }
}

function validateBindings(shader: ComputeShader, sourceInterface: SourceInterface): void {
    const sourceByLocation = new Map<string, SourceBinding>();
    for (const binding of sourceInterface.bindings) {
        const key = `${String(binding.group)}:${String(binding.binding)}`;
        if (sourceByLocation.has(key)) {
            failSource(
                shader.source,
                binding.offset,
                `WGSL contains duplicate resource binding ${key}`
            );
        }
        sourceByLocation.set(key, binding);
    }
    for (const descriptor of shader.bindings) {
        const key = `${String(descriptor.group)}:${String(descriptor.binding)}`;
        const source = sourceByLocation.get(key);
        if (source === undefined) {
            throw new TypeError(`ComputeShader ABI binding ${key} is absent from WGSL source`);
        }
        validateBindingMetadata(shader, descriptor, source);
        sourceByLocation.delete(key);
    }
    const extra = sourceByLocation.values().next().value;
    if (extra !== undefined) {
        failSource(
            shader.source,
            extra.offset,
            `WGSL resource ${extra.name} at ${String(extra.group)}:${String(extra.binding)} is absent from ComputeShader ABI`
        );
    }
}

function reflectionBinding(binding: ComputeShaderBinding): Readonly<RHIShaderBindingReflection> {
    const base = {
        name: binding.name,
        group: binding.group,
        binding: binding.binding,
        kind: binding.kind === 'non-filtering-sampler' ? ('sampler' as const) : binding.kind
    } as const;
    switch (binding.kind) {
        case 'uniform-buffer':
        case 'read-only-storage-buffer':
        case 'storage-buffer':
            return Object.freeze({
                ...base,
                ...(binding.minBindingSize === undefined
                    ? {}
                    : { minBindingSize: binding.minBindingSize })
            });
        case 'sampled-texture':
            return Object.freeze({
                ...base,
                sampleType: binding.sampleType,
                viewDimension: binding.viewDimension ?? '2d',
                multisampled: false
            });
        case 'sampler':
        case 'non-filtering-sampler':
        case 'comparison-sampler':
            return Object.freeze(base);
        case 'storage-texture':
            return Object.freeze({
                ...base,
                storageTextureAccess: binding.access,
                storageTextureFormat: binding.format,
                viewDimension: binding.viewDimension ?? '2d'
            });
    }
}

function deriveBufferBindingSizes(
    shader: ComputeShader,
    metadata: ComputeModuleMetadata
): readonly ComputeShaderBinding[] {
    return Object.freeze(
        shader.bindings.map(binding => {
            if (
                binding.kind !== 'uniform-buffer' &&
                binding.kind !== 'read-only-storage-buffer' &&
                binding.kind !== 'storage-buffer'
            ) {
                return binding;
            }
            const key = `${String(binding.group)}:${String(binding.binding)}`;
            const exact = metadata.bufferMinBindingSizes.get(key);
            if (exact === undefined) {
                throw new TypeError(`ComputeShader buffer binding ${key} has no WGSL store type`);
            }
            if (binding.minBindingSize !== undefined && binding.minBindingSize < exact) {
                throw new RangeError(
                    `ComputeShader binding ${key} minBindingSize ${String(binding.minBindingSize)} is below the shader-derived minimum ${String(exact)}`
                );
            }
            return Object.freeze({ ...binding, minBindingSize: exact });
        })
    );
}

function createReflection(
    bindings: readonly ComputeShaderBinding[],
    workgroupSize: NormalizedComputeWorkgroupSize,
    metadata: ComputeModuleMetadata
): Readonly<RHIShaderReflection> {
    return Object.freeze({
        bindings: Object.freeze(bindings.map(reflectionBinding)),
        workgroupSize,
        workgroupStorageSize: metadata.workgroupStorageSize,
        overrides: metadata.overrides,
        requiresF16: metadata.requiresF16
    });
}

/** Validates Direct WGSL and compiles its explicit ABI into backend-neutral reflection. */
export class WgslComputeShaderCompiler {
    #initialized = false;
    #records = new WeakMap<ComputeShader, CompiledWgslComputeShader>();
    #nextCacheKey = 1;

    get initialized(): boolean {
        return this.#initialized;
    }

    async initialize(): Promise<void> {
        if (this.#initialized) return;
        await initializeNagaModule();
        this.#initialized = true;
    }

    compile(shader: ComputeShader): CompiledWgslComputeShader {
        if (!this.#initialized) {
            throw new Error('WgslComputeShaderCompiler.initialize() is required');
        }
        const cached = this.#records.get(shader);
        if (cached !== undefined) return cached;
        const compiler = getInitializedNagaModule();
        if (compiler === null) throw new Error('Naga module is unavailable after initialization');
        try {
            // Preserve Naga's original source diagnostics before the constrained metadata parser
            // performs its stricter workgroup/override reflection.
            useNagaResource(compiler.WgslFrontend.new(), frontend => {
                useNagaShaderModule(frontend.parse(shader.source), () => undefined);
            });
        } catch (error: unknown) {
            throw new WgslComputeCompilationError(shader.source, error);
        }
        // Reflect constrained module metadata before invoking Naga. This intentionally catches
        // unsupported override-dependent workgroup footprints before some Naga versions reach an
        // internal assertion instead of returning a source diagnostic.
        const metadata = analyzeComputeMetadata(shader.source, shader.entryPoint);
        try {
            useNagaResource(compiler.WgslFrontend.new(), frontend => {
                const nagaValidationSource = metadata.requiresF16
                    ? createNagaF16ValidationSource(metadata.nagaValidationSource)
                    : metadata.nagaValidationSource;
                if (nagaValidationSource !== shader.source) {
                    // web-naga 1.0.1 parses override declarations but its WGSL writer reaches an
                    // internal assertion when serializing them. Parse the original first, then run
                    // Naga's validator/backend against a metadata-derived const specialization.
                    // The native artifact remains the original Direct WGSL source.
                    useNagaShaderModule(frontend.parse(shader.source), () => undefined);
                    useNagaShaderModule(frontend.parse(nagaValidationSource), activeModule => {
                        void activeModule.to_wgsl();
                    });
                } else {
                    const module = frontend.parse(shader.source);
                    useNagaShaderModule(module, activeModule => {
                        // Parsing alone only exercises Naga's WGSL frontend. Serializing the module
                        // runs the validator/backend path as well, so semantically invalid Direct
                        // WGSL fails before any renderer-local pipeline object is created.
                        void activeModule.to_wgsl();
                    });
                }
            });
        } catch (error: unknown) {
            throw new WgslComputeCompilationError(shader.source, error);
        }

        const sourceInterface = analyzeSource(shader.source);
        validateEntryPoint(shader, sourceInterface);
        validateBindings(shader, sourceInterface);
        const compiledBindings = deriveBufferBindingSizes(shader, metadata);
        const cacheKey = this.allocateCacheKey();
        const compiled = Object.freeze({
            source: shader.source,
            entryPoint: shader.entryPoint,
            workgroupSize: shader.workgroupSize,
            bindings: compiledBindings,
            reflection: createReflection(compiledBindings, shader.workgroupSize, metadata),
            cacheKey
        });
        this.#records.set(shader, compiled);
        return compiled;
    }

    clear(): void {
        this.#records = new WeakMap();
    }

    private allocateCacheKey(): number {
        const cacheKey = this.#nextCacheKey++;
        if (!Number.isSafeInteger(cacheKey)) {
            throw new RangeError('Compute shader cache key space is exhausted');
        }
        return cacheKey;
    }
}
