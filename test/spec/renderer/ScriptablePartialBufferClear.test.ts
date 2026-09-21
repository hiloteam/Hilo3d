import { expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import type {
    RenderPipeline,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphBufferHandle,
    ScriptableRenderPass
} from '../../../src/render/pipeline/ScriptableRenderGraph';

interface BufferPair {
    readonly source: RenderGraphBufferHandle;
    readonly destination: RenderGraphBufferHandle;
}

it('preserves preceding copied bytes through public partial clears and coalesces mixed clear declarations', async () => {
    const events: string[] = [];
    let mode: 'partial' | 'full-first' | 'full-last' | 'transient-full-first' = 'partial';
    let output: StorageBuffer | null = null;
    const initialize: ScriptableRenderPass<BufferPair> = {
        name: 'copy complete initialization',
        setup(builder, parameters): void {
            builder.copyBuffer(parameters.source, parameters.destination);
        },
        execute(context, parameters): void {
            events.push('initialize');
            context.commands.copyBuffer(parameters.source, parameters.destination);
        }
    };
    const unusedReader: ScriptableRenderPass<BufferPair> = {
        name: 'unused buffer reader',
        setup(builder, parameters): void {
            builder.readBuffer(parameters.destination, 'storage');
        },
        execute(): void {
            events.push('unused reader');
        }
    };
    const clear: ScriptableRenderPass<BufferPair> = {
        name: 'partial or mixed buffer clears',
        setup(builder, parameters): void {
            if (mode === 'full-first' || mode === 'transient-full-first') {
                builder.clearBuffer(parameters.destination);
            }
            builder.clearBuffer(parameters.destination, 4, 4);
            builder.clearBuffer(parameters.destination, 12, 4);
            if (mode === 'full-last') builder.clearBuffer(parameters.destination);
        },
        execute(context, parameters): void {
            events.push('clear');
            if (mode === 'full-first' || mode === 'transient-full-first') {
                context.commands.clearBuffer(parameters.destination);
            }
            context.commands.clearBuffer(parameters.destination, 4, 4);
            context.commands.clearBuffer(parameters.destination, 12, 4);
            if (mode === 'full-last') context.commands.clearBuffer(parameters.destination);
        }
    };
    const factory: RenderPipelineFactory = {
        name: 'public partial buffer clear',
        requirements: { requiredCapabilities: ['storage-buffer'] },
        create(context): RenderPipeline {
            const source = context.createStorageBuffer({
                label: 'copy source',
                byteLength: 16,
                usage: ['storage', 'copy-source'],
                initialData: new Uint32Array([11, 22, 33, 44])
            });
            const destination = context.createStorageBuffer({
                label: 'partially cleared destination',
                byteLength: 16,
                usage: ['storage', 'copy-source', 'copy-destination'],
                initialData: new Uint32Array([91, 92, 93, 94])
            });
            output = destination;
            return {
                name: 'public partial buffer clear',
                record(frame): void {
                    if (mode === 'transient-full-first') {
                        const transient = frame.graph.createBuffer('fresh transient clear', {
                            byteLength: 16
                        });
                        frame.graph.addPass(clear, { source: transient, destination: transient });
                        frame.graph.addPass(initialize, {
                            source: transient,
                            destination: frame.graph.importStorageBuffer(destination)
                        });
                        return;
                    }
                    const parameters = {
                        source: frame.graph.importStorageBuffer(source),
                        destination: frame.graph.importStorageBuffer(destination)
                    };
                    frame.graph.addPass(initialize, parameters);
                    frame.graph.addPass(unusedReader, parameters);
                    frame.graph.addPass(clear, parameters);
                },
                destroy(): void {
                    source.destroy();
                    destination.destroy();
                }
            };
        }
    };
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: document.createElement('canvas'),
        width: 4,
        height: 4,
        antialias: false,
        renderPipeline: factory
    });
    try {
        // The factory callback initializes this renderer-owned identity before create resolves.
        const destination = output as StorageBuffer | null;
        if (destination === null) throw new Error('Expected renderer-owned clear destination');
        const scene = new Node();
        const camera = new PerspectiveCamera();
        const readWords = async (): Promise<number[]> => {
            const { data } = await destination.read();
            return Array.from(new Uint32Array(data.buffer, data.byteOffset, 4));
        };

        renderer.render(scene, camera);
        expect(await readWords()).toEqual([11, 0, 33, 0]);
        expect(events).toEqual(['initialize', 'clear']);

        events.length = 0;
        mode = 'full-first';
        renderer.render(scene, camera);
        expect(await readWords()).toEqual([0, 0, 0, 0]);
        expect(events).toEqual(['clear']);

        events.length = 0;
        mode = 'full-last';
        renderer.render(scene, camera);
        expect(await readWords()).toEqual([0, 0, 0, 0]);
        expect(events).toEqual(['initialize', 'clear']);

        events.length = 0;
        mode = 'transient-full-first';
        renderer.render(scene, camera);
        expect(await readWords()).toEqual([0, 0, 0, 0]);
        expect(events).toEqual(['clear', 'initialize']);
    } finally {
        renderer.destroy();
    }
});
