import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type { RendererListHandle } from '../../../src/render/pipeline/RendererList';
import type {
    RenderGraphPassHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext,
    ScriptableRenderPrepareContext
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import type { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';

interface ClearParameters {
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class AttachmentClearPass implements ScriptableRenderPass<ClearParameters> {
    readonly name: string;

    constructor(name = 'Attachment clear') {
        this.name = name;
    }

    setup(builder: ScriptableRenderPassBuilder, parameters: ClearParameters): void {
        builder.useColorAttachment(parameters.attachment);
    }

    execute(): void {
        // The attachment declaration performs the clear.
    }
}

function recordOutputClear(
    context: RenderPipelineContext,
    pass: AttachmentClearPass
): RenderGraphPassHandle {
    const output = context.graph.importOutput();
    return context.graph.addPass(pass, {
        attachment: {
            texture: output.color(0),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: context.clearColor
        }
    });
}

class FixedRuntimeFactory implements RenderPipelineFactory {
    readonly name = 'fixed-regression-runtime';

    constructor(readonly runtime: RenderPipeline) {}

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        return this.runtime;
    }
}

class InvocationTrackingPipeline implements RenderPipeline {
    readonly name = 'invocation-tracking';
    readonly pass = new AttachmentClearPass();
    readonly handles: RenderGraphPassHandle[] = [];
    readonly outputKinds: RenderPipelineContext['output']['kind'][] = [];
    readonly outputSizes: { width: number; height: number }[] = [];

    record(context: RenderPipelineContext): void {
        this.outputKinds.push(context.output.kind);
        this.outputSizes.push({
            width: context.output.width,
            height: context.output.height
        });
        this.handles.push(recordOutputClear(context, this.pass));
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface DependencyParameters {
    readonly dependency: RenderGraphPassHandle;
}

class DependencySideEffectPass implements ScriptableRenderPass<DependencyParameters> {
    readonly name = 'Dependency side effect';

    setup(builder: ScriptableRenderPassBuilder, parameters: DependencyParameters): void {
        builder.dependsOn(parameters.dependency);
        builder.markSideEffect();
    }

    execute(): void {
        // Dependency-only regression pass.
    }
}

class StaleHandlePipeline implements RenderPipeline {
    readonly name = 'stale-handle';
    readonly clearPass = new AttachmentClearPass();
    readonly dependencyPass = new DependencySideEffectPass();
    staleHandle: RenderGraphPassHandle | null = null;
    invocationCount = 0;
    useStaleHandle = true;

    record(context: RenderPipelineContext): void {
        const current = recordOutputClear(context, this.clearPass);
        if (this.invocationCount === 0) this.staleHandle = current;
        else if (this.useStaleHandle) {
            const stale = this.staleHandle;
            if (stale === null) throw new Error('Stale pass handle is unavailable');
            context.graph.addPass(this.dependencyPass, { dependency: stale });
        }
        this.invocationCount++;
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class NestedRenderPipeline implements RenderPipeline {
    readonly name = 'nested-render';
    readonly pass = new AttachmentClearPass();
    renderer: Renderer | null = null;
    scene: Node | null = null;
    camera: PerspectiveCamera | null = null;
    attemptNestedRender = true;
    caughtNestedError: unknown;

    record(context: RenderPipelineContext): void {
        if (this.attemptNestedRender) {
            const renderer = this.renderer;
            const scene = this.scene;
            const camera = this.camera;
            if (renderer === null || scene === null || camera === null) {
                throw new Error('Nested render test is not configured');
            }
            try {
                renderer.render(scene, camera);
            } catch (error) {
                this.caughtNestedError = error;
            }
        }
        recordOutputClear(context, this.pass);
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

type PersistentMode =
    'acquire' | 'acquire-and-fail' | 'release' | 'release-and-fail' | 'acquire-and-release';

class ReleasablePersistentTargetPipeline implements RenderPipeline {
    readonly name = 'releasable-persistent-target';
    readonly pass = new AttachmentClearPass();
    readonly key = Object.freeze({});
    readonly conflictingKey = Object.freeze({});
    mode: PersistentMode = 'acquire';
    releaseResult: boolean | null = null;

    record(context: RenderPipelineContext): void {
        if (this.mode === 'acquire' || this.mode === 'acquire-and-fail') {
            const target = context.graph.acquirePersistentTarget(this.key, {
                extent: { width: 4, height: 4 },
                colorFormats: ['rgba8unorm']
            });
            if (this.mode === 'acquire-and-fail') {
                throw new Error('acquire frame failed');
            }
            context.graph.addPass(this.pass, {
                attachment: {
                    texture: target.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            });
            return;
        }
        if (this.mode === 'acquire-and-release') {
            context.graph.acquirePersistentTarget(this.conflictingKey, {
                extent: { width: 4, height: 4 },
                colorFormats: ['rgba8unorm']
            });
            context.graph.releasePersistentTarget(this.conflictingKey);
            return;
        }
        this.releaseResult = context.graph.releasePersistentTarget(this.key);
        if (this.mode === 'release-and-fail') {
            throw new Error('release frame failed');
        }
        recordOutputClear(context, this.pass);
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class OpaqueOnlyPipeline implements RenderPipeline {
    readonly name = 'opaque-only';
    readonly pass = new SceneRenderPass('Opaque-only scene');

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const opaque = context.createRendererList({
            cullingResults: culling,
            queue: 'opaque',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList: opaque,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class CulledScenePassPipeline implements RenderPipeline {
    readonly name = 'culled-scene-pass';
    readonly deadPass = new SceneRenderPass('Dead transient scene');
    readonly outputPass = new AttachmentClearPass('Live output clear');

    record(context: RenderPipelineContext): void {
        const transient = context.graph.createTexture('dead transient', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const list = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        context.graph.addPass(this.deadPass, {
            rendererList: list,
            colorAttachments: [
                {
                    texture: transient,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
        recordOutputClear(context, this.outputPass);
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class DivertedOutputResolvePipeline implements RenderPipeline {
    readonly name = 'diverted-output-resolve';
    readonly pass = new AttachmentClearPass('Diverted output resolve');

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        const diverted = context.graph.createTexture('diverted resolve', {
            format: context.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 }
        });
        context.graph.addPass(this.pass, {
            attachment: {
                texture: output.color(0),
                resolveTarget: diverted,
                loadOp: 'clear',
                storeOp: 'discard',
                clearValue: context.clearColor
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface ConditionalSceneParameters {
    readonly rendererList: RendererListHandle;
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
    readonly draw: boolean;
}

class ConditionalScenePass implements ScriptableRenderPass<ConditionalSceneParameters> {
    readonly name = 'Conditional scene draw';

    setup(builder: ScriptableRenderPassBuilder, parameters: ConditionalSceneParameters): void {
        builder.useColorAttachment(parameters.attachment);
        builder.useRendererList(parameters.rendererList);
    }

    execute(context: ScriptableRenderPassContext, parameters: ConditionalSceneParameters): void {
        if (parameters.draw) context.commands.drawRendererList(parameters.rendererList);
    }
}

class ConditionalScenePipeline implements RenderPipeline {
    readonly name = 'conditional-scene';
    readonly pass = new ConditionalScenePass();
    draw = false;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList,
            attachment: {
                texture: output.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            },
            draw: this.draw
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface CaughtUndeclaredRendererListParameters {
    readonly declaredList: RendererListHandle;
    readonly undeclaredList: RendererListHandle;
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class CaughtUndeclaredRendererListPass implements ScriptableRenderPass<CaughtUndeclaredRendererListParameters> {
    readonly name = 'Caught undeclared renderer list';
    caughtError: unknown;

    setup(
        builder: ScriptableRenderPassBuilder,
        parameters: CaughtUndeclaredRendererListParameters
    ): void {
        builder.useColorAttachment(parameters.attachment);
        builder.useRendererList(parameters.declaredList);
    }

    execute(
        context: ScriptableRenderPassContext,
        parameters: CaughtUndeclaredRendererListParameters
    ): void {
        try {
            context.commands.drawRendererList(parameters.undeclaredList);
        } catch (error) {
            this.caughtError = error;
        }
    }
}

class CaughtUndeclaredRendererListPipeline implements RenderPipeline {
    readonly name = 'caught-undeclared-renderer-list';
    readonly pass = new CaughtUndeclaredRendererListPass();

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const declaredList = context.createRendererList({
            cullingResults: culling,
            queue: 'transparent',
            sorting: 'back-to-front'
        });
        const undeclaredList = context.createRendererList({
            cullingResults: culling,
            queue: 'opaque',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            declaredList,
            undeclaredList,
            attachment: {
                texture: output.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class RepeatedScenePipeline implements RenderPipeline {
    readonly name = 'repeated-scene';
    readonly firstPass = new SceneRenderPass('Repeated scene first');
    readonly secondPass = new SceneRenderPass('Repeated scene second');
    repeat = false;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.firstPass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
        if (!this.repeat) return;
        context.graph.addPass(this.secondPass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'load',
                    storeOp: 'store'
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class NoTerminalScenePipeline implements RenderPipeline {
    readonly name = 'no-terminal-scene';
    readonly pass = new SceneRenderPass('No-terminal scene');

    record(context: RenderPipelineContext): void {
        const transient = context.graph.createTexture('no-terminal transient', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: transient,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

type NestedPassPhase = 'prepare' | 'execute';

class NestedPass implements ScriptableRenderPass<ClearParameters> {
    readonly name: string;
    renderer: Renderer | null = null;
    scene: Node | null = null;
    camera: PerspectiveCamera | null = null;
    attemptNestedRender = true;
    caughtNestedError: unknown;

    constructor(readonly phase: NestedPassPhase) {
        this.name = `Nested ${phase} pass`;
    }

    setup(builder: ScriptableRenderPassBuilder, parameters: ClearParameters): void {
        builder.useColorAttachment(parameters.attachment);
    }

    prepare(_context: ScriptableRenderPrepareContext): void {
        if (this.phase === 'prepare') this.tryNestedRender();
    }

    execute(_context: ScriptableRenderPassContext): void {
        if (this.phase === 'execute') this.tryNestedRender();
    }

    private tryNestedRender(): void {
        if (!this.attemptNestedRender) return;
        const renderer = this.renderer;
        const scene = this.scene;
        const camera = this.camera;
        if (renderer === null || scene === null || camera === null) {
            throw new Error('Nested pass test is not configured');
        }
        try {
            renderer.render(scene, camera);
        } catch (error) {
            this.caughtNestedError = error;
        }
    }
}

class NestedPassPipeline implements RenderPipeline {
    readonly name = 'nested-pass-pipeline';
    readonly pass: NestedPass;

    constructor(phase: NestedPassPhase) {
        this.pass = new NestedPass(phase);
    }

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            attachment: {
                texture: output.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface AliasedFeedbackParameters {
    readonly sampled: RenderGraphTextureHandle;
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class AliasedFeedbackPass implements ScriptableRenderPass<AliasedFeedbackParameters> {
    readonly name = 'Aliased texture feedback';

    setup(builder: ScriptableRenderPassBuilder, parameters: AliasedFeedbackParameters): void {
        builder.readTexture(parameters.sampled);
        builder.useColorAttachment(parameters.attachment);
    }

    execute(): void {
        // Setup must reject aliases before native resources or commands are reached.
    }
}

class ImportedTargetAliasPipeline implements RenderPipeline {
    readonly name = 'imported-target-alias';
    readonly pass = new AliasedFeedbackPass();
    target: RenderTarget | null = null;

    record(context: RenderPipelineContext): void {
        const target = this.target;
        if (target === null) throw new Error('Imported target alias test is not configured');
        const sampled = context.graph.importRenderTarget(target);
        const attachment = context.graph.importRenderTarget(target);
        context.graph.addPass(this.pass, {
            sampled: sampled.color(0),
            attachment: {
                texture: attachment.color(0),
                loadOp: 'load',
                storeOp: 'store'
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface AliasedAttachmentsParameters {
    readonly first: Readonly<RenderPipelineColorAttachment>;
    readonly second: Readonly<RenderPipelineColorAttachment>;
}

class AliasedAttachmentsPass implements ScriptableRenderPass<AliasedAttachmentsParameters> {
    readonly name = 'Aliased color attachments';

    setup(builder: ScriptableRenderPassBuilder, parameters: AliasedAttachmentsParameters): void {
        builder.useColorAttachment(parameters.first);
        builder.useColorAttachment(parameters.second);
    }

    execute(): void {
        // Setup must reject duplicate internal attachment identities.
    }
}

class PersistentTargetAliasPipeline implements RenderPipeline {
    readonly name = 'persistent-target-alias';
    readonly pass = new AliasedAttachmentsPass();
    readonly key = Object.freeze({});

    record(context: RenderPipelineContext): void {
        const descriptor = {
            extent: { width: 4, height: 4 },
            colorFormats: ['rgba8unorm']
        } as const;
        const first = context.graph.acquirePersistentTarget(this.key, descriptor);
        const second = context.graph.acquirePersistentTarget(this.key, descriptor);
        context.graph.addPass(this.pass, {
            first: {
                texture: first.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            },
            second: {
                texture: second.color(0),
                loadOp: 'load',
                storeOp: 'store'
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('Scriptable render pipeline regressions', () => {
    it('routes renderToTarget through the configured scriptable pipeline', async () => {
        const runtime = new InvocationTrackingPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 5,
            height: 3,
            depthStencilAttachment: false
        });

        renderer.renderToTarget(target, new Node(), new PerspectiveCamera());

        expect(runtime.outputKinds).toEqual(['render-target']);
        expect(runtime.outputSizes).toEqual([{ width: 5, height: 3 }]);
        target.destroy();
    });

    it('keeps public graph handles unique across invocations in one application frame', async () => {
        const runtime = new InvocationTrackingPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.renderFrame(frame => {
            frame.render(scene, camera);
            frame.render(scene, camera);
        });

        expect(runtime.handles).toHaveLength(2);
        expect(runtime.handles[0]).not.toBe(runtime.handles[1]);
    });

    it('rejects a pass handle retained from another invocation in the same frame', async () => {
        const runtime = new StaleHandlePipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.render(scene, camera);
                frame.render(scene, camera);
            });
        }).toThrow(/stale or invalid/u);

        runtime.useStaleHandle = false;
        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
    });

    it('poisons a caught nested render but accepts the next independent frame', async () => {
        const runtime = new NestedRenderPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();
        runtime.renderer = renderer;
        runtime.scene = scene;
        runtime.camera = camera;

        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/Nested renderer\.render|aborted/u);
        expect(runtime.caughtNestedError).toBeInstanceOf(Error);

        runtime.attemptNestedRender = false;
        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
    });

    it('releases persistent targets by key and rejects active-frame release', async () => {
        const runtime = new ReleasablePersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const cache = (
            renderer as Renderer & { readonly renderTargetResources: RenderTargetResourceCache }
        ).renderTargetResources;
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        expect(cache.metrics.size).toBe(1);

        const missesBeforeRollback = cache.metrics.misses;
        runtime.mode = 'release-and-fail';
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/release frame failed/u);
        expect(cache.metrics.size).toBe(1);

        runtime.mode = 'acquire';
        renderer.render(scene, camera);
        expect(cache.metrics.misses).toBe(missesBeforeRollback);

        runtime.mode = 'release';
        renderer.render(scene, camera);
        expect(runtime.releaseResult).toBe(true);
        expect(cache.metrics.size).toBe(0);

        renderer.render(scene, camera);
        expect(runtime.releaseResult).toBe(false);

        runtime.mode = 'acquire';
        renderer.render(scene, camera);
        expect(cache.metrics.size).toBe(1);
        const registryRelease = cache.registry.release.bind(cache.registry);
        let targetReleaseCallCount = 0;
        const release = vi.spyOn(cache.registry, 'release').mockImplementation(handle => {
            if (!handle.label.startsWith('Shared render target')) {
                registryRelease(handle);
                return;
            }
            targetReleaseCallCount++;
            if (targetReleaseCallCount === 2) {
                throw new Error('injected persistent handle cleanup failure');
            }
            registryRelease(handle);
        });
        runtime.mode = 'release';
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/cleanup failed/u);
        expect(runtime.releaseResult).toBe(true);
        expect(cache.metrics.size).toBe(1);
        expect(targetReleaseCallCount).toBe(2);
        expect(cache.registry.diagnostics().pendingReleaseCount).toBeGreaterThanOrEqual(1);

        renderer.render(scene, camera);
        expect(runtime.releaseResult).toBe(false);
        expect(cache.metrics.size).toBe(0);
        expect(targetReleaseCallCount).toBe(3);
        release.mockRestore();

        runtime.mode = 'acquire-and-fail';
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/acquire frame failed/u);
        expect(cache.metrics.size).toBe(0);

        runtime.mode = 'release';
        renderer.render(scene, camera);
        expect(runtime.releaseResult).toBe(false);

        runtime.mode = 'acquire-and-release';
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/Cannot release a persistent target used by the active frame/u);
        expect(cache.metrics.size).toBe(0);

        runtime.mode = 'release';
        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
    });

    it('finishes a partially failed persistent-target release during renderer destruction', async () => {
        const runtime = new ReleasablePersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const cache = (
            renderer as Renderer & { readonly renderTargetResources: RenderTargetResourceCache }
        ).renderTargetResources;
        renderer.render(new Node(), new PerspectiveCamera());
        expect(cache.metrics.size).toBe(1);

        const registryRelease = cache.registry.release.bind(cache.registry);
        let targetReleaseCallCount = 0;
        const release = vi.spyOn(cache.registry, 'release').mockImplementation(handle => {
            if (!handle.label.startsWith('Shared render target')) {
                registryRelease(handle);
                return;
            }
            targetReleaseCallCount++;
            if (targetReleaseCallCount === 2) {
                throw new Error('injected destroy-time persistent handle cleanup failure');
            }
            registryRelease(handle);
        });

        expect(() => {
            renderer.destroy();
        }).toThrow(/failed while destroying owned resources/u);
        activeRenderers.pop();
        expect(targetReleaseCallCount).toBe(3);
        expect(cache.metrics.size).toBe(0);
        expect(() => cache.release({})).toThrow(/resource cache is destroyed/u);
        release.mockRestore();
    });

    it('fires mesh events and counts faces only for the selected renderer list', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new OpaqueOnlyPipeline())
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const opaque = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
            frustumTest: false
        });
        scene.addChild(opaque);
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera, true);
        renderer.render(scene, camera, true);
        const opaqueFaceCount = renderer.renderInfo.faceCount;
        expect(opaqueFaceCount).toBeGreaterThan(0);

        const transparent = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({
                lightType: 'NONE',
                depthTest: false,
                transparent: true
            }),
            frustumTest: false
        });
        const beforeRender = vi.fn();
        const afterRender = vi.fn();
        transparent.on('beforeRender', beforeRender);
        transparent.on('afterRender', afterRender);
        scene.addChild(transparent);

        renderer.render(scene, camera, true);
        renderer.render(scene, camera, true);

        expect(renderer.renderInfo.faceCount).toBe(opaqueFaceCount);
        expect(beforeRender).not.toHaveBeenCalled();
        expect(afterRender).not.toHaveBeenCalled();
    });

    it('fires Mesh beforeRender before preparing the current frame draw snapshot', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new OpaqueOnlyPipeline())
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
            frustumTest: false
        });
        let beforeRenderFired = false;
        mesh.on('beforeRender', () => {
            beforeRenderFired = true;
        });
        scene.addChild(mesh);
        const originalPrepare = Reflect.get(MeshDrawProcessor.prototype, 'prepare');
        const prepare = vi
            .spyOn(MeshDrawProcessor.prototype, 'prepare')
            .mockImplementation(function (
                this: MeshDrawProcessor,
                ...parameters: Parameters<MeshDrawProcessor['prepare']>
            ) {
                expect(beforeRenderFired).toBe(true);
                return originalPrepare.apply(this, parameters);
            });

        try {
            renderer.render(scene, new PerspectiveCamera(), true);
        } finally {
            prepare.mockRestore();
        }
    });

    it('prepares declared meshes before snapshots but only completes events and faces for draws', async () => {
        const runtime = new ConditionalScenePipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
            frustumTest: false
        });
        const beforeRender = vi.fn();
        const afterRender = vi.fn();
        mesh.on('beforeRender', beforeRender);
        mesh.on('afterRender', afterRender);
        scene.addChild(mesh);
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera, true);
        renderer.render(scene, camera, true);

        expect(renderer.renderInfo.faceCount).toBe(0);
        expect(renderer.renderInfo.drawCount).toBe(0);
        expect(beforeRender).toHaveBeenCalledTimes(2);
        expect(afterRender).not.toHaveBeenCalled();
    });

    it('does not count faces or fire Mesh afterRender when an undeclared list error is caught', async () => {
        const runtime = new CaughtUndeclaredRendererListPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
            frustumTest: false
        });
        const afterRender = vi.fn();
        mesh.on('afterRender', afterRender);
        scene.addChild(mesh);

        renderer.render(scene, new PerspectiveCamera(), true);

        expect(runtime.pass.caughtError).toBeInstanceOf(Error);
        expect(String(runtime.pass.caughtError)).toMatch(/not declared by this pass setup/u);
        expect(renderer.renderInfo.faceCount).toBe(0);
        expect(renderer.renderInfo.drawCount).toBe(0);
        expect(afterRender).not.toHaveBeenCalled();
    });

    it('counts repeated list draws while deduplicating public mesh events', async () => {
        const runtime = new RepeatedScenePipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
            frustumTest: false
        });
        scene.addChild(mesh);
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        renderer.render(scene, camera);
        const singleFaceCount = renderer.renderInfo.faceCount;
        const singleDrawCount = renderer.renderInfo.drawCount;

        const beforeRender = vi.fn();
        const afterRender = vi.fn();
        mesh.on('beforeRender', beforeRender);
        mesh.on('afterRender', afterRender);
        runtime.repeat = true;
        renderer.render(scene, camera, true);
        renderer.render(scene, camera, true);

        expect(renderer.renderInfo.faceCount).toBe(singleFaceCount * 2);
        expect(renderer.renderInfo.drawCount).toBeGreaterThan(singleDrawCount);
        expect(beforeRender).toHaveBeenCalledTimes(2);
        expect(afterRender).toHaveBeenCalledTimes(2);
    });

    it('fires renderer events once for a successful invocation without renderer lists', async () => {
        const runtime = new InvocationTrackingPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const beforeRender = vi.fn();
        const beforeRenderScene = vi.fn();
        const afterRender = vi.fn();
        renderer.on('beforeRender', beforeRender);
        renderer.on('beforeRenderScene', beforeRenderScene);
        renderer.on('afterRender', afterRender);

        renderer.render(new Node(), new PerspectiveCamera(), true);

        expect(beforeRender).toHaveBeenCalledOnce();
        expect(beforeRenderScene).toHaveBeenCalledOnce();
        expect(afterRender).toHaveBeenCalledOnce();
    });

    it('does not let fireEvent turn dead scene work into a terminal side effect', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new NoTerminalScenePipeline())
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
                frustumTest: false
            })
        );

        expect(() => {
            renderer.render(scene, new PerspectiveCamera(), true);
        }).toThrow(/must write an output\/persistent target/u);
    });

    it('does not count scene work from graph-culled passes', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new CulledScenePassPipeline())
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
                frustumTest: false
            })
        );

        const camera = new PerspectiveCamera();
        renderer.render(scene, camera);
        renderer.render(scene, camera);

        expect(renderer.renderInfo.faceCount).toBe(0);
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it('does not treat a diverted MSAA resolve as a write to the selected output', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: true,
            renderPipeline: new FixedRuntimeFactory(new DivertedOutputResolvePipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/must write an output\/persistent target/u);
    });

    it('rejects sampled/attachment feedback through two imports of one RenderTarget', async () => {
        const runtime = new ImportedTargetAliasPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        runtime.target = target;

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/Same-pass texture feedback is not portable/u);
        target.destroy();
    });

    it('rejects duplicate attachments through two acquisitions of one persistent key', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new PersistentTargetAliasPipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/Same-pass texture feedback is not portable/u);
    });

    it('poisons caught nested rendering from the direct forward beforeRender event', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();
        let caughtNestedError: unknown;
        renderer.on(
            'beforeRender',
            () => {
                try {
                    renderer.render(scene, camera);
                } catch (error) {
                    caughtNestedError = error;
                }
            },
            true
        );
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(scene, camera, true);
        }).toThrow(/Nested renderer\.render|aborted/u);
        expect(caughtNestedError).toBeInstanceOf(Error);
        expect(beginFrame).not.toHaveBeenCalled();

        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
    });

    it.each(['prepare', 'execute'] as const)(
        'poisons caught nested rendering from pass %s without submitting the frame',
        async phase => {
            const runtime = new NestedPassPipeline(phase);
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(runtime)
            });
            activeRenderers.push(renderer);
            const scene = new Node();
            const camera = new PerspectiveCamera();
            runtime.pass.renderer = renderer;
            runtime.pass.scene = scene;
            runtime.pass.camera = camera;
            const extension = renderer.getExtension('rhi') as {
                readonly device?: {
                    readonly graphicsQueue: {
                        beginFrame(): unknown;
                        endFrame(context: unknown): unknown;
                        abortFrame(context: unknown, reason?: unknown): void;
                    };
                };
            } | null;
            if (extension?.device === undefined) throw new Error('Expected an RHI extension');
            const queue = extension.device.graphicsQueue;
            const beginFrame = vi.spyOn(queue, 'beginFrame');
            const endFrame = vi.spyOn(queue, 'endFrame');
            const abortFrame = vi.spyOn(queue, 'abortFrame');

            expect(() => {
                renderer.render(scene, camera);
            }).toThrow(/Render Graph prepare or execute|aborted/u);
            expect(runtime.pass.caughtNestedError).toBeInstanceOf(Error);
            expect(endFrame).not.toHaveBeenCalled();
            if (phase === 'prepare') {
                expect(beginFrame).not.toHaveBeenCalled();
                expect(abortFrame).not.toHaveBeenCalled();
            } else {
                expect(beginFrame).toHaveBeenCalledOnce();
                expect(abortFrame).toHaveBeenCalledOnce();
            }

            runtime.pass.attemptNestedRender = false;
            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
        }
    );
});
