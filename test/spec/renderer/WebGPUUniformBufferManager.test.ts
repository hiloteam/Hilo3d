import { describe, expect, it, vi } from 'vitest';
import UniformBuffer from '../../../src/render/UniformBuffer';
import BuiltInUniformBlockManager from '../../../src/render/BuiltInUniformBlockManager';
import { createStd140Layout } from '../../../src/render/ubo/Std140Layout';
import { WebGPUUniformBufferManager } from '../../../src/render/internal/webgpu/WebGPUUniformBufferManager';
import { WebGLUniformBufferManager } from '../../../src/render/internal/webgl2/WebGLUniformBufferManager';
import { testEnv } from '../../legacy-setup';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import Material from '../../../src/material/Material';

function createDevice() {
    const writeBuffer = vi.fn();
    const buffers: { readonly destroy: ReturnType<typeof vi.fn> }[] = [];
    const createBuffer = vi.fn(() => {
        const buffer = { destroy: vi.fn() };
        buffers.push(buffer);
        return buffer;
    });
    const device = {
        queue: { writeBuffer },
        limits: { maxUniformBufferBindingSize: 65_536, maxBufferSize: 1_048_576 },
        createBuffer
    } as unknown as GPUDevice;
    return { buffers, createBuffer, device, writeBuffer };
}

describe('WebGPUUniformBufferManager lifecycle', () => {
    it('uploads the exact std140 ABI for arrays, matrices and booleans', () => {
        const { device, writeBuffer } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const layout = createStd140Layout({
            scalars: { type: 'float', arrayLength: 2 },
            pairs: { type: 'ivec2', arrayLength: 2 },
            matrix: 'mat2',
            flags: { type: 'bvec2', arrayLength: 2 }
        });
        const block = UniformBuffer.fromSchema(layout, {
            scalars: [1.5, 2.5],
            pairs: [3, 4, 5, 6],
            matrix: [7, 8, 9, 10],
            flags: [true, false, false, true]
        });

        const binding = manager.getBinding(block);
        const upload = writeBuffer.mock.calls[0] as [GPUBuffer, number, Uint8Array];
        const view = new DataView(upload[2].buffer, upload[2].byteOffset, upload[2].byteLength);

        expect(binding.size).toBe(layout.byteLength);
        expect(upload[2].byteLength).toBe(layout.byteLength);
        expect(view.getFloat32(layout.fields.scalars.offset, true)).toBe(1.5);
        expect(
            view.getFloat32(layout.fields.scalars.offset + layout.fields.scalars.arrayStride, true)
        ).toBe(2.5);
        expect(view.getInt32(layout.fields.pairs.offset + 4, true)).toBe(4);
        expect(
            view.getInt32(layout.fields.pairs.offset + layout.fields.pairs.arrayStride, true)
        ).toBe(5);
        expect(view.getFloat32(layout.fields.matrix.offset, true)).toBe(7);
        expect(
            view.getFloat32(layout.fields.matrix.offset + layout.fields.matrix.matrixStride, true)
        ).toBe(9);
        expect(view.getInt32(layout.fields.flags.offset, true)).toBe(1);
        expect(
            view.getInt32(layout.fields.flags.offset + layout.fields.flags.arrayStride + 4, true)
        ).toBe(1);
    });

    it('releases one logical block and recreates it without retaining destroyed buffers', () => {
        const { buffers, createBuffer, device } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const block = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }), {
            value: [1, 2, 3, 4]
        });

        const first = manager.getBinding(block);
        expect(manager.getBinding(block)).toBe(first);

        manager.release(block);
        manager.release(block);
        expect(buffers[0]?.destroy).toHaveBeenCalledOnce();

        const second = manager.getBinding(block);
        expect(second.buffer).not.toBe(first.buffer);
        expect(createBuffer).toHaveBeenCalledTimes(2);

        manager.destroy();
        expect(buffers[0]?.destroy).toHaveBeenCalledOnce();
        expect(buffers[1]?.destroy).toHaveBeenCalledOnce();
    });

    it('uploads only the aligned changed byte range after the initial allocation', () => {
        const { device, writeBuffer } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const block = UniformBuffer.fromSchema(createStd140Layout({ head: 'vec4', tail: 'vec4' }), {
            head: [1, 2, 3, 4],
            tail: [5, 6, 7, 8]
        });

        manager.getBinding(block);
        expect(writeBuffer).toHaveBeenLastCalledWith(expect.anything(), 0, expect.any(Uint8Array));

        block.set('tail', [5, 6, 70, 8]);
        manager.getBinding(block);
        const update = writeBuffer.mock.calls.at(-1) as [GPUBuffer, number, Uint8Array];
        expect(update[1]).toBe(24);
        expect(update[2].byteLength).toBe(4);

        block.set('tail', [5, 6, 70, 8]);
        manager.getBinding(block);
        expect(writeBuffer).toHaveBeenCalledTimes(2);
    });

    it('snapshots changing revisions within one submission and reuses the pooled slots', () => {
        const { createBuffer, device } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const block = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }), {
            value: [1, 2, 3, 4]
        });

        manager.beginSubmission();
        const first = manager.getBinding(block);
        expect(manager.getBinding(block)).toBe(first);
        block.set('value', [5, 6, 7, 8]);
        const second = manager.getBinding(block);
        expect(second.buffer).not.toBe(first.buffer);
        expect(manager.getBinding(block)).toBe(second);
        manager.endSubmission();

        manager.beginSubmission();
        const reused = manager.getBinding(block);
        manager.endSubmission();
        expect(reused.buffer).toBe(first.buffer);
        expect(createBuffer).toHaveBeenCalledTimes(2);
    });

    it('binds distinct CameraBlock snapshots for multiple cameras in one submission', () => {
        const { device } = createDevice();
        const gpuManager = new WebGPUUniformBufferManager(device);
        const blockManager = new BuiltInUniformBlockManager({ width: 64, height: 64 });
        const mesh = new Mesh({ geometry: new Geometry(), material: new Material() });
        const material = mesh.material;
        if (!material) throw new Error('Mesh material was not created');
        const firstCamera = new PerspectiveCamera({ z: 2 });
        const secondCamera = new PerspectiveCamera({ x: 3, z: 5 });
        firstCamera.updateViewProjectionMatrix();
        secondCamera.updateViewProjectionMatrix();

        gpuManager.beginSubmission();
        blockManager.beginFrame(firstCamera);
        const firstBlock = blockManager.getUniformBlocks(
            ['CameraBlock'],
            mesh,
            material,
            firstCamera
        )['CameraBlock'];
        if (!firstBlock) throw new Error('CameraBlock was not created');
        const firstBinding = gpuManager.getBinding(firstBlock);

        blockManager.beginPass(secondCamera);
        const secondBlock = blockManager.getUniformBlocks(
            ['CameraBlock'],
            mesh,
            material,
            secondCamera
        )['CameraBlock'];
        if (!secondBlock) throw new Error('CameraBlock was not created');
        const secondBinding = gpuManager.getBinding(secondBlock);
        gpuManager.endSubmission();

        expect(secondBlock).not.toBe(firstBlock);
        expect(secondBinding.buffer).not.toBe(firstBinding.buffer);
    });

    it('keeps fast and slow consumers independent and fully refreshes an expired consumer', () => {
        const fast = createDevice();
        const slow = createDevice();
        const fastManager = new WebGPUUniformBufferManager(fast.device);
        const slowManager = new WebGPUUniformBufferManager(slow.device);
        const block = UniformBuffer.fromSchema(createStd140Layout({ head: 'vec4', tail: 'vec4' }));

        fastManager.getBinding(block);
        slowManager.getBinding(block);
        fast.writeBuffer.mockClear();
        slow.writeBuffer.mockClear();
        const slowRevision = block.revision;

        for (let frame = 1; frame <= 70; frame++) {
            block.set('tail', [frame, 0, 0, 0]);
            fastManager.getBinding(block);
        }

        expect(block.getDirtyRangesSince(slowRevision)).toBeNull();
        expect(fast.writeBuffer).toHaveBeenCalledTimes(70);
        expect(fast.writeBuffer).toHaveBeenLastCalledWith(
            expect.anything(),
            16,
            expect.objectContaining({ byteLength: 4 })
        );

        slowManager.getBinding(block);
        expect(slow.writeBuffer).toHaveBeenCalledOnce();
        expect(slow.writeBuffer).toHaveBeenLastCalledWith(
            expect.anything(),
            0,
            expect.objectContaining({ byteLength: 32 })
        );

        block.set('tail', [71, 0, 0, 0]);
        fastManager.getBinding(block);
        slowManager.getBinding(block);
        expect(fast.writeBuffer).toHaveBeenLastCalledWith(
            expect.anything(),
            16,
            expect.objectContaining({ byteLength: 4 })
        );
        expect(slow.writeBuffer).toHaveBeenLastCalledWith(
            expect.anything(),
            16,
            expect.objectContaining({ byteLength: 4 })
        );
    });

    it('does not let WebGL2 consume changes before WebGPU observes them', () => {
        const { device, writeBuffer } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const webGLManager = new WebGLUniformBufferManager(testEnv.gl);
        const block = UniformBuffer.fromSchema(createStd140Layout({ head: 'vec4', tail: 'vec4' }));
        const webGLUpload = vi.spyOn(testEnv.gl, 'bufferSubData');

        webGLManager.getBuffer(block);
        manager.getBinding(block);
        writeBuffer.mockClear();

        block.set('tail', [1, 0, 0, 0]);
        webGLManager.getBuffer(block);
        manager.getBinding(block);
        expect(webGLUpload).toHaveBeenCalledTimes(1);
        expect(writeBuffer).toHaveBeenCalledTimes(1);

        block.set('tail', [2, 0, 0, 0]);
        manager.getBinding(block);
        webGLManager.getBuffer(block);
        expect(webGLUpload).toHaveBeenCalledTimes(2);
        expect(writeBuffer).toHaveBeenCalledTimes(2);
        webGLManager.destroy();
    });

    it('bounds 10k WebGPU-only frame updates while retaining partial uploads', () => {
        const { device, writeBuffer } = createDevice();
        const manager = new WebGPUUniformBufferManager(device);
        const block = UniformBuffer.fromSchema(createStd140Layout({ head: 'vec4', tail: 'vec4' }));

        manager.getBinding(block);
        for (let frame = 1; frame <= 10_000; frame++) {
            block.set('tail', [frame, 0, 0, 0]);
            manager.getBinding(block);
        }

        expect(writeBuffer).toHaveBeenCalledTimes(10_001);
        expect(
            writeBuffer.mock.calls
                .slice(1)
                .every(
                    call =>
                        call[1] === 16 && call[2] instanceof Uint8Array && call[2].byteLength === 4
                )
        ).toBe(true);
        expect(writeBuffer).toHaveBeenLastCalledWith(
            expect.anything(),
            16,
            expect.objectContaining({ byteLength: 4 })
        );
        expect(block.getDirtyRangesSince(0)).toBeNull();
        expect(block.getDirtyRangesSince(block.revision - 64)).toHaveLength(64);
        expect(block.getDirtyRangesSince(block.revision - 1)).toEqual([
            {
                revision: block.revision,
                byteOffset: 16,
                byteLength: 4
            }
        ]);
    });
});
