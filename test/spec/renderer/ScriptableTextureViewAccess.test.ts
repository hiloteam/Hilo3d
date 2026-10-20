import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Color from '../../../src/math/Color';
import type RendererCore from '../../../src/render/RendererCore';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import type { RenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import { ScriptableRenderPipelineContextImpl } from '../../../src/render/internal/ScriptableRenderPipelineContext';
import { ScriptableRenderPipelineResources } from '../../../src/render/internal/ScriptableRenderPipelineResources';
import type {
    ScriptableRenderPipelineServices,
    TextureAccess
} from '../../../src/render/internal/ScriptableRenderPipelineTypes';
import { createRenderPipelineCapabilities } from '../../../src/render/pipeline/RenderPipelineCapabilities';
import type { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function fixture(backendName: 'webgl2' | 'webgpu', sampleCount: 1 | 4 = 1) {
    const backend =
        backendName === 'webgl2' ? new FakeWebGLRHIBackend() : new FakeWebGPURHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const graph = new RenderGraph();
    const builder = graph.createBuilder();
    const surface = device.createSurface({} as HTMLCanvasElement);
    surface.configure({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage:
            RHITextureUsage.RENDER_ATTACHMENT |
            RHITextureUsage.TEXTURE_BINDING |
            RHITextureUsage.COPY_SRC
    });
    const services = {
        renderer: { clearColor: new Color(0, 0, 0, 1) } as RendererCore,
        getScriptableSurface: () => surface,
        getScriptableSurfaceFramePolicy: () => ({
            sampleCount,
            colorLoadOp: 'clear',
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
            stencilLoadOp: 'clear',
            stencilStoreOp: 'discard'
        }),
        getScriptableMeshProcessor: () => ({ registry }) as MeshDrawProcessor,
        fireScriptableBeforeScene(): void {
            // These declaration tests contain no renderer lists or scene events.
        },
        markScriptableSurfaceRequested(): void {
            // No surface acquisition is needed to inspect its graph views.
        }
    } satisfies Pick<
        ScriptableRenderPipelineServices,
        | 'renderer'
        | 'getScriptableSurface'
        | 'getScriptableSurfaceFramePolicy'
        | 'getScriptableMeshProcessor'
        | 'fireScriptableBeforeScene'
        | 'markScriptableSurfaceRequested'
    >;
    const resources = new ScriptableRenderPipelineResources();
    const targets = new RenderTargetResourceCache(registry);
    const owner = new ScriptableRenderPipelineContextImpl(
        services as unknown as ScriptableRenderPipelineServices,
        resources
    );
    resources.beginFrame(1, registry);
    const arena = new FrameArena();
    const runtimeOwner = {};
    const begin = () =>
        owner.begin(
            new Node(),
            new PerspectiveCamera(),
            null,
            false,
            createRenderPipelineCapabilities(device.capabilities),
            runtimeOwner,
            {
                context: { frameIndex: 1 } as RenderGraphFrameContext,
                graph: builder,
                arena,
                uploads: new RHIUploadBatch(arena)
            }
        );
    const context = begin();
    return {
        builder,
        owner,
        context,
        nextInvocation() {
            owner.end(false);
            return begin();
        },
        compile() {
            return graph.compile(builder, device.capabilities);
        },
        dispose(): void {
            owner.end(false);
            owner.releaseFrameReferences();
            builder.discard();
            resources.endFrame(targets, registry, false);
            graph.destroy();
            registry.destroy();
            backend.destroy();
        }
    };
}

describe.each(['webgl2', 'webgpu'] as const)('scriptable texture-view usages on %s', backend => {
    it.each([
        ['sampled', 'copy-source'],
        ['copy-source', 'sampled']
    ] as const)('aggregates %s then %s on a cached view', (first, second) => {
        const state = fixture(backend);
        try {
            const texture = state.context.graph.createTexture('source', {
                format: 'rgba8unorm',
                extent: { width: 8, height: 8 }
            });
            const view = state.context.graph.createTextureView('source mip', texture);
            const firstHandle = state.owner.resolveTexture(view, first);
            const secondHandle = state.owner.resolveTexture(view, second);
            const attachmentHandle = state.owner.resolveTexture(view, 'attachment');
            const internalView = state.builder.requireTextureAccess(secondHandle);
            if (internalView.kind !== 'texture-view') throw new Error('Expected a graph view');
            const parent = state.builder.requireResource(internalView.texture, 'texture');
            expect(parent.descriptor.usage).toBe(
                RHITextureUsage.TEXTURE_BINDING |
                    RHITextureUsage.COPY_SRC |
                    RHITextureUsage.RENDER_ATTACHMENT
            );
            expect(secondHandle).toBe(firstHandle);
            expect(attachmentHandle).toBe(firstHandle);
        } finally {
            state.dispose();
        }
    });

    it('keeps MSAA attachments distinct from their single-sample resolve views', () => {
        const state = fixture(backend, 4);
        try {
            const texture = state.context.graph.importOutput().color(0);
            const view = state.context.graph.createTextureView('output view', texture);
            const sampled = state.owner.resolveTexture(view, 'sampled');
            const attachment = state.owner.resolveTexture(view, 'attachment');
            const copied = state.owner.resolveTexture(view, 'copy-source');
            expect(copied).toBe(sampled);
            expect(attachment).not.toBe(sampled);
            for (const [handle, expectedSamples] of [
                [sampled, 1],
                [attachment, 4]
            ] as const) {
                const internal = state.builder.requireTextureAccess(handle);
                if (internal.kind !== 'texture-view') throw new Error('Expected a graph view');
                expect(
                    state.builder.requireResource(internal.texture, 'texture').descriptor
                        .sampleCount
                ).toBe(expectedSamples);
            }
        } finally {
            state.dispose();
        }
    });

    it.each([false, true])(
        'preserves initially uninitialized history identity across invocations (writer first: %s)',
        writerFirst => {
            const state = fixture(backend);
            const key = {};
            const descriptor = {
                format: 'rgba8unorm',
                extent: { width: 8, height: 8 },
                usage: ['sampled', 'attachment', 'copy-source']
            } as const;
            try {
                const first = state.context.graph.acquireHistoryTexture(key, descriptor);
                const firstView = state.context.graph.createTextureView(
                    'first view',
                    first.current
                );
                const firstAccess = state.owner.resolveTexture(
                    firstView,
                    writerFirst ? 'attachment' : 'sampled'
                );
                state.builder.addPass(
                    {
                        name: writerFirst ? 'writer' : 'reader',
                        setup(pass): void {
                            if (writerFirst) pass.writeTexture(firstAccess);
                            else {
                                pass.readTexture(firstAccess);
                                pass.markSideEffect();
                            }
                        },
                        execute(): void {
                            // Only compile the access schedule in this fixture.
                        }
                    },
                    undefined
                );
                const secondContext = state.nextInvocation();
                const second = secondContext.graph.acquireHistoryTexture(key, descriptor);
                const secondView = secondContext.graph.createTextureView(
                    'second view',
                    second.current
                );
                const secondAccess = state.owner.resolveTexture(
                    secondView,
                    writerFirst ? 'sampled' : 'attachment'
                );
                const firstInternal = state.builder.requireTextureAccess(firstAccess);
                const secondInternal = state.builder.requireTextureAccess(secondAccess);
                if (
                    firstInternal.kind !== 'texture-view' ||
                    secondInternal.kind !== 'texture-view'
                ) {
                    throw new Error('Expected graph views');
                }
                expect(second.current).not.toBe(first.current);
                expect(secondInternal.texture).toBe(firstInternal.texture);
                expect(
                    state.builder.requireResource(secondInternal.texture, 'texture')
                        .initiallyInitialized
                ).toBe(false);
                state.builder.addPass(
                    {
                        name: writerFirst ? 'reader' : 'writer',
                        setup(pass): void {
                            if (writerFirst) {
                                pass.readTexture(secondAccess);
                                pass.markSideEffect();
                            } else pass.writeTexture(secondAccess);
                        },
                        execute(): void {
                            // Only compile the access schedule in this fixture.
                        }
                    },
                    undefined
                );
                if (writerFirst) {
                    expect(state.compile().passes.map(pass => pass.name)).toEqual([
                        'writer',
                        'reader'
                    ]);
                } else expect(() => state.compile()).toThrow(/before initialization/u);
            } finally {
                state.dispose();
            }
        }
    );
});

it('aggregates storage, copy and resolve usages without allocating duplicate views', () => {
    const state = fixture('webgpu');
    try {
        const texture = state.context.graph.createTexture('storage image', {
            format: 'rgba8unorm',
            extent: { width: 8, height: 8 }
        });
        const view = state.context.graph.createTextureView('storage view', texture);
        const accesses: readonly TextureAccess[] = [
            'storage-write',
            'copy-destination',
            'resolve-target'
        ];
        const handles = accesses.map(access => state.owner.resolveTexture(view, access));
        expect(new Set(handles).size).toBe(1);
        const writable = state.owner.requireTexture(view).writable;
        if (writable === null) throw new Error('Missing writable view');
        const internal = state.builder.requireTextureAccess(writable);
        if (internal.kind !== 'texture-view') throw new Error('Expected a graph view');
        expect(state.builder.requireResource(internal.texture, 'texture').descriptor.usage).toBe(
            RHITextureUsage.STORAGE_BINDING |
                RHITextureUsage.COPY_DST |
                RHITextureUsage.RENDER_ATTACHMENT
        );
    } finally {
        state.dispose();
    }
});
