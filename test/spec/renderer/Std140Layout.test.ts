import { describe, expect, it, vi } from 'vitest';
import UniformBuffer from '../../../src/render/UniformBuffer';
import { WebGLUniformBufferManager } from '../../../src/render/internal/webgl2/WebGLUniformBufferManager';
import { createStd140Layout, Std140Layout } from '../../../src/render/ubo/Std140Layout';
import {
    getUniformBlockBinding,
    registerUniformBlockBinding,
    UNIFORM_BLOCK_BINDINGS
} from '../../../src/render/ubo/UniformBlockBindings';
import { testEnv } from '../../legacy-setup';

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
        expect(new Float32Array(buffer.data)[4]).toBe(0.5);
        const stableRevision = buffer.revision;
        buffer.set('opacity', 0.5);
        expect(buffer.revision).toBe(stableRevision);
        expect(buffer.range(0, 16)).toEqual({
            uniformBuffer: buffer,
            byteOffset: 0,
            byteLength: 16
        });
        expect(() => buffer.range(1, buffer.byteLength)).toThrow(RangeError);
    });

    it('supports a caller-owned write result for allocation-free stable field updates', () => {
        const layout = createStd140Layout({ color: 'vec4', opacity: 'float' });
        const target = layout.createBuffer();
        const result = { byteOffset: -1, byteLength: -1 };

        expect(layout.writeInto(target, 'opacity', 0.5, result)).toBe(result);
        expect(result).toEqual({ byteOffset: 16, byteLength: 4 });
        expect(layout.writeInto(target, 'opacity', 0.5, result)).toBe(result);
        expect(result).toEqual({ byteOffset: 16, byteLength: 0 });
        expect(layout.writeInto(target, 'color', [1, 0, 0, 1], result)).toBe(result);
        expect(result).toEqual({ byteOffset: 0, byteLength: 16 });
    });

    it('uses bufferSubData for dirty bytes and supports range binding', () => {
        const layout = createStd140Layout({ color: 'vec4', opacity: 'float' });
        const buffer = UniformBuffer.fromSchema(layout);
        const manager = new WebGLUniformBufferManager(testEnv.gl);
        manager.getBuffer(buffer);
        const subData = vi.spyOn(testEnv.gl, 'bufferSubData');
        const bindRange = vi.spyOn(testEnv.gl, 'bindBufferRange');

        buffer.set('opacity', 0.75);
        manager.getBuffer(buffer);
        expect(subData).toHaveBeenCalledOnce();
        expect(subData.mock.calls[0]?.[1]).toBe(16);
        manager.getBuffer(buffer);
        expect(subData).toHaveBeenCalledOnce();

        const range = buffer.range(0, 16);
        manager.bind(buffer, 7, range);
        expect(bindRange).toHaveBeenCalledWith(
            testEnv.gl.UNIFORM_BUFFER,
            7,
            expect.anything(),
            0,
            16
        );
        manager.destroy();
    });

    it('merges retained dirty writes into caller-owned span storage', () => {
        const buffer = UniformBuffer.fromSchema(
            createStd140Layout({ first: 'vec4', second: 'vec4', third: 'vec4' })
        );
        const baseline = buffer.revision;
        const span = { byteOffset: -1, byteLength: -1 };

        buffer.set('first', [1, 0, 0, 0]);
        buffer.set('third', [0, 0, 0, 1]);
        expect(buffer.getDirtySpanSince(baseline, span)).toBe(true);
        expect(span).toEqual({ byteOffset: 0, byteLength: 48 });
        expect(buffer.getDirtySpanSince(buffer.revision, span)).toBe(true);
        expect(span).toEqual({ byteOffset: 0, byteLength: 0 });
    });

    it('keeps independent GPU allocations for each WebGL2 context', () => {
        const secondContext = document.createElement('canvas').getContext('webgl2');
        expect(secondContext).not.toBeNull();
        if (!secondContext) return;
        const layout = createStd140Layout({ value: 'float' });
        const buffer = UniformBuffer.fromSchema(layout, { value: 1 });
        const firstManager = new WebGLUniformBufferManager(testEnv.gl);
        const secondManager = new WebGLUniformBufferManager(secondContext);
        const firstAllocation = firstManager.getBuffer(buffer);
        const secondAllocation = secondManager.getBuffer(buffer);

        expect(secondAllocation).not.toBe(firstAllocation);
        firstManager.release(buffer);
        expect(firstManager.getBuffer(buffer)).not.toBe(firstAllocation);
        expect(secondManager.getBuffer(buffer)).toBe(secondAllocation);
        firstManager.destroy();
        secondManager.destroy();
    });

    it('fully refreshes an expired WebGL2 consumer and resumes partial uploads', () => {
        const secondContext = document.createElement('canvas').getContext('webgl2');
        expect(secondContext).not.toBeNull();
        if (!secondContext) return;
        const buffer = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }));
        const fastManager = new WebGLUniformBufferManager(testEnv.gl);
        const slowManager = new WebGLUniformBufferManager(secondContext);

        fastManager.getBuffer(buffer);
        slowManager.getBuffer(buffer);
        const fastPartialUpload = vi.spyOn(testEnv.gl, 'bufferSubData');
        const slowFullUpload = vi.spyOn(secondContext, 'bufferData');
        const slowPartialUpload = vi.spyOn(secondContext, 'bufferSubData');
        const slowRevision = buffer.revision;

        for (let frame = 1; frame <= 70; frame++) {
            buffer.set('value', [frame, 0, 0, 0]);
            fastManager.getBuffer(buffer);
        }

        expect(buffer.getDirtyRangesSince(slowRevision)).toBeNull();
        expect(fastPartialUpload).toHaveBeenCalledTimes(70);
        slowManager.getBuffer(buffer);
        expect(slowFullUpload).toHaveBeenCalledOnce();
        expect(slowPartialUpload).not.toHaveBeenCalled();

        buffer.set('value', [71, 0, 0, 0]);
        fastManager.getBuffer(buffer);
        slowManager.getBuffer(buffer);
        expect(fastPartialUpload).toHaveBeenCalledTimes(71);
        expect(slowFullUpload).toHaveBeenCalledOnce();
        expect(slowPartialUpload).toHaveBeenCalledOnce();
        expect(() => buffer.getDirtyRangesSince(-1)).toThrow(RangeError);
        expect(() => buffer.getDirtyRangesSince(buffer.revision + 1)).toThrow(RangeError);
        fastManager.destroy();
        slowManager.destroy();
    });

    it('validates typed values and prevents replacing layout storage with a short buffer', () => {
        const layout = createStd140Layout({ count: 'uint', vector: 'vec2' });
        const buffer = UniformBuffer.fromSchema(layout);

        expect(() => buffer.set('count', -1)).toThrow(/unsigned/);
        expect(() => buffer.set('vector', [1, Number.NaN])).toThrow(/finite/);
        expect(() => {
            buffer.data = new ArrayBuffer(4);
        }).toThrow(/layout requires/);
        expect(() => {
            buffer.data = new Float32Array(layout.byteLength / 4) as unknown as ArrayBuffer;
        }).toThrow(/must be an ArrayBuffer/);
    });

    it('requires a std140 schema at construction and allocates its exact layout size', () => {
        const layout = createStd140Layout({ value: 'vec4' });
        const buffer = new UniformBuffer(layout, { value: [1, 2, 3, 4] });

        expect(buffer.layout).toBe(layout);
        expect(buffer.data).toBeInstanceOf(ArrayBuffer);
        expect(buffer.byteLength).toBe(layout.byteLength);
        expect(Array.from(new Float32Array(buffer.data))).toEqual([1, 2, 3, 4]);
        expect(() => {
            new UniformBuffer(new Float32Array(4) as unknown as Std140Layout);
        }).toThrow(/requires a Std140Layout schema/);
    });

    it('rejects nested structures that the public flat schema cannot express portably', () => {
        expect(() => {
            new Std140Layout({
                nested: { fields: { value: 'vec4' } }
            } as unknown as { nested: 'vec4' });
        }).toThrow(/nested structs are not part of the portable schema/);
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
