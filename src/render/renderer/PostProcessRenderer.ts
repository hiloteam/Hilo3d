import Material from '../../material/Material';
import ShaderClass from '../../shader/Shader';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RenderGraphBuilder } from '../graph/RenderGraphBuilder';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import {
    RHITextureUsage,
    type RHIBuffer,
    type RHIColor,
    type RHISurface,
    type RHITextureView
} from '../rhi/core';
import { assertRHIObjectOwnedBy } from '../rhi/core/RHIValidation';
import { FullscreenDrawProcessor } from './FullscreenDrawProcessor';
import type { ResourceRegistryHandle } from './ResourceRegistry';
import { RenderTargetGraphBridge, type RenderTargetGraphImport } from './RenderTargetGraphBridge';
import type {
    RenderTargetResourceCache,
    RenderTargetResourceDescriptor,
    RenderTargetResourceRecord
} from './RenderTargetResourceCache';
import type { ShaderSampledBindingResources } from './ShaderBindGroupResourceCache';
import { ShaderArtifactCompiler } from './ShaderArtifactCompiler';
import { importSurfaceColor } from './SurfaceGraphBridge';
import { PostProcessPassTemplate, PresentPassTemplate, SharedDrawPassParameters } from './passes';

const DEFAULT_CLEAR_COLOR: Readonly<RHIColor> = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const EMPTY_UNIFORM_BUFFERS: readonly ResourceRegistryHandle<RHIBuffer>[] = Object.freeze([]);

const FULLSCREEN_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const PRESENT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_source, v_uv);
}`;

export interface PostProcessOutputTarget {
    readonly owner: object;
    readonly descriptor: Readonly<RenderTargetResourceDescriptor>;
}

export interface PostProcessStep {
    /** Stable identity for reflected bind groups and PreparedDraw reuse. */
    readonly owner: object;
    readonly shader: ShaderClass;
    readonly material: Material;
    readonly output: Readonly<PostProcessOutputTarget>;
    readonly uniformBuffers?: readonly ResourceRegistryHandle<RHIBuffer>[];
}

export interface PostProcessFrameOptions {
    readonly steps?: readonly Readonly<PostProcessStep>[];
    readonly label?: string;
    readonly clearColor?: RHIColor;
}

export interface PostProcessFrameResult {
    readonly execution: RGExecutionResult;
    readonly tracking: Promise<void>;
    readonly finalSource: Readonly<RenderTargetResourceRecord>;
}

interface SampledScratch {
    readonly resource: {
        textureView: ResourceRegistryHandle<RHITextureView>;
        sampler: FullscreenDrawProcessor['defaultSampler'];
    };
    readonly resources: readonly ShaderSampledBindingResources[];
}

function requireObjectIdentity(value: unknown, label: string): asserts value is object {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
        throw new TypeError(`${label} must be a non-null object`);
    }
}

function surfaceHasAcquiredTexture(surface: RHISurface): boolean {
    return surface.state === 'acquired';
}

/** Shared post-process chain followed by an explicit fullscreen present pass. */
export class PostProcessRenderer {
    readonly frame: RenderGraphFrame;
    readonly bridge: RenderTargetGraphBridge;
    readonly fullscreen: FullscreenDrawProcessor;
    readonly #passes: SharedDrawPassParameters[] = [];
    readonly #presentPass = new SharedDrawPassParameters({
        colorAttachments: 1,
        draws: 1,
        readTextures: 1
    });
    readonly #presentOwner = {};
    readonly #presentShader = new ShaderClass({
        vs: FULLSCREEN_VERTEX_SOURCE,
        fs: PRESENT_FRAGMENT_SOURCE
    });
    readonly #presentMaterial = new Material({
        depthTest: false,
        depthMask: false,
        cullFace: false
    });
    #sampledScratch = new WeakMap<object, SampledScratch>();
    readonly #targetScratch: RenderTargetResourceRecord[] = [];
    readonly #compositionPresentSlots: {
        readonly owner: object;
        readonly pass: SharedDrawPassParameters;
    }[] = [];
    #compositionPresentCursor = 0;
    #active = false;
    #destroyed = false;

    constructor(
        readonly resources: RenderTargetResourceCache,
        initialStepCapacity = 0,
        compiler = new ShaderArtifactCompiler()
    ) {
        if (!Number.isSafeInteger(initialStepCapacity) || initialStepCapacity < 0) {
            throw new RangeError('Post-process step capacity must be a non-negative integer');
        }
        this.frame = new RenderGraphFrame();
        this.bridge = new RenderTargetGraphBridge(resources);
        this.fullscreen = new FullscreenDrawProcessor(resources.registry, compiler);
        for (let index = 0; index < initialStepCapacity; index += 1) {
            this.#passes.push(
                new SharedDrawPassParameters({
                    colorAttachments: 1,
                    draws: 1,
                    readTextures: 1
                })
            );
        }
    }

    get active(): boolean {
        return this.#active;
    }

    async initialize(): Promise<void> {
        this.assertAlive();
        await this.fullscreen.initialize();
    }

    beginComposition(): void {
        this.assertAlive();
        if (this.#active) throw new Error('Nested PostProcessRenderer execution is not allowed');
        this.#compositionPresentCursor = 0;
        this.#active = true;
    }

    endComposition(): void {
        this.#active = false;
    }

    /** Add a target-to-surface present pass to a caller-owned application graph. */
    buildPresent(
        scope: RenderGraphFrameBuildScope,
        context: RenderGraphFrameContext,
        surface: RHISurface,
        input: Readonly<RenderTargetResourceRecord>,
        options: Readonly<PostProcessFrameOptions> = {},
        fullscreenFrameStarted = false
    ): Readonly<RenderTargetResourceRecord> {
        if (!this.#active) {
            throw new Error('Post-process build requires an active composition');
        }
        const steps = options.steps ?? [];
        if (steps.length !== 0) {
            throw new TypeError('Composed post-process effects require explicit output scheduling');
        }
        const configuration = this.validateInputs(context, surface, input, options);
        if (!fullscreenFrameStarted) this.fullscreen.beginFrame(context, scope.uploads);
        const currentImport = this.bridge.import(scope.graph, input);
        const surfaceTexture = importSurfaceColor(scope.graph, surface, 'post-process surface');
        const sourceColor = this.requireColor0(input, currentImport);
        const slot = this.acquireCompositionPresentSlot();
        const present = slot.pass;
        present.reset();
        present.label = `${options.label ?? 'Post-process'} present`;
        present.addReadTexture(sourceColor.graph.readableTexture);
        present.addColorAttachment({
            texture: surfaceTexture,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: options.clearColor ?? DEFAULT_CLEAR_COLOR
        });
        present.setViewport({
            x: 0,
            y: 0,
            width: configuration.width,
            height: configuration.height,
            minDepth: 0,
            maxDepth: 1
        });
        present.setScissor({
            x: 0,
            y: 0,
            width: configuration.width,
            height: configuration.height
        });
        present.addDraw(
            this.fullscreen.prepare({
                owner: slot.owner,
                shader: this.#presentShader,
                material: this.#presentMaterial,
                target: { colorFormats: [configuration.format], sampleCount: 1 },
                sampledResources: this.sampledResources(slot.owner, sourceColor.record.readableView)
            })
        );
        scope.graph.addPass(PresentPassTemplate, present);
        scope.graph.markOutput(surfaceTexture);
        return input;
    }

    render(
        context: RenderGraphFrameContext,
        surface: RHISurface,
        input: Readonly<RenderTargetResourceRecord>,
        options: Readonly<PostProcessFrameOptions> = {}
    ): Readonly<PostProcessFrameResult> {
        this.assertAlive();
        if (this.#active) throw new Error('Nested PostProcessRenderer execution is not allowed');
        const configuration = this.validateInputs(context, surface, input, options);
        const steps = options.steps ?? [];
        this.prepareOutputTargets(input, steps);
        this.#active = true;
        try {
            const execution = this.frame.execute(context, scope => {
                this.fullscreen.beginFrame(scope.context, scope.uploads);
                let currentRecord = input;
                let currentImport = this.bridge.import(scope.graph, currentRecord);
                for (let index = 0; index < steps.length; index += 1) {
                    const step = steps[index];
                    const outputRecord = this.#targetScratch[index];
                    if (step === undefined || outputRecord === undefined) {
                        throw new Error('Post-process step storage is incomplete');
                    }
                    const outputImport = this.bridge.import(scope.graph, outputRecord);
                    this.addEffectPass(
                        index,
                        scope.graph,
                        step,
                        currentRecord,
                        currentImport,
                        outputRecord,
                        outputImport
                    );
                    currentRecord = outputRecord;
                    currentImport = outputImport;
                }

                const surfaceTexture = importSurfaceColor(
                    scope.graph,
                    surface,
                    'post-process surface'
                );
                const sourceColor = this.requireColor0(currentRecord, currentImport);
                const present = this.#presentPass;
                present.reset();
                present.label = `${options.label ?? 'Post-process'} present`;
                present.addReadTexture(sourceColor.graph.readableTexture);
                present.addColorAttachment({
                    texture: surfaceTexture,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: options.clearColor ?? DEFAULT_CLEAR_COLOR
                });
                present.setViewport({
                    x: 0,
                    y: 0,
                    width: configuration.width,
                    height: configuration.height,
                    minDepth: 0,
                    maxDepth: 1
                });
                present.setScissor({
                    x: 0,
                    y: 0,
                    width: configuration.width,
                    height: configuration.height
                });
                present.addDraw(
                    this.fullscreen.prepare({
                        owner: this.#presentOwner,
                        shader: this.#presentShader,
                        material: this.#presentMaterial,
                        target: { colorFormats: [configuration.format], sampleCount: 1 },
                        sampledResources: this.sampledResources(
                            this.#presentOwner,
                            sourceColor.record.readableView
                        )
                    })
                );
                scope.graph.addPass(PresentPassTemplate, present);
                scope.graph.markOutput(surfaceTexture);
            });
            this.resources.markUsed(input, context.frameIndex);
            for (let index = 0; index < steps.length; index += 1) {
                const record = this.#targetScratch[index];
                if (record !== undefined) this.resources.markUsed(record, context.frameIndex);
            }
            const tracking = this.fullscreen.trackSubmission(
                context.frameIndex,
                execution.submission
            );
            surface.present();
            return Object.freeze({
                execution,
                tracking,
                finalSource: this.#targetScratch[steps.length - 1] ?? input
            });
        } catch (error) {
            if (surfaceHasAcquiredTexture(surface)) {
                try {
                    surface.present();
                } catch {
                    // Preserve the original graph/preparation error.
                }
            }
            throw error;
        } finally {
            this.#active = false;
        }
    }

    detach(owner: object): boolean {
        this.assertIdle();
        this.#sampledScratch.delete(owner);
        return this.fullscreen.detach(owner);
    }

    reset(): void {
        this.assertIdle();
        for (const pass of this.#passes) pass.reset();
        this.#presentPass.reset();
        for (const slot of this.#compositionPresentSlots) slot.pass.reset();
        this.#targetScratch.length = 0;
        this.#sampledScratch = new WeakMap();
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.assertIdle();
        if (this.fullscreen.submissions.pendingSubmissionCount !== 0) {
            throw new Error(
                'Cannot destroy post-process resources while submissions are in flight'
            );
        }
        this.reset();
        this.fullscreen.destroy();
        this.frame.destroy();
        this.#passes.length = 0;
        this.#compositionPresentSlots.length = 0;
        this.#destroyed = true;
    }

    private addEffectPass(
        index: number,
        graph: RenderGraphBuilder,
        step: Readonly<PostProcessStep>,
        inputRecord: Readonly<RenderTargetResourceRecord>,
        inputImport: Readonly<RenderTargetGraphImport>,
        outputRecord: Readonly<RenderTargetResourceRecord>,
        outputImport: Readonly<RenderTargetGraphImport>
    ): void {
        const source = this.requireColor0(inputRecord, inputImport);
        const destination = this.requireColor0(outputRecord, outputImport);
        const pass = this.passAt(index);
        pass.reset();
        pass.label = `Post-process ${String(index)}`;
        pass.addReadTexture(source.graph.readableTexture);
        pass.addColorAttachment({
            texture: destination.graph.texture,
            ...(destination.graph.resolveTarget === null
                ? {}
                : { resolveTarget: destination.graph.resolveTarget }),
            loadOp: 'clear',
            storeOp: destination.graph.resolveTarget === null ? 'store' : 'discard',
            clearValue: DEFAULT_CLEAR_COLOR
        });
        pass.setViewport({
            x: 0,
            y: 0,
            width: outputRecord.width,
            height: outputRecord.height,
            minDepth: 0,
            maxDepth: 1
        });
        pass.setScissor({ x: 0, y: 0, width: outputRecord.width, height: outputRecord.height });
        pass.addDraw(
            this.fullscreen.prepare({
                owner: step.owner,
                shader: step.shader,
                material: step.material,
                target: {
                    colorFormats: [destination.record.format],
                    sampleCount: outputRecord.sampleCount
                },
                uniformBuffers: step.uniformBuffers ?? EMPTY_UNIFORM_BUFFERS,
                sampledResources: this.sampledResources(step.owner, source.record.readableView)
            })
        );
        graph.addPass(PostProcessPassTemplate, pass);
    }

    private sampledResources(
        owner: object,
        textureView: ResourceRegistryHandle<RHITextureView>
    ): readonly ShaderSampledBindingResources[] {
        let scratch = this.#sampledScratch.get(owner);
        if (scratch === undefined) {
            const resource = { textureView, sampler: this.fullscreen.defaultSampler };
            scratch = { resource, resources: Object.freeze([resource]) };
            this.#sampledScratch.set(owner, scratch);
        } else {
            scratch.resource.textureView = textureView;
        }
        return scratch.resources;
    }

    private acquireCompositionPresentSlot(): {
        readonly owner: object;
        readonly pass: SharedDrawPassParameters;
    } {
        let slot = this.#compositionPresentSlots[this.#compositionPresentCursor++];
        if (slot === undefined) {
            slot = {
                owner: {},
                pass: new SharedDrawPassParameters({
                    colorAttachments: 1,
                    draws: 1,
                    readTextures: 1
                })
            };
            this.#compositionPresentSlots.push(slot);
        }
        return slot;
    }

    private requireColor0(
        record: Readonly<RenderTargetResourceRecord>,
        imported: Readonly<RenderTargetGraphImport>
    ) {
        const recordColor = record.colorAttachments[0];
        const graphColor = imported.colorAttachments[0];
        if (recordColor === undefined || graphColor === undefined) {
            throw new Error('Post-process source requires color attachment zero');
        }
        return { record: recordColor, graph: graphColor };
    }

    private passAt(index: number): SharedDrawPassParameters {
        let pass = this.#passes[index];
        if (pass === undefined) {
            pass = new SharedDrawPassParameters({
                colorAttachments: 1,
                draws: 1,
                readTextures: 1
            });
            this.#passes[index] = pass;
        }
        return pass;
    }

    private prepareOutputTargets(
        input: Readonly<RenderTargetResourceRecord>,
        steps: readonly Readonly<PostProcessStep>[]
    ): void {
        const seenOwners = new Set<object>();
        const seenOutputOwners = new Set<object>([input.owner]);
        this.requireFilterableSource(input, 'Post-process input');
        let index = 0;
        for (const candidate of steps as readonly (Readonly<PostProcessStep> | undefined)[]) {
            const step = candidate;
            if (step === undefined) throw new TypeError('Post-process steps must not be sparse');
            requireObjectIdentity(step.owner, 'Post-process step owner');
            const output = (step as { readonly output?: Readonly<PostProcessOutputTarget> }).output;
            if (output === undefined) throw new TypeError('Post-process step output is required');
            requireObjectIdentity(output.owner, 'Post-process output owner');
            if (seenOwners.has(step.owner)) {
                throw new TypeError('Post-process step owners must be unique within one frame');
            }
            seenOwners.add(step.owner);
            if (seenOutputOwners.has(output.owner)) {
                throw new TypeError(
                    'Post-process output owners must be unique and must not alias the input target'
                );
            }
            seenOutputOwners.add(output.owner);
            const descriptor = output.descriptor;
            if (
                descriptor.colorFormats.length !== 1 ||
                (descriptor.depthStencilFormat ?? null) !== null
            ) {
                throw new TypeError(
                    'Post-process outputs require one color attachment and no depth'
                );
            }
            const format = descriptor.colorFormats[0];
            if (format === undefined) throw new Error('Post-process output format is missing');
            this.requireFilterableFormat(format, `Post-process output ${String(index)}`);
            index += 1;
        }
        index = 0;
        for (const step of steps) {
            const output = this.resources.prepare(step.output.owner, step.output.descriptor);
            this.#targetScratch[index] = output;
            index += 1;
        }
        this.#targetScratch.length = steps.length;
    }

    private validateInputs(
        context: RenderGraphFrameContext,
        surface: RHISurface,
        input: Readonly<RenderTargetResourceRecord>,
        options: Readonly<PostProcessFrameOptions>
    ): NonNullable<RHISurface['configuration']> {
        assertRHIObjectOwnedBy(context.rhi, surface, 'post-process surface');
        const configuration = surface.configuration;
        if (surface.state !== 'configured' || configuration === null) {
            throw new Error(`Post-process surface is ${surface.state}`);
        }
        if ((configuration.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
            throw new Error('Post-process surface lacks RENDER_ATTACHMENT usage');
        }
        if (
            context.rhi.id !== this.resources.registry.deviceId ||
            context.rhi.generation !== this.resources.registry.deviceGeneration
        ) {
            throw new Error('Post-process context belongs to another registry generation');
        }
        if (!this.resources.owns(input)) {
            throw new Error('Post-process input target is stale or belongs to another cache');
        }
        if (options.steps !== undefined && !Array.isArray(options.steps)) {
            throw new TypeError('Post-process steps must be an array');
        }
        return configuration;
    }

    private requireFilterableSource(
        record: Readonly<RenderTargetResourceRecord>,
        label: string
    ): void {
        const color = record.colorAttachments[0];
        if (color === undefined) throw new Error(`${label} requires color attachment zero`);
        this.requireFilterableFormat(color.format, label);
    }

    private requireFilterableFormat(
        format: RenderTargetResourceRecord['colorAttachments'][number]['format'],
        label: string
    ): void {
        if (
            !this.resources.registry.deviceCapabilities.getTextureFormatCapabilities(format)
                .filterable
        ) {
            throw new TypeError(`${label} format ${format} is not filterable`);
        }
    }

    private assertIdle(): void {
        this.assertAlive();
        if (this.#active) throw new Error('PostProcessRenderer is active');
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('PostProcessRenderer is destroyed');
    }
}
