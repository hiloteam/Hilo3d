import type * as Naga from 'web-naga';
import type {
    ShaderReadBinding,
    ShaderTextureSampleType,
    ShaderTextureViewDimension
} from '../compute/ComputeShader';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type {
    RHIBackend,
    RHIShaderArtifactInput,
    RHIShaderBindingReflection,
    RHIShaderReflection
} from '../rhi/core';
import {
    prepareGLSLForNaga,
    type GraphicsShaderStage,
    type GlslSamplerType,
    type PreparedShaderPair,
    type WebGPUSamplerBinding,
    type WebGPUUniformBlock
} from './GlslToWgsl';
import {
    getInitializedNagaModule,
    initializeNagaModule,
    useNagaResource,
    useNagaShaderModule
} from './NagaModule';
import { makeWgslUniformLayoutsPortable } from './WgslUniformLayout';

type BufferReadBinding = Extract<
    ShaderReadBinding,
    { readonly kind: 'uniform-buffer' | 'read-only-storage-buffer' }
>;
type SampledTextureBinding = Extract<ShaderReadBinding, { readonly kind: 'sampled-texture' }>;
type SamplerBinding = Extract<
    ShaderReadBinding,
    { readonly kind: 'sampler' | 'comparison-sampler' }
>;

interface SourceToken {
    readonly kind: 'identifier' | 'number' | 'symbol';
    readonly value: string;
    readonly offset: number;
    readonly end: number;
}

interface SourceStorageBlock {
    readonly stage: GraphicsShaderStage;
    readonly name: string;
    readonly blockName: string;
    readonly signature: string;
    readonly layoutStart: number;
    readonly layoutEnd: number;
    readonly offset: number;
}

export interface StorageGraphicsBufferBinding {
    readonly name: string;
    readonly blockName: string;
    readonly group: number;
    readonly binding: number;
    readonly stages: readonly GraphicsShaderStage[];
}

export interface CompiledStorageGraphicsShaderMetadata {
    readonly vertexInputs: PreparedShaderPair['vertexInputs'];
    readonly fragmentOutputs: PreparedShaderPair['fragmentOutputs'];
    readonly uniformBlocks: readonly WebGPUUniformBlock[];
    readonly samplers: readonly WebGPUSamplerBinding[];
    readonly storageBuffers: readonly StorageGraphicsBufferBinding[];
}

export interface CompiledStorageGraphicsShader {
    readonly backend: 'webgpu';
    readonly token: number;
    readonly vertex: Readonly<RHIShaderArtifactInput>;
    readonly fragment: Readonly<RHIShaderArtifactInput>;
    readonly bindings: readonly ShaderReadBinding[];
    readonly metadata: Readonly<CompiledStorageGraphicsShaderMetadata>;
}

export class StorageGraphicsCompilationError extends Error {
    readonly stage: GraphicsShaderStage;
    readonly source: string;
    override readonly cause: unknown;

    constructor(stage: GraphicsShaderStage, source: string, cause: unknown) {
        super(`Naga failed to translate the storage graphics ${stage} shader: ${String(cause)}`);
        this.name = 'StorageGraphicsCompilationError';
        this.stage = stage;
        this.source = source;
        this.cause = cause;
    }
}

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
            characters[index] = ' ';
            characters[index + 1] = ' ';
            index += 2;
            while (index < characters.length) {
                const blockCurrent = characters[index];
                const blockNext = characters[index + 1];
                if (blockCurrent === '*' && blockNext === '/') {
                    characters[index] = ' ';
                    characters[index + 1] = ' ';
                    index += 2;
                    break;
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

function maskPreprocessorDirectives(source: string): string {
    const characters = new Array<string>(source.length);
    for (let characterIndex = 0; characterIndex < source.length; characterIndex += 1) {
        characters[characterIndex] = source[characterIndex] ?? '';
    }
    let lineStart = true;
    let directive = false;
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (character === '\n') {
            lineStart = true;
            directive = false;
            continue;
        }
        if (directive) {
            characters[index] = ' ';
            continue;
        }
        if (lineStart && (character === ' ' || character === '\t' || character === '\r')) {
            continue;
        }
        if (lineStart && character === '#') {
            directive = true;
            characters[index] = ' ';
            continue;
        }
        lineStart = false;
    }
    return characters.join('');
}

function tokenize(source: string): readonly SourceToken[] {
    const masked = maskPreprocessorDirectives(maskComments(source));
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
            tokens.push({
                kind: 'identifier',
                value: masked.slice(start, offset),
                offset: start,
                end: offset
            });
            continue;
        }
        if (/[0-9]/u.test(character)) {
            const start = offset++;
            while (/[A-Za-z0-9_.]/u.test(masked[offset] ?? '')) offset++;
            tokens.push({
                kind: 'number',
                value: masked.slice(start, offset),
                offset: start,
                end: offset
            });
            continue;
        }
        tokens.push({ kind: 'symbol', value: character, offset, end: offset + 1 });
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
    for (let index = openIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.value === open) depth++;
        if (token?.value === close) {
            depth--;
            if (depth === 0) return index;
        }
    }
    failSource(source, tokens[openIndex]?.offset ?? 0, `Unclosed ${open} delimiter`);
}

function compactTokens(tokens: readonly SourceToken[]): string {
    return tokens.map(token => token.value).join('');
}

function splitTopLevel(tokens: readonly SourceToken[], separator: string): SourceToken[][] {
    const result: SourceToken[][] = [[]];
    let depth = 0;
    for (const token of tokens) {
        if (token.value === '(' || token.value === '[' || token.value === '{') depth++;
        if (token.value === ')' || token.value === ']' || token.value === '}') depth--;
        if (token.value === separator && depth === 0) {
            result.push([]);
        } else {
            result.at(-1)?.push(token);
        }
    }
    return result;
}

function parseStorageBlock(
    source: string,
    stage: GraphicsShaderStage,
    tokens: readonly SourceToken[],
    declarationStart: number,
    bufferIndex: number
): { readonly block: SourceStorageBlock; readonly nextIndex: number } {
    const bufferToken = tokens[bufferIndex];
    const prefix = tokens.slice(declarationStart, bufferIndex);
    if (prefix[0]?.value !== 'layout' || prefix[1]?.value !== '(') {
        failSource(
            source,
            bufferToken?.offset ?? 0,
            'Storage graphics buffer blocks require layout(std430) readonly buffer'
        );
    }
    const layoutClose = matchingToken(source, tokens, declarationStart + 1, '(', ')');
    if (layoutClose >= bufferIndex) {
        failSource(source, bufferToken?.offset ?? 0, 'Malformed storage buffer layout qualifier');
    }
    const layoutQualifiers = splitTopLevel(tokens.slice(declarationStart + 2, layoutClose), ',');
    if (layoutQualifiers.length !== 1 || compactTokens(layoutQualifiers[0] ?? []) !== 'std430') {
        failSource(
            source,
            tokens[declarationStart]?.offset ?? 0,
            'Storage graphics blocks accept only layout(std430); set and binding come from the descriptor ABI'
        );
    }
    const memoryQualifiers = tokens.slice(layoutClose + 1, bufferIndex);
    if (memoryQualifiers.length !== 1 || memoryQualifiers[0]?.value !== 'readonly') {
        failSource(
            source,
            bufferToken?.offset ?? 0,
            'Graphics storage buffer blocks must be explicitly readonly'
        );
    }

    const blockName = tokens[bufferIndex + 1];
    const openBrace = tokens[bufferIndex + 2];
    if (blockName?.kind !== 'identifier' || openBrace?.value !== '{') {
        failSource(source, bufferToken?.offset ?? 0, 'Storage buffer block requires a block name');
    }
    const closeBrace = matchingToken(source, tokens, bufferIndex + 2, '{', '}');
    const instanceName = tokens[closeBrace + 1];
    const semicolon = tokens[closeBrace + 2];
    if (instanceName?.kind !== 'identifier' || semicolon?.value !== ';') {
        failSource(
            source,
            tokens[closeBrace]?.offset ?? bufferToken?.offset ?? 0,
            'Storage buffer block requires one named, non-array instance'
        );
    }
    return {
        block: {
            stage,
            name: instanceName.value,
            blockName: blockName.value,
            signature: compactTokens(tokens.slice(bufferIndex + 1, closeBrace + 1)),
            layoutStart: tokens[declarationStart]?.offset ?? 0,
            layoutEnd: tokens[layoutClose]?.end ?? 0,
            offset: bufferToken?.offset ?? 0
        },
        nextIndex: closeBrace + 3
    };
}

function collectStorageBlocks(
    source: string,
    stage: GraphicsShaderStage
): readonly SourceStorageBlock[] {
    const tokens = tokenize(source);
    const blocks: SourceStorageBlock[] = [];
    let declarationStart = 0;
    let braceDepth = 0;
    let index = 0;
    while (index < tokens.length) {
        const token = tokens[index];
        if (token === undefined) break;
        if (braceDepth > 0) {
            if (token.value === '{') braceDepth++;
            if (token.value === '}') {
                braceDepth--;
                if (braceDepth === 0 && tokens[index + 1]?.value !== ';') {
                    declarationStart = index + 1;
                }
            }
            index++;
            continue;
        }
        if (token.value === 'buffer') {
            const parsed = parseStorageBlock(source, stage, tokens, declarationStart, index);
            blocks.push(parsed.block);
            declarationStart = parsed.nextIndex;
            index = parsed.nextIndex;
            continue;
        }
        if (token.value === '{') {
            braceDepth = 1;
        } else if (token.value === ';') {
            declarationStart = index + 1;
        }
        index++;
    }
    return Object.freeze(blocks);
}

function normalizeStorageGraphicsVersion(source: string, stage: GraphicsShaderStage): string {
    const directive = /^\s*#\s*version\s+([0-9]+)\s+([A-Za-z]+)\s*(?:\n|$)/u.exec(source);
    if (directive?.[1] !== '310' || directive[2] !== 'es') {
        throw new TypeError(`Storage graphics ${stage} source must begin with #version 310 es`);
    }
    const versionOffset = directive.index + directive[0].indexOf('310');
    return `${source.slice(0, versionOffset)}300${source.slice(versionOffset + 3)}`;
}

function bindingMap<T extends ShaderReadBinding>(
    bindings: readonly ShaderReadBinding[],
    predicate: (binding: ShaderReadBinding) => binding is T
): ReadonlyMap<string, T> {
    return new Map(bindings.filter(predicate).map(binding => [binding.name, binding]));
}

function isUniformBinding(binding: ShaderReadBinding): binding is BufferReadBinding & {
    readonly kind: 'uniform-buffer';
} {
    return binding.kind === 'uniform-buffer';
}

function isStorageBinding(binding: ShaderReadBinding): binding is BufferReadBinding & {
    readonly kind: 'read-only-storage-buffer';
} {
    return binding.kind === 'read-only-storage-buffer';
}

function isSampledTextureBinding(binding: ShaderReadBinding): binding is SampledTextureBinding {
    return binding.kind === 'sampled-texture';
}

function isSamplerBinding(binding: ShaderReadBinding): binding is SamplerBinding {
    return binding.kind === 'sampler' || binding.kind === 'comparison-sampler';
}

function createSamplerResolver(
    shader: StorageGraphicsShader
): (
    name: string,
    arrayIndex: number
) => { readonly group: number; readonly textureBinding: number; readonly samplerBinding: number } {
    const textures = bindingMap(shader.bindings, isSampledTextureBinding);
    const samplers = bindingMap(shader.bindings, isSamplerBinding);
    for (const [name, texture] of textures) {
        const sampler = samplers.get(name);
        if (sampler === undefined) {
            throw new TypeError(
                `StorageGraphicsShader sampled texture ${name} requires a same-name sampler binding`
            );
        }
        if (texture.group !== sampler.group) {
            throw new TypeError(
                `StorageGraphicsShader combined sampler ${name} must keep texture and sampler in one bind group`
            );
        }
    }
    for (const name of samplers.keys()) {
        if (!textures.has(name)) {
            throw new TypeError(
                `StorageGraphicsShader sampler ${name} requires a same-name sampled-texture binding`
            );
        }
    }
    return (name, arrayIndex) => {
        if (arrayIndex !== 0) {
            throw new TypeError(
                `StorageGraphicsShader sampler arrays are not representable by the scalar ShaderReadBinding ABI (${name}[${String(arrayIndex)}])`
            );
        }
        const texture = textures.get(name);
        const sampler = samplers.get(name);
        if (texture === undefined || sampler === undefined) {
            throw new TypeError(
                `GLSL sampler ${name} is absent from the StorageGraphicsShader binding ABI`
            );
        }
        return {
            group: texture.group,
            textureBinding: texture.binding,
            samplerBinding: sampler.binding
        };
    };
}

function injectStorageBindings(
    source: string,
    blocks: readonly SourceStorageBlock[],
    descriptors: ReadonlyMap<
        string,
        BufferReadBinding & { readonly kind: 'read-only-storage-buffer' }
    >
): string {
    const replacements = blocks.map(block => {
        const descriptor = descriptors.get(block.name);
        if (descriptor === undefined) {
            failSource(
                source,
                block.offset,
                `GLSL readonly storage block ${block.name} is absent from the StorageGraphicsShader binding ABI`
            );
        }
        return {
            start: block.layoutStart,
            end: block.layoutEnd,
            value: `layout(std430, set = ${String(descriptor.group)}, binding = ${String(descriptor.binding)})`
        };
    });
    let result = source;
    replacements.sort((left, right) => right.start - left.start);
    for (const replacement of replacements) {
        result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
    }
    return result;
}

function stageUses(stages: readonly GraphicsShaderStage[], stage: GraphicsShaderStage): boolean {
    return stages.includes(stage);
}

function samplerViewDimension(type: GlslSamplerType): ShaderTextureViewDimension {
    if (type.includes('2DArray')) return '2d-array';
    if (type.includes('Cube')) return 'cube';
    if (type.includes('3D')) return '3d';
    return '2d';
}

function samplerSampleType(type: GlslSamplerType): ShaderTextureSampleType {
    if (type.endsWith('Shadow')) return 'depth';
    if (type.startsWith('isampler')) return 'sint';
    if (type.startsWith('usampler')) return 'uint';
    return 'float';
}

function validatePreparedAbi(
    shader: StorageGraphicsShader,
    uniformBlocks: readonly WebGPUUniformBlock[],
    samplers: readonly WebGPUSamplerBinding[],
    storageBuffers: readonly StorageGraphicsBufferBinding[]
): void {
    const uniformDescriptors = bindingMap(shader.bindings, isUniformBinding);
    const storageDescriptors = bindingMap(shader.bindings, isStorageBinding);
    const textureDescriptors = bindingMap(shader.bindings, isSampledTextureBinding);
    const samplerDescriptors = bindingMap(shader.bindings, isSamplerBinding);

    const uniformNames = new Set(uniformBlocks.map(block => block.name));
    for (const name of uniformDescriptors.keys()) {
        if (!uniformNames.has(name)) {
            throw new TypeError(
                `StorageGraphicsShader uniform-buffer ABI binding ${name} is absent from GLSL source`
            );
        }
    }
    const storageNames = new Set(storageBuffers.map(buffer => buffer.name));
    for (const name of storageDescriptors.keys()) {
        if (!storageNames.has(name)) {
            throw new TypeError(
                `StorageGraphicsShader read-only-storage-buffer ABI binding ${name} is absent from GLSL source`
            );
        }
    }
    const samplerNames = new Set<string>();
    for (const sampler of samplers) {
        if (sampler.arrayIndex !== 0 || samplerNames.has(sampler.name)) {
            throw new TypeError(
                `StorageGraphicsShader GLSL sampler arrays are not supported by the scalar binding ABI (${sampler.name})`
            );
        }
        samplerNames.add(sampler.name);
        const texture = textureDescriptors.get(sampler.name);
        const samplerDescriptor = samplerDescriptors.get(sampler.name);
        if (texture === undefined || samplerDescriptor === undefined) {
            throw new TypeError(
                `StorageGraphicsShader GLSL sampler ${sampler.name} is absent from the binding ABI`
            );
        }
        const sourceSampleType = samplerSampleType(sampler.type);
        if (
            texture.sampleType !== sourceSampleType &&
            !(sourceSampleType === 'float' && texture.sampleType === 'unfilterable-float')
        ) {
            throw new TypeError(
                `StorageGraphicsShader sampled texture ${sampler.name} sampleType ${texture.sampleType} does not match GLSL ${sampler.type}`
            );
        }
        if ((texture.viewDimension ?? '2d') !== samplerViewDimension(sampler.type)) {
            throw new TypeError(
                `StorageGraphicsShader sampled texture ${sampler.name} viewDimension ${texture.viewDimension ?? '2d'} does not match GLSL ${sampler.type}`
            );
        }
        const expectedSamplerKind = sampler.type.endsWith('Shadow')
            ? 'comparison-sampler'
            : 'sampler';
        if (samplerDescriptor.kind !== expectedSamplerKind) {
            throw new TypeError(
                `StorageGraphicsShader sampler ${sampler.name} must use ${expectedSamplerKind} for GLSL ${sampler.type}`
            );
        }
    }
    for (const name of textureDescriptors.keys()) {
        if (!samplerNames.has(name)) {
            throw new TypeError(
                `StorageGraphicsShader sampled-texture ABI binding ${name} is absent from GLSL source`
            );
        }
    }
    for (const name of samplerDescriptors.keys()) {
        if (!samplerNames.has(name)) {
            throw new TypeError(
                `StorageGraphicsShader sampler ABI binding ${name} is absent from GLSL source`
            );
        }
    }
}

function mergeStorageBuffers(
    shader: StorageGraphicsShader,
    vertexBlocks: readonly SourceStorageBlock[],
    fragmentBlocks: readonly SourceStorageBlock[]
): readonly StorageGraphicsBufferBinding[] {
    const descriptors = bindingMap(shader.bindings, isStorageBinding);
    const sourceByName = new Map<string, SourceStorageBlock>();
    const stagesByName = new Map<string, Set<GraphicsShaderStage>>();
    for (const block of [...vertexBlocks, ...fragmentBlocks]) {
        const previous = sourceByName.get(block.name);
        if (previous?.stage === block.stage) {
            throw new TypeError(
                `Storage graphics ${block.stage} source declares storage instance ${block.name} more than once`
            );
        }
        if (previous !== undefined && previous.signature !== block.signature) {
            throw new TypeError(
                `Storage graphics block ${block.name} has incompatible vertex and fragment layouts`
            );
        }
        sourceByName.set(block.name, previous ?? block);
        const stages = stagesByName.get(block.name) ?? new Set<GraphicsShaderStage>();
        stages.add(block.stage);
        stagesByName.set(block.name, stages);
    }
    const result: StorageGraphicsBufferBinding[] = [];
    for (const [name, block] of sourceByName) {
        const descriptor = descriptors.get(name);
        if (descriptor === undefined) continue;
        result.push(
            Object.freeze({
                name,
                blockName: block.blockName,
                group: descriptor.group,
                binding: descriptor.binding,
                stages: Object.freeze([...(stagesByName.get(name) ?? [])])
            })
        );
    }
    result.sort((left, right) => left.group - right.group || left.binding - right.binding);
    return Object.freeze(result);
}

function reflectionBinding(binding: ShaderReadBinding): Readonly<RHIShaderBindingReflection> {
    const base = {
        name: binding.name,
        group: binding.group,
        binding: binding.binding,
        kind: binding.kind
    } as const;
    switch (binding.kind) {
        case 'uniform-buffer':
        case 'read-only-storage-buffer':
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
        case 'comparison-sampler':
            return Object.freeze(base);
    }
}

function bindingStages(
    binding: ShaderReadBinding,
    metadata: CompiledStorageGraphicsShaderMetadata
): readonly GraphicsShaderStage[] {
    switch (binding.kind) {
        case 'uniform-buffer':
            return metadata.uniformBlocks.find(block => block.name === binding.name)?.stages ?? [];
        case 'read-only-storage-buffer':
            return (
                metadata.storageBuffers.find(buffer => buffer.name === binding.name)?.stages ?? []
            );
        case 'sampled-texture':
        case 'sampler':
        case 'comparison-sampler':
            return metadata.samplers.find(sampler => sampler.name === binding.name)?.stages ?? [];
    }
}

function createReflection(
    stage: GraphicsShaderStage,
    shader: StorageGraphicsShader,
    metadata: CompiledStorageGraphicsShaderMetadata
): Readonly<RHIShaderReflection> {
    return Object.freeze({
        bindings: Object.freeze(
            shader.bindings
                .filter(binding => stageUses(bindingStages(binding, metadata), stage))
                .map(reflectionBinding)
        ),
        ...(stage === 'vertex'
            ? {
                  vertexInputs: Object.freeze(
                      metadata.vertexInputs.flatMap(input =>
                          Array.from({ length: input.locationCount }, (_unused, column) =>
                              Object.freeze({
                                  location: input.location + column,
                                  ...(column === 0 ? { name: input.name } : {})
                              })
                          )
                      )
                  )
              }
            : {
                  fragmentOutputs: Object.freeze(
                      metadata.fragmentOutputs.map(output =>
                          Object.freeze({ location: output.location, name: output.name })
                      )
                  )
              })
    });
}

function snapshotMetadata(
    prepared: PreparedShaderPair,
    storageBuffers: readonly StorageGraphicsBufferBinding[]
): Readonly<CompiledStorageGraphicsShaderMetadata> {
    return Object.freeze({
        vertexInputs: Object.freeze(
            prepared.vertexInputs.map(input => Object.freeze({ ...input }))
        ),
        fragmentOutputs: Object.freeze(
            prepared.fragmentOutputs.map(output => Object.freeze({ ...output }))
        ),
        uniformBlocks: Object.freeze(
            prepared.uniformBlocks.map(block =>
                Object.freeze({ ...block, stages: Object.freeze([...block.stages]) })
            )
        ),
        samplers: Object.freeze(
            prepared.samplers.map(sampler =>
                Object.freeze({ ...sampler, stages: Object.freeze([...sampler.stages]) })
            )
        ),
        storageBuffers
    });
}

function translateStage(compiler: typeof Naga, stage: GraphicsShaderStage, source: string): string {
    try {
        return useNagaResource(compiler.GlslFrontend.new(), frontend => {
            const nagaStage =
                stage === 'vertex' ? compiler.ShaderStage.Vertex : compiler.ShaderStage.Fragment;
            const module = frontend.parse(source, nagaStage);
            return useNagaShaderModule(module, activeModule =>
                makeWgslUniformLayoutsPortable(activeModule.to_wgsl())
            );
        });
    } catch (error: unknown) {
        throw new StorageGraphicsCompilationError(stage, source, error);
    }
}

/** Compiles the constrained GLSL ES 3.10 readonly-storage graphics contract for WebGPU. */
export class StorageGraphicsShaderCompiler {
    #initialized = false;
    #records = new WeakMap<StorageGraphicsShader, CompiledStorageGraphicsShader>();
    #nextToken = 1;
    #cacheGeneration = 0;

    get initialized(): boolean {
        return this.#initialized;
    }

    /** @internal Monotonic identity for compiled records retained by this compiler. */
    get cacheGeneration(): number {
        return this.#cacheGeneration;
    }

    async initialize(): Promise<void> {
        if (this.#initialized) return;
        await initializeNagaModule();
        this.#initialized = true;
    }

    compile(shader: StorageGraphicsShader, backend: RHIBackend): CompiledStorageGraphicsShader {
        if (backend !== 'webgpu') {
            throw new TypeError(
                'StorageGraphicsShader is WebGPU-only; WebGL2 has no storage buffers'
            );
        }
        if (!this.#initialized) {
            throw new Error('StorageGraphicsShaderCompiler.initialize() is required for WebGPU');
        }
        const cached = this.#records.get(shader);
        if (cached !== undefined) return cached;

        const uniformDescriptors = bindingMap(shader.bindings, isUniformBinding);
        const resolveSamplerBinding = createSamplerResolver(shader);
        const prepared = prepareGLSLForNaga(
            normalizeStorageGraphicsVersion(shader.vertexSource, 'vertex'),
            normalizeStorageGraphicsVersion(shader.fragmentSource, 'fragment'),
            name => {
                const descriptor = uniformDescriptors.get(name);
                if (descriptor === undefined) {
                    throw new TypeError(
                        `GLSL uniform block ${name} is absent from the StorageGraphicsShader binding ABI`
                    );
                }
                return { group: descriptor.group, binding: descriptor.binding };
            },
            { resolveSamplerBinding }
        );
        const vertexBlocks = collectStorageBlocks(prepared.vertex.glsl, 'vertex');
        const fragmentBlocks = collectStorageBlocks(prepared.fragment.glsl, 'fragment');
        const storageDescriptors = bindingMap(shader.bindings, isStorageBinding);
        const storageBuffers = mergeStorageBuffers(shader, vertexBlocks, fragmentBlocks);
        validatePreparedAbi(shader, prepared.uniformBlocks, prepared.samplers, storageBuffers);

        const vertexGlsl = injectStorageBindings(
            prepared.vertex.glsl,
            vertexBlocks,
            storageDescriptors
        );
        const fragmentGlsl = injectStorageBindings(
            prepared.fragment.glsl,
            fragmentBlocks,
            storageDescriptors
        );
        const compiler = getInitializedNagaModule();
        if (compiler === null) throw new Error('Naga module is unavailable after initialization');
        const vertexWgsl = translateStage(compiler, 'vertex', vertexGlsl);
        const fragmentWgsl = translateStage(compiler, 'fragment', fragmentGlsl);
        const metadata = snapshotMetadata(prepared, storageBuffers);
        const token = this.allocateToken();
        const compiled: CompiledStorageGraphicsShader = Object.freeze({
            backend: 'webgpu',
            token,
            bindings: shader.bindings,
            metadata,
            vertex: Object.freeze({
                backend: 'webgpu',
                stage: 'vertex',
                code: vertexWgsl,
                entryPoint: 'main',
                reflection: createReflection('vertex', shader, metadata),
                cacheKey: token * 2
            }),
            fragment: Object.freeze({
                backend: 'webgpu',
                stage: 'fragment',
                code: fragmentWgsl,
                entryPoint: 'main',
                reflection: createReflection('fragment', shader, metadata),
                cacheKey: token * 2 + 1
            })
        });
        this.#records.set(shader, compiled);
        return compiled;
    }

    clear(): void {
        this.#records = new WeakMap();
        this.#cacheGeneration++;
        if (!Number.isSafeInteger(this.#cacheGeneration)) {
            throw new RangeError('Storage graphics compiler cache generation is exhausted');
        }
    }

    private allocateToken(): number {
        const token = this.#nextToken++;
        if (!Number.isSafeInteger(token) || !Number.isSafeInteger(token * 2 + 1)) {
            throw new RangeError('Storage graphics shader cache-key space is exhausted');
        }
        return token;
    }
}
