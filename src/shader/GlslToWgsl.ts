import type * as Naga from 'web-naga';
import {
    getWebGPUUniformBlockBinding,
    type WebGPUResourceBinding
} from '../renderer/webgpu/WebGPUBindingLayout';

export type GraphicsShaderStage = 'vertex' | 'fragment';

export interface WebGPUVertexInput {
    readonly name: string;
    readonly type: string;
    readonly location: number;
    readonly locationCount: number;
}

export interface WebGPUFragmentOutput {
    readonly name: string;
    readonly type: string;
    readonly location: number;
}

export interface WebGPUUniformBlock extends WebGPUResourceBinding {
    readonly name: string;
    readonly stages: readonly GraphicsShaderStage[];
}

export interface WebGPUSamplerBinding {
    readonly name: string;
    readonly arrayIndex: number;
    readonly type: GlslSamplerType;
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
    readonly stages: readonly GraphicsShaderStage[];
}

export interface TranslatedShaderStage {
    readonly glsl: string;
    readonly wgsl: string;
}

export interface TranslatedShaderPair {
    readonly vertex: TranslatedShaderStage;
    readonly fragment: TranslatedShaderStage;
    readonly vertexInputs: readonly WebGPUVertexInput[];
    readonly fragmentOutputs: readonly WebGPUFragmentOutput[];
    readonly uniformBlocks: readonly WebGPUUniformBlock[];
    readonly samplers: readonly WebGPUSamplerBinding[];
}

export interface PreparedShaderStage {
    readonly glsl: string;
}

export interface PreparedShaderPair {
    readonly vertex: PreparedShaderStage;
    readonly fragment: PreparedShaderStage;
    readonly vertexInputs: readonly WebGPUVertexInput[];
    readonly fragmentOutputs: readonly WebGPUFragmentOutput[];
    readonly uniformBlocks: readonly WebGPUUniformBlock[];
    readonly samplers: readonly WebGPUSamplerBinding[];
}

interface ConditionalFrame {
    readonly parentActive: boolean;
    active: boolean;
    branchTaken: boolean;
}

interface PreprocessorAnalysis {
    readonly activeLines: readonly boolean[];
    readonly macros: ReadonlyMap<string, string>;
}

interface StageIoDeclaration {
    readonly stage: GraphicsShaderStage;
    readonly line: number;
    readonly direction: 'in' | 'out';
    readonly name: string;
    readonly type: string;
    readonly qualifiers: string;
    readonly indentation: string;
    readonly explicitLocation: number | null;
    readonly locationCount: number;
}

interface SamplerDeclaration {
    readonly stage: GraphicsShaderStage;
    readonly name: string;
    readonly type: GlslSamplerType;
    readonly arrayLength: number;
    readonly start: number;
    readonly end: number;
}

interface SamplerResource extends WebGPUSamplerBinding {
    readonly textureType: string;
    readonly samplerType: 'sampler' | 'samplerShadow';
    readonly constructorType: string;
    readonly textureName: string;
    readonly samplerName: string;
}

interface UniformBlockOccurrence {
    readonly stage: GraphicsShaderStage;
    readonly name: string;
    readonly start: number;
    readonly signature: string;
}

interface Token {
    readonly kind: 'number' | 'identifier' | 'operator';
    readonly value: string;
}

interface SourceArgument {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

interface SamplerFunctionParameter {
    readonly index: number;
    readonly name: string;
    readonly type: GlslSamplerType;
}

interface SamplerFunctionSignature {
    readonly name: string;
    readonly arity: number;
    readonly parameters: readonly SamplerFunctionParameter[];
}

interface SamplerFunctionDefinition extends SamplerFunctionSignature {
    readonly parametersStart: number;
    readonly parametersEnd: number;
    readonly bodyStart: number;
    readonly bodyEnd: number;
    readonly parameterTexts: readonly string[];
}

const samplerTypePattern = '(?:[iu]?sampler(?:2D|3D|Cube|2DArray)(?:Shadow)?)';
const samplerDeclarationPattern = new RegExp(
    `\\buniform\\s+(${samplerTypePattern})\\s+([A-Za-z_]\\w*)(?:\\s*\\[\\s*([^\\]]+)\\s*\\])?\\s*;`,
    'gu'
);
const uniformBlockPattern = /layout\s*\(\s*std140\s*\)\s*uniform\s+([A-Za-z_]\w*)\s*\{/gu;
const ioLinePattern =
    /^(\s*)(?:(layout\s*\(([^)]*)\)\s*)?)((?:(?:flat|smooth|noperspective|centroid|sample)\s+)*)(in|out)\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;\s*$/u;

export type GlslSamplerType =
    | 'sampler2D'
    | 'sampler3D'
    | 'samplerCube'
    | 'sampler2DArray'
    | 'sampler2DShadow'
    | 'samplerCubeShadow'
    | 'sampler2DArrayShadow'
    | 'isampler2D'
    | 'isampler3D'
    | 'isamplerCube'
    | 'isampler2DArray'
    | 'usampler2D'
    | 'usampler3D'
    | 'usamplerCube'
    | 'usampler2DArray';

const samplerTypes = new Set<GlslSamplerType>([
    'sampler2D',
    'sampler3D',
    'samplerCube',
    'sampler2DArray',
    'sampler2DShadow',
    'samplerCubeShadow',
    'sampler2DArrayShadow',
    'isampler2D',
    'isampler3D',
    'isamplerCube',
    'isampler2DArray',
    'usampler2D',
    'usampler3D',
    'usamplerCube',
    'usampler2DArray'
]);

const supportedWebGPUSamplerTypes = new Set<GlslSamplerType>([
    'sampler2D',
    'samplerCube',
    'sampler2DShadow',
    'samplerCubeShadow'
]);

type NagaModule = typeof Naga;
type NagaShaderStage = Naga.ShaderStage;

let nagaModule: NagaModule | null = null;
let nagaInitialization: Promise<NagaModule> | null = null;

function initializeNagaModule(): Promise<NagaModule> {
    if (nagaModule) return Promise.resolve(nagaModule);
    if (nagaInitialization) return nagaInitialization;

    const loading = import('web-naga').then(async module => {
        await module.default();
        return module;
    });
    const initialization: Promise<NagaModule> = loading.then(
        module => {
            if (nagaInitialization === initialization) nagaModule = module;
            return module;
        },
        (error: unknown) => {
            if (nagaInitialization === initialization) nagaInitialization = null;
            throw error;
        }
    );
    nagaInitialization = initialization;
    return initialization;
}

function lineAtOffset(source: string, offset: number): number {
    let line = 0;
    for (let index = 0; index < offset; index++) {
        if (source.charCodeAt(index) === 10) line++;
    }
    return line;
}

function matchingDelimiter(
    source: string,
    openOffset: number,
    open: '(' | '{',
    close: ')' | '}'
): number {
    let depth = 0;
    let lineComment = false;
    let blockComment = false;
    for (let index = openOffset; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index++;
            }
            continue;
        }
        if (char === '/' && next === '/') {
            lineComment = true;
            index++;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index++;
            continue;
        }
        if (char === open) depth++;
        else if (char === close) {
            depth--;
            if (depth === 0) return index;
        }
    }
    throw new Error(`GLSL ${open} at offset ${String(openOffset)} has no matching ${close}`);
}

function splitSourceArguments(source: string, start: number, end: number): SourceArgument[] {
    if (source.slice(start, end).trim() === '') return [];
    const arguments_: SourceArgument[] = [];
    let argumentStart = start;
    let parentheses = 0;
    let brackets = 0;
    let braces = 0;
    for (let index = start; index < end; index++) {
        const char = source[index];
        if (char === '(') parentheses++;
        else if (char === ')') parentheses--;
        else if (char === '[') brackets++;
        else if (char === ']') brackets--;
        else if (char === '{') braces++;
        else if (char === '}') braces--;
        else if (char === ',' && parentheses === 0 && brackets === 0 && braces === 0) {
            arguments_.push({
                start: argumentStart,
                end: index,
                text: source.slice(argumentStart, index)
            });
            argumentStart = index + 1;
        }
    }
    arguments_.push({
        start: argumentStart,
        end,
        text: source.slice(argumentStart, end)
    });
    return arguments_;
}

function replaceSourceRanges(
    source: string,
    replacements: readonly {
        readonly start: number;
        readonly end: number;
        readonly value: string;
    }[]
): string {
    let result = source;
    const ordered = [...replacements].sort((left, right) => right.start - left.start);
    let previousStart = source.length;
    for (const replacement of ordered) {
        if (replacement.end > previousStart) {
            throw new Error('Overlapping GLSL source rewrites are not supported');
        }
        result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
        previousStart = replacement.start;
    }
    return result;
}

function tokenizeExpression(expression: string): Token[] {
    const tokens: Token[] = [];
    const pattern =
        /\s*(0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z_]\w*|\|\||&&|==|!=|<=|>=|[()+\-*/%!<>])/gy;
    let cursor = 0;
    while (cursor < expression.length) {
        pattern.lastIndex = cursor;
        const match = pattern.exec(expression);
        if (match?.index !== cursor) {
            throw new Error(`Unsupported GLSL preprocessor expression: ${expression}`);
        }
        const value = match[1];
        if (!value) throw new Error(`Unable to tokenize GLSL expression: ${expression}`);
        const kind: Token['kind'] = /^(?:0[xX]|\d|\.)/u.test(value)
            ? 'number'
            : /^[A-Za-z_]/u.test(value)
              ? 'identifier'
              : 'operator';
        tokens.push({ kind, value });
        cursor = pattern.lastIndex;
    }
    return tokens;
}

function evaluatePreprocessorExpression(
    rawExpression: string,
    macros: ReadonlyMap<string, string>,
    resolving: ReadonlySet<string> = new Set()
): number {
    const expression = rawExpression
        .replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/gu, (_match, name: string) =>
            macros.has(name) ? '1' : '0'
        )
        .replace(/defined\s+([A-Za-z_]\w*)/gu, (_match, name: string) =>
            macros.has(name) ? '1' : '0'
        );
    const tokens = tokenizeExpression(expression);
    let cursor = 0;

    const peek = (value?: string): boolean => {
        const token = tokens[cursor];
        return token !== undefined && (value === undefined || token.value === value);
    };
    const take = (value?: string): Token => {
        const token = tokens[cursor];
        if (!token || (value !== undefined && token.value !== value)) {
            throw new Error(`Invalid GLSL preprocessor expression: ${rawExpression}`);
        }
        cursor++;
        return token;
    };
    const primary = (): number => {
        if (peek('(')) {
            take('(');
            const value = logicalOr();
            take(')');
            return value;
        }
        const token = take();
        if (token.kind === 'number') return Number(token.value);
        if (token.kind !== 'identifier') {
            throw new Error(`Expected value in GLSL preprocessor expression: ${rawExpression}`);
        }
        const macro = macros.get(token.value);
        if (macro === undefined) return 0;
        if (resolving.has(token.value)) {
            throw new Error(`Recursive GLSL macro in preprocessor expression: ${token.value}`);
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(token.value);
        try {
            return evaluatePreprocessorExpression(macro || '1', macros, nextResolving);
        } catch {
            return 1;
        }
    };
    const unary = (): number => {
        if (peek('!')) {
            take('!');
            return unary() === 0 ? 1 : 0;
        }
        if (peek('+')) {
            take('+');
            return unary();
        }
        if (peek('-')) {
            take('-');
            return -unary();
        }
        return primary();
    };
    const multiplicative = (): number => {
        let value = unary();
        while (peek('*') || peek('/') || peek('%')) {
            const operator = take().value;
            const right = unary();
            if (operator === '*') value *= right;
            else if (operator === '/') value /= right;
            else value %= right;
        }
        return value;
    };
    const additive = (): number => {
        let value = multiplicative();
        while (peek('+') || peek('-')) {
            const operator = take().value;
            const right = multiplicative();
            value = operator === '+' ? value + right : value - right;
        }
        return value;
    };
    const relational = (): number => {
        let value = additive();
        while (peek('<') || peek('>') || peek('<=') || peek('>=')) {
            const operator = take().value;
            const right = additive();
            if (operator === '<') value = value < right ? 1 : 0;
            else if (operator === '>') value = value > right ? 1 : 0;
            else if (operator === '<=') value = value <= right ? 1 : 0;
            else value = value >= right ? 1 : 0;
        }
        return value;
    };
    const equality = (): number => {
        let value = relational();
        while (peek('==') || peek('!=')) {
            const operator = take().value;
            const right = relational();
            value = operator === '==' ? (value === right ? 1 : 0) : value !== right ? 1 : 0;
        }
        return value;
    };
    const logicalAnd = (): number => {
        let value = equality();
        while (peek('&&')) {
            take('&&');
            const right = equality();
            value = value !== 0 && right !== 0 ? 1 : 0;
        }
        return value;
    };
    const logicalOr = (): number => {
        let value = logicalAnd();
        while (peek('||')) {
            take('||');
            const right = logicalAnd();
            value = value !== 0 || right !== 0 ? 1 : 0;
        }
        return value;
    };

    const result = logicalOr();
    if (cursor !== tokens.length) {
        throw new Error(`Trailing tokens in GLSL preprocessor expression: ${rawExpression}`);
    }
    return result;
}

function analyzePreprocessor(source: string): PreprocessorAnalysis {
    const lines = source.split('\n');
    const activeLines: boolean[] = [];
    const macros = new Map<string, string>();
    const stack: ConditionalFrame[] = [];
    let active = true;

    lines.forEach((line, index) => {
        activeLines[index] = active;
        const directive = /^\s*#\s*(\w+)(?:\s+(.*?))?\s*$/u.exec(line);
        if (!directive) return;
        const command = directive[1] ?? '';
        const body = directive[2] ?? '';
        if (command === 'if' || command === 'ifdef' || command === 'ifndef') {
            const parentActive = active;
            const condition =
                command === 'ifdef'
                    ? macros.has(body.trim())
                    : command === 'ifndef'
                      ? !macros.has(body.trim())
                      : evaluatePreprocessorExpression(body, macros) !== 0;
            const branchActive = parentActive && condition;
            stack.push({ parentActive, active: branchActive, branchTaken: branchActive });
            active = branchActive;
            return;
        }
        if (command === 'elif') {
            const frame = stack.at(-1);
            if (!frame) throw new Error('GLSL #elif has no matching #if');
            const branchActive =
                frame.parentActive &&
                !frame.branchTaken &&
                evaluatePreprocessorExpression(body, macros) !== 0;
            frame.active = branchActive;
            frame.branchTaken ||= branchActive;
            active = branchActive;
            return;
        }
        if (command === 'else') {
            const frame = stack.at(-1);
            if (!frame) throw new Error('GLSL #else has no matching #if');
            const branchActive = frame.parentActive && !frame.branchTaken;
            frame.active = branchActive;
            frame.branchTaken = true;
            active = branchActive;
            return;
        }
        if (command === 'endif') {
            const frame = stack.pop();
            if (!frame) throw new Error('GLSL #endif has no matching #if');
            active = frame.parentActive;
            return;
        }
        if (!active) return;
        if (command === 'define') {
            const definition = /^([A-Za-z_]\w*)(?!\s*\()(?:\s+(.*))?$/u.exec(body);
            if (definition?.[1]) macros.set(definition[1], definition[2]?.trim() ?? '1');
        } else if (command === 'undef') {
            macros.delete(body.trim());
        }
    });
    if (stack.length !== 0) throw new Error('GLSL source has an unterminated conditional block');
    return { activeLines, macros };
}

function matrixShape(type: string): { columns: number; rows: number } | null {
    const match = /^mat([2-4])(?:x([2-4]))?$/u.exec(type);
    if (!match?.[1]) return null;
    return { columns: Number(match[1]), rows: Number(match[2] ?? match[1]) };
}

function locationCount(type: string): number {
    return matrixShape(type)?.columns ?? 1;
}

function collectStageIo(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): StageIoDeclaration[] {
    const declarations: StageIoDeclaration[] = [];
    source.split('\n').forEach((line, index) => {
        if (!analysis.activeLines[index]) return;
        const match = ioLinePattern.exec(line);
        if (!match?.[5] || !match[6] || !match[7]) return;
        const layout = match[3] ?? '';
        const locationMatch = /(?:^|,)\s*location\s*=\s*(\d+)/u.exec(layout);
        declarations.push({
            stage,
            line: index,
            direction: match[5] as 'in' | 'out',
            type: match[6],
            name: match[7],
            qualifiers: match[4] ?? '',
            indentation: match[1] ?? '',
            explicitLocation: locationMatch?.[1] ? Number(locationMatch[1]) : null,
            locationCount: locationCount(match[6])
        });
    });
    return declarations;
}

function assignLocations(
    declarations: readonly StageIoDeclaration[],
    label: string
): ReadonlyMap<string, number> {
    const locations = new Map<string, number>();
    const types = new Map<string, string>();
    const occupied = new Map<number, string>();
    for (const declaration of declarations) {
        const existingType = types.get(declaration.name);
        if (existingType && existingType !== declaration.type) {
            throw new Error(
                `${label} ${declaration.name} has incompatible types ${existingType} and ${declaration.type}`
            );
        }
        types.set(declaration.name, declaration.type);
        if (declaration.explicitLocation === null) continue;
        const existingLocation = locations.get(declaration.name);
        if (existingLocation !== undefined && existingLocation !== declaration.explicitLocation) {
            throw new Error(`${label} ${declaration.name} has conflicting explicit locations`);
        }
        locations.set(declaration.name, declaration.explicitLocation);
        for (let offset = 0; offset < declaration.locationCount; offset++) {
            const location = declaration.explicitLocation + offset;
            const owner = occupied.get(location);
            if (owner && owner !== declaration.name) {
                throw new Error(
                    `${label} location ${String(location)} is shared by ${owner} and ${declaration.name}`
                );
            }
            occupied.set(location, declaration.name);
        }
    }
    for (const declaration of declarations) {
        if (locations.has(declaration.name)) continue;
        let location = 0;
        while (
            Array.from({ length: declaration.locationCount }, (_value, offset) =>
                occupied.has(location + offset)
            ).some(Boolean)
        ) {
            location++;
        }
        locations.set(declaration.name, location);
        for (let offset = 0; offset < declaration.locationCount; offset++) {
            occupied.set(location + offset, declaration.name);
        }
    }
    return locations;
}

function injectMainStatements(
    source: string,
    beginning: readonly string[],
    ending: readonly string[]
): string {
    const main = /\bvoid\s+main\s*\([^)]*\)\s*\{/gu;
    const match = main.exec(source);
    if (!match) throw new Error('GLSL shader has no main entry point');
    const openBrace = source.indexOf('{', match.index);
    let depth = 0;
    let closeBrace = -1;
    for (let index = openBrace; index < source.length; index++) {
        const char = source[index];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                closeBrace = index;
                break;
            }
        }
    }
    if (closeBrace < 0) throw new Error('GLSL main entry point has no closing brace');
    let userMainName = 'hilo_webgpu_user_main';
    while (new RegExp(`\\b${userMainName}\\b`, 'u').test(source)) userMainName += '_entry';
    const signature = source.slice(match.index, openBrace);
    const mainNameOffset = signature.search(/\bmain\b/u);
    if (mainNameOffset < 0) throw new Error('Unable to rewrite the GLSL main entry point');
    const absoluteMainNameOffset = match.index + mainNameOffset;
    const renamed = `${source.slice(0, absoluteMainNameOffset)}${userMainName}${source.slice(
        absoluteMainNameOffset + 'main'.length
    )}`;
    const statements = [...beginning, `${userMainName}();`, ...ending];
    const wrapper = `\nvoid main() {\n${statements.map(line => `    ${line}`).join('\n')}\n}\n`;
    return `${renamed}${wrapper}`;
}

function rewriteStageIo(
    source: string,
    stage: GraphicsShaderStage,
    declarations: readonly StageIoDeclaration[],
    vertexInputLocations: ReadonlyMap<string, number>,
    varyingLocations: ReadonlyMap<string, number>,
    fragmentOutputLocations: ReadonlyMap<string, number>
): { source: string; vertexInputs: WebGPUVertexInput[] } {
    const byLine = new Map(declarations.map(declaration => [declaration.line, declaration]));
    const beginning: string[] = [];
    const ending: string[] = [];
    const vertexInputs: WebGPUVertexInput[] = [];
    const lines = source.split('\n').map((line, index) => {
        const declaration = byLine.get(index);
        if (!declaration) return line;
        const locations =
            stage === 'vertex' && declaration.direction === 'in'
                ? vertexInputLocations
                : stage === 'fragment' && declaration.direction === 'out'
                  ? fragmentOutputLocations
                  : varyingLocations;
        const location = locations.get(declaration.name);
        if (location === undefined) {
            throw new Error(`No WebGPU location was allocated for ${declaration.name}`);
        }
        if (stage === 'vertex' && declaration.direction === 'in') {
            vertexInputs.push({
                name: declaration.name,
                type: declaration.type,
                location,
                locationCount: declaration.locationCount
            });
        }
        const matrix = matrixShape(declaration.type);
        if (!matrix) {
            return `${declaration.indentation}layout(location = ${String(location)}) ${declaration.qualifiers}${declaration.direction} ${declaration.type} ${declaration.name};`;
        }
        const columnType = `vec${String(matrix.rows)}`;
        const columns = Array.from(
            { length: matrix.columns },
            (_value, column) => `${declaration.name}__column${String(column)}`
        );
        const interfaceLines = columns.map(
            (name, column) =>
                `${declaration.indentation}layout(location = ${String(location + column)}) ${declaration.qualifiers}${declaration.direction} ${columnType} ${name};`
        );
        const privateDeclaration = `${declaration.indentation}${declaration.type} ${declaration.name};`;
        if (declaration.direction === 'in') {
            beginning.push(`${declaration.name} = ${declaration.type}(${columns.join(', ')});`);
        } else {
            columns.forEach((name, column) => {
                ending.push(`${name} = ${declaration.name}[${String(column)}];`);
            });
        }
        return [...interfaceLines, privateDeclaration].join('\n');
    });
    if (stage === 'vertex') {
        ending.unshift('gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;');
    }
    return {
        source: injectMainStatements(lines.join('\n'), beginning, ending),
        vertexInputs
    };
}

function normalizeForNaga(source: string): string {
    const version = /^\s*#version\s+300\s+es\s*/u;
    return `#version 450\n#define HILO_WEBGPU 1\n${source
        .replace(version, '')
        // These macros only feed GLSL ES precision declarations. Naga's
        // preprocessor does not accept precision keywords as macro values,
        // and the declarations themselves are removed immediately below.
        .replace(/^\s*#\s*define\s+HILO_MAX_(?:VERTEX_|FRAGMENT_)?PRECISION\s+\w+\s*$/gmu, '')
        .replace(/^\s*precision\s+[^;]+;\s*$/gmu, '')
        // Naga accepts GLSL parameter direction qualifiers, but not WebGL's
        // redundant `const in` qualifier pair.
        .replace(/\bconst\s+in\s+/gu, 'in ')
        .replace(/\b(?:highp|mediump|lowp)\s+/gu, '')}`;
}

function samplerTypeInfo(type: GlslSamplerType): {
    textureType: string;
    samplerType: 'sampler' | 'samplerShadow';
    constructorType: string;
} {
    const shadow = type.endsWith('Shadow');
    const unsigned = type.startsWith('usampler');
    const signed = !unsigned && type.startsWith('isampler');
    const base = type.replace(/^[iu]/u, '').replace(/Shadow$/u, '');
    const texturePrefix = unsigned ? 'utexture' : signed ? 'itexture' : 'texture';
    const dimension = base.slice('sampler'.length);
    return {
        textureType: `${texturePrefix}${dimension}`,
        samplerType: shadow ? 'samplerShadow' : 'sampler',
        constructorType: type
    };
}

function samplerConstructorArguments(expression: string): {
    readonly type: GlslSamplerType;
    readonly texture: string;
    readonly sampler: string;
} | null {
    const match = new RegExp(`^\\s*(${samplerTypePattern})\\s*\\(`, 'u').exec(expression);
    const rawType = match?.[1];
    if (!match || !rawType || !samplerTypes.has(rawType as GlslSamplerType)) return null;
    const open = expression.indexOf('(', match.index);
    const close = matchingDelimiter(expression, open, '(', ')');
    if (expression.slice(close + 1).trim() !== '') return null;
    const arguments_ = splitSourceArguments(expression, open + 1, close);
    if (arguments_.length !== 2) return null;
    const texture = arguments_[0]?.text.trim();
    const sampler = arguments_[1]?.text.trim();
    if (!texture || !sampler) return null;
    return { type: rawType as GlslSamplerType, texture, sampler };
}

function collectSamplerFunctionDefinitions(source: string): SamplerFunctionDefinition[] {
    const definitions: SamplerFunctionDefinition[] = [];
    const functionPattern =
        /\b(?:void|bool|int|uint|float|[biu]?vec[2-4]|mat[2-4](?:x[2-4])?)\s+([A-Za-z_]\w*)\s*\(/gu;
    for (let match = functionPattern.exec(source); match; match = functionPattern.exec(source)) {
        const name = match[1];
        if (!name) continue;
        const open = source.indexOf('(', match.index);
        const close = matchingDelimiter(source, open, '(', ')');
        let bodyStart = close + 1;
        while (/\s/u.test(source[bodyStart] ?? '')) bodyStart++;
        if (source[bodyStart] !== '{') {
            functionPattern.lastIndex = close + 1;
            continue;
        }
        const bodyEnd = matchingDelimiter(source, bodyStart, '{', '}');
        const arguments_ = splitSourceArguments(source, open + 1, close);
        const samplerParameters: SamplerFunctionParameter[] = [];
        arguments_.forEach((argument, index) => {
            const parameter = new RegExp(
                `(?:^|\\s)(${samplerTypePattern})\\s+([A-Za-z_]\\w*)\\s*$`,
                'u'
            ).exec(argument.text.trim());
            const rawType = parameter?.[1];
            const parameterName = parameter?.[2];
            if (rawType && parameterName && samplerTypes.has(rawType as GlslSamplerType)) {
                samplerParameters.push({
                    index,
                    name: parameterName,
                    type: rawType as GlslSamplerType
                });
            }
        });
        if (samplerParameters.length > 0) {
            definitions.push({
                name,
                arity: arguments_.length,
                parameters: samplerParameters,
                parametersStart: open + 1,
                parametersEnd: close,
                bodyStart,
                bodyEnd,
                parameterTexts: arguments_.map(argument => argument.text.trim())
            });
        }
        functionPattern.lastIndex = bodyEnd + 1;
    }
    return definitions;
}

function rewriteNamedFunctionCalls(
    source: string,
    name: string,
    rewrite: (arguments_: readonly SourceArgument[], callStart: number) => string | null
): string {
    const pattern = new RegExp(`\\b${name}\\s*\\(`, 'gu');
    const replacements: { start: number; end: number; value: string }[] = [];
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const open = source.indexOf('(', match.index);
        const close = matchingDelimiter(source, open, '(', ')');
        const arguments_ = splitSourceArguments(source, open + 1, close);
        const replacement = rewrite(arguments_, match.index);
        if (replacement !== null) {
            replacements.push({ start: match.index, end: close + 1, value: replacement });
        }
        pattern.lastIndex = close + 1;
    }
    return replaceSourceRanges(source, replacements);
}

/**
 * Lower Hilo's UV-selection macro before lowering user functions. With two UV
 * sets the macro forwards to a sampler-taking helper; with one UV set it maps
 * directly to the GLSL texture builtin.
 */
function lowerHiloTextureCalls(source: string, analysis: PreprocessorAnalysis): string {
    const hasUv0 = analysis.macros.has('HILO_HAS_TEXCOORD0');
    const hasUv1 = analysis.macros.has('HILO_HAS_TEXCOORD1');
    return rewriteNamedFunctionCalls(source, 'HILO_TEXTURE_2D', (arguments_, callStart) => {
        if (!analysis.activeLines[lineAtOffset(source, callStart)]) return null;
        if (arguments_.length !== 2) return null;
        const combined = samplerConstructorArguments(arguments_[0]?.text ?? '');
        const uvSet = arguments_[1]?.text.trim();
        if (!combined || !uvSet) return null;
        if (hasUv0 && hasUv1) {
            return `hiloTexture2D(${combined.texture}, ${combined.sampler}, ${uvSet})`;
        }
        if (!hasUv0 && !hasUv1) {
            throw new Error('HILO_TEXTURE_2D is active without a texture-coordinate attribute');
        }
        const coordinates = hasUv1 ? 'v_texcoord1' : 'v_texcoord0';
        return `texture(${combined.type}(${combined.texture}, ${combined.sampler}), ${coordinates})`;
    });
}

/**
 * Vulkan GLSL represents textures and samplers as separate opaque values and
 * Naga consequently rejects WebGL-style combined samplers in function
 * parameters. Split every such parameter and every corresponding call site.
 */
function lowerCombinedSamplerFunctionParameters(source: string): string {
    const definitions = collectSamplerFunctionDefinitions(source);
    if (definitions.length === 0) return source;
    const signatures: SamplerFunctionSignature[] = definitions.map(definition => ({
        name: definition.name,
        arity: definition.arity,
        parameters: definition.parameters
    }));

    let result = source;
    for (const definition of [...definitions].sort(
        (left, right) => right.parametersStart - left.parametersStart
    )) {
        let body = result.slice(definition.bodyStart + 1, definition.bodyEnd);
        for (const parameter of definition.parameters) {
            const info = samplerTypeInfo(parameter.type);
            body = body.replace(
                new RegExp(`\\b${parameter.name}\\b`, 'gu'),
                `${info.constructorType}(${parameter.name}__texture, ${parameter.name}__sampler)`
            );
        }
        result = `${result.slice(0, definition.bodyStart + 1)}${body}${result.slice(definition.bodyEnd)}`;

        const samplerByIndex = new Map(
            definition.parameters.map(parameter => [parameter.index, parameter])
        );
        const parameters: string[] = [];
        definition.parameterTexts.forEach((parameterText, index) => {
            const samplerParameter = samplerByIndex.get(index);
            if (!samplerParameter) {
                parameters.push(parameterText);
                return;
            }
            const info = samplerTypeInfo(samplerParameter.type);
            parameters.push(
                `${info.textureType} ${samplerParameter.name}__texture`,
                `${info.samplerType} ${samplerParameter.name}__sampler`
            );
        });
        result = `${result.slice(0, definition.parametersStart)}${parameters.join(', ')}${result.slice(definition.parametersEnd)}`;
    }

    const signaturesByName = new Map<string, SamplerFunctionSignature[]>();
    for (const signature of signatures) {
        const named = signaturesByName.get(signature.name) ?? [];
        named.push(signature);
        signaturesByName.set(signature.name, named);
    }
    for (const [name, namedSignatures] of signaturesByName) {
        result = rewriteNamedFunctionCalls(result, name, arguments_ => {
            const matching = namedSignatures.filter(
                signature => signature.arity === arguments_.length
            );
            if (matching.length === 0) return null;
            const samplerIndices = new Set(
                matching.flatMap(signature =>
                    signature.parameters.map(parameter => parameter.index)
                )
            );
            const combinedArguments = arguments_.map((argument, index) =>
                samplerIndices.has(index) ? samplerConstructorArguments(argument.text) : null
            );
            if (!combinedArguments.some(value => value !== null)) return null;
            const rewrittenArguments = arguments_.flatMap((argument, index) => {
                const combined = combinedArguments[index];
                return combined ? [combined.texture, combined.sampler] : [argument.text.trim()];
            });
            return `${name}(${rewrittenArguments.join(', ')})`;
        });
    }
    return result;
}

function collectSamplerDeclarations(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): SamplerDeclaration[] {
    const declarations: SamplerDeclaration[] = [];
    samplerDeclarationPattern.lastIndex = 0;
    for (
        let match = samplerDeclarationPattern.exec(source);
        match;
        match = samplerDeclarationPattern.exec(source)
    ) {
        const line = lineAtOffset(source, match.index);
        if (!analysis.activeLines[line]) continue;
        const rawType = match[1];
        const name = match[2];
        if (!rawType || !name || !samplerTypes.has(rawType as GlslSamplerType)) continue;
        const lengthExpression = match[3];
        const arrayLength = lengthExpression
            ? evaluatePreprocessorExpression(lengthExpression, analysis.macros)
            : 1;
        if (!Number.isSafeInteger(arrayLength) || arrayLength < 1) {
            throw new RangeError(`Sampler ${name} has invalid array length ${String(arrayLength)}`);
        }
        declarations.push({
            stage,
            name,
            type: rawType as GlslSamplerType,
            arrayLength,
            start: match.index,
            end: samplerDeclarationPattern.lastIndex
        });
    }
    return declarations;
}

function createSamplerResources(declarations: readonly SamplerDeclaration[]): SamplerResource[] {
    const signatures = new Map<string, string>();
    const stages = new Map<string, Set<GraphicsShaderStage>>();
    const order: string[] = [];
    for (const declaration of declarations) {
        const signature = `${declaration.type}:${String(declaration.arrayLength)}`;
        const existing = signatures.get(declaration.name);
        if (existing && existing !== signature) {
            throw new Error(`Sampler ${declaration.name} has incompatible stage declarations`);
        }
        if (!existing) {
            signatures.set(declaration.name, signature);
            order.push(declaration.name);
        }
        const declarationStages = stages.get(declaration.name) ?? new Set<GraphicsShaderStage>();
        declarationStages.add(declaration.stage);
        stages.set(declaration.name, declarationStages);
    }
    const resources: SamplerResource[] = [];
    let binding = 1;
    for (const name of order) {
        const declaration = declarations.find(item => item.name === name);
        if (!declaration) continue;
        const typeInfo = samplerTypeInfo(declaration.type);
        for (let arrayIndex = 0; arrayIndex < declaration.arrayLength; arrayIndex++) {
            const suffix = declaration.arrayLength === 1 ? '' : `_${String(arrayIndex)}`;
            resources.push({
                name,
                arrayIndex,
                type: declaration.type,
                group: 1,
                textureBinding: binding++,
                samplerBinding: binding++,
                stages: Object.freeze([...(stages.get(name) ?? [])]),
                textureType: typeInfo.textureType,
                samplerType: typeInfo.samplerType,
                constructorType: typeInfo.constructorType,
                textureName: `${name}__texture${suffix}`,
                samplerName: `${name}__sampler${suffix}`
            });
        }
    }
    return resources;
}

function replaceSamplerDeclarations(
    source: string,
    stage: GraphicsShaderStage,
    declarations: readonly SamplerDeclaration[],
    resources: readonly SamplerResource[]
): string {
    const stageDeclarations = declarations.filter(declaration => declaration.stage === stage);
    const placeholders: string[] = [];
    let result = source;
    for (const [index, declaration] of [...stageDeclarations].reverse().entries()) {
        const placeholder = `__HILO_NAGA_SAMPLER_DECL_${String(index)}__`;
        placeholders[index] = placeholder;
        result = `${result.slice(0, declaration.start)}${placeholder}${result.slice(declaration.end)}`;
    }
    for (const declaration of stageDeclarations) {
        const items = resources.filter(resource => resource.name === declaration.name);
        if (declaration.arrayLength === 1) {
            const item = items[0];
            if (!item) throw new Error(`Sampler resource ${declaration.name} was not allocated`);
            const usePattern = new RegExp(`\\b${declaration.name}\\b`, 'gu');
            result = result.replace(
                usePattern,
                `${item.constructorType}(${item.textureName}, ${item.samplerName})`
            );
        } else {
            for (const item of items) {
                const usePattern = new RegExp(
                    `\\b${declaration.name}\\s*\\[\\s*${String(item.arrayIndex)}\\s*\\]`,
                    'gu'
                );
                result = result.replace(
                    usePattern,
                    `${item.constructorType}(${item.textureName}, ${item.samplerName})`
                );
            }
            const remainingUse = new RegExp(
                `\\b${declaration.name}\\s*\\[\\s*([^\\]]+)\\s*\\]`,
                'gu'
            );
            for (let match = remainingUse.exec(result); match; match = remainingUse.exec(result)) {
                if (!/^\d+$/u.test(match[1]?.trim() ?? '')) {
                    throw new Error(
                        `WebGPU sampler array ${declaration.name} must only use compile-time literal indices`
                    );
                }
            }
        }
    }
    for (const [index, declaration] of stageDeclarations.entries()) {
        const placeholder = placeholders[stageDeclarations.length - index - 1];
        if (!placeholder) continue;
        const resourceDeclarations = resources
            .filter(resource => resource.name === declaration.name)
            .map(
                resource =>
                    `layout(set = ${String(resource.group)}, binding = ${String(resource.textureBinding)}) uniform ${resource.textureType} ${resource.textureName};\nlayout(set = ${String(resource.group)}, binding = ${String(resource.samplerBinding)}) uniform ${resource.samplerType} ${resource.samplerName};`
            )
            .join('\n');
        result = result.replace(placeholder, resourceDeclarations);
    }
    return result;
}

function defaultUniformBlockBinding(name: string): WebGPUResourceBinding {
    return getWebGPUUniformBlockBinding(name);
}

function canonicalUniformBlockSignature(
    source: string,
    openBrace: number,
    closeBrace: number,
    analysis: PreprocessorAnalysis
): string {
    const firstLine = lineAtOffset(source, openBrace + 1);
    const activeBody = source
        .slice(openBrace + 1, closeBrace)
        .split('\n')
        .map((line, index) =>
            analysis.activeLines[firstLine + index] && !/^\s*#/u.test(line) ? line : ''
        )
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/\/\/[^\n]*/gu, '');
    const tokens = [
        ...activeBody.matchAll(/[A-Za-z_]\w*|(?:0[xX][\dA-Fa-f]+|\d+(?:\.\d*)?)|[^\s]/gu)
    ].map(match => match[0]);
    const expand = (token: string, resolving: ReadonlySet<string>): readonly string[] => {
        const replacement = analysis.macros.get(token);
        if (replacement === undefined) return [token];
        if (resolving.has(token)) {
            throw new Error(`Recursive GLSL macro in uniform block layout: ${token}`);
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(token);
        return [
            ...replacement.matchAll(/[A-Za-z_]\w*|(?:0[xX][\dA-Fa-f]+|\d+(?:\.\d*)?)|[^\s]/gu)
        ].flatMap(match => expand(match[0], nextResolving));
    };
    return tokens.flatMap(token => expand(token, new Set())).join(' ');
}

function collectUniformBlocks(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): UniformBlockOccurrence[] {
    const blocks: UniformBlockOccurrence[] = [];
    uniformBlockPattern.lastIndex = 0;
    for (
        let match = uniformBlockPattern.exec(source);
        match;
        match = uniformBlockPattern.exec(source)
    ) {
        const name = match[1];
        if (!name) continue;
        const line = lineAtOffset(source, match.index);
        if (!analysis.activeLines[line]) continue;
        const openBrace = source.indexOf('{', match.index);
        const closeBrace = matchingDelimiter(source, openBrace, '{', '}');
        blocks.push({
            stage,
            name,
            start: match.index,
            signature: canonicalUniformBlockSignature(source, openBrace, closeBrace, analysis)
        });
    }
    return blocks;
}

function replaceUniformBlockBindings(
    source: string,
    stage: GraphicsShaderStage,
    blocks: readonly UniformBlockOccurrence[],
    resolveBinding: (name: string) => WebGPUResourceBinding
): string {
    const stageBlocks = blocks.filter(block => block.stage === stage);
    const activeNames = new Set(stageBlocks.map(block => block.name));
    uniformBlockPattern.lastIndex = 0;
    return source.replace(uniformBlockPattern, (match, name: string) => {
        if (!activeNames.has(name)) return match;
        const { group, binding } = resolveBinding(name);
        return `layout(std140, set = ${String(group)}, binding = ${String(binding)}) uniform ${name} {`;
    });
}

function mergeUniformBlocks(
    occurrences: readonly UniformBlockOccurrence[],
    resolveBinding: (name: string) => WebGPUResourceBinding
): WebGPUUniformBlock[] {
    const stageMap = new Map<string, Set<GraphicsShaderStage>>();
    const signatures = new Map<string, UniformBlockOccurrence>();
    for (const occurrence of occurrences) {
        const existing = signatures.get(occurrence.name);
        if (existing && existing.signature !== occurrence.signature) {
            throw new Error(
                `Uniform block ${occurrence.name} has incompatible ${existing.stage} and ${occurrence.stage} layouts`
            );
        }
        signatures.set(occurrence.name, existing ?? occurrence);
        const stages = stageMap.get(occurrence.name) ?? new Set<GraphicsShaderStage>();
        stages.add(occurrence.stage);
        stageMap.set(occurrence.name, stages);
    }
    return [...stageMap].map(([name, stages]) => ({
        name,
        ...resolveBinding(name),
        stages: Object.freeze([...stages])
    }));
}

/** Convert assembled GLSL ES 3.00 into the Vulkan-flavoured GLSL accepted by Naga. */
export function prepareGLSLForNaga(
    vertexSource: string,
    fragmentSource: string,
    resolveUniformBlockBinding: (name: string) => WebGPUResourceBinding = defaultUniformBlockBinding
): PreparedShaderPair {
    const normalizedVertex = normalizeForNaga(vertexSource);
    const normalizedFragment = normalizeForNaga(fragmentSource);
    const vertexAnalysis = analyzePreprocessor(normalizedVertex);
    const fragmentAnalysis = analyzePreprocessor(normalizedFragment);
    const vertexIo = collectStageIo(normalizedVertex, 'vertex', vertexAnalysis);
    const fragmentIo = collectStageIo(normalizedFragment, 'fragment', fragmentAnalysis);

    const vertexInputDeclarations = vertexIo.filter(item => item.direction === 'in');
    const varyingDeclarations = [
        ...vertexIo.filter(item => item.direction === 'out'),
        ...fragmentIo.filter(item => item.direction === 'in')
    ];
    const fragmentOutputDeclarations = fragmentIo.filter(item => item.direction === 'out');
    const vertexInputLocations = assignLocations(vertexInputDeclarations, 'vertex input');
    const varyingLocations = assignLocations(varyingDeclarations, 'inter-stage varying');
    const fragmentOutputLocations = assignLocations(fragmentOutputDeclarations, 'fragment output');

    const rewrittenVertex = rewriteStageIo(
        normalizedVertex,
        'vertex',
        vertexIo,
        vertexInputLocations,
        varyingLocations,
        fragmentOutputLocations
    );
    const rewrittenFragment = rewriteStageIo(
        normalizedFragment,
        'fragment',
        fragmentIo,
        vertexInputLocations,
        varyingLocations,
        fragmentOutputLocations
    );

    const vertexAfterIoAnalysis = analyzePreprocessor(rewrittenVertex.source);
    const fragmentAfterIoAnalysis = analyzePreprocessor(rewrittenFragment.source);
    const samplerDeclarations = [
        ...collectSamplerDeclarations(rewrittenVertex.source, 'vertex', vertexAfterIoAnalysis),
        ...collectSamplerDeclarations(rewrittenFragment.source, 'fragment', fragmentAfterIoAnalysis)
    ];
    for (const declaration of samplerDeclarations) {
        if (!supportedWebGPUSamplerTypes.has(declaration.type)) {
            throw new TypeError(
                `WebGPU shader sampler ${declaration.name} uses unsupported ${declaration.type}; supported types are sampler2D, samplerCube, sampler2DShadow and samplerCubeShadow`
            );
        }
    }
    const samplerResources = createSamplerResources(samplerDeclarations);
    const blockOccurrences = [
        ...collectUniformBlocks(rewrittenVertex.source, 'vertex', vertexAfterIoAnalysis),
        ...collectUniformBlocks(rewrittenFragment.source, 'fragment', fragmentAfterIoAnalysis)
    ];
    const uniformBlocks = mergeUniformBlocks(blockOccurrences, resolveUniformBlockBinding);

    let vertex = replaceSamplerDeclarations(
        rewrittenVertex.source,
        'vertex',
        samplerDeclarations,
        samplerResources
    );
    let fragment = replaceSamplerDeclarations(
        rewrittenFragment.source,
        'fragment',
        samplerDeclarations,
        samplerResources
    );
    vertex = lowerCombinedSamplerFunctionParameters(
        lowerHiloTextureCalls(vertex, analyzePreprocessor(vertex))
    );
    fragment = lowerCombinedSamplerFunctionParameters(
        lowerHiloTextureCalls(fragment, analyzePreprocessor(fragment))
    );
    vertex = replaceUniformBlockBindings(
        vertex,
        'vertex',
        blockOccurrences,
        resolveUniformBlockBinding
    );
    fragment = replaceUniformBlockBindings(
        fragment,
        'fragment',
        blockOccurrences,
        resolveUniformBlockBinding
    );

    return {
        vertex: { glsl: vertex },
        fragment: { glsl: fragment },
        vertexInputs: Object.freeze(rewrittenVertex.vertexInputs),
        fragmentOutputs: Object.freeze(
            fragmentOutputDeclarations.map(declaration => {
                const location = fragmentOutputLocations.get(declaration.name);
                if (location === undefined) {
                    throw new Error(
                        `No WebGPU fragment output location was allocated for ${declaration.name}`
                    );
                }
                return { name: declaration.name, type: declaration.type, location };
            })
        ),
        uniformBlocks: Object.freeze(uniformBlocks),
        samplers: Object.freeze(samplerResources)
    };
}

export class NagaShaderTranslationError extends Error {
    readonly stage: GraphicsShaderStage;
    readonly source: string;
    override readonly cause: unknown;

    constructor(stage: GraphicsShaderStage, source: string, cause: unknown) {
        super(`Naga failed to translate the ${stage} shader: ${String(cause)}`);
        this.name = 'NagaShaderTranslationError';
        this.stage = stage;
        this.source = source;
        this.cause = cause;
    }
}

/** Owns the asynchronously initialized Naga WASM compiler used by the WebGPU backend. */
export class NagaShaderTranslator {
    async initialize(): Promise<void> {
        await initializeNagaModule();
    }

    translate(
        vertexSource: string,
        fragmentSource: string,
        resolveUniformBlockBinding?: (name: string) => WebGPUResourceBinding
    ): TranslatedShaderPair {
        const compiler = nagaModule;
        if (!compiler) {
            throw new Error(
                'Naga is not initialized; await translator.initialize() before translating'
            );
        }
        const prepared = prepareGLSLForNaga(
            vertexSource,
            fragmentSource,
            resolveUniformBlockBinding
        );
        const translateStage = (
            stage: GraphicsShaderStage,
            source: string,
            nagaStage: NagaShaderStage
        ): TranslatedShaderStage => {
            const frontend = compiler.GlslFrontend.new();
            try {
                const module = frontend.parse(source, nagaStage);
                try {
                    return {
                        glsl: source,
                        wgsl: `requires uniform_buffer_standard_layout;\n${module.to_wgsl()}`
                    };
                } finally {
                    module.free();
                }
            } catch (error: unknown) {
                throw new NagaShaderTranslationError(stage, source, error);
            } finally {
                frontend.free();
            }
        };
        return {
            vertex: translateStage('vertex', prepared.vertex.glsl, compiler.ShaderStage.Vertex),
            fragment: translateStage(
                'fragment',
                prepared.fragment.glsl,
                compiler.ShaderStage.Fragment
            ),
            vertexInputs: prepared.vertexInputs,
            fragmentOutputs: prepared.fragmentOutputs,
            uniformBlocks: prepared.uniformBlocks,
            samplers: prepared.samplers
        };
    }
}
