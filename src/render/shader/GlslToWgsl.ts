import type * as Naga from 'web-naga';
import {
    FIRST_MATERIAL_TEXTURE_BINDING,
    getWebGPUUniformBlockBinding,
    type WebGPUResourceBinding
} from './WebGPUBindingLayout';
import { makeWgslUniformLayoutsPortable } from './WgslUniformLayout';
import {
    getInitializedNagaModule,
    initializeNagaModule,
    useNagaResource,
    useNagaShaderModule
} from './NagaModule';

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

export interface WebGPUSamplerResourceBinding {
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
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

function depthTextureType(type: GlslSamplerType): string {
    switch (type) {
        case 'sampler2D':
            return 'texture_depth_2d';
        case 'sampler2DArray':
            return 'texture_depth_2d_array';
        case 'samplerCube':
            return 'texture_depth_cube';
        default:
            throw new TypeError(
                `WebGPU numeric depth sampling is not available for GLSL sampler type ${type}`
            );
    }
}

function sampledTextureType(type: GlslSamplerType): string {
    switch (type) {
        case 'sampler2D':
            return 'texture_2d<f32>';
        case 'sampler2DArray':
            return 'texture_2d_array<f32>';
        case 'samplerCube':
            return 'texture_cube<f32>';
        default:
            return '';
    }
}

function replaceWgslTextureCalls(
    source: string,
    functionName: string,
    textureName: string,
    replacement: (arguments_: readonly SourceArgument[]) => string | null
): string {
    return rewriteNamedFunctionCalls(source, functionName, arguments_ => {
        if (!arguments_.some(argument => argument.text.trim() === textureName)) return null;
        return replacement(arguments_);
    });
}

function specializeDepthTextureBinding(source: string, binding: WebGPUSamplerBinding): string {
    const sampledType = sampledTextureType(binding.type);
    const depthType = depthTextureType(binding.type);
    const declaration = new RegExp(
        `(@group\\(\\s*${String(binding.group)}\\s*\\)\\s*@binding\\(\\s*${String(binding.textureBinding)}\\s*\\)\\s*var\\s+([A-Za-z_]\\w*)\\s*:\\s*)${regexEscape(sampledType)}(\\s*;)`,
        'u'
    );
    const match = declaration.exec(source);
    const textureName = match?.[2];
    if (!match || !textureName) {
        throw new Error(
            `Naga WGSL does not expose sampler ${binding.name}[${String(binding.arrayIndex)}] at @group(${String(binding.group)}) @binding(${String(binding.textureBinding)}) as ${sampledType}`
        );
    }
    let result = source.replace(declaration, `$1${depthType}$3`);
    for (const functionName of ['textureSampleBias', 'textureSampleGrad'] as const) {
        const callPattern = new RegExp(`\\b${functionName}\\s*\\(`, 'u');
        if (
            callPattern.test(result) &&
            rewriteNamedFunctionCalls(result, functionName, arguments_ =>
                arguments_.some(argument => argument.text.trim() === textureName) ? '' : null
            ) !== result
        ) {
            throw new TypeError(
                `WebGPU numeric depth sampler ${binding.name} cannot use ${functionName}; WGSL depth textures do not define that operation`
            );
        }
    }
    for (const functionName of ['textureSample', 'textureLoad'] as const) {
        result = replaceWgslTextureCalls(result, functionName, textureName, arguments_ => {
            if (arguments_[0]?.text.trim() !== textureName) return null;
            return `vec4<f32>(${functionName}(${arguments_
                .map(argument => argument.text.trim())
                .join(', ')}), 0.0, 0.0, 1.0)`;
        });
    }
    result = replaceWgslTextureCalls(result, 'textureSampleLevel', textureName, arguments_ => {
        if (arguments_[0]?.text.trim() !== textureName) return null;
        const levelIndex = binding.type.includes('2DArray') ? 4 : 3;
        const rewrittenArguments = arguments_.map((argument, index) =>
            index === levelIndex ? `i32(${argument.text.trim()})` : argument.text.trim()
        );
        return `vec4<f32>(textureSampleLevel(${rewrittenArguments.join(', ')}), 0.0, 0.0, 1.0)`;
    });
    result = replaceWgslTextureCalls(result, 'textureGather', textureName, arguments_ => {
        if (arguments_[0]?.text.trim() === textureName) return null;
        if (arguments_[1]?.text.trim() !== textureName) return null;
        return `textureGather(${arguments_
            .slice(1)
            .map(argument => argument.text.trim())
            .join(', ')})`;
    });
    return result;
}

/**
 * Specialize Naga's format-agnostic float sampler declarations for actual WebGPU depth resources.
 * GLSL exposes numeric depth reads through ordinary float samplers, whereas WGSL gives depth
 * textures a distinct type and scalar return value. The wrapper preserves GLSL's `.r`/vec4 ABI.
 */
export function specializeWebGPUDepthSamplers(
    shader: TranslatedShaderPair,
    depthSamplers: readonly WebGPUSamplerBinding[]
): TranslatedShaderPair {
    if (depthSamplers.length === 0) return shader;
    let vertexWgsl = shader.vertex.wgsl;
    let fragmentWgsl = shader.fragment.wgsl;
    for (const binding of depthSamplers) {
        if (binding.type.endsWith('Shadow')) {
            throw new TypeError(
                `Comparison sampler ${binding.name} is already represented as a WGSL depth texture`
            );
        }
        if (binding.stages.includes('vertex')) {
            vertexWgsl = specializeDepthTextureBinding(vertexWgsl, binding);
        }
        if (binding.stages.includes('fragment')) {
            fragmentWgsl = specializeDepthTextureBinding(fragmentWgsl, binding);
        }
    }
    return {
        ...shader,
        vertex: { ...shader.vertex, wgsl: vertexWgsl },
        fragment: { ...shader.fragment, wgsl: fragmentWgsl }
    };
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

export interface PrepareGLSLForNagaOptions {
    /** Keep fragment execution/discard/depth writes while omitting color outputs. */
    readonly fragmentOutputs?: 'color' | 'depth-only';
    /** Inject the WebGPU backend macro while normalizing. Defaults to true. */
    readonly defineWebGPU?: boolean;
    /** Override generated separate texture/sampler locations for an explicit graphics ABI. */
    readonly resolveSamplerBinding?: (
        name: string,
        arrayIndex: number
    ) => WebGPUSamplerResourceBinding | undefined;
}

interface ConditionalFrame {
    readonly parentActive: boolean;
    active: boolean;
    branchTaken: boolean;
}

interface PreprocessorAnalysis {
    readonly activeLines: readonly boolean[];
    readonly macros: ReadonlyMap<string, string>;
    readonly functionMacros: ReadonlyMap<string, FunctionMacro>;
}

interface FunctionMacro {
    readonly parameters: readonly string[];
    readonly body: string;
}

interface StageIoDeclaration {
    readonly stage: GraphicsShaderStage;
    readonly start: number;
    readonly end: number;
    readonly direction: 'in' | 'out';
    readonly name: string;
    readonly type: string;
    readonly arrayLength: number;
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

interface DynamicSamplerHelper {
    readonly name: string;
    readonly builtin: string;
    readonly returnType: string;
    readonly parameterTypes: readonly string[];
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
    readonly returnType: string;
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
const uniformBlockPattern = /((?:layout\s*\([^)]*\)\s*)*)uniform\s+([A-Za-z_]\w*)\s*\{/gu;
const stageIoPattern =
    /(?:(?:layout\s*\(([^)]*)\)\s*)?)((?:(?:flat|smooth|noperspective|centroid|sample)\s+)*)(in|out)\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[\s*([^\]]*)\s*\])?\s*;/gu;
const interfaceBlockPattern =
    /(?:(?:layout\s*\(([^)]*)\)\s*)?)((?:(?:flat|smooth|noperspective|centroid|sample)\s+)*)(in|out)\s+([A-Za-z_]\w*)\s*\{/gu;
const interfaceBlockFieldPattern =
    /(?:(?:layout\s*\(([^)]*)\)\s*)?)((?:(?:flat|smooth|noperspective|centroid|sample)\s+)*)([A-Za-z_]\w*)\s+([^;]+);/gu;

function uniformBlockLayoutQualifiers(layoutPrefix: string): readonly string[] {
    return [...layoutPrefix.matchAll(/layout\s*\(([^)]*)\)/gu)].flatMap(match =>
        splitSourceArguments(match[1] ?? '', 0, (match[1] ?? '').length).map(argument =>
            argument.text.trim()
        )
    );
}

function isStd140UniformBlock(layoutPrefix: string): boolean {
    return uniformBlockLayoutQualifiers(layoutPrefix).includes('std140');
}

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

type NagaShaderStage = Naga.ShaderStage;

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
    open: '(' | '{' | '[',
    close: ')' | '}' | ']'
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

function maskComments(source: string): string {
    const characters = source.split('');
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < characters.length; index++) {
        const character = characters[index];
        const next = characters[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            else characters[index] = ' ';
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                characters[index] = ' ';
                characters[index + 1] = ' ';
                blockComment = false;
                index++;
            } else if (character !== '\n') {
                characters[index] = ' ';
            }
            continue;
        }
        if (character === '/' && next === '/') {
            characters[index] = ' ';
            characters[index + 1] = ' ';
            lineComment = true;
            index++;
        } else if (character === '/' && next === '*') {
            characters[index] = ' ';
            characters[index + 1] = ' ';
            blockComment = true;
            index++;
        }
    }
    return characters.join('');
}

interface TwoRowMatrixUniformField {
    readonly name: string;
    readonly physicalName: string;
    readonly type: string;
    readonly columns: number;
    readonly arrayLength: number | null;
    readonly instanceName: string | null;
    readonly declarationStart: number;
    readonly declarationEnd: number;
}

interface BooleanUniformField {
    readonly name: string;
    readonly physicalName: string;
    readonly type: string;
    readonly physicalType: string;
    readonly vectorWidth: number;
    readonly arrayLength: number | null;
    readonly instanceName: string | null;
    readonly declarationStart: number;
    readonly declarationEnd: number;
}

function collectTwoRowMatrixUniformFields(
    source: string,
    analysis: PreprocessorAnalysis
): readonly TwoRowMatrixUniformField[] {
    const fields: TwoRowMatrixUniformField[] = [];
    const searchableSource = maskComments(source);
    uniformBlockPattern.lastIndex = 0;
    for (
        let blockMatch = uniformBlockPattern.exec(searchableSource);
        blockMatch;
        blockMatch = uniformBlockPattern.exec(searchableSource)
    ) {
        if (!isStd140UniformBlock(blockMatch[1] ?? '')) continue;
        const blockLine = lineAtOffset(source, blockMatch.index);
        if (!analysis.activeLines[blockLine]) continue;
        const openBrace = searchableSource.indexOf('{', blockMatch.index);
        const closeBrace = matchingDelimiter(searchableSource, openBrace, '{', '}');
        const suffix = /^\s*([A-Za-z_]\w*)?\s*;/u.exec(searchableSource.slice(closeBrace + 1));
        if (!suffix) {
            throw new Error('GLSL std140 uniform block is missing its terminating semicolon');
        }
        const instanceName = suffix[1] ?? null;
        const body = searchableSource.slice(openBrace + 1, closeBrace);
        const bodyStart = openBrace + 1;
        const declarationPattern =
            /\b(mat2(?:x2)?|mat[3-4]x2)\s+([A-Za-z_]\w*)\s*(?:\[\s*([^\]]+)\s*\])?\s*;/gu;
        for (
            let fieldMatch = declarationPattern.exec(body);
            fieldMatch;
            fieldMatch = declarationPattern.exec(body)
        ) {
            const declarationStart = bodyStart + fieldMatch.index;
            if (!analysis.activeLines[lineAtOffset(source, declarationStart)]) continue;
            const type = fieldMatch[1];
            const name = fieldMatch[2];
            if (!type || !name) continue;
            const columns = Number(type[3]);
            const rawArrayLength = fieldMatch[3];
            const arrayLength =
                rawArrayLength === undefined
                    ? null
                    : evaluatePreprocessorExpression(
                          rawArrayLength,
                          analysis.macros,
                          analysis.functionMacros
                      );
            if (arrayLength !== null && (!Number.isSafeInteger(arrayLength) || arrayLength < 1)) {
                throw new RangeError(
                    `std140 matrix array ${name} has invalid length ${String(arrayLength)}`
                );
            }
            const physicalName = `${name}__hiloStd140Columns`;
            if (new RegExp(`\\b${physicalName}\\b`, 'u').test(searchableSource)) {
                throw new Error(
                    `Reserved WebGPU uniform field ${physicalName} is already declared`
                );
            }
            fields.push({
                name,
                physicalName,
                type: type === 'mat2x2' ? 'mat2' : type,
                columns,
                arrayLength,
                instanceName,
                declarationStart,
                declarationEnd: bodyStart + declarationPattern.lastIndex
            });
        }
        uniformBlockPattern.lastIndex = closeBrace + 1;
    }
    return fields;
}

function regexEscape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function twoRowMatrixConstructor(
    field: TwoRowMatrixUniformField,
    physicalAccess: string,
    arrayIndex?: string
): string {
    const columns = Array.from({ length: field.columns }, (_unused, column) => {
        const index =
            arrayIndex === undefined
                ? String(column)
                : `((${arrayIndex}) * ${String(field.columns)} + ${String(column)})`;
        return `${physicalAccess}[${index}].xy`;
    });
    return `${field.type}(${columns.join(', ')})`;
}

function rewriteTwoRowMatrixAccesses(source: string, field: TwoRowMatrixUniformField): string {
    const logicalAccess = field.instanceName
        ? `\\b${regexEscape(field.instanceName)}\\s*\\.\\s*${regexEscape(field.name)}\\b`
        : `\\b${regexEscape(field.name)}\\b`;
    const physicalAccess = field.instanceName
        ? `${field.instanceName}.${field.physicalName}`
        : field.physicalName;
    const pattern = new RegExp(logicalAccess, 'gu');
    const searchableSource = maskComments(source);
    const replacements: { start: number; end: number; value: string }[] = [];
    for (
        let match = pattern.exec(searchableSource);
        match;
        match = pattern.exec(searchableSource)
    ) {
        if (field.arrayLength === null) {
            replacements.push({
                start: match.index,
                end: pattern.lastIndex,
                value: twoRowMatrixConstructor(field, physicalAccess)
            });
            continue;
        }
        let suffixStart = pattern.lastIndex;
        while (/[ \t\n\r]/u.test(searchableSource[suffixStart] ?? '')) suffixStart++;
        if (searchableSource[suffixStart] === '[') {
            const closeBracket = matchingDelimiter(searchableSource, suffixStart, '[', ']');
            replacements.push({
                start: match.index,
                end: closeBracket + 1,
                value: twoRowMatrixConstructor(
                    field,
                    physicalAccess,
                    source.slice(suffixStart + 1, closeBracket)
                )
            });
            pattern.lastIndex = closeBracket + 1;
            continue;
        }
        const lengthCall = /^\.\s*length\s*\(\s*\)/u.exec(searchableSource.slice(suffixStart));
        if (lengthCall) {
            replacements.push({
                start: match.index,
                end: suffixStart + lengthCall[0].length,
                value: String(field.arrayLength)
            });
            pattern.lastIndex = suffixStart + lengthCall[0].length;
            continue;
        }
        throw new Error(
            `WebGPU std140 matrix array ${field.name} must be accessed by element or .length()`
        );
    }
    return replaceSourceRanges(source, replacements);
}

/** Lower matrix columns that Naga's GLSL std140 frontend cannot represent. */
function lowerTwoRowStd140Matrices(source: string): string {
    const fields = collectTwoRowMatrixUniformFields(source, analyzePreprocessor(source));
    if (fields.length === 0) return source;
    const declarations = fields.map(field => ({
        start: field.declarationStart,
        end: field.declarationEnd,
        value: `vec4 ${field.physicalName}[${String(field.columns * (field.arrayLength ?? 1))}];`
    }));
    let result = replaceSourceRanges(source, declarations);
    for (const field of fields) result = rewriteTwoRowMatrixAccesses(result, field);
    return result;
}

function collectBooleanUniformFields(
    source: string,
    analysis: PreprocessorAnalysis
): readonly BooleanUniformField[] {
    const fields: BooleanUniformField[] = [];
    const searchableSource = maskComments(source);
    uniformBlockPattern.lastIndex = 0;
    for (
        let blockMatch = uniformBlockPattern.exec(searchableSource);
        blockMatch;
        blockMatch = uniformBlockPattern.exec(searchableSource)
    ) {
        if (!isStd140UniformBlock(blockMatch[1] ?? '')) continue;
        if (!analysis.activeLines[lineAtOffset(source, blockMatch.index)]) continue;
        const openBrace = searchableSource.indexOf('{', blockMatch.index);
        const closeBrace = matchingDelimiter(searchableSource, openBrace, '{', '}');
        const suffix = /^\s*([A-Za-z_]\w*)?\s*;/u.exec(searchableSource.slice(closeBrace + 1));
        if (!suffix) {
            throw new Error('GLSL std140 uniform block is missing its terminating semicolon');
        }
        const instanceName = suffix[1] ?? null;
        const body = searchableSource.slice(openBrace + 1, closeBrace);
        const bodyStart = openBrace + 1;
        const declarationPattern =
            /\b(bool|bvec([2-4]))\s+([A-Za-z_]\w*)\s*(?:\[\s*([^\]]+)\s*\])?\s*;/gu;
        for (
            let fieldMatch = declarationPattern.exec(body);
            fieldMatch;
            fieldMatch = declarationPattern.exec(body)
        ) {
            const declarationStart = bodyStart + fieldMatch.index;
            if (!analysis.activeLines[lineAtOffset(source, declarationStart)]) continue;
            const type = fieldMatch[1];
            const name = fieldMatch[3];
            if (!type || !name) continue;
            const vectorWidth = fieldMatch[2] === undefined ? 1 : Number(fieldMatch[2]);
            const rawArrayLength = fieldMatch[4];
            const arrayLength =
                rawArrayLength === undefined
                    ? null
                    : evaluatePreprocessorExpression(
                          rawArrayLength,
                          analysis.macros,
                          analysis.functionMacros
                      );
            if (arrayLength !== null && (!Number.isSafeInteger(arrayLength) || arrayLength < 1)) {
                throw new RangeError(
                    `std140 boolean array ${name} has invalid length ${String(arrayLength)}`
                );
            }
            const physicalName = `${name}__hiloStd140Value`;
            if (new RegExp(`\\b${physicalName}\\b`, 'u').test(searchableSource)) {
                throw new Error(
                    `Reserved WebGPU uniform field ${physicalName} is already declared`
                );
            }
            fields.push({
                name,
                physicalName,
                type,
                physicalType: vectorWidth === 1 ? 'int' : `ivec${String(vectorWidth)}`,
                vectorWidth,
                arrayLength,
                instanceName,
                declarationStart,
                declarationEnd: bodyStart + declarationPattern.lastIndex
            });
        }
        uniformBlockPattern.lastIndex = closeBrace + 1;
    }
    return fields;
}

function booleanValueExpression(field: BooleanUniformField, physicalValue: string): string {
    return field.vectorWidth === 1
        ? `(${physicalValue} != 0)`
        : `notEqual(${physicalValue}, ${field.physicalType}(0))`;
}

function rewriteBooleanUniformAccesses(source: string, field: BooleanUniformField): string {
    const logicalAccess = field.instanceName
        ? `\\b${regexEscape(field.instanceName)}\\s*\\.\\s*${regexEscape(field.name)}\\b`
        : `\\b${regexEscape(field.name)}\\b`;
    const physicalAccess = field.instanceName
        ? `${field.instanceName}.${field.physicalName}`
        : field.physicalName;
    const pattern = new RegExp(logicalAccess, 'gu');
    const searchableSource = maskComments(source);
    const replacements: { start: number; end: number; value: string }[] = [];
    for (
        let match = pattern.exec(searchableSource);
        match;
        match = pattern.exec(searchableSource)
    ) {
        if (field.arrayLength === null) {
            replacements.push({
                start: match.index,
                end: pattern.lastIndex,
                value: booleanValueExpression(field, physicalAccess)
            });
            continue;
        }
        let suffixStart = pattern.lastIndex;
        while (/[ \t\n\r]/u.test(searchableSource[suffixStart] ?? '')) suffixStart++;
        if (searchableSource[suffixStart] === '[') {
            const closeBracket = matchingDelimiter(searchableSource, suffixStart, '[', ']');
            replacements.push({
                start: match.index,
                end: closeBracket + 1,
                value: booleanValueExpression(
                    field,
                    `${physicalAccess}[${source.slice(suffixStart + 1, closeBracket)}]`
                )
            });
            pattern.lastIndex = closeBracket + 1;
            continue;
        }
        const lengthCall = /^\.\s*length\s*\(\s*\)/u.exec(searchableSource.slice(suffixStart));
        if (lengthCall) {
            replacements.push({
                start: match.index,
                end: suffixStart + lengthCall[0].length,
                value: String(field.arrayLength)
            });
            pattern.lastIndex = suffixStart + lengthCall[0].length;
            continue;
        }
        throw new Error(
            `WebGPU std140 boolean array ${field.name} must be accessed by element or .length()`
        );
    }
    return replaceSourceRanges(source, replacements);
}

/** Store GLSL booleans as their std140 32-bit integer representation for WGSL hosts. */
function lowerBooleanStd140Fields(source: string): string {
    const fields = collectBooleanUniformFields(source, analyzePreprocessor(source));
    if (fields.length === 0) return source;
    const declarations = fields.map(field => ({
        start: field.declarationStart,
        end: field.declarationEnd,
        value: `${field.physicalType} ${field.physicalName}${
            field.arrayLength === null ? '' : `[${String(field.arrayLength)}]`
        };`
    }));
    let result = replaceSourceRanges(source, declarations);
    for (const field of fields) result = rewriteBooleanUniformAccesses(result, field);
    return result;
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
        /\s*(0[xX][0-9a-fA-F]+[uUlL]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[uUlLfF]*|[A-Za-z_]\w*|<<|>>|\|\||&&|==|!=|<=|>=|[()?:+*/%!<>&|^~-])/gy;
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

function macroNames(
    macros: ReadonlyMap<string, string>,
    functionMacros: ReadonlyMap<string, FunctionMacro>
): ReadonlySet<string> {
    return new Set([...macros.keys(), ...functionMacros.keys()]);
}

function replaceMacroParameters(
    body: string,
    parameters: readonly string[],
    arguments_: readonly string[]
): string {
    const argumentByParameter = new Map(
        parameters.map((parameter, index) => [parameter, arguments_[index] ?? ''] as const)
    );
    return body.replace(/\b[A-Za-z_]\w*\b/gu, identifier => {
        return argumentByParameter.get(identifier) ?? identifier;
    });
}

function expandFunctionMacros(
    expression: string,
    macros: ReadonlyMap<string, string>,
    functionMacros: ReadonlyMap<string, FunctionMacro>,
    resolving: ReadonlySet<string>
): string {
    let result = expression;
    let cursor = 0;
    while (cursor < result.length) {
        const identifier = /[A-Za-z_]\w*/uy;
        identifier.lastIndex = cursor;
        const match = identifier.exec(result);
        if (!match) {
            cursor++;
            continue;
        }
        const name = match[0];
        const definition = functionMacros.get(name);
        if (!definition) {
            cursor = identifier.lastIndex;
            continue;
        }
        let open = identifier.lastIndex;
        while (/\s/u.test(result[open] ?? '')) open++;
        if (result[open] !== '(') {
            cursor = identifier.lastIndex;
            continue;
        }
        if (resolving.has(name)) {
            throw new Error(`Recursive GLSL function macro in preprocessor expression: ${name}`);
        }
        const close = matchingDelimiter(result, open, '(', ')');
        const arguments_ = splitSourceArguments(result, open + 1, close).map(argument =>
            argument.text.trim()
        );
        if (arguments_.length !== definition.parameters.length) {
            throw new TypeError(
                `GLSL function macro ${name} expects ${String(definition.parameters.length)} arguments, received ${String(arguments_.length)}`
            );
        }
        const nextResolving = new Set(resolving);
        nextResolving.add(name);
        const expandedArguments = arguments_.map(argument =>
            expandFunctionMacros(argument, macros, functionMacros, nextResolving)
        );
        const replacement = expandFunctionMacros(
            replaceMacroParameters(definition.body, definition.parameters, expandedArguments),
            macros,
            functionMacros,
            nextResolving
        );
        result = `${result.slice(0, match.index)}(${replacement})${result.slice(close + 1)}`;
        cursor = match.index;
    }
    return result;
}

function numericTokenValue(token: string): number {
    const normalized = token.replace(/[uUlLfF]+$/u, '');
    if (/^0[xX]/u.test(normalized)) return Number.parseInt(normalized.slice(2), 16);
    if (/^0[0-7]+$/u.test(normalized)) return Number.parseInt(normalized.slice(1), 8);
    return Number(normalized);
}

function evaluatePreprocessorExpression(
    rawExpression: string,
    macros: ReadonlyMap<string, string>,
    functionMacros: ReadonlyMap<string, FunctionMacro> = new Map(),
    resolving: ReadonlySet<string> = new Set()
): number {
    const names = macroNames(macros, functionMacros);
    const definedExpression = rawExpression
        .replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/gu, (_match, name: string) =>
            names.has(name) ? '1' : '0'
        )
        .replace(/defined\s+([A-Za-z_]\w*)/gu, (_match, name: string) =>
            names.has(name) ? '1' : '0'
        );
    const expression = expandFunctionMacros(definedExpression, macros, functionMacros, resolving);
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
            const value = conditional();
            take(')');
            return value;
        }
        const token = take();
        if (token.kind === 'number') return numericTokenValue(token.value);
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
        return evaluatePreprocessorExpression(macro || '1', macros, functionMacros, nextResolving);
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
        if (peek('~')) {
            take('~');
            return ~unary();
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
    const shift = (): number => {
        let value = additive();
        while (peek('<<') || peek('>>')) {
            const operator = take().value;
            const right = additive();
            value = operator === '<<' ? value << right : value >> right;
        }
        return value;
    };
    const relational = (): number => {
        let value = shift();
        while (peek('<') || peek('>') || peek('<=') || peek('>=')) {
            const operator = take().value;
            const right = shift();
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
    const bitwiseAnd = (): number => {
        let value = equality();
        while (peek('&')) {
            take('&');
            value &= equality();
        }
        return value;
    };
    const bitwiseXor = (): number => {
        let value = bitwiseAnd();
        while (peek('^')) {
            take('^');
            value ^= bitwiseAnd();
        }
        return value;
    };
    const bitwiseOr = (): number => {
        let value = bitwiseXor();
        while (peek('|')) {
            take('|');
            value |= bitwiseXor();
        }
        return value;
    };
    const logicalAnd = (): number => {
        let value = bitwiseOr();
        while (peek('&&')) {
            take('&&');
            const right = bitwiseOr();
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
    const conditional = (): number => {
        const condition = logicalOr();
        if (!peek('?')) return condition;
        take('?');
        const whenTrue = conditional();
        take(':');
        const whenFalse = conditional();
        return condition !== 0 ? whenTrue : whenFalse;
    };

    const result = conditional();
    if (cursor !== tokens.length) {
        throw new Error(`Trailing tokens in GLSL preprocessor expression: ${rawExpression}`);
    }
    return result;
}

function analyzePreprocessor(source: string): PreprocessorAnalysis {
    const lines = source.split('\n');
    const directiveLines = maskComments(source).split('\n');
    const activeLines: boolean[] = [];
    const macros = new Map<string, string>();
    const functionMacros = new Map<string, FunctionMacro>();
    const stack: ConditionalFrame[] = [];
    let active = true;

    lines.forEach((_line, index) => {
        activeLines[index] = active;
        const directive = /^\s*#\s*(\w+)(?:\s+(.*?))?\s*$/u.exec(directiveLines[index] ?? '');
        if (!directive) return;
        const command = directive[1] ?? '';
        const body = directive[2] ?? '';
        if (command === 'if' || command === 'ifdef' || command === 'ifndef') {
            const parentActive = active;
            const condition =
                command === 'ifdef'
                    ? macros.has(body.trim()) || functionMacros.has(body.trim())
                    : command === 'ifndef'
                      ? !macros.has(body.trim()) && !functionMacros.has(body.trim())
                      : evaluatePreprocessorExpression(body, macros, functionMacros) !== 0;
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
                evaluatePreprocessorExpression(body, macros, functionMacros) !== 0;
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
            const functionDefinition = /^([A-Za-z_]\w*)\(([^)]*)\)(?:\s+(.*))?$/u.exec(body);
            if (functionDefinition?.[1]) {
                const parameters =
                    functionDefinition[2]?.trim() === ''
                        ? []
                        : (functionDefinition[2] ?? '')
                              .split(',')
                              .map(parameter => parameter.trim());
                if (
                    parameters.some(parameter => !/^[A-Za-z_]\w*$/u.test(parameter)) ||
                    new Set(parameters).size !== parameters.length
                ) {
                    throw new SyntaxError(
                        `Unsupported GLSL function macro parameters: ${functionDefinition[2] ?? ''}`
                    );
                }
                const macroBody = functionDefinition[3]?.trim() ?? '1';
                if (/#|##/u.test(macroBody)) {
                    throw new SyntaxError(
                        `GLSL macro stringification and token pasting are not supported: ${functionDefinition[1]}`
                    );
                }
                functionMacros.set(functionDefinition[1], {
                    parameters,
                    body: macroBody
                });
                macros.delete(functionDefinition[1]);
                return;
            }
            const definition = /^([A-Za-z_]\w*)(?:\s+(.*))?$/u.exec(body);
            if (!definition?.[1]) {
                throw new SyntaxError(`Invalid GLSL macro definition: ${body}`);
            }
            macros.set(definition[1], definition[2]?.trim() ?? '1');
            functionMacros.delete(definition[1]);
        } else if (command === 'undef') {
            const name = body.trim();
            macros.delete(name);
            functionMacros.delete(name);
        }
    });
    if (stack.length !== 0) throw new Error('GLSL source has an unterminated conditional block');
    return { activeLines, macros, functionMacros };
}

function resolveConditionalCompilation(source: string): string {
    const analysis = analyzePreprocessor(source);
    const directiveLines = maskComments(source).split('\n');
    return source
        .split('\n')
        .map((line, index) => {
            const directive = /^\s*#\s*(\w+)/u.exec(directiveLines[index] ?? '');
            const command = directive?.[1] ?? '';
            if (['if', 'ifdef', 'ifndef', 'elif', 'else', 'endif'].includes(command)) return '';
            return analysis.activeLines[index] ? line : '';
        })
        .join('\n');
}

function interfaceLocation(
    layout: string,
    analysis: PreprocessorAnalysis,
    label: string
): number | null {
    if (layout.trim() === '') return null;
    let location: number | null = null;
    for (const argument of splitSourceArguments(layout, 0, layout.length)) {
        const qualifier = argument.text.trim();
        const match = /^location\s*=\s*(.+)$/u.exec(qualifier);
        if (!match?.[1]) {
            throw new TypeError(`WebGPU does not support ${label} layout qualifier ${qualifier}`);
        }
        if (location !== null) throw new SyntaxError(`${label} declares location more than once`);
        location = evaluatePreprocessorExpression(
            match[1],
            analysis.macros,
            analysis.functionMacros
        );
        if (!Number.isSafeInteger(location) || location < 0) {
            throw new RangeError(`${label} has invalid location ${String(location)}`);
        }
    }
    return location;
}

function normalizeStageInterfaceBlocks(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): string {
    const searchableSource = maskComments(source);
    const replacements: { start: number; end: number; value: string }[] = [];
    interfaceBlockPattern.lastIndex = 0;
    for (
        let match = interfaceBlockPattern.exec(searchableSource);
        match;
        match = interfaceBlockPattern.exec(searchableSource)
    ) {
        if (!isGlobalDeclaration(source, searchableSource, match.index, analysis)) continue;
        const line = lineAtOffset(source, match.index);
        if (!analysis.activeLines[line]) continue;
        const blockLayout = match[1] ?? '';
        const blockQualifiers = match[2] ?? '';
        const direction = match[3];
        const blockName = match[4];
        if (!direction || !blockName) continue;
        const openBrace = searchableSource.indexOf('{', match.index);
        const closeBrace = matchingDelimiter(searchableSource, openBrace, '{', '}');
        const tail = /^\s*([A-Za-z_]\w*)?\s*(\[\s*([^\]]*)\s*\])?\s*;/u.exec(
            searchableSource.slice(closeBrace + 1)
        );
        if (!tail) {
            throw new SyntaxError(`${stage} interface block ${blockName} has an invalid instance`);
        }
        const instanceName = tail[1];
        if (!instanceName) {
            throw new TypeError(
                `${stage} interface block ${blockName} must use a named instance for deterministic WebGPU lowering`
            );
        }
        if (tail[2] !== undefined) {
            throw new TypeError(
                `${stage} interface block array ${blockName} is unavailable in the vertex/fragment WebGPU pipeline`
            );
        }
        const blockLocation = interfaceLocation(
            blockLayout,
            analysis,
            `${stage} interface block ${blockName}`
        );
        let nextLocation = blockLocation;
        const bodyStart = openBrace + 1;
        const searchableBody = searchableSource.slice(bodyStart, closeBrace);
        const parsedRanges: { start: number; end: number; value: string }[] = [];
        const declarations: string[] = [];
        interfaceBlockFieldPattern.lastIndex = 0;
        for (
            let fieldMatch = interfaceBlockFieldPattern.exec(searchableBody);
            fieldMatch;
            fieldMatch = interfaceBlockFieldPattern.exec(searchableBody)
        ) {
            parsedRanges.push({
                start: fieldMatch.index,
                end: interfaceBlockFieldPattern.lastIndex,
                value: ''
            });
            const fieldLine = lineAtOffset(source, bodyStart + fieldMatch.index);
            if (!analysis.activeLines[fieldLine]) continue;
            const memberLayout = fieldMatch[1] ?? '';
            const memberQualifiers = fieldMatch[2] ?? '';
            const type = fieldMatch[3];
            const rawDeclarators = fieldMatch[4];
            if (!type || !rawDeclarators) continue;
            const memberLocation = interfaceLocation(
                memberLayout,
                analysis,
                `${stage} interface block member ${blockName}`
            );
            if (blockLocation !== null && memberLocation !== null) {
                throw new SyntaxError(
                    `${stage} interface block ${blockName} cannot combine block and member locations`
                );
            }
            if (memberLocation !== null) nextLocation = memberLocation;
            for (const declarator of splitSourceArguments(
                rawDeclarators,
                0,
                rawDeclarators.length
            )) {
                const field = /^\s*([A-Za-z_]\w*)\s*(?:\[\s*([^\]]+)\s*\])?\s*$/u.exec(
                    declarator.text
                );
                const fieldName = field?.[1];
                if (!fieldName) {
                    throw new SyntaxError(
                        `Unsupported ${stage} interface member declaration: ${declarator.text.trim()}`
                    );
                }
                const rawArrayLength = field[2];
                const arrayLength = rawArrayLength
                    ? evaluatePreprocessorExpression(
                          rawArrayLength,
                          analysis.macros,
                          analysis.functionMacros
                      )
                    : 1;
                if (!Number.isSafeInteger(arrayLength) || arrayLength < 1) {
                    throw new RangeError(
                        `${stage} interface member ${blockName}.${fieldName} has invalid array length ${String(arrayLength)}`
                    );
                }
                const canonicalName = `hilo_webgpu_interface_${blockName}_${fieldName}`;
                const qualifiers = `${blockQualifiers}${memberQualifiers}`
                    .trim()
                    .split(/\s+/u)
                    .filter((qualifier, index, all) => all.indexOf(qualifier) === index)
                    .join(' ');
                const layout =
                    nextLocation === null ? '' : `layout(location = ${String(nextLocation)}) `;
                declarations.push(
                    `${layout}${qualifiers === '' ? '' : `${qualifiers} `}${direction} ${type} ${canonicalName}${
                        rawArrayLength ? `[${String(arrayLength)}]` : ''
                    };`
                );
                const accessPattern = new RegExp(
                    `\\b${regexEscape(instanceName)}\\s*\\.\\s*${regexEscape(fieldName)}\\b`,
                    'gu'
                );
                for (
                    let access = accessPattern.exec(searchableSource);
                    access;
                    access = accessPattern.exec(searchableSource)
                ) {
                    replacements.push({
                        start: access.index,
                        end: accessPattern.lastIndex,
                        value: canonicalName
                    });
                }
                if (nextLocation !== null) {
                    nextLocation += locationCount(type) * arrayLength;
                }
            }
        }
        const unparsed = replaceSourceRanges(searchableBody, parsedRanges)
            .replace(/^\s*#.*$/gmu, '')
            .trim();
        if (unparsed !== '') {
            throw new SyntaxError(
                `Unsupported ${stage} interface block ${blockName} body: ${unparsed}`
            );
        }
        replacements.push({
            start: match.index,
            end: closeBrace + 1 + tail[0].length,
            value: declarations.join('\n')
        });
        interfaceBlockPattern.lastIndex = closeBrace + 1 + tail[0].length;
    }
    return replaceSourceRanges(source, replacements);
}

function assertGlslEs300BuiltinSet(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): void {
    const unsupported = [
        'textureGather',
        'textureGatherOffset',
        'textureGatherOffsets',
        'textureQueryLevels',
        'textureQueryLod'
    ] as const;
    const searchableSource = maskComments(source);
    const lines = source.split('\n');
    for (const name of unsupported) {
        const pattern = new RegExp(`\\b${name}\\s*\\(`, 'gu');
        for (
            let match = pattern.exec(searchableSource);
            match;
            match = pattern.exec(searchableSource)
        ) {
            const line = lineAtOffset(source, match.index);
            if (!analysis.activeLines[line] || /^\s*#/u.test(lines[line] ?? '')) continue;
            throw new TypeError(
                `${stage} shader builtin ${name} is not part of the GLSL ES 3.00/WebGL2 shader contract`
            );
        }
    }
}

function matrixShape(type: string): { columns: number; rows: number } | null {
    const match = /^mat([2-4])(?:x([2-4]))?$/u.exec(type);
    if (!match?.[1]) return null;
    return { columns: Number(match[1]), rows: Number(match[2] ?? match[1]) };
}

function locationCount(type: string): number {
    return matrixShape(type)?.columns ?? 1;
}

function isGlobalDeclaration(
    source: string,
    searchableSource: string,
    offset: number,
    analysis: PreprocessorAnalysis
): boolean {
    const lines = source.split('\n');
    let line = 0;
    let depth = 0;
    for (let index = 0; index < offset; index++) {
        const char = searchableSource[index];
        if (char === '\n') {
            line++;
            continue;
        }
        if (!analysis.activeLines[line] || /^\s*#/u.test(lines[line] ?? '')) continue;
        if (char === '{') depth++;
        else if (char === '}') depth--;
    }
    if (depth !== 0) return false;

    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    const prefix = searchableSource.slice(lineStart, offset);
    if (prefix.trim() === '') return true;
    let previous = offset - 1;
    while (/\s/u.test(searchableSource[previous] ?? '')) previous--;
    return searchableSource[previous] === ';' || searchableSource[previous] === '}';
}

function collectStageIo(
    source: string,
    stage: GraphicsShaderStage,
    analysis: PreprocessorAnalysis
): StageIoDeclaration[] {
    const declarations: StageIoDeclaration[] = [];
    const searchableSource = maskComments(source);
    stageIoPattern.lastIndex = 0;
    for (
        let match = stageIoPattern.exec(searchableSource);
        match;
        match = stageIoPattern.exec(searchableSource)
    ) {
        if (!isGlobalDeclaration(source, searchableSource, match.index, analysis)) continue;
        const line = lineAtOffset(source, match.index);
        if (!analysis.activeLines[line]) continue;
        const direction = match[3];
        const type = match[4];
        const name = match[5];
        if (!direction || !type || !name) continue;
        const rawArrayLength = match[6];
        if (rawArrayLength?.trim() === '') {
            throw new TypeError(`Shader I/O array ${name} must declare a fixed length`);
        }
        const arrayLength =
            rawArrayLength === undefined
                ? 1
                : evaluatePreprocessorExpression(
                      rawArrayLength,
                      analysis.macros,
                      analysis.functionMacros
                  );
        if (!Number.isSafeInteger(arrayLength) || arrayLength < 1) {
            throw new RangeError(
                `Shader I/O array ${name} has invalid length ${String(arrayLength)}`
            );
        }
        const layout = match[1] ?? '';
        const locationMatch = /(?:^|,)\s*location\s*=\s*(\d+)/u.exec(layout);
        const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
        const prefix = source.slice(lineStart, match.index);
        declarations.push({
            stage,
            start: match.index,
            end: stageIoPattern.lastIndex,
            direction: direction as 'in' | 'out',
            type,
            name,
            arrayLength,
            qualifiers: match[2] ?? '',
            indentation: prefix.trim() === '' ? prefix : '',
            explicitLocation: locationMatch?.[1] ? Number(locationMatch[1]) : null,
            locationCount: locationCount(type) * arrayLength
        });
    }
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
        const declarationType = `${declaration.type}[${String(declaration.arrayLength)}]`;
        const existingType = types.get(declaration.name);
        if (existingType && existingType !== declarationType) {
            throw new Error(
                `${label} ${declaration.name} has incompatible types ${existingType} and ${declarationType}`
            );
        }
        types.set(declaration.name, declarationType);
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
    fragmentOutputLocations: ReadonlyMap<string, number>,
    fragmentOutputMode: 'color' | 'depth-only'
): { source: string; vertexInputs: WebGPUVertexInput[] } {
    const beginning: string[] = [];
    const ending: string[] = [];
    const vertexInputs: WebGPUVertexInput[] = [];
    const replacements: { start: number; end: number; value: string }[] = [];
    for (const declaration of declarations) {
        if (
            stage === 'fragment' &&
            declaration.direction === 'out' &&
            fragmentOutputMode === 'depth-only'
        ) {
            replacements.push({
                start: declaration.start,
                end: declaration.end,
                value: `${declaration.type} ${declaration.name}${
                    declaration.arrayLength === 1 ? '' : `[${String(declaration.arrayLength)}]`
                };`
            });
            continue;
        }
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
        const matrix = matrixShape(declaration.type);
        const elementLocationCount = matrix?.columns ?? 1;
        const requiresFlattening = matrix !== null || declaration.arrayLength > 1;
        if (!requiresFlattening) {
            if (stage === 'vertex' && declaration.direction === 'in') {
                vertexInputs.push({
                    name: declaration.name,
                    type: declaration.type,
                    location,
                    locationCount: 1
                });
            }
            replacements.push({
                start: declaration.start,
                end: declaration.end,
                value: `layout(location = ${String(location)}) ${declaration.qualifiers}${declaration.direction} ${declaration.type} ${declaration.name};`
            });
            continue;
        }

        const interfaceLines: string[] = [];
        for (let element = 0; element < declaration.arrayLength; element++) {
            const elementLocation = location + element * elementLocationCount;
            const logicalAccess =
                declaration.arrayLength === 1
                    ? declaration.name
                    : `${declaration.name}[${String(element)}]`;
            const metadataName =
                declaration.arrayLength === 1
                    ? declaration.name
                    : `${declaration.name}[${String(element)}]`;
            if (stage === 'vertex' && declaration.direction === 'in') {
                vertexInputs.push({
                    name: metadataName,
                    type: declaration.type,
                    location: elementLocation,
                    locationCount: elementLocationCount
                });
            }
            if (!matrix) {
                const physicalName = `${declaration.name}__element${String(element)}`;
                interfaceLines.push(
                    `layout(location = ${String(elementLocation)}) ${declaration.qualifiers}${declaration.direction} ${declaration.type} ${physicalName};`
                );
                if (declaration.direction === 'in') {
                    beginning.push(`${logicalAccess} = ${physicalName};`);
                } else {
                    ending.push(`${physicalName} = ${logicalAccess};`);
                }
                continue;
            }

            const columnType = `vec${String(matrix.rows)}`;
            const columns = Array.from({ length: matrix.columns }, (_value, column) =>
                declaration.arrayLength === 1
                    ? `${declaration.name}__column${String(column)}`
                    : `${declaration.name}__element${String(element)}__column${String(column)}`
            );
            columns.forEach((name, column) => {
                interfaceLines.push(
                    `layout(location = ${String(elementLocation + column)}) ${declaration.qualifiers}${declaration.direction} ${columnType} ${name};`
                );
            });
            if (declaration.direction === 'in') {
                beginning.push(`${logicalAccess} = ${declaration.type}(${columns.join(', ')});`);
            } else {
                columns.forEach((name, column) => {
                    ending.push(`${name} = ${logicalAccess}[${String(column)}];`);
                });
            }
        }
        const privateDeclaration = `${declaration.type} ${declaration.name}${
            declaration.arrayLength === 1 ? '' : `[${String(declaration.arrayLength)}]`
        };`;
        replacements.push({
            start: declaration.start,
            end: declaration.end,
            value: [...interfaceLines, privateDeclaration]
                .map(line => `${declaration.indentation}${line}`)
                .join('\n')
        });
    }
    if (stage === 'vertex') {
        ending.unshift('gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;');
    }
    return {
        source: injectMainStatements(replaceSourceRanges(source, replacements), beginning, ending),
        vertexInputs
    };
}

function normalizeForNaga(source: string, defineWebGPU: boolean): string {
    const version = /^\s*#version\s+300\s+es\s*/u;
    return `#version 450\n${defineWebGPU ? '#define HILO_WEBGPU 1\n' : ''}${source
        .replace(version, '')
        // These macros only feed GLSL ES precision declarations. Naga's
        // preprocessor does not accept precision keywords as macro values,
        // and the declarations themselves are removed immediately below.
        .replace(/^\s*#\s*define\s+HILO_MAX_(?:VERTEX_|FRAGMENT_)?PRECISION\s+\w+\s*$/gmu, '')
        .replace(/^\s*precision\s+[^;]+;\s*$/gmu, '')
        // GLSL ES and Vulkan GLSL expose the same zero-based vertex index
        // under different built-in names.
        .replace(/\bgl_VertexID\b/gu, 'gl_VertexIndex')
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
        /\b(void|bool|int|uint|float|[biu]?vec[2-4]|mat[2-4](?:x[2-4])?)\s+([A-Za-z_]\w*)\s*\(/gu;
    for (let match = functionPattern.exec(source); match; match = functionPattern.exec(source)) {
        const returnType = match[1];
        const name = match[2];
        if (!returnType || !name) continue;
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
                returnType,
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
 * Lower Hilo's managed material-texture macro before lowering user functions.
 * Every texture-coordinate configuration must keep the sampler-taking helper:
 * besides UV selection it owns texture transforms, color decoding, and channel
 * remapping. Bypassing it for a single UV set changes material semantics.
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
        if (hasUv0 || hasUv1) {
            return `hiloTexture2D(${combined.texture}, ${combined.sampler}, ${uvSet})`;
        }
        throw new Error('HILO_TEXTURE_2D is active without a texture-coordinate attribute');
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
            ? evaluatePreprocessorExpression(
                  lengthExpression,
                  analysis.macros,
                  analysis.functionMacros
              )
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

function createSamplerResources(
    declarations: readonly SamplerDeclaration[],
    resolveBinding?: (name: string, arrayIndex: number) => WebGPUSamplerResourceBinding | undefined
): SamplerResource[] {
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
    // Bindings 0 and 1 are the scalar and per-texture-slot material uniform blocks.
    let binding = FIRST_MATERIAL_TEXTURE_BINDING;
    for (const name of order) {
        const declaration = declarations.find(item => item.name === name);
        if (!declaration) continue;
        const typeInfo = samplerTypeInfo(declaration.type);
        for (let arrayIndex = 0; arrayIndex < declaration.arrayLength; arrayIndex++) {
            const suffix = declaration.arrayLength === 1 ? '' : `_${String(arrayIndex)}`;
            const resolved = resolveBinding?.(name, arrayIndex);
            const group = resolved?.group ?? 1;
            const textureBinding = resolved?.textureBinding ?? binding++;
            const samplerBinding = resolved?.samplerBinding ?? binding++;
            resources.push({
                name,
                arrayIndex,
                type: declaration.type,
                group,
                textureBinding,
                samplerBinding,
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

function samplerDimension(type: GlslSamplerType): '2D' | '3D' | 'Cube' | '2DArray' {
    return type
        .replace(/^[iu]/u, '')
        .replace(/^sampler/u, '')
        .replace(/Shadow$/u, '') as '2D' | '3D' | 'Cube' | '2DArray';
}

function samplerValueType(type: GlslSamplerType): 'float' | 'vec4' | 'ivec4' | 'uvec4' {
    if (type.endsWith('Shadow')) return 'float';
    if (type.startsWith('isampler')) return 'ivec4';
    if (type.startsWith('usampler')) return 'uvec4';
    return 'vec4';
}

function samplerCoordinateType(type: GlslSamplerType): string {
    const dimension = samplerDimension(type);
    if (type.endsWith('Shadow')) {
        return dimension === '2D' ? 'vec3' : 'vec4';
    }
    return dimension === '2D' ? 'vec2' : 'vec3';
}

function samplerDerivativeType(type: GlslSamplerType): string {
    const dimension = samplerDimension(type);
    return dimension === '2D' || dimension === '2DArray' ? 'vec2' : 'vec3';
}

function samplerOffsetType(type: GlslSamplerType): string | null {
    const dimension = samplerDimension(type);
    if (dimension === 'Cube') return null;
    return dimension === '3D' ? 'ivec3' : 'ivec2';
}

function samplerTexelCoordinateType(type: GlslSamplerType): string | null {
    const dimension = samplerDimension(type);
    if (dimension === 'Cube' || type.endsWith('Shadow')) return null;
    return dimension === '2D' ? 'ivec2' : 'ivec3';
}

function samplerSizeType(type: GlslSamplerType): string {
    const dimension = samplerDimension(type);
    return dimension === '2D' || dimension === 'Cube' ? 'ivec2' : 'ivec3';
}

function samplerProjectiveCoordinateType(type: GlslSamplerType): string | null {
    const dimension = samplerDimension(type);
    if (dimension === '2D') return type.endsWith('Shadow') ? 'vec4' : 'vec3';
    if (dimension === '3D' && !type.endsWith('Shadow')) return 'vec4';
    return null;
}

function dynamicSamplerSignature(
    builtin: string,
    type: GlslSamplerType,
    argumentCount: number
): Omit<DynamicSamplerHelper, 'name' | 'builtin'> | null {
    const coordinate = samplerCoordinateType(type);
    const derivative = samplerDerivativeType(type);
    const offset = samplerOffsetType(type);
    const texelCoordinate = samplerTexelCoordinateType(type);
    const projectiveCoordinate = samplerProjectiveCoordinateType(type);
    const value = samplerValueType(type);
    switch (builtin) {
        case 'texture':
            if (argumentCount === 1) return { returnType: value, parameterTypes: [coordinate] };
            if (argumentCount === 2)
                return { returnType: value, parameterTypes: [coordinate, 'float'] };
            return null;
        case 'textureLod':
            return argumentCount === 2
                ? { returnType: value, parameterTypes: [coordinate, 'float'] }
                : null;
        case 'textureProj':
            if (!projectiveCoordinate) return null;
            if (argumentCount === 1)
                return { returnType: value, parameterTypes: [projectiveCoordinate] };
            if (argumentCount === 2)
                return {
                    returnType: value,
                    parameterTypes: [projectiveCoordinate, 'float']
                };
            return null;
        case 'textureProjOffset':
            if (!projectiveCoordinate || !offset) return null;
            if (argumentCount === 2)
                return {
                    returnType: value,
                    parameterTypes: [projectiveCoordinate, offset]
                };
            if (argumentCount === 3)
                return {
                    returnType: value,
                    parameterTypes: [projectiveCoordinate, offset, 'float']
                };
            return null;
        case 'textureProjLod':
            return argumentCount === 2 && projectiveCoordinate
                ? { returnType: value, parameterTypes: [projectiveCoordinate, 'float'] }
                : null;
        case 'textureProjLodOffset':
            return argumentCount === 3 && projectiveCoordinate && offset
                ? {
                      returnType: value,
                      parameterTypes: [projectiveCoordinate, 'float', offset]
                  }
                : null;
        case 'textureProjGrad':
            return argumentCount === 3 && projectiveCoordinate
                ? {
                      returnType: value,
                      parameterTypes: [projectiveCoordinate, derivative, derivative]
                  }
                : null;
        case 'textureProjGradOffset':
            return argumentCount === 4 && projectiveCoordinate && offset
                ? {
                      returnType: value,
                      parameterTypes: [projectiveCoordinate, derivative, derivative, offset]
                  }
                : null;
        case 'texelFetch':
            return argumentCount === 2 && texelCoordinate
                ? { returnType: value, parameterTypes: [texelCoordinate, 'int'] }
                : null;
        case 'textureSize':
            return argumentCount === 1
                ? { returnType: samplerSizeType(type), parameterTypes: ['int'] }
                : null;
        case 'textureOffset':
            if (!offset) return null;
            if (argumentCount === 2)
                return { returnType: value, parameterTypes: [coordinate, offset] };
            if (argumentCount === 3)
                return { returnType: value, parameterTypes: [coordinate, offset, 'float'] };
            return null;
        case 'textureLodOffset':
            return argumentCount === 3 && offset
                ? { returnType: value, parameterTypes: [coordinate, 'float', offset] }
                : null;
        case 'textureGrad':
            return argumentCount === 3
                ? { returnType: value, parameterTypes: [coordinate, derivative, derivative] }
                : null;
        case 'textureGradOffset':
            return argumentCount === 4 && offset
                ? {
                      returnType: value,
                      parameterTypes: [coordinate, derivative, derivative, offset]
                  }
                : null;
        case 'texelFetchOffset':
            return argumentCount === 3 && texelCoordinate && offset
                ? { returnType: value, parameterTypes: [texelCoordinate, 'int', offset] }
                : null;
        default:
            return null;
    }
}

function samplerArrayIndex(argument: string, name: string): string | null {
    const prefix = new RegExp(`^\\s*${regexEscape(name)}\\s*\\[`, 'u').exec(argument);
    if (!prefix) return null;
    const open = argument.indexOf('[', prefix.index);
    const close = matchingDelimiter(argument, open, '[', ']');
    if (argument.slice(close + 1).trim() !== '') return null;
    return argument.slice(open + 1, close).trim();
}

function zeroValue(type: string): string {
    switch (type) {
        case 'float':
            return '0.0';
        case 'int':
            return '0';
        case 'uint':
            return '0u';
        case 'vec2':
        case 'vec3':
        case 'vec4':
            return `${type}(0.0)`;
        case 'ivec2':
        case 'ivec3':
        case 'ivec4':
            return `${type}(0)`;
        case 'uvec2':
        case 'uvec3':
        case 'uvec4':
            return `${type}(0u)`;
        default:
            throw new TypeError(`Cannot construct a zero value for GLSL type ${type}`);
    }
}

const inlineSamplerDispatchBuiltins = new Set([
    'textureOffset',
    'textureLodOffset',
    'textureGradOffset',
    'texelFetchOffset',
    'textureProjOffset',
    'textureProjLodOffset',
    'textureProjGradOffset'
]);

function assertRepeatableSamplerIndex(index: string, builtin: string): void {
    if (/\+\+|--|(?:^|[^=!<>])=(?!=)|\b(?!int\s*\(|uint\s*\()[A-Za-z_]\w*\s*\(/u.test(index)) {
        throw new TypeError(
            `Dynamic sampler index for ${builtin} must be a side-effect-free dynamically uniform expression`
        );
    }
}

function inlineDynamicSamplerDispatch(
    builtin: string,
    returnType: string,
    index: string,
    arguments_: readonly string[],
    resources: readonly SamplerResource[]
): string {
    assertRepeatableSamplerIndex(index, builtin);
    let expression = zeroValue(returnType);
    for (const resource of [...resources].reverse()) {
        const call = `${builtin}(${resource.constructorType}(${resource.textureName}, ${resource.samplerName})${
            arguments_.length === 0 ? '' : `, ${arguments_.join(', ')}`
        })`;
        expression = `(int(${index}) == ${String(resource.arrayIndex)} ? ${call} : ${expression})`;
    }
    return expression;
}

function dynamicSamplerHelperSource(
    helper: DynamicSamplerHelper,
    resources: readonly SamplerResource[]
): string {
    const parameters = helper.parameterTypes.map((type, index) => {
        const array = /^(.+)\[(\d+)\]$/u.exec(type);
        return array?.[1] && array[2]
            ? `${array[1]} hiloArgument${String(index)}[${array[2]}]`
            : `${type} hiloArgument${String(index)}`;
    });
    const arguments_ = helper.parameterTypes.map((_type, index) => `hiloArgument${String(index)}`);
    const branches = resources.map(
        resource => `    if (hiloSamplerIndex == ${String(resource.arrayIndex)}) {
        return ${helper.builtin}(${resource.constructorType}(${resource.textureName}, ${resource.samplerName})${arguments_.length === 0 ? '' : `, ${arguments_.join(', ')}`});
    }`
    );
    return `${helper.returnType} ${helper.name}(int hiloSamplerIndex${parameters.length === 0 ? '' : `, ${parameters.join(', ')}`}) {
${branches.join('\n')}
    return ${zeroValue(helper.returnType)};
}`;
}

function samplerFunctionParameterName(parameter: string): string {
    const match = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/u.exec(parameter);
    const name = match?.[1];
    if (!name) throw new TypeError(`Cannot resolve GLSL function parameter name: ${parameter}`);
    return name;
}

function samplerResourceCombinations(
    resources: readonly SamplerResource[],
    count: number
): readonly (readonly SamplerResource[])[] {
    if (count === 0) return [[]];
    const tails = samplerResourceCombinations(resources, count - 1);
    return resources.flatMap(resource => tails.map(tail => [resource, ...tail]));
}

function dynamicSamplerFunctionHelperSource(
    helperName: string,
    definition: SamplerFunctionDefinition,
    dynamicPositions: readonly number[],
    resources: readonly SamplerResource[]
): string {
    const positionSet = new Set(dynamicPositions);
    const parameterNames = definition.parameterTexts.map(samplerFunctionParameterName);
    const indexNames = new Map<number, string>();
    for (const position of dynamicPositions) {
        const parameterName = parameterNames[position];
        if (!parameterName) throw new Error('Dynamic sampler parameter position is out of range');
        indexNames.set(position, `${parameterName}__hiloIndex`);
    }
    const helperParameters = definition.parameterTexts.map((parameter, index) => {
        if (!positionSet.has(index)) return parameter;
        const indexName = indexNames.get(index);
        if (!indexName) throw new Error('Dynamic sampler index parameter is unavailable');
        return `int ${indexName}`;
    });
    const invocation = (combination: readonly SamplerResource[]): string => {
        let resourceIndex = 0;
        const arguments_ = parameterNames.map((name, index) => {
            if (!positionSet.has(index)) return name;
            const resource = combination[resourceIndex++];
            if (!resource) throw new Error('Dynamic sampler dispatch resource is unavailable');
            return `${resource.constructorType}(${resource.textureName}, ${resource.samplerName})`;
        });
        return `${definition.name}(${arguments_.join(', ')})`;
    };
    const statement = (call: string): string =>
        definition.returnType === 'void' ? `${call};\n        return;` : `return ${call};`;
    const combinations = samplerResourceCombinations(resources, dynamicPositions.length);
    const branches = combinations.map(combination => {
        const condition = dynamicPositions
            .map((position, index) => {
                const resource = combination[index];
                if (!resource) throw new Error('Dynamic sampler dispatch condition is unavailable');
                const indexName = indexNames.get(position);
                if (!indexName) throw new Error('Dynamic sampler index parameter is unavailable');
                return `${indexName} == ${String(resource.arrayIndex)}`;
            })
            .join(' && ');
        return `    if (${condition}) {
        ${statement(invocation(combination))}
    }`;
    });
    const fallback = resources[0];
    if (!fallback) throw new Error('Dynamic sampler dispatch requires at least one resource');
    return `${definition.returnType} ${helperName}(${helperParameters.join(', ')}) {
${branches.join('\n')}
    ${statement(invocation(dynamicPositions.map(() => fallback)))}
}`;
}

function lowerDynamicSamplerFunctionCalls(
    source: string,
    declaration: SamplerDeclaration,
    resources: readonly SamplerResource[]
): { readonly source: string; readonly helpers: readonly string[] } {
    const definitionsByName = new Map<string, SamplerFunctionDefinition[]>();
    for (const definition of collectSamplerFunctionDefinitions(source)) {
        if (!definition.parameters.some(parameter => parameter.type === declaration.type)) continue;
        const definitions = definitionsByName.get(definition.name) ?? [];
        definitions.push(definition);
        definitionsByName.set(definition.name, definitions);
    }
    const helpers = new Map<string, string>();
    let result = source;
    for (const [name, definitions] of definitionsByName) {
        result = rewriteNamedFunctionCalls(result, name, arguments_ => {
            const matching = definitions.filter(
                definition => definition.arity === arguments_.length
            );
            const candidates = matching
                .map(definition => ({
                    definition,
                    positions: definition.parameters
                        .filter(parameter => parameter.type === declaration.type)
                        .map(parameter => parameter.index)
                        .filter(position => {
                            const index = samplerArrayIndex(
                                arguments_[position]?.text ?? '',
                                declaration.name
                            );
                            return index !== null && !/^\d+$/u.test(index);
                        })
                }))
                .filter(candidate => candidate.positions.length > 0);
            if (candidates.length === 0) return null;
            const positionKeys = new Set(
                candidates.map(candidate => candidate.positions.join(','))
            );
            if (positionKeys.size !== 1) {
                throw new TypeError(
                    `WebGPU cannot disambiguate dynamic sampler array call ${name} with ${String(arguments_.length)} arguments`
                );
            }
            const positions = candidates[0]?.positions;
            if (!positions) return null;
            const helperName = `${declaration.name}__hiloDynamicCall_${name}_${positions.join('_')}`;
            for (const candidate of candidates) {
                const signature = `${helperName}:${candidate.definition.returnType}:${candidate.definition.parameterTexts.join(':')}`;
                if (!helpers.has(signature)) {
                    helpers.set(
                        signature,
                        dynamicSamplerFunctionHelperSource(
                            helperName,
                            candidate.definition,
                            positions,
                            resources
                        )
                    );
                }
            }
            const positionSet = new Set(positions);
            const rewrittenArguments = arguments_.map((argument, index) => {
                if (!positionSet.has(index)) return argument.text.trim();
                const samplerIndex = samplerArrayIndex(argument.text, declaration.name);
                if (samplerIndex === null) {
                    throw new Error('Dynamic sampler call index disappeared during lowering');
                }
                return `int(${samplerIndex})`;
            });
            return `${helperName}(${rewrittenArguments.join(', ')})`;
        });
    }
    return { source: result, helpers: [...helpers.values()] };
}

function lowerDynamicSamplerArrayCalls(
    source: string,
    declaration: SamplerDeclaration,
    resources: readonly SamplerResource[]
): {
    readonly source: string;
    readonly helpers: readonly DynamicSamplerHelper[];
    readonly functionHelpers: readonly string[];
} {
    const helpers = new Map<string, DynamicSamplerHelper>();
    let result = source;
    const builtins = [
        'texture',
        'textureLod',
        'textureProj',
        'textureProjOffset',
        'textureProjLod',
        'textureProjLodOffset',
        'textureProjGrad',
        'textureProjGradOffset',
        'texelFetch',
        'textureSize',
        'textureOffset',
        'textureLodOffset',
        'textureGrad',
        'textureGradOffset',
        'texelFetchOffset'
    ] as const;
    for (const builtin of builtins) {
        result = rewriteNamedFunctionCalls(result, builtin, arguments_ => {
            const index = samplerArrayIndex(arguments_[0]?.text ?? '', declaration.name);
            if (index === null || /^\d+$/u.test(index)) return null;
            const signature = dynamicSamplerSignature(
                builtin,
                declaration.type,
                arguments_.length - 1
            );
            if (!signature) {
                throw new TypeError(
                    `WebGPU cannot lower ${builtin}(${declaration.type}, ...) with ${String(arguments_.length - 1)} non-sampler arguments`
                );
            }
            const remainingArguments = arguments_.slice(1).map(argument => argument.text.trim());
            if (inlineSamplerDispatchBuiltins.has(builtin)) {
                return inlineDynamicSamplerDispatch(
                    builtin,
                    signature.returnType,
                    index,
                    remainingArguments,
                    resources
                );
            }
            const key = `${builtin}:${signature.returnType}:${signature.parameterTypes.join(':')}`;
            let helper = helpers.get(key);
            if (!helper) {
                const suffix = key.replace(/[^A-Za-z0-9_]/gu, '_');
                helper = {
                    name: `${declaration.name}__hiloDynamic_${suffix}`,
                    builtin,
                    ...signature
                };
                helpers.set(key, helper);
            }
            return `${helper.name}(int(${index})${remainingArguments.length === 0 ? '' : `, ${remainingArguments.join(', ')}`})`;
        });
    }
    const lengthPattern = new RegExp(
        `\\b${regexEscape(declaration.name)}\\s*\\.\\s*length\\s*\\(\\s*\\)`,
        'gu'
    );
    result = result.replace(lengthPattern, String(declaration.arrayLength));
    const functions = lowerDynamicSamplerFunctionCalls(result, declaration, resources);
    return {
        source: functions.source,
        helpers: [...helpers.values()],
        functionHelpers: functions.helpers
    };
}

function insertDynamicSamplerHelpers(source: string, helpers: string): string {
    if (!helpers) return source;
    const userMain = /\bvoid\s+hilo_webgpu_user_main(?:_entry)*\s*\(/u.exec(source);
    if (!userMain) throw new Error('WebGPU sampler lowering cannot locate the rewritten main');
    return `${source.slice(0, userMain.index)}${helpers}\n${source.slice(userMain.index)}`;
}

function replaceSamplerDeclarations(
    source: string,
    stage: GraphicsShaderStage,
    declarations: readonly SamplerDeclaration[],
    resources: readonly SamplerResource[]
): string {
    const stageDeclarations = declarations.filter(declaration => declaration.stage === stage);
    const placeholders = new Map<SamplerDeclaration, string>();
    let result = source;
    for (const [index, declaration] of [...stageDeclarations].reverse().entries()) {
        const placeholder = `__HILO_NAGA_SAMPLER_DECL_${String(index)}__`;
        placeholders.set(declaration, placeholder);
        result = `${result.slice(0, declaration.start)}${placeholder}${result.slice(declaration.end)}`;
    }
    for (const declaration of stageDeclarations) {
        const items = resources.filter(resource => resource.name === declaration.name);
        let helperDeclarations = '';
        if (declaration.arrayLength === 1) {
            const item = items[0];
            if (!item) throw new Error(`Sampler resource ${declaration.name} was not allocated`);
            const usePattern = new RegExp(`\\b${declaration.name}\\b`, 'gu');
            result = result.replace(
                usePattern,
                `${item.constructorType}(${item.textureName}, ${item.samplerName})`
            );
        } else {
            const lowered = lowerDynamicSamplerArrayCalls(result, declaration, items);
            result = lowered.source;
            helperDeclarations = [
                ...lowered.helpers.map(helper => dynamicSamplerHelperSource(helper, items)),
                ...lowered.functionHelpers
            ].join('\n');
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
                const index = match[1]?.trim() ?? '';
                if (/^\d+$/u.test(index)) {
                    throw new RangeError(
                        `WebGPU sampler array ${declaration.name} index ${index} is outside its declared length ${String(declaration.arrayLength)}`
                    );
                }
                throw new Error(
                    `WebGPU sampler array ${declaration.name} must be sampled through a supported GLSL texture builtin when its index is dynamically uniform`
                );
            }
        }
        const placeholder = placeholders.get(declaration);
        if (!placeholder) continue;
        const resourceDeclarations = items
            .map(
                resource =>
                    `layout(set = ${String(resource.group)}, binding = ${String(resource.textureBinding)}) uniform ${resource.textureType} ${resource.textureName};\nlayout(set = ${String(resource.group)}, binding = ${String(resource.samplerBinding)}) uniform ${resource.samplerType} ${resource.samplerName};`
            )
            .join('\n');
        result = result.replace(placeholder, resourceDeclarations);
        result = insertDynamicSamplerHelpers(result, helperDeclarations);
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
    const searchableSource = maskComments(source);
    uniformBlockPattern.lastIndex = 0;
    for (
        let match = uniformBlockPattern.exec(searchableSource);
        match;
        match = uniformBlockPattern.exec(searchableSource)
    ) {
        const layoutPrefix = match[1] ?? '';
        const name = match[2];
        if (!name) continue;
        const line = lineAtOffset(source, match.index);
        if (!analysis.activeLines[line]) continue;
        if (!isStd140UniformBlock(layoutPrefix)) {
            throw new TypeError(
                `WebGPU uniform block ${name} must explicitly declare the std140 layout`
            );
        }
        const openBrace = searchableSource.indexOf('{', match.index);
        const closeBrace = matchingDelimiter(searchableSource, openBrace, '{', '}');
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
    return source.replace(uniformBlockPattern, (match, layoutPrefix: string, name: string) => {
        if (!activeNames.has(name)) return match;
        const { group, binding } = resolveBinding(name);
        const preserved = uniformBlockLayoutQualifiers(layoutPrefix).filter(
            qualifier =>
                qualifier !== 'std140' &&
                !/^set\s*=/u.test(qualifier) &&
                !/^binding\s*=/u.test(qualifier)
        );
        return `layout(${[
            'std140',
            ...preserved,
            `set = ${String(group)}`,
            `binding = ${String(binding)}`
        ].join(', ')}) uniform ${name} {`;
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

/**
 * Preserve fragment execution, discard, and depth writes while turning active color outputs into
 * private globals. The returned source remains GLSL ES 3.00 and is therefore suitable for the
 * WebGL2 depth-only pipeline; the Naga path performs the equivalent rewrite during stage-IO
 * normalization below.
 */
export function prepareGLSLDepthOnlyFragment(fragmentSource: string): string {
    const baseAnalysis = analyzePreprocessor(fragmentSource);
    assertGlslEs300BuiltinSet(fragmentSource, 'fragment', baseAnalysis);
    const normalized = normalizeStageInterfaceBlocks(fragmentSource, 'fragment', baseAnalysis);
    const analysis = analyzePreprocessor(normalized);
    const outputs = collectStageIo(normalized, 'fragment', analysis).filter(
        declaration => declaration.direction === 'out'
    );
    return replaceSourceRanges(
        normalized,
        outputs.map(declaration => ({
            start: declaration.start,
            end: declaration.end,
            value: `${declaration.type} ${declaration.name}${
                declaration.arrayLength === 1 ? '' : `[${String(declaration.arrayLength)}]`
            };`
        }))
    );
}

/** Convert assembled GLSL ES 3.00 into the Vulkan-flavoured GLSL accepted by Naga. */
export function prepareGLSLForNaga(
    vertexSource: string,
    fragmentSource: string,
    resolveUniformBlockBinding: (
        name: string
    ) => WebGPUResourceBinding = defaultUniformBlockBinding,
    options: PrepareGLSLForNagaOptions = {}
): PreparedShaderPair {
    const fragmentOutputMode = options.fragmentOutputs ?? 'color';
    const defineWebGPU = options.defineWebGPU ?? true;
    const normalizedVertexBase = normalizeForNaga(vertexSource, defineWebGPU);
    const normalizedFragmentBase = normalizeForNaga(fragmentSource, defineWebGPU);
    const normalizedVertexBaseAnalysis = analyzePreprocessor(normalizedVertexBase);
    const normalizedFragmentBaseAnalysis = analyzePreprocessor(normalizedFragmentBase);
    assertGlslEs300BuiltinSet(normalizedVertexBase, 'vertex', normalizedVertexBaseAnalysis);
    assertGlslEs300BuiltinSet(normalizedFragmentBase, 'fragment', normalizedFragmentBaseAnalysis);
    const normalizedVertex = normalizeStageInterfaceBlocks(
        normalizedVertexBase,
        'vertex',
        normalizedVertexBaseAnalysis
    );
    const normalizedFragment = normalizeStageInterfaceBlocks(
        normalizedFragmentBase,
        'fragment',
        normalizedFragmentBaseAnalysis
    );
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
        fragmentOutputLocations,
        fragmentOutputMode
    );
    const rewrittenFragment = rewriteStageIo(
        normalizedFragment,
        'fragment',
        fragmentIo,
        vertexInputLocations,
        varyingLocations,
        fragmentOutputLocations,
        fragmentOutputMode
    );

    const vertexAfterIoAnalysis = analyzePreprocessor(rewrittenVertex.source);
    const fragmentAfterIoAnalysis = analyzePreprocessor(rewrittenFragment.source);
    const samplerDeclarations = [
        ...collectSamplerDeclarations(rewrittenVertex.source, 'vertex', vertexAfterIoAnalysis),
        ...collectSamplerDeclarations(rewrittenFragment.source, 'fragment', fragmentAfterIoAnalysis)
    ];
    const samplerResources = createSamplerResources(
        samplerDeclarations,
        options.resolveSamplerBinding
    );
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
    vertex = lowerTwoRowStd140Matrices(vertex);
    fragment = lowerTwoRowStd140Matrices(fragment);
    vertex = lowerBooleanStd140Fields(vertex);
    fragment = lowerBooleanStd140Fields(fragment);
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
        vertex: { glsl: resolveConditionalCompilation(vertex) },
        fragment: { glsl: resolveConditionalCompilation(fragment) },
        vertexInputs: Object.freeze(rewrittenVertex.vertexInputs),
        fragmentOutputs: Object.freeze(
            (fragmentOutputMode === 'depth-only' ? [] : fragmentOutputDeclarations).flatMap(
                declaration => {
                    const location = fragmentOutputLocations.get(declaration.name);
                    if (location === undefined) {
                        throw new Error(
                            `No WebGPU fragment output location was allocated for ${declaration.name}`
                        );
                    }
                    const elementLocations = locationCount(declaration.type);
                    return Array.from({ length: declaration.arrayLength }, (_value, index) => ({
                        name:
                            declaration.arrayLength === 1
                                ? declaration.name
                                : `${declaration.name}[${String(index)}]`,
                        type: declaration.type,
                        location: location + index * elementLocations
                    }));
                }
            )
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
        resolveUniformBlockBinding?: (name: string) => WebGPUResourceBinding,
        options: PrepareGLSLForNagaOptions = {}
    ): TranslatedShaderPair {
        const compiler = getInitializedNagaModule();
        if (!compiler) {
            throw new Error(
                'Naga is not initialized; await translator.initialize() before translating'
            );
        }
        const prepared = prepareGLSLForNaga(
            vertexSource,
            fragmentSource,
            resolveUniformBlockBinding,
            options
        );
        const translateStage = (
            stage: GraphicsShaderStage,
            source: string,
            nagaStage: NagaShaderStage
        ): TranslatedShaderStage => {
            try {
                return useNagaResource(compiler.GlslFrontend.new(), frontend => {
                    const module = frontend.parse(source, nagaStage);
                    return useNagaShaderModule(module, activeModule => ({
                        glsl: source,
                        wgsl: makeWgslUniformLayoutsPortable(activeModule.to_wgsl())
                    }));
                });
            } catch (error: unknown) {
                throw new NagaShaderTranslationError(stage, source, error);
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
