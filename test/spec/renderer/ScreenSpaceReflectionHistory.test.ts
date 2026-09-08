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

it('keeps confidence independent of fractional and interpolated sample counts on WebGPU', async () => {
    const pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: `
${REFLECTION_HISTORY_WGSL}
@group(0) @binding(0) var<storage, read_write> output: array<vec4<f32>>;
@compute @workgroup_size(1)
fn main() {
    let fractional = packHistoryState(7.75, 0.25);
    let a = vec4<f32>(1.0, 0.0, 0.0, packHistoryState(1.0, 0.25));
    let b = vec4<f32>(0.0, 1.0, 0.0, packHistoryState(4.0, 0.5));
    let c = vec4<f32>(0.0, 0.0, 1.0, packHistoryState(12.0, 0.75));
    let d = vec4<f32>(1.0, 1.0, 1.0, packHistoryState(24.0, 0.0));
    let interpolated = interpolateHistory(a, b, c, d, vec2<f32>(0.5));
    output[0] = vec4<f32>(historySampleCount(fractional), historyConfidence(fractional), historySampleCount(interpolated.a), historyConfidence(interpolated.a));
    output[1] = vec4<f32>(interpolated.rgb, 0.0);
}`,
                workgroupSize: [1],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-buffer',
                        access: 'write-discard',
                        minBindingSize: 32
                    }
                ]
            })
        })
    );
    const runtime: RenderPipeline & { buffer: StorageBuffer | null } = {
        name: 'SSR history encoding regression',
        buffer: null,
        record(context: RenderPipelineContext): void {
            if (this.buffer === null) throw new Error('Missing history output');
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
            byteLength: 32,
            usage: ['storage', 'copy-source']
        });
        renderer.render(new Node(), new PerspectiveCamera());
        const result = await runtime.buffer.read();
        expect([...new Float32Array(result.data.buffer)]).toEqual([
            8, 0.25, 10, 0.375, 0.5, 0.5, 0.5, 0
        ]);
    } finally {
        renderer.destroy();
    }
});
