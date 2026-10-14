import ComputeShader from '../../compute/ComputeShader';
import ComputeKernel from '../../compute/ComputeKernel';
import { ComputeRenderPass } from '../passes/ComputeRenderPass';
import { FRAME_RECORD_BYTES } from './clusteredLayout';

/** @internal Copy the existing frame ABI, replacing only its jittered raster view-projection. */
export const STABLE_CLUSTERED_FRAME_PASS = new ComputeRenderPass(
    new ComputeKernel({
        shader: new ComputeShader({
            label: 'Stable transparent clustered frame',
            source: `
struct Frame { values: array<vec4<f32>> };
@group(0) @binding(0) var<storage, read> source: Frame;
@group(0) @binding(1) var<storage, read_write> destination: Frame;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= ${String(FRAME_RECORD_BYTES / 16)}u) { return; }
    if (id.x < 4u) {
        let projection = mat4x4<f32>(source.values[12], source.values[13], source.values[14], source.values[15]);
        let view = mat4x4<f32>(source.values[8], source.values[9], source.values[10], source.values[11]);
        destination.values[id.x] = (projection * view)[id.x];
    } else { destination.values[id.x] = source.values[id.x]; }
}`,
            workgroupSize: [64],
            bindings: [
                {
                    name: 'source',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: FRAME_RECORD_BYTES
                },
                {
                    name: 'destination',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'write-discard',
                    minBindingSize: FRAME_RECORD_BYTES
                }
            ]
        })
    })
);
