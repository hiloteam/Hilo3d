import type Shader from '../../shader/Shader';
import {
    NagaShaderTranslator,
    prepareGLSLDepthOnlyFragment,
    prepareGLSLForNaga,
    specializeWebGPUDepthSamplers,
    type GraphicsShaderStage,
    type GlslSamplerType,
    type PrepareGLSLForNagaOptions,
    type PreparedShaderPair,
    type TranslatedShaderPair,
    type WebGPUSamplerBinding,
    type WebGPUUniformBlock
} from '../shader/GlslToWgsl';
import type {
    RHIBackend,
    RHIShaderArtifactInput,
    RHIShaderBindingReflection,
    RHIShaderReflection
} from '../rhi/core';

interface CachedShaderArtifactPair {
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly compiled: CompiledShaderArtifactPair;
}

interface ShaderArtifactRecordSet {
    readonly webgl2: ShaderArtifactModeRecords;
    readonly webgpu: ShaderArtifactModeRecords;
}

interface ShaderArtifactModeRecords {
    readonly color: Map<number, CachedShaderArtifactPair>;
    readonly 'depth-only': Map<number, CachedShaderArtifactPair>;
}

interface SharedShaderMetadata {
    readonly vertexInputs: PreparedShaderPair['vertexInputs'];
    readonly fragmentOutputs: PreparedShaderPair['fragmentOutputs'];
    readonly uniformBlocks: PreparedShaderPair['uniformBlocks'];
    readonly samplers: PreparedShaderPair['samplers'];
}

export interface CompiledShaderArtifactPair {
    readonly backend: RHIBackend;
    readonly fragmentOutputMode: ShaderFragmentOutputMode;
    readonly numericDepthSamplerMask: number;
    readonly token: number;
    readonly vertex: Readonly<RHIShaderArtifactInput>;
    readonly fragment: Readonly<RHIShaderArtifactInput>;
    readonly metadata: SharedShaderMetadata;
}

export type ShaderFragmentOutputMode = NonNullable<PrepareGLSLForNagaOptions['fragmentOutputs']>;

export interface ShaderArtifactCompileOptions {
    readonly fragmentOutputs?: ShaderFragmentOutputMode;
    /** Bit `n` specializes metadata sampler `n` for ordinary numeric depth reads. */
    readonly numericDepthSamplerMask?: number;
}

function createRecordSet(): ShaderArtifactRecordSet {
    return {
        webgl2: { color: new Map(), 'depth-only': new Map() },
        webgpu: { color: new Map(), 'depth-only': new Map() }
    };
}

function requireNumericDepthSamplerMask(mask: number): void {
    if (!Number.isSafeInteger(mask) || mask < 0) {
        throw new RangeError('Numeric depth sampler mask must be a non-negative safe integer');
    }
}

function samplerMaskIncludes(mask: number, index: number): boolean {
    return Math.floor(mask / 2 ** index) % 2 === 1;
}

function validateNumericDepthSamplerMask(
    mask: number,
    samplers: readonly WebGPUSamplerBinding[]
): void {
    requireNumericDepthSamplerMask(mask);
    if (mask === 0) return;
    if (samplers.length > 52) {
        throw new RangeError('Numeric depth sampler masks support at most 52 scalar samplers');
    }
    if (mask >= 2 ** samplers.length) {
        throw new RangeError('Numeric depth sampler mask references a missing shader sampler');
    }
    for (let index = 0; index < samplers.length; index += 1) {
        if (!samplerMaskIncludes(mask, index)) continue;
        const sampler = samplers[index];
        if (sampler === undefined || sampler.type.endsWith('Shadow')) {
            throw new TypeError(
                'Numeric depth specialization requires an ordinary floating-point sampler'
            );
        }
        if (samplerSampleType(sampler.type) !== 'float') {
            throw new TypeError(`Numeric depth specialization does not support ${sampler.type}`);
        }
    }
}

function stageUses(stages: readonly GraphicsShaderStage[], stage: GraphicsShaderStage): boolean {
    return stages.includes(stage);
}

function samplerViewDimension(type: GlslSamplerType): '2d' | '2d-array' | '3d' | 'cube' {
    if (type.includes('2DArray')) return '2d-array';
    if (type.includes('Cube')) return 'cube';
    if (type.includes('3D')) return '3d';
    return '2d';
}

function samplerSampleType(type: GlslSamplerType): 'float' | 'depth' | 'sint' | 'uint' {
    if (type.endsWith('Shadow')) return 'depth';
    if (type.startsWith('isampler')) return 'sint';
    if (type.startsWith('usampler')) return 'uint';
    return 'float';
}

function bindingReflection(
    stage: GraphicsShaderStage,
    uniformBlocks: readonly WebGPUUniformBlock[],
    samplers: readonly WebGPUSamplerBinding[],
    numericDepthSamplerMask: number
): readonly RHIShaderBindingReflection[] {
    const bindings: RHIShaderBindingReflection[] = [];
    for (const block of uniformBlocks) {
        if (!stageUses(block.stages, stage)) continue;
        bindings.push({
            group: block.group,
            binding: block.binding,
            kind: 'uniform-buffer',
            name: block.name
        });
    }
    for (let samplerIndex = 0; samplerIndex < samplers.length; samplerIndex += 1) {
        const sampler = samplers[samplerIndex];
        if (sampler === undefined) continue;
        if (!stageUses(sampler.stages, stage)) continue;
        const numericDepth = samplerMaskIncludes(numericDepthSamplerMask, samplerIndex);
        bindings.push(
            {
                group: sampler.group,
                binding: sampler.textureBinding,
                kind: 'sampled-texture',
                name: sampler.name,
                arrayIndex: sampler.arrayIndex,
                sampleType: numericDepth ? 'depth' : samplerSampleType(sampler.type),
                viewDimension: samplerViewDimension(sampler.type),
                multisampled: false
            },
            {
                group: sampler.group,
                binding: sampler.samplerBinding,
                kind: sampler.type.endsWith('Shadow') ? 'comparison-sampler' : 'sampler',
                name: sampler.name,
                arrayIndex: sampler.arrayIndex
            }
        );
    }
    bindings.sort((left, right) => left.group - right.group || left.binding - right.binding);
    return Object.freeze(bindings.map(binding => Object.freeze(binding)));
}

function reflection(
    stage: GraphicsShaderStage,
    metadata: SharedShaderMetadata,
    numericDepthSamplerMask: number
): Readonly<RHIShaderReflection> {
    return Object.freeze({
        bindings: bindingReflection(
            stage,
            metadata.uniformBlocks,
            metadata.samplers,
            numericDepthSamplerMask
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

function preparedBindings(stage: GraphicsShaderStage, metadata: SharedShaderMetadata) {
    return Object.freeze({
        uniformBlocks: Object.freeze(
            metadata.uniformBlocks
                .filter(block => stageUses(block.stages, stage))
                .map(block =>
                    Object.freeze({
                        name: block.name,
                        group: block.group,
                        binding: block.binding
                    })
                )
        ),
        combinedSamplers: Object.freeze(
            metadata.samplers
                .filter(sampler => stageUses(sampler.stages, stage))
                .map(sampler =>
                    Object.freeze({
                        name: sampler.name,
                        group: sampler.group,
                        textureBinding: sampler.textureBinding,
                        samplerBinding: sampler.samplerBinding,
                        arrayIndex: sampler.arrayIndex
                    })
                )
        )
    });
}

function metadataFromPrepared(prepared: PreparedShaderPair): SharedShaderMetadata {
    return Object.freeze({
        vertexInputs: prepared.vertexInputs,
        fragmentOutputs: prepared.fragmentOutputs,
        uniformBlocks: prepared.uniformBlocks,
        samplers: prepared.samplers
    });
}

function metadataFromTranslated(translated: TranslatedShaderPair): SharedShaderMetadata {
    return Object.freeze({
        vertexInputs: translated.vertexInputs,
        fragmentOutputs: translated.fragmentOutputs,
        uniformBlocks: translated.uniformBlocks,
        samplers: translated.samplers
    });
}

/**
 * Compiles one final engine Shader into backend-specific RHI artifacts above the hardware layer.
 * Records are invalidated by exact source identity, while monotonic tokens drive PreparedDraw.
 */
export class ShaderArtifactCompiler {
    readonly #translator = new NagaShaderTranslator();
    #records = new WeakMap<Shader, ShaderArtifactRecordSet>();
    #nextToken = 1;
    #initialized = false;

    get initialized(): boolean {
        return this.#initialized;
    }

    async initialize(): Promise<void> {
        if (this.#initialized) return;
        await this.#translator.initialize();
        this.#initialized = true;
    }

    compile(
        shader: Shader,
        backend: RHIBackend,
        options: Readonly<ShaderArtifactCompileOptions> = {}
    ): CompiledShaderArtifactPair {
        const fragmentOutputMode = options.fragmentOutputs ?? 'color';
        const numericDepthSamplerMask = options.numericDepthSamplerMask ?? 0;
        requireNumericDepthSamplerMask(numericDepthSamplerMask);
        let records = this.#records.get(shader);
        if (!records) {
            records = createRecordSet();
            this.#records.set(shader, records);
        }
        const modeRecords = records[backend];
        const recordsByDepthMask = modeRecords[fragmentOutputMode];
        const cached = recordsByDepthMask.get(numericDepthSamplerMask);
        if (cached?.vertexSource === shader.vs && cached.fragmentSource === shader.fs) {
            return cached.compiled;
        }
        const compiled =
            backend === 'webgl2'
                ? this.compileWebGL2(shader, fragmentOutputMode, numericDepthSamplerMask)
                : this.compileWebGPU(shader, fragmentOutputMode, numericDepthSamplerMask);
        recordsByDepthMask.set(numericDepthSamplerMask, {
            vertexSource: shader.vs,
            fragmentSource: shader.fs,
            compiled
        });
        return compiled;
    }

    clear(): void {
        this.#records = new WeakMap();
    }

    private compileWebGL2(
        shader: Shader,
        fragmentOutputMode: ShaderFragmentOutputMode,
        numericDepthSamplerMask: number
    ): CompiledShaderArtifactPair {
        const metadata = metadataFromPrepared(
            prepareGLSLForNaga(shader.vs, shader.fs, undefined, {
                fragmentOutputs: fragmentOutputMode,
                defineWebGPU: false
            })
        );
        validateNumericDepthSamplerMask(numericDepthSamplerMask, metadata.samplers);
        const token = this.allocateToken();
        return Object.freeze({
            backend: 'webgl2',
            fragmentOutputMode,
            numericDepthSamplerMask,
            token,
            metadata,
            vertex: this.artifact(
                'webgl2',
                'vertex',
                shader.vs,
                token * 2,
                metadata,
                preparedBindings('vertex', metadata),
                numericDepthSamplerMask
            ),
            fragment: this.artifact(
                'webgl2',
                'fragment',
                fragmentOutputMode === 'depth-only'
                    ? prepareGLSLDepthOnlyFragment(shader.fs)
                    : shader.fs,
                token * 2 + 1,
                metadata,
                preparedBindings('fragment', metadata),
                numericDepthSamplerMask
            )
        });
    }

    private compileWebGPU(
        shader: Shader,
        fragmentOutputMode: ShaderFragmentOutputMode,
        numericDepthSamplerMask: number
    ): CompiledShaderArtifactPair {
        if (!this.#initialized) {
            throw new Error('ShaderArtifactCompiler.initialize() is required for WebGPU');
        }
        const base = this.#translator.translate(shader.vs, shader.fs, undefined, {
            fragmentOutputs: fragmentOutputMode
        });
        validateNumericDepthSamplerMask(numericDepthSamplerMask, base.samplers);
        const depthSamplers = base.samplers.filter((_sampler, index) =>
            samplerMaskIncludes(numericDepthSamplerMask, index)
        );
        const translated = specializeWebGPUDepthSamplers(base, depthSamplers);
        const metadata = metadataFromTranslated(translated);
        const token = this.allocateToken();
        return Object.freeze({
            backend: 'webgpu',
            fragmentOutputMode,
            numericDepthSamplerMask,
            token,
            metadata,
            vertex: this.artifact(
                'webgpu',
                'vertex',
                translated.vertex.wgsl,
                token * 2,
                metadata,
                undefined,
                numericDepthSamplerMask
            ),
            fragment: this.artifact(
                'webgpu',
                'fragment',
                translated.fragment.wgsl,
                token * 2 + 1,
                metadata,
                undefined,
                numericDepthSamplerMask
            )
        });
    }

    private artifact(
        backend: RHIBackend,
        stage: GraphicsShaderStage,
        code: string,
        cacheKey: number,
        metadata: SharedShaderMetadata,
        bindings: ReturnType<typeof preparedBindings> | undefined,
        numericDepthSamplerMask: number
    ): Readonly<RHIShaderArtifactInput> {
        return Object.freeze({
            backend,
            stage,
            code,
            entryPoint: 'main',
            reflection: reflection(stage, metadata, numericDepthSamplerMask),
            cacheKey,
            ...(bindings === undefined ? {} : { preparedBindings: bindings })
        });
    }

    private allocateToken(): number {
        const token = this.#nextToken;
        if (!Number.isSafeInteger(token)) {
            throw new RangeError('Shader artifact token space is exhausted');
        }
        this.#nextToken++;
        if (!Number.isSafeInteger(token * 2 + 1)) {
            throw new RangeError('Shader artifact cache-key space is exhausted');
        }
        return token;
    }
}
