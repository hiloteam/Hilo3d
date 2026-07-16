import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderFeatureContext,
    type ForwardRenderPipelineFeature,
    type ForwardRenderPipelineFeatureRuntime
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineTargetResources,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext,
    ScriptableRenderPrepareContext
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { TextureCopyPass } from '../../../src/render/pipeline/passes/TextureCopyPass';
import { PresentRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import type { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';

class TestPipeline implements RenderPipeline {
    readonly name = 'test-pipeline';
    readonly pass = new SceneRenderPass('Test scene pass');
    destroyCount = 0;

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
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ],
            ...(output.depthStencil === null
                ? {}
                : {
                      depthStencilAttachment: {
                          texture: output.depthStencil,
                          depthLoadOp: 'clear' as const,
                          depthStoreOp: 'discard' as const,
                          depthClearValue: 1
                      }
                  })
        });
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class CopyPipeline implements RenderPipeline {
    readonly name = 'copy-pipeline';
    readonly clearPass = new SceneRenderPass('Copy source clear');
    readonly copyPass = new TextureCopyPass();

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('copy source', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.copyPass, {
            source,
            destination: output.color(0)
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class CopyPipelineFactory implements RenderPipelineFactory {
    readonly name = 'copy-pipeline';

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        return new CopyPipeline();
    }
}

interface TextureReadParameters {
    readonly texture: RenderGraphTextureHandle;
}

class TextureReadSideEffectPass implements ScriptableRenderPass<TextureReadParameters> {
    readonly name = 'Texture read side effect';

    setup(builder: ScriptableRenderPassBuilder, parameters: TextureReadParameters): void {
        builder.readTexture(parameters.texture);
        builder.markSideEffect();
    }

    execute(): void {
        // Dependency-only test pass.
    }
}

class SampledDepthPipeline implements RenderPipeline {
    readonly name = 'sampled-depth';
    readonly pass = new TextureReadSideEffectPass();
    target: RenderTarget | null = null;

    record(context: RenderPipelineContext): void {
        const target = this.target;
        if (target === null) throw new Error('Sampled depth target is unavailable');
        const resources = context.graph.importRenderTarget(target);
        const depth = resources.depthStencil;
        if (depth === null) throw new Error('Sampled depth target has no depth attachment');
        context.graph.addPass(this.pass, { texture: depth });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

type InvalidCopyMode = 'extent' | 'format' | 'sample-count';

class InvalidCopyPipeline implements RenderPipeline {
    readonly name = 'invalid-copy';
    readonly clearPass = new SceneRenderPass('Invalid copy source clear');
    readonly copyPass = new TextureCopyPass();

    constructor(readonly mode: InvalidCopyMode) {}

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('invalid copy source', {
            format: this.mode === 'format' ? 'rgba16float' : 'rgba8unorm',
            extent:
                this.mode === 'extent'
                    ? {
                          width: Math.max(1, context.output.width - 1),
                          height: context.output.height
                      }
                    : { relativeTo: 'output', scale: 1 },
            sampleCount: this.mode === 'sample-count' ? 4 : 1
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.copyPass, {
            source,
            destination: output.color(0)
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class ExplicitResolvePipeline implements RenderPipeline {
    readonly name = 'explicit-resolve';
    readonly pass = new SceneRenderPass('Explicit resolve clear');

    record(context: RenderPipelineContext): void {
        const multisampled = context.graph.createTexture('explicit resolve source', {
            format: context.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 },
            sampleCount: 4
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: multisampled,
                    resolveTarget: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'discard',
                    clearValue: { r: 0.2, g: 0.4, b: 0.6, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface ReadOnlyDepthParameters {
    readonly texture: RenderGraphTextureHandle;
}

class ReadOnlyDepthPass implements ScriptableRenderPass<ReadOnlyDepthParameters> {
    readonly name = 'Read-only depth';

    setup(builder: ScriptableRenderPassBuilder, parameters: ReadOnlyDepthParameters): void {
        builder.useDepthStencilAttachment({
            texture: parameters.texture,
            depthReadOnly: true
        });
    }

    execute(): void {
        // Attachment-only validation pass.
    }
}

class ReadOnlyDepthPipeline implements RenderPipeline {
    readonly name = 'read-only-depth';
    readonly pass = new ReadOnlyDepthPass();

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        const depth = output.depthStencil;
        if (depth === null) throw new Error('Read-only depth output is unavailable');
        context.graph.addPass(this.pass, { texture: depth });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class ConditionalShadowPipeline implements RenderPipeline {
    readonly name = 'conditional-shadow';
    readonly pass = new SceneRenderPass('Conditional shadow scene');
    recordSharedShadows = true;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        if (this.recordSharedShadows) context.recordShadows(culling);
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ],
            ...(output.depthStencil === null
                ? {}
                : {
                      depthStencilAttachment: {
                          texture: output.depthStencil,
                          depthLoadOp: 'clear' as const,
                          depthStoreOp: 'discard' as const,
                          depthClearValue: 1
                      }
                  })
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class SurfaceClearPipeline implements RenderPipeline {
    readonly name = 'surface-clear';
    readonly pass = new SceneRenderPass('Surface clear');
    destroyCount = 0;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class FixedRuntimeFactory implements RenderPipelineFactory {
    readonly name = 'fixed-runtime';

    constructor(readonly runtime: RenderPipeline) {}

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        return this.runtime;
    }
}

class FullscreenPresentPipeline implements RenderPipeline {
    readonly name = 'fullscreen-present';
    readonly clearPass = new SceneRenderPass('Fullscreen source clear');
    readonly presentPass = new PresentRenderPass();

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('fullscreen source', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 1, g: 0, b: 0, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.presentPass, {
            inputTextures: [source],
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class PersistentTargetPipeline implements RenderPipeline {
    readonly name = 'persistent-target-pipeline';
    readonly pass = new SceneRenderPass('Persistent target clear');
    readonly key = Object.freeze({});
    width = 4;
    failAfterRecord = false;

    record(context: RenderPipelineContext): void {
        const target = context.graph.acquirePersistentTarget(this.key, {
            extent: { width: this.width, height: 4 },
            colorFormats: ['rgba8unorm']
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: target.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
        if (this.failAfterRecord) throw new Error('persistent frame failed');
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

type PromisePassPhase = 'setup' | 'prepare' | 'execute';

interface PromisePassParameters {
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class PromisePass implements ScriptableRenderPass<PromisePassParameters> {
    readonly name: string;

    constructor(readonly phase: PromisePassPhase) {
        this.name = `Promise ${phase} pass`;
    }

    setup(builder: ScriptableRenderPassBuilder, parameters: PromisePassParameters): unknown {
        builder.useColorAttachment(parameters.attachment);
        return this.phase === 'setup' ? Promise.resolve() : undefined;
    }

    prepare(_context: ScriptableRenderPrepareContext, _parameters: PromisePassParameters): unknown {
        return this.phase === 'prepare' ? Promise.resolve() : undefined;
    }

    execute(_context: ScriptableRenderPassContext, _parameters: PromisePassParameters): unknown {
        return this.phase === 'execute' ? Promise.resolve() : undefined;
    }
}

class PromisePassPipeline implements RenderPipeline {
    readonly name = 'promise-pass-pipeline';
    readonly pass: PromisePass;

    constructor(phase: PromisePassPhase) {
        this.pass = new PromisePass(phase);
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

class TestPipelineFactory implements RenderPipelineFactory {
    readonly name = 'test-pipeline';
    runtime: TestPipeline | null = null;

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        this.runtime = new TestPipeline();
        return this.runtime;
    }
}

class CountingForwardFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    recordCount = 0;
    destroyCount = 0;

    record(_context: ForwardRenderFeatureContext): void {
        this.recordCount++;
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class CountingForwardFeature implements ForwardRenderPipelineFeature {
    readonly name = 'counting-feature';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false
    });
    readonly runtimes: CountingForwardFeatureRuntime[] = [];

    create(_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        const runtime = new CountingForwardFeatureRuntime();
        this.runtimes.push(runtime);
        return runtime;
    }
}

class SampledColorFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly pass = new PresentRenderPass('Sampled forward feature');
    recordCount = 0;
    destroyCount = 0;

    record(context: ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('Expected forward scene color');
        const filtered = context.pipeline.graph.createTexture('sampled feature color', {
            format: context.pipeline.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 }
        });
        context.pipeline.graph.addPass(this.pass, {
            inputTextures: [source],
            colorAttachments: [
                {
                    texture: filtered,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
        context.resources.replaceColor(filtered);
        this.recordCount++;
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class SampledColorFeature implements ForwardRenderPipelineFeature {
    readonly name = 'sampled-color-feature';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false
    });
    runtime: SampledColorFeatureRuntime | null = null;

    create(_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        this.runtime = new SampledColorFeatureRuntime();
        return this.runtime;
    }
}

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('Scriptable render pipeline', () => {
    it('records culling, a renderer list and a scene pass through the shared graph/RHI path', async () => {
        const factory = new TestPipelineFactory();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: factory
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

        expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        expect(renderer.renderInfo.faceCount).toBeGreaterThan(0);
        expect(factory.runtime?.destroyCount).toBe(0);
        renderer.destroy();
        activeRenderers.pop();
        expect(factory.runtime?.destroyCount).toBe(1);
    });

    it('resolves texture-copy handles during setup and emits only the declared copy in execute', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new CopyPipelineFactory()
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });

        renderer.setRenderTarget(target);
        renderer.render(new Node(), new PerspectiveCamera());
        renderer.setRenderTarget(null);

        expect(renderer.isReady).toBe(true);
        target.destroy();
    });

    it('keeps sampled depth reads independent from COPY_SRC usage', async () => {
        const runtime = new SampledDepthPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [],
            depthStencilAttachment: { format: 'depth24plus', sampled: true }
        });
        runtime.target = target;

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();

        target.destroy();
    });

    it.each(['extent', 'format', 'sample-count'] as const)(
        'rejects invalid texture-copy %s before beginning an RHI frame',
        async mode => {
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 4,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(new InvalidCopyPipeline(mode))
            });
            activeRenderers.push(renderer);
            const extension = renderer.getExtension('rhi') as {
                readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
            } | null;
            if (extension?.device === undefined) throw new Error('Expected an RHI extension');
            const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');
            const target = renderer.createRenderTarget({
                width: 8,
                height: 4,
                depthStencilAttachment: false
            });
            renderer.setRenderTarget(target);

            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/Texture copy|texture sample count|sample counts/u);
            expect(beginFrame).not.toHaveBeenCalled();
            renderer.setRenderTarget(null);
            target.destroy();
        }
    );

    it('treats an explicit resolve target as the terminal output writer', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new ExplicitResolvePipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it('does not count a read-only depth-only attachment as terminal work', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new ReadOnlyDepthPipeline())
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [],
            depthStencilAttachment: { format: 'depth24plus-stencil8' }
        });
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');
        renderer.setRenderTarget(target);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/must write an output\/persistent target/u);
        expect(beginFrame).not.toHaveBeenCalled();

        renderer.setRenderTarget(null);
        target.destroy();
    });

    it('rejects attaching one runtime to two renderers without destroying the first owner', async () => {
        const runtime = new SurfaceClearPipeline();
        const factory = new FixedRuntimeFactory(runtime);
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first);

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/already attached/u);
        expect(runtime.destroyCount).toBe(0);
        first.render(new Node(), new PerspectiveCamera());
    });

    it('samples a transient graph texture in prepare and presents a fullscreen triangle', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new FullscreenPresentPipeline())
        });
        activeRenderers.push(renderer);

        renderer.render(new Node(), new PerspectiveCamera());
        renderer.render(new Node(), new PerspectiveCamera());

        expect(renderer.renderInfo.drawCount).toBe(1);
    });

    it('commits persistent target descriptor changes only after successful submission', async () => {
        const runtime = new PersistentTargetPipeline();
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

        runtime.width = 8;
        runtime.failAfterRecord = true;
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/persistent frame failed/u);
        expect(cache.metrics.size).toBe(1);
        const missesAfterFailure = cache.metrics.misses;

        runtime.width = 4;
        runtime.failAfterRecord = false;
        renderer.render(new Node(), new PerspectiveCamera());

        expect(cache.metrics.misses).toBe(missesAfterFailure);
        expect(cache.metrics.size).toBe(1);
    });

    it('commits a submitted persistent target when an after-render listener fails', async () => {
        const runtime = new PersistentTargetPipeline();
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

        runtime.width = 8;
        const failAfterRender = (): void => {
            throw new Error('after-render listener failed');
        };
        renderer.on('afterRender', failAfterRender);
        expect(() => {
            renderer.render(scene, camera, true);
        }).toThrow(/after-render listener failed/u);
        renderer.off('afterRender', failAfterRender);
        const missesAfterSubmittedFailure = cache.metrics.misses;

        renderer.render(scene, camera);

        expect(cache.metrics.misses).toBe(missesAfterSubmittedFailure);
        expect(cache.metrics.size).toBe(1);
    });

    it('rebuilds persistent targets after explicit renderer resource release', async () => {
        const runtime = new PersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const rendererWithCache = renderer as Renderer & {
            readonly renderTargetResources: RenderTargetResourceCache;
        };
        const originalCache = rendererWithCache.renderTargetResources;
        renderer.render(new Node(), new PerspectiveCamera());

        renderer.releaseGPUResources();
        const replacementCache = rendererWithCache.renderTargetResources;
        renderer.render(new Node(), new PerspectiveCamera());

        expect(replacementCache).not.toBe(originalCache);
        expect(replacementCache.metrics.size).toBe(1);
    });

    it('rejects Promise-returning record callbacks before beginning an RHI frame', async () => {
        const runtime: RenderPipeline = {
            name: 'async-record',
            record(_context: RenderPipelineContext): Promise<void> {
                return Promise.resolve();
            },
            destroy(): void {
                // No renderer-local resources.
            }
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/record\(\) must be synchronous/u);
        expect(beginFrame).not.toHaveBeenCalled();
    });

    it.each([
        ['setup', false],
        ['prepare', false],
        ['execute', true]
    ] as const)(
        'rejects Promise-returning %s callbacks at the correct RHI boundary',
        async (phase, beginsRHIFrame) => {
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(new PromisePassPipeline(phase))
            });
            activeRenderers.push(renderer);
            const extension = renderer.getExtension('rhi') as {
                readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
            } | null;
            if (extension?.device === undefined) throw new Error('Expected an RHI extension');
            const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(new RegExp(`${phase}\\(\\) must be synchronous`, 'u'));
            expect(beginFrame).toHaveBeenCalledTimes(beginsRHIFrame ? 1 : 0);
        }
    );

    it('snapshots a factory create callback before asynchronous backend resolution', async () => {
        const originalCreate = vi.fn(
            (_context: RenderPipelineCreateContext): RenderPipeline => new SurfaceClearPipeline()
        );
        const replacementCreate = vi.fn(
            (_context: RenderPipelineCreateContext): RenderPipeline => new SurfaceClearPipeline()
        );
        const factory = { name: 'mutable-create', create: originalCreate };

        const pendingRenderer = Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        factory.create = replacementCreate;
        const renderer = await pendingRenderer;
        activeRenderers.push(renderer);

        expect(originalCreate).toHaveBeenCalledOnce();
        expect(replacementCreate).not.toHaveBeenCalled();
        renderer.render(new Node(), new PerspectiveCamera());
    });

    it('invalidates a retained context as soon as record returns', async () => {
        let retained: RenderPipelineContext | null = null;
        let retainedOutput: RenderPipelineContext['output'] | null = null;
        let retainedClearColor: RenderPipelineContext['clearColor'] | null = null;
        let retainedViewport: RenderPipelineContext['viewport'] | null = null;
        let retainedTarget: RenderPipelineTargetResources | null = null;
        const runtime = new SurfaceClearPipeline();
        const record = runtime.record.bind(runtime);
        runtime.record = (context: RenderPipelineContext): void => {
            retained = context;
            retainedOutput = context.output;
            retainedClearColor = context.clearColor;
            retainedViewport = context.viewport;
            retainedTarget = context.graph.importOutput();
            record(context);
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);

        renderer.render(new Node(), new PerspectiveCamera());

        const escaped = retained as RenderPipelineContext | null;
        if (escaped === null) throw new Error('Expected a retained pipeline context');
        expect(() => escaped.cull()).toThrow(/valid only during synchronous record/u);
        expect(() => escaped.scene).toThrow(/valid only during synchronous record/u);
        expect(() => escaped.output.colorFormat(0)).toThrow(
            /valid only during synchronous record/u
        );
        const output = retainedOutput as RenderPipelineContext['output'] | null;
        const clearColor = retainedClearColor as RenderPipelineContext['clearColor'] | null;
        const viewport = retainedViewport as RenderPipelineContext['viewport'] | null;
        const target = retainedTarget as RenderPipelineTargetResources | null;
        if (output === null || clearColor === null || viewport === null || target === null) {
            throw new Error('Expected retained nested pipeline facades');
        }
        expect(() => output.width).toThrow(/valid only during synchronous record/u);
        expect(() => clearColor.r).toThrow(/valid only during synchronous record/u);
        expect(() => viewport[0]).toThrow(/valid only during synchronous record/u);
        expect(() => target.width).toThrow(/valid only during synchronous record/u);
        expect(Object.isFrozen(output)).toBe(true);
        expect(Object.isFrozen(clearColor)).toBe(true);
        expect(Object.isFrozen(viewport)).toBe(true);
        expect(Object.isFrozen(target)).toBe(true);
        expect(Reflect.set(output, 'width', 99)).toBe(false);
    });

    it('validates future compute requirements before invoking the factory', async () => {
        const create = vi.fn((_context: RenderPipelineCreateContext): RenderPipeline => {
            return new SurfaceClearPipeline();
        });
        const factory: RenderPipelineFactory = {
            name: 'compute-required',
            requirements: { requiredCapabilities: ['compute-pass'] },
            create
        };

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/unsupported capability compute-pass/u);
        expect(create).not.toHaveBeenCalled();
    });

    it('merges forward feature capabilities before creating feature runtimes', async () => {
        const create = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const feature: ForwardRenderPipelineFeature = {
            name: 'compute-forward-feature',
            injectionPoint: 'before-opaque',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: false,
                requiredCapabilities: ['compute-pass']
            },
            create
        };
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });

        expect(factory.requirements.requiredCapabilities).toEqual(['compute-pass']);
        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/unsupported capability compute-pass/u);
        expect(create).not.toHaveBeenCalled();
    });

    it('finishes renderer cleanup when the user runtime destroy method throws', async () => {
        const runtime = new SurfaceClearPipeline();
        runtime.destroy = (): void => {
            runtime.destroyCount++;
            throw new Error('user destroy failed');
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly destroyed: boolean };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const device = extension.device;

        expect(() => {
            renderer.destroy();
        }).toThrow(/failed while destroying owned resources/u);
        activeRenderers.pop();
        expect(runtime.destroyCount).toBe(1);
        expect(device.destroyed).toBe(true);
    });

    it('records non-sampling forward features without replacing the direct output', async () => {
        const feature = new CountingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
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

        renderer.render(scene, new PerspectiveCamera());
        renderer.render(scene, new PerspectiveCamera());

        expect(feature.runtimes).toHaveLength(1);
        expect(feature.runtimes[0]?.recordCount).toBe(2);
        expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
    });

    it('reuses the shared shadow atlas and restores its LightBlock before scene draws', async () => {
        const feature = new CountingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial(),
                frustumTest: false
            })
        );
        const target = new Vector3(0, 0, 0);
        const light = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        light.setPosition(2, 4, 3).lookAt(target);
        scene.addChild(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);

        renderer.render(scene, camera);
        renderer.render(scene, camera);

        expect(renderer.lightManager.shadowAtlas).not.toBeNull();
        expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(2);
    });

    it('detaches the previous shared shadow atlas when a later invocation omits shadows', async () => {
        const runtime = new ConditionalShadowPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ receiveShadows: false }),
                frustumTest: false
            })
        );
        const target = new Vector3(0, 0, 0);
        const light = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        light.setPosition(2, 4, 3).lookAt(target);
        scene.addChild(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);

        renderer.render(scene, camera);
        expect(renderer.lightManager.shadowAtlas).not.toBeNull();

        runtime.recordSharedShadows = false;
        renderer.render(scene, camera);

        expect(renderer.lightManager.shadowAtlas).toBeNull();
    });

    it.each([false, true])(
        'samples forward scene color and presents the replacement with antialias=%s',
        async antialias => {
            const feature = new SampledColorFeature();
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias,
                renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
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

            renderer.render(scene, new PerspectiveCamera());
            renderer.render(scene, new PerspectiveCamera());

            expect(feature.runtime?.recordCount).toBe(2);
            expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(3);
        }
    );

    it('creates and destroys independent forward feature runtimes per Renderer', async () => {
        const feature = new CountingForwardFeature();
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        const second = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first, second);

        expect(feature.runtimes).toHaveLength(2);
        first.destroy();
        activeRenderers.splice(activeRenderers.indexOf(first), 1);
        expect(feature.runtimes[0]?.destroyCount).toBe(1);
        expect(feature.runtimes[1]?.destroyCount).toBe(0);
        second.destroy();
        activeRenderers.splice(activeRenderers.indexOf(second), 1);
        expect(feature.runtimes[1]?.destroyCount).toBe(1);
    });

    it('snapshots feature create callbacks when the forward factory is constructed', async () => {
        const originalCreate = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const replacementCreate = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const feature = {
            name: 'mutable-feature-create',
            injectionPoint: 'after-transparent' as const,
            requirements: { sampledSceneColor: false, sampledDepth: false },
            create: originalCreate
        };
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });
        feature.create = replacementCreate;

        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(renderer);

        expect(originalCreate).toHaveBeenCalledOnce();
        expect(replacementCreate).not.toHaveBeenCalled();
    });

    it('cleans up an invalid forward feature runtime during Renderer initialization', async () => {
        const destroy = vi.fn();
        const feature: ForwardRenderPipelineFeature = {
            name: 'invalid-runtime-feature',
            injectionPoint: 'before-output',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: false
            },
            create(): ForwardRenderPipelineFeatureRuntime {
                return { destroy } as unknown as ForwardRenderPipelineFeatureRuntime;
            }
        };

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
            })
        ).rejects.toThrow(/must implement record\(\) and destroy\(\)/u);
        expect(destroy).toHaveBeenCalledOnce();
    });
});
