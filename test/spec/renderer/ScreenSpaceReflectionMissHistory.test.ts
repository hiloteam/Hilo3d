import { expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import { ComputeRenderPass } from '../../../src/render/pipeline/passes';
import type {
    RenderPipeline,
    RenderPipelineContext
} from '../../../src/render/pipeline/RenderPipeline';
import { REFLECTION_HISTORY_WGSL } from '../../../src/render/postprocessing/ScreenSpaceReflectionHistory';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';

it('rejects unsupported and moving SSR misses while retaining jitter-safe history on WebGPU', async () => {
    const byteLength = 80;
    const pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: `
${REFLECTION_HISTORY_WGSL}
@group(0) @binding(0) var<storage, read_write> output: array<vec4<f32>>;
@compute @workgroup_size(1)
fn main() {
    output[0] = vec4<f32>(
        reflectionMissHistoryWeight(0.0, false, 0.95, 1.0),
        reflectionMissHistoryWeight(0.0, true, 0.0, 1.0),
        reflectionMissHistoryWeight(0.0, true, 0.95, 0.0),
        reflectionMissHistoryWeight(8.0, true, 0.95, 1.0)
    );
    output[1] = vec4<f32>(
        reflectionMissHistoryWeight(0.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(1.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(2.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(5.0, true, 0.95, 1.0)
    );
    output[2] = vec4<f32>(
        reflectionMissHistoryWeight(9.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(64.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(0.0, true, 0.95, -1.0),
        reflectionMissHistoryWeight(5.0, false, 0.95, 1.0)
    );
    output[3] = vec4<f32>(
        reflectionMissHistoryWeight(0.0, true, 0.25, 1.0),
        reflectionMissHistoryWeight(0.0, true, 0.95, 0.5),
        reflectionMissHistoryWeight(0.0, true, 0.95, 2.0),
        reflectionMissHistoryWeight(5.0, true, 0.25, 0.5)
    );
    output[4] = vec4<f32>(
        reflectionMissHistoryWeight(3.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(4.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(6.0, true, 0.95, 1.0),
        reflectionMissHistoryWeight(7.0, true, 0.95, 1.0)
    );
}`,
                workgroupSize: [1],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-buffer',
                        access: 'write-discard',
                        minBindingSize: byteLength
                    }
                ]
            })
        })
    );
    const runtime: RenderPipeline & { buffer: StorageBuffer | null } = {
        name: 'SSR missed-hit history regression',
        buffer: null,
        record(context: RenderPipelineContext): void {
            if (this.buffer === null) throw new Error('Missing miss-history output');
            context.graph.addPass(pass, {
                buffers: [{ buffer: context.graph.importStorageBuffer(this.buffer) }],
                textures: [],
                dispatch: { x: 1 }
            });
        },
        destroy(): void {
            this.buffer?.destroy();
        }
    };
    const renderer = await Renderer.create({
        backend: 'webgpu',
        width: 4,
        height: 4,
        antialias: false,
        domElement: document.createElement('canvas'),
        renderPipeline: { name: runtime.name, create: (): RenderPipeline => runtime }
    });
    try {
        runtime.buffer = renderer.createStorageBuffer({
            byteLength,
            usage: ['storage', 'copy-source']
        });
        renderer.render(new Node(), new PerspectiveCamera());
        const result = await runtime.buffer.read();
        const weights = new Float32Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength / Float32Array.BYTES_PER_ELEMENT
        );

        // Unsupported pixels, disabled history, and fast motion must leave no residual energy.
        expect([...weights.slice(0, 4)]).toEqual([0, 0, 0, 0]);
        expect([...weights.slice(8, 12)]).toEqual([0, 0, 0, 0]);

        // Subpixel temporal jitter does not shorten a supported stationary reflection's life.
        for (const weight of weights.slice(4, 7)) expect(weight).toBeCloseTo(0.82, 6);
        expect(weights[7]).toBeCloseTo(0.41, 6);

        // Honor the public history limit and reject discontinuous surfaces before reuse.
        const expectedLimits = [0.25, 0.41, 0.82, 0.0625];
        for (const [index, expected] of expectedLimits.entries()) {
            expect(weights[12 + index]).toBeCloseTo(expected, 6);
        }

        // Motion between the retention and rejection thresholds fades smoothly, without steps.
        const expectedFade = [0.75925926, 0.60740741, 0.21259259, 0.06074074];
        for (const [index, expected] of expectedFade.entries()) {
            expect(weights[16 + index]).toBeCloseTo(expected, 6);
        }
    } finally {
        renderer.destroy();
    }
});
