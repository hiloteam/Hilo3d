import { describe, expect, it, vi } from 'vitest';
import UniformBuffer from '../../../src/renderer/UniformBuffer';
import { createStd140Layout, Std140Layout } from '../../../src/renderer/ubo/Std140Layout';
import {
    getUniformBlockBinding,
    registerUniformBlockBinding,
    UNIFORM_BLOCK_BINDINGS
} from '../../../src/renderer/ubo/UniformBlockBindings';
import { testEnv } from '../../setup';

describe('Std140Layout', () => {
    it('calculates scalar, vector, matrix and array layout using std140 rules', () => {
        const layout = createStd140Layout({
            scalar: 'float',
            vector: 'vec3',
            tail: 'float',
            matrix: 'mat3',
            samples: { type: 'vec2', arrayLength: 2 }
        });

        expect(layout.fields.scalar.offset).toBe(0);
        expect(layout.fields.vector.offset).toBe(16);
        expect(layout.fields.tail.offset).toBe(28);
        expect(layout.fields.matrix.offset).toBe(32);
        expect(layout.fields.matrix.matrixStride).toBe(16);
        expect(layout.fields.samples.offset).toBe(80);
        expect(layout.fields.samples.arrayStride).toBe(16);
        expect(layout.byteLength).toBe(112);
    });

    it('packs column-major matrices, arrays and typed scalar values', () => {
        const layout = new Std140Layout({
            transform: 'mat2',
            enabled: 'bool',
            ids: { type: 'uvec2', arrayLength: 2 }
        });
        const buffer = layout.createBuffer({
            transform: [1, 2, 3, 4],
            enabled: true,
            ids: [5, 6, 7, 8]
        });
        const view = new DataView(buffer);

        expect(view.getFloat32(0, true)).toBe(1);
        expect(view.getFloat32(4, true)).toBe(2);
        expect(view.getFloat32(16, true)).toBe(3);
        expect(view.getFloat32(20, true)).toBe(4);
        expect(view.getInt32(32, true)).toBe(1);
        expect(view.getUint32(48, true)).toBe(5);
        expect(view.getUint32(52, true)).toBe(6);
        expect(view.getUint32(64, true)).toBe(7);
        expect(view.getUint32(68, true)).toBe(8);
    });

    it('updates typed UniformBuffer fields and validates ranges', () => {
        const layout = createStd140Layout({ color: 'vec4', opacity: 'float' });
        const buffer = UniformBuffer.fromSchema(layout, { color: [1, 0, 0, 1] });

        buffer.set('opacity', 0.5);
        expect(new Float32Array(buffer.data as ArrayBuffer)[4]).toBe(0.5);
        expect(buffer.range(0, 16)).toEqual({
            uniformBuffer: buffer,
            byteOffset: 0,
            byteLength: 16
        });
        expect(() => buffer.range(1, buffer.byteLength)).toThrow(RangeError);
    });

    it('uses bufferSubData for dirty bytes and supports range binding', () => {
        const layout = createStd140Layout({ color: 'vec4', opacity: 'float' });
        const buffer = UniformBuffer.fromSchema(layout);
        buffer.getBuffer(testEnv.gl);
        const subData = vi.spyOn(testEnv.gl, 'bufferSubData');
        const bindRange = vi.spyOn(testEnv.gl, 'bindBufferRange');

        buffer.set('opacity', 0.75);
        buffer.getBuffer(testEnv.gl);
        expect(subData).toHaveBeenCalledOnce();
        expect(subData.mock.calls[0]?.[1]).toBe(16);
        buffer.getBuffer(testEnv.gl);
        expect(subData).toHaveBeenCalledOnce();

        const range = buffer.range(0, 16);
        buffer.bind(testEnv.gl, 7, range);
        expect(bindRange).toHaveBeenCalledWith(
            testEnv.gl.UNIFORM_BUFFER,
            7,
            expect.anything(),
            0,
            16
        );
        buffer.destroy(testEnv.gl);
    });

    it('keeps independent GPU allocations for each WebGL2 context', () => {
        const secondContext = document.createElement('canvas').getContext('webgl2');
        expect(secondContext).not.toBeNull();
        if (!secondContext) return;
        const layout = createStd140Layout({ value: 'float' });
        const buffer = UniformBuffer.fromSchema(layout, { value: 1 });
        const firstAllocation = buffer.getBuffer(testEnv.gl);
        const secondAllocation = buffer.getBuffer(secondContext);

        expect(secondAllocation).not.toBe(firstAllocation);
        buffer.destroy(testEnv.gl);
        expect(buffer.getBuffer(testEnv.gl)).not.toBe(firstAllocation);
        expect(buffer.getBuffer(secondContext)).toBe(secondAllocation);
        buffer.destroy();
    });

    it('fully refreshes an expired WebGL2 consumer and resumes partial uploads', () => {
        const secondContext = document.createElement('canvas').getContext('webgl2');
        expect(secondContext).not.toBeNull();
        if (!secondContext) return;
        const buffer = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }));

        buffer.getBuffer(testEnv.gl);
        buffer.getBuffer(secondContext);
        const fastPartialUpload = vi.spyOn(testEnv.gl, 'bufferSubData');
        const slowFullUpload = vi.spyOn(secondContext, 'bufferData');
        const slowPartialUpload = vi.spyOn(secondContext, 'bufferSubData');
        const slowRevision = buffer.revision;

        for (let frame = 1; frame <= 70; frame++) {
            buffer.set('value', [frame, 0, 0, 0]);
            buffer.getBuffer(testEnv.gl);
        }

        expect(buffer.getDirtyRangesSince(slowRevision)).toBeNull();
        expect(fastPartialUpload).toHaveBeenCalledTimes(70);
        buffer.getBuffer(secondContext);
        expect(slowFullUpload).toHaveBeenCalledOnce();
        expect(slowPartialUpload).not.toHaveBeenCalled();

        buffer.set('value', [71, 0, 0, 0]);
        buffer.getBuffer(testEnv.gl);
        buffer.getBuffer(secondContext);
        expect(fastPartialUpload).toHaveBeenCalledTimes(71);
        expect(slowFullUpload).toHaveBeenCalledOnce();
        expect(slowPartialUpload).toHaveBeenCalledOnce();
        expect(() => buffer.getDirtyRangesSince(-1)).toThrow(RangeError);
        expect(() => buffer.getDirtyRangesSince(buffer.revision + 1)).toThrow(RangeError);
        buffer.destroy();
    });

    it('validates typed values and prevents replacing layout storage with a short buffer', () => {
        const layout = createStd140Layout({ count: 'uint', vector: 'vec2' });
        const buffer = UniformBuffer.fromSchema(layout);

        expect(() => buffer.set('count', -1)).toThrow(/unsigned/);
        expect(() => buffer.set('vector', [1, Number.NaN])).toThrow(/finite/);
        expect(() => {
            buffer.data = new ArrayBuffer(4);
        }).toThrow(/layout requires/);
    });
});

describe('uniform block binding ABI', () => {
    it('keeps built-in binding points stable and allocates explicit custom bindings', () => {
        expect(UNIFORM_BLOCK_BINDINGS.FrameBlock).toBe(0);
        expect(UNIFORM_BLOCK_BINDINGS.ModelBlock).toBe(5);
        expect(UNIFORM_BLOCK_BINDINGS.GeometryBlock).toBe(6);
        expect(UNIFORM_BLOCK_BINDINGS.MorphBlock).toBe(8);
        expect(registerUniformBlockBinding('TestCustomBlock')).toBeGreaterThanOrEqual(9);
        expect(getUniformBlockBinding('TestCustomBlock')).toBe(
            registerUniformBlockBinding('TestCustomBlock')
        );
        expect(() => getUniformBlockBinding('UnregisteredTestBlock')).toThrow(
            /no fixed binding point/
        );
    });
});
