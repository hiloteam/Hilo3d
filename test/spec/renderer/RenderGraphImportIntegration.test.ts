import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import type { RenderPipeline } from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    ScriptableRenderPass
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { TextureCopyPass } from '../../../src/render/pipeline/passes/TextureCopyPass';

const clearHistory: ScriptableRenderPass<RenderGraphTextureHandle> = {
    name: 'initialize shared history',
    setup(builder, texture): void {
        builder.useColorAttachment({
            texture,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 1, b: 0, a: 1 }
        });
    },
    execute(): void {
        // The attachment declaration clears the image.
    }
};

describe.each(['webgl2', 'webgpu'] as const)('graph import identity on %s', backend => {
    it('connects history writes and reads across invocation-local public handles', async () => {
        const key = {};
        const copy = new TextureCopyPass();
        const handles: RenderGraphTextureHandle[] = [];
        const historyValidity: boolean[] = [];
        let invocation = 0;
        const pipeline: RenderPipeline = {
            name: 'shared history across invocations',
            record(context): void {
                const history = context.graph.acquireHistoryTexture(key, {
                    format: 'rgba8unorm',
                    extent: { width: 4, height: 4 },
                    usage: ['sampled', 'attachment', 'copy-source']
                });
                handles.push(history.current);
                historyValidity.push(history.valid);
                if (invocation++ % 2 === 0) {
                    context.graph.addPass(clearHistory, history.current);
                } else {
                    context.graph.addPass(copy, {
                        source: history.current,
                        destination: context.graph.importOutput().color(0)
                    });
                }
            },
            destroy(): void {
                // The renderer owns the shared history.
            }
        };
        const renderer = await Renderer.create({
            backend,
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: { name: pipeline.name, create: () => pipeline }
        });
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        const scene = new Node();
        const camera = new PerspectiveCamera();
        try {
            for (let frameIndex = 0; frameIndex < 2; frameIndex++) {
                renderer.renderFrame(frame => {
                    frame.renderToTarget(target, scene, camera);
                    frame.renderToTarget(target, scene, camera);
                });
                expect(Array.from((await target.readColorAttachment()).data.slice(0, 4))).toEqual([
                    0, 255, 0, 255
                ]);
            }
            expect(new Set(handles).size).toBe(4);
            expect(historyValidity).toEqual([false, false, true, true]);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });
});

interface BufferCopyParameters {
    readonly source: RenderGraphBufferHandle;
    readonly destination: RenderGraphBufferHandle;
}

it('connects persistent buffer initialization across pipeline invocations on WebGPU', async () => {
    const copy: ScriptableRenderPass<BufferCopyParameters> = {
        name: 'copy shared storage',
        setup(builder, parameters): void {
            builder.copyBuffer(parameters.source, parameters.destination);
        },
        execute(context, parameters): void {
            context.commands.copyBuffer(parameters.source, parameters.destination);
        }
    };
    let output: StorageBuffer | null = null;
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: document.createElement('canvas'),
        width: 4,
        height: 4,
        antialias: false,
        renderPipeline: {
            name: 'shared storage across invocations',
            requirements: { requiredCapabilities: ['storage-buffer'] },
            create(context): RenderPipeline {
                const source = context.createStorageBuffer({
                    byteLength: 16,
                    usage: ['storage', 'copy-source'],
                    initialData: new Uint32Array([11, 22, 33, 44])
                });
                const shared = context.createStorageBuffer({
                    byteLength: 16,
                    usage: ['storage', 'copy-source', 'copy-destination']
                });
                const destination = context.createStorageBuffer({
                    byteLength: 16,
                    usage: ['storage', 'copy-source', 'copy-destination']
                });
                output = destination;
                let invocation = 0;
                return {
                    name: 'shared storage across invocations',
                    record(frame): void {
                        const initialize = invocation++ % 2 === 0;
                        frame.graph.addPass(copy, {
                            source: frame.graph.importStorageBuffer(initialize ? source : shared),
                            destination: frame.graph.importStorageBuffer(
                                initialize ? shared : destination
                            )
                        });
                    },
                    destroy(): void {
                        source.destroy();
                        shared.destroy();
                        destination.destroy();
                    }
                };
            }
        }
    });
    try {
        const destination = output as StorageBuffer | null;
        if (destination === null) throw new Error('Missing shared storage output');
        const scene = new Node();
        const camera = new PerspectiveCamera();
        renderer.renderFrame(frame => {
            frame.render(scene, camera);
            frame.render(scene, camera);
        });
        const { data } = await destination.read();
        expect(Array.from(new Uint32Array(data.buffer, data.byteOffset, 4))).toEqual([
            11, 22, 33, 44
        ]);
    } finally {
        renderer.destroy();
    }
});
