import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import Program, { type ProgramAttribute } from '../../../src/render/internal/webgl2/Program';
import VertexArrayObject from '../../../src/render/internal/webgl2/VertexArrayObject';
import { testEnv } from '../../setup';

describe('VertexArrayObject', () => {
    it('create', () => {
        const vao = new VertexArrayObject(testEnv.gl, '_hiloTestVaoCreate');
        expect(vao.isVertexArrayObject).toBe(true);
        expect(vao.className).toBe('VertexArrayObject');
    });

    it('cache & destroy', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        expect(VertexArrayObject.getCache(testEnv.gl).get('_hiloTestVao')).toBe(vao);
        expect(vao.destroy()).toBe(vao);
        expect(VertexArrayObject.getCache(testEnv.gl).get('_hiloTestVao')).toBeUndefined();
        expect(vao.getResources()).toEqual([]);
        expect(vao.destroy()).toBe(vao);
    });

    it('getVertexCount', () => {
        const vao = VertexArrayObject.getVao(testEnv.gl, '_hiloTestVao');
        expect(vao.getVertexCount()).toBe(0);
    });

    it('detects backend-local vertex and index revisions without consuming global dirty state', () => {
        const vao = new VertexArrayObject(testEnv.gl, '_hiloRevisionVao');
        const vertices = new Hilo3d.GeometryData(new Float32Array([0, 1, 2, 3]), 2);
        const indices = new Hilo3d.GeometryData(new Uint16Array([0, 1, 2]), 1);
        const attribute = {
            name: 'a_position',
            enable: () => undefined,
            pointer: () => undefined
        } as unknown as ProgramAttribute;
        vao.addAttribute(vertices, attribute, testEnv.gl.DYNAMIC_DRAW);
        vao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        expect(vao.hasPendingGeometryDataUpdates()).toBe(false);

        vertices.setSubData(2, new Float32Array([8, 9]));
        indices.setSubData(1, new Uint16Array([2, 1]));
        expect(vao.hasPendingGeometryDataUpdates()).toBe(true);
        vao.addAttribute(vertices, attribute, testEnv.gl.DYNAMIC_DRAW);
        expect(vao.hasPendingGeometryDataUpdates()).toBe(true);
        vao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        expect(vao.hasPendingGeometryDataUpdates()).toBe(false);
        expect(vertices.isDirty).toBe(true);
        expect(indices.isDirty).toBe(true);
        vao.getResources().forEach(resource => resource.destroy());
        vao.destroy();
    });

    it('tracks shared buffer bindings independently for every VAO', () => {
        const firstVao = new VertexArrayObject(testEnv.gl, '_hiloSharedRevisionVaoFirst');
        const secondVao = new VertexArrayObject(testEnv.gl, '_hiloSharedRevisionVaoSecond');
        const vertices = new Hilo3d.GeometryData(new Float32Array([0, 1, 2, 3]), 2);
        const indices = new Hilo3d.GeometryData(new Uint16Array([0, 1, 2]), 1);
        const firstPointer = vi.fn();
        const secondPointer = vi.fn();
        const firstAttribute = {
            name: 'a_position',
            enable: () => undefined,
            pointer: firstPointer
        } as unknown as ProgramAttribute;
        const secondAttribute = {
            name: 'a_position',
            enable: () => undefined,
            pointer: secondPointer
        } as unknown as ProgramAttribute;

        firstVao.addAttribute(vertices, firstAttribute, testEnv.gl.DYNAMIC_DRAW);
        firstVao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        secondVao.addAttribute(vertices, secondAttribute, testEnv.gl.DYNAMIC_DRAW);
        secondVao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);

        vertices.data = new Float32Array([0, 1, 2, 3, 4, 5]);
        indices.data = new Uint16Array([0, 1, 2, 2, 1, 0]);
        expect(firstVao.hasPendingGeometryDataUpdates()).toBe(true);
        expect(secondVao.hasPendingGeometryDataUpdates()).toBe(true);

        firstVao.addAttribute(vertices, firstAttribute, testEnv.gl.DYNAMIC_DRAW);
        firstVao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        expect(firstVao.hasPendingGeometryDataUpdates()).toBe(false);
        expect(secondVao.hasPendingGeometryDataUpdates()).toBe(true);

        secondVao.addAttribute(vertices, secondAttribute, testEnv.gl.DYNAMIC_DRAW);
        secondVao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        expect(secondVao.hasPendingGeometryDataUpdates()).toBe(false);
        expect(firstVao.getVertexCount()).toBe(6);
        expect(secondVao.getVertexCount()).toBe(6);
        expect(firstPointer).toHaveBeenCalledTimes(2);
        expect(secondPointer).toHaveBeenCalledTimes(2);

        firstVao.getResources().forEach(resource => resource.destroy());
        firstVao.destroy();
        secondVao.destroy();
    });

    it('refreshes VAO attribute shape and removes stale index bindings', () => {
        const vao = new VertexArrayObject(testEnv.gl, '_hiloBindingShapeVao');
        const vertices = new Hilo3d.GeometryData(new Float32Array([0, 1, 2, 3]), 2);
        const indices = new Hilo3d.GeometryData(new Uint16Array([0, 1, 2]), 1);
        const pointer = vi.fn();
        const attribute = {
            name: 'a_position',
            enable: () => undefined,
            pointer
        } as unknown as ProgramAttribute;

        vao.addAttribute(vertices, attribute, testEnv.gl.DYNAMIC_DRAW);
        vao.addIndexBuffer(indices, testEnv.gl.DYNAMIC_DRAW);
        vertices.stride = Float32Array.BYTES_PER_ELEMENT * 2;
        vertices.offset = Float32Array.BYTES_PER_ELEMENT;
        expect(vao.hasPendingGeometryDataUpdates()).toBe(true);
        vao.addAttribute(vertices, attribute, testEnv.gl.DYNAMIC_DRAW);
        expect(pointer).toHaveBeenCalledTimes(2);

        vao.removeIndexBuffer();
        expect(vao.getVertexCount()).toBe(vertices.count);
        vao.getResources().forEach(resource => resource.destroy());
        vao.destroy();
    });

    it('packs every reflected instance shape into legal WebGL2 attribute columns', () => {
        const program = new Program({
            state: testEnv.state,
            vertexShader: `#version 300 es
                in float instanceScalar;
                in vec2 instanceVec2;
                in vec3 instanceVec3;
                in vec4 instanceVec4;
                in mat2 instanceMat2;
                in mat3 instanceMat3;
                in mat4 instanceMat4;
                void main() {
                    float value = instanceScalar + instanceVec2.x + instanceVec3.x +
                        instanceVec4.x + instanceMat2[0][0] + instanceMat3[0][0] +
                        instanceMat4[0][0];
                    gl_Position = vec4(value * 0.000001, 0.0, 0.0, 1.0);
                }`,
            fragShader:
                '#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(1.0);}'
        });
        const vao = new VertexArrayObject(testEnv.gl, '_hiloInstancedAttributeColumns');
        const meshes = [new Hilo3d.Mesh(), new Hilo3d.Mesh()];
        const cases = [
            { name: 'instanceScalar', valueSize: 1, columnSize: 1, stride: 0 },
            { name: 'instanceVec2', valueSize: 2, columnSize: 2, stride: 0 },
            { name: 'instanceVec3', valueSize: 3, columnSize: 3, stride: 0 },
            { name: 'instanceVec4', valueSize: 4, columnSize: 4, stride: 0 },
            { name: 'instanceMat2', valueSize: 4, columnSize: 2, stride: 16 },
            { name: 'instanceMat3', valueSize: 9, columnSize: 3, stride: 36 },
            { name: 'instanceMat4', valueSize: 16, columnSize: 4, stride: 64 }
        ] as const;

        try {
            for (const item of cases) {
                const attribute = program.attributes[item.name];
                expect(attribute, item.name).toBeDefined();
                if (!attribute) continue;
                expect(attribute.glTypeInfo.size).toBe(item.valueSize);
                const values = Float32Array.from(
                    { length: item.valueSize },
                    (_, index) => index + 1
                );
                const result = vao.addInstancedAttribute(attribute, meshes, () => values);
                expect(result.geometryData.size).toBe(item.columnSize);
                expect(result.geometryData.stride).toBe(item.stride);
                expect(result.geometryData.count).toBe(meshes.length);
                expect(Array.from(result.geometryData.data)).toEqual([...values, ...values]);
            }

            const mat3 = program.attributes['instanceMat3'];
            expect(mat3).toBeDefined();
            if (mat3) {
                const updated = Float32Array.from({ length: 9 }, (_, index) => 9 - index);
                const result = vao.addInstancedAttribute(mat3, meshes, () => updated);
                expect(result.geometryData.size).toBe(3);
                expect(result.geometryData.stride).toBe(36);
                expect(result.geometryData.count).toBe(meshes.length);
                expect(Array.from(result.geometryData.data)).toEqual([...updated, ...updated]);
            }
        } finally {
            vao.getResources().forEach(resource => resource.destroy());
            vao.destroy();
            program.destroy();
        }
    });
});
