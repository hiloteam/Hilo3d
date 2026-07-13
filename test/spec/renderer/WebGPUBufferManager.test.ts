import { describe, expect, it } from 'vitest';
import GeometryData from '../../../src/geometry/GeometryData';
import type { WebGPUVertexInput } from '../../../src/shader/GlslToWgsl';
import {
    WebGPUBufferManager,
    type WebGPUIndexBufferBinding,
    type WebGPUVertexBufferBinding
} from '../../../src/renderer/webgpu/WebGPUBufferManager';

interface FakeBufferRecord {
    readonly buffer: GPUBuffer;
    readonly descriptor: GPUBufferDescriptor;
    readonly storage: ArrayBuffer;
    destroyCount: number;
    unmapCount: number;
}

interface FakeWrite {
    readonly buffer: GPUBuffer;
    readonly bufferOffset: number;
    readonly bytes: Uint8Array;
}

interface FakeGPU {
    readonly device: GPUDevice;
    readonly records: FakeBufferRecord[];
    readonly writes: FakeWrite[];
    record(buffer: GPUBuffer): FakeBufferRecord;
}

function fakeGPU(): FakeGPU {
    const records: FakeBufferRecord[] = [];
    const writes: FakeWrite[] = [];
    const findRecord = (buffer: GPUBuffer): FakeBufferRecord => {
        const record = records.find(candidate => candidate.buffer === buffer);
        if (!record) throw new Error('Unknown fake GPU buffer');
        return record;
    };
    const device = {
        limits: {
            maxVertexAttributes: 16,
            maxVertexBufferArrayStride: 2048,
            maxBufferSize: 256 * 1024 * 1024
        },
        queue: {
            writeBuffer: (
                buffer: GPUBuffer,
                bufferOffset: number,
                data: ArrayBuffer,
                dataOffset = 0,
                size = data.byteLength - dataOffset
            ) => {
                const record = findRecord(buffer);
                if (bufferOffset % 4 !== 0) {
                    throw new RangeError(
                        'GPUQueue.writeBuffer bufferOffset must be 4-byte aligned'
                    );
                }
                if (size % 4 !== 0) {
                    throw new RangeError('GPUQueue.writeBuffer size must be 4-byte aligned');
                }
                if (dataOffset < 0 || size < 0 || dataOffset + size > data.byteLength) {
                    throw new RangeError('GPUQueue.writeBuffer source range is invalid');
                }
                if (bufferOffset + size > record.storage.byteLength) {
                    throw new RangeError('GPUQueue.writeBuffer destination range is invalid');
                }
                const bytes = new Uint8Array(data, dataOffset, size).slice();
                new Uint8Array(record.storage).set(bytes, bufferOffset);
                writes.push({ buffer, bufferOffset, bytes });
            }
        },
        createBuffer: (descriptor: GPUBufferDescriptor) => {
            const storage = new ArrayBuffer(descriptor.size);
            const lifecycle = { destroyCount: 0, unmapCount: 0 };
            const buffer = {
                getMappedRange: () => storage,
                unmap: () => {
                    lifecycle.unmapCount++;
                },
                destroy: () => {
                    lifecycle.destroyCount++;
                }
            } as unknown as GPUBuffer;
            const record: FakeBufferRecord = {
                buffer,
                descriptor,
                storage,
                get destroyCount() {
                    return lifecycle.destroyCount;
                },
                set destroyCount(value: number) {
                    lifecycle.destroyCount = value;
                },
                get unmapCount() {
                    return lifecycle.unmapCount;
                },
                set unmapCount(value: number) {
                    lifecycle.unmapCount = value;
                }
            };
            records.push(record);
            return buffer;
        }
    } as unknown as GPUDevice;
    return { device, records, writes, record: findRecord };
}

function input(
    name: string,
    type: string,
    location: number,
    locationCount = type.startsWith('mat') ? Number(/^mat([2-4])/u.exec(type)?.[1] ?? 1) : 1
): WebGPUVertexInput {
    return { name, type, location, locationCount };
}

function bindingBytes(fake: FakeGPU, binding: WebGPUVertexBufferBinding): Uint8Array {
    const byteLength = binding.count * binding.layout.arrayStride;
    return new Uint8Array(fake.record(binding.buffer).storage, 0, byteLength);
}

function bindingFloats(fake: FakeGPU, binding: WebGPUVertexBufferBinding): number[] {
    const bytes = bindingBytes(fake, binding);
    return [...new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)];
}

function indexValues(fake: FakeGPU, binding: WebGPUIndexBufferBinding): number[] {
    const storage = fake.record(binding.buffer).storage;
    return binding.format === 'uint16'
        ? [...new Uint16Array(storage, 0, binding.count)]
        : [...new Uint32Array(storage, 0, binding.count)];
}

describe('WebGPUBufferManager packed vertex buffers', () => {
    it('expands mat4 into four stable vertex locations with column-major bytes', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const values = new Float32Array(Array.from({ length: 32 }, (_value, index) => index + 1));
        const matrices = new GeometryData(values, 16);

        const resource = manager.getVertexBuffer(matrices, input('model', 'mat4', 2, 4));

        expect(resource.count).toBe(2);
        expect(resource.layout).toEqual({
            arrayStride: 64,
            stepMode: 'vertex',
            attributes: [
                { format: 'float32x4', offset: 0, shaderLocation: 2 },
                { format: 'float32x4', offset: 16, shaderLocation: 3 },
                { format: 'float32x4', offset: 32, shaderLocation: 4 },
                { format: 'float32x4', offset: 48, shaderLocation: 5 }
            ]
        });
        expect(bindingFloats(fake, resource)).toEqual([...values]);
    });

    it('packs interleaved and normalized sources into one canonical AoS buffer', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const owner = {};
        const positions = new GeometryData(new Float32Array([99, 1, 2, 3, 88, 4, 5, 6]), 3, {
            stride: 16,
            offset: 4
        });
        const colors = new GeometryData(new Uint8Array([0, 10, 20, 30, 0, 40, 50, 60]), 3, {
            stride: 4,
            offset: 1,
            normalized: true
        });
        const positionSource = {
            geometryData: positions,
            input: input('position', 'vec3', 0)
        };
        const colorSource = { geometryData: colors, input: input('color', 'vec3', 1) };

        const first = manager.getInterleavedVertexBuffer(owner, [colorSource, positionSource]);
        const second = manager.getInterleavedVertexBuffer(owner, [positionSource, colorSource]);

        expect(second).toBe(first);
        expect(fake.records).toHaveLength(1);
        expect(fake.writes).toHaveLength(0);
        expect(first.layout).toEqual({
            arrayStride: 24,
            stepMode: 'vertex',
            attributes: [
                { format: 'float32x3', offset: 0, shaderLocation: 0 },
                { format: 'float32x3', offset: 12, shaderLocation: 1 }
            ]
        });
        expect(bindingFloats(fake, first)).toEqual([
            1,
            2,
            3,
            Math.fround(10 / 255),
            Math.fround(20 / 255),
            Math.fround(30 / 255),
            4,
            5,
            6,
            Math.fround(40 / 255),
            Math.fround(50 / 255),
            Math.fround(60 / 255)
        ]);
    });

    it('uses one GPU buffer for nine logical inputs', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const sources = Array.from({ length: 9 }, (_value, location) => ({
            geometryData: new GeometryData(new Float32Array([location, location + 1]), 1),
            input: input(`attribute${String(location)}`, 'float', location)
        }));

        const resource = manager.getInterleavedVertexBuffer('nine-attributes', sources);

        expect(fake.records).toHaveLength(1);
        expect(resource.layout.attributes).toHaveLength(9);
        expect(resource.layout.arrayStride).toBe(36);
    });

    it('bounds GeometryData identity churn per long-lived owner with LRU eviction', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device, {
            vertexVariantsPerOwner: 3
        });
        const owner = {};
        const vertexInput = input('position', 'float', 0);
        const geometries = Array.from(
            { length: 10 },
            (_value, index) => new GeometryData(new Float32Array([index]), 1)
        );
        const bindings = geometries.map(geometryData =>
            manager.getInterleavedVertexBuffer(owner, [{ geometryData, input: vertexInput }])
        );

        expect(fake.records).toHaveLength(10);
        expect(
            bindings.slice(0, 7).map(binding => fake.record(binding.buffer).destroyCount)
        ).toEqual(new Array<number>(7).fill(1));
        expect(bindings.slice(7).map(binding => fake.record(binding.buffer).destroyCount)).toEqual([
            0, 0, 0
        ]);

        const firstGeometry = geometries[0];
        const firstBinding = bindings[0];
        if (!firstGeometry || !firstBinding) throw new Error('Missing vertex LRU fixture');
        const revived = manager.getInterleavedVertexBuffer(owner, [
            { geometryData: firstGeometry, input: vertexInput }
        ]);
        expect(revived.buffer).not.toBe(firstBinding.buffer);
        expect(fake.records.filter(record => record.destroyCount === 0)).toHaveLength(3);
    });

    it('retains multiple active shader-layout variants and touches LRU hits', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device, {
            vertexVariantsPerOwner: 2
        });
        const owner = {};
        const geometryData = new GeometryData(new Float32Array([1, 2]), 1);
        const first = manager.getInterleavedVertexBuffer(owner, [
            { geometryData, input: input('first', 'float', 0) }
        ]);
        const second = manager.getInterleavedVertexBuffer(owner, [
            { geometryData, input: input('second', 'float', 1) }
        ]);

        expect(
            manager.getInterleavedVertexBuffer(owner, [
                { geometryData, input: input('first', 'float', 0) }
            ])
        ).toBe(first);
        const third = manager.getInterleavedVertexBuffer(owner, [
            { geometryData, input: input('third', 'float', 2) }
        ]);

        expect(fake.record(first.buffer).destroyCount).toBe(0);
        expect(fake.record(second.buffer).destroyCount).toBe(1);
        expect(fake.record(third.buffer).destroyCount).toBe(0);
    });

    it('tracks revision, dirty and structural fingerprints without stale cache hits', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const geometry = new GeometryData(new Float32Array([1, 2, 3, 4]), 2);
        const vertexInput = input('position', 'vec2', 0);

        const first = manager.getVertexBuffer(geometry, vertexInput);
        expect(geometry.isDirty).toBe(true);
        geometry.data[0] = 9;
        geometry.isDirty = true;
        const dirtyUpdate = manager.getVertexBuffer(geometry, vertexInput);
        expect(dirtyUpdate).toBe(first);
        expect(fake.writes).toHaveLength(1);
        expect(bindingFloats(fake, dirtyUpdate)).toEqual([9, 2, 3, 4]);

        geometry.setSubData(2, new Float32Array([7, 8]));
        const subDataUpdate = manager.getVertexBuffer(geometry, vertexInput);
        expect(subDataUpdate).toBe(first);
        expect(fake.writes).toHaveLength(2);
        expect(bindingFloats(fake, subDataUpdate)).toEqual([9, 2, 7, 8]);

        geometry.data = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        geometry.stride = 12;
        geometry.offset = 4;
        const resized = manager.getVertexBuffer(geometry, vertexInput);
        expect(resized).not.toBe(first);
        expect(fake.record(first.buffer).destroyCount).toBe(1);
        expect(resized.count).toBe(3);
        expect(bindingFloats(fake, resized)).toEqual([1, 2, 4, 5, 7, 8]);
    });

    it('detects normalized changes even when GeometryData revision is unchanged', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const geometry = new GeometryData(new Uint8Array([0, 255]), 2);
        const vertexInput = input('weight', 'vec2', 0);
        const first = manager.getVertexBuffer(geometry, vertexInput);

        geometry.normalized = true;
        const normalized = manager.getVertexBuffer(geometry, vertexInput);

        expect(normalized).toBe(first);
        expect(fake.writes).toHaveLength(1);
        expect(bindingFloats(fake, normalized)).toEqual([0, 1]);
    });

    it('rejects location overlap, malformed matrix location counts and unequal source counts', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const matrix = new GeometryData(new Float32Array(16), 16);
        const vector = new GeometryData(new Float32Array(4), 4);

        expect(() => manager.getVertexBuffer(matrix, input('matrix', 'mat4', 0, 1))).toThrow(
            /requires 4/
        );
        expect(() =>
            manager.getInterleavedVertexBuffer('overlap', [
                { geometryData: matrix, input: input('matrix', 'mat4', 0, 4) },
                { geometryData: vector, input: input('vector', 'vec4', 2) }
            ])
        ).toThrow(/location 2 is used more than once/);
        expect(() =>
            manager.getInterleavedVertexBuffer('count', [
                {
                    geometryData: new GeometryData(new Float32Array([0, 1]), 1),
                    input: input('a', 'float', 0)
                },
                {
                    geometryData: new GeometryData(new Float32Array([0, 1, 2]), 1),
                    input: input('b', 'float', 1)
                }
            ])
        ).toThrow(/equal count/);
    });
});

describe('WebGPUBufferManager index buffers', () => {
    it('supports Uint8/16/32 and explicitly remaps Uint8 strip restart markers', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const uint8 = new GeometryData(new Uint8Array([0, 1, 0xff]), 1);
        const plain = manager.getIndexBuffer(uint8);
        const restart = manager.getIndexBuffer(uint8, { primitiveRestart: true });

        expect(plain.format).toBe('uint16');
        expect(indexValues(fake, plain)).toEqual([0, 1, 0xff]);
        expect(indexValues(fake, restart)).toEqual([0, 1, 0xffff]);
        expect(restart).not.toBe(plain);

        const uint16 = manager.getIndexBuffer(new GeometryData(new Uint16Array([0, 1, 2]), 1));
        const uint32 = manager.getIndexBuffer(new GeometryData(new Uint32Array([0, 1, 70000]), 1));
        expect(uint16.format).toBe('uint16');
        expect(uint32.format).toBe('uint32');
        expect(indexValues(fake, uint32)).toEqual([0, 1, 70000]);
    });

    it('updates same-size index data and rejects non-index GeometryData layouts', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const indices = new GeometryData(new Uint16Array([0, 1, 2]), 1);
        const first = manager.getIndexBuffer(indices);
        indices.setSubData(1, new Uint16Array([2, 1]));
        const updated = manager.getIndexBuffer(indices);

        expect(updated).toBe(first);
        expect(fake.writes).toHaveLength(1);
        expect(indexValues(fake, updated)).toEqual([0, 2, 1]);

        expect(() =>
            manager.getIndexBuffer(new GeometryData(new Uint16Array([0, 1, 2, 3]), 2))
        ).toThrow(/size=1/);
        expect(() =>
            manager.getIndexBuffer(
                new GeometryData(new Uint16Array([0, 1, 2, 3]), 1, { stride: 4 })
            )
        ).toThrow(/stride=0/);
        expect(() =>
            manager.getIndexBuffer(
                new GeometryData(new Uint16Array([0, 1]), 1, { normalized: true })
            )
        ).toThrow(/normalized=false/);
    });

    it('pads odd uint16 update byte counts without changing the logical index count', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const uint16 = new GeometryData(new Uint16Array([0, 1, 2]), 1);
        const uint8 = new GeometryData(new Uint8Array([3, 4, 5]), 1);
        const uint16Buffer = manager.getIndexBuffer(uint16);
        const uint8Buffer = manager.getIndexBuffer(uint8);

        uint16.setSubData(0, new Uint16Array([6, 7, 8]));
        uint8.setSubData(0, new Uint8Array([9, 10, 11]));
        const updatedUint16 = manager.getIndexBuffer(uint16);
        const updatedUint8 = manager.getIndexBuffer(uint8);

        expect(updatedUint16).toBe(uint16Buffer);
        expect(updatedUint8).toBe(uint8Buffer);
        expect(updatedUint16.count).toBe(3);
        expect(updatedUint8.count).toBe(3);
        expect(indexValues(fake, updatedUint16)).toEqual([6, 7, 8]);
        expect(indexValues(fake, updatedUint8)).toEqual([9, 10, 11]);
        expect(fake.writes.map(write => write.bytes.byteLength)).toEqual([8, 8]);
    });

    it('releases replaced index identities through the explicit owner lifecycle', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const owners = Array.from(
            { length: 10 },
            (_value, index) => new GeometryData(new Uint16Array([0, index + 1]), 1)
        );
        const bindings: WebGPUIndexBufferBinding[] = [];
        owners.forEach((owner, index) => {
            const previousOwner = owners[index - 1];
            if (previousOwner) manager.releaseOwner(previousOwner);
            bindings.push(manager.getIndexBuffer(owner));
        });

        expect(
            bindings.slice(0, 9).map(binding => fake.record(binding.buffer).destroyCount)
        ).toEqual(new Array<number>(9).fill(1));
        const lastOwner = owners[9];
        const lastBinding = bindings[9];
        if (!lastOwner || !lastBinding) throw new Error('Missing index lifecycle fixture');
        expect(fake.record(lastBinding.buffer).destroyCount).toBe(0);
        expect(fake.records.filter(record => record.destroyCount === 0)).toHaveLength(1);

        manager.releaseOwner(lastOwner);
        expect(fake.record(lastBinding.buffer).destroyCount).toBe(1);
    });

    it('bounds index format variants independently', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device, {
            indexVariantsPerOwner: 1
        });
        const firstOwner = new GeometryData(new Uint8Array([0, 1, 0xff]), 1);
        const plain = manager.getIndexBuffer(firstOwner);
        const restart = manager.getIndexBuffer(firstOwner, { primitiveRestart: true });

        expect(fake.record(plain.buffer).destroyCount).toBe(1);
        expect(fake.record(restart.buffer).destroyCount).toBe(0);
        expect(manager.getIndexBuffer(firstOwner, { primitiveRestart: true })).toBe(restart);
        manager.releaseOwner(firstOwner);
        expect(fake.record(restart.buffer).destroyCount).toBe(1);
    });
});

describe('WebGPUBufferManager instance buffers and lifecycle', () => {
    it('packs mat3 and mat4 instance inputs into one slot and snapshots shared scratch values', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const normalScratch = new Float32Array(9);
        const modelScratch = new Float32Array(16);
        const resource = manager.getInterleavedInstanceBuffer('instances', 2, [
            {
                input: input('normalMatrix', 'mat3', 0, 3),
                getValue: instanceIndex => {
                    normalScratch.fill(instanceIndex + 1);
                    return normalScratch;
                }
            },
            {
                input: input('modelMatrix', 'mat4', 3, 4),
                getValue: instanceIndex => {
                    modelScratch.fill((instanceIndex + 1) * 10);
                    return modelScratch;
                }
            }
        ]);

        expect(fake.records).toHaveLength(1);
        expect(resource.layout.stepMode).toBe('instance');
        expect(resource.layout.arrayStride).toBe(100);
        expect(resource.layout.attributes).toEqual([
            { format: 'float32x3', offset: 0, shaderLocation: 0 },
            { format: 'float32x3', offset: 12, shaderLocation: 1 },
            { format: 'float32x3', offset: 24, shaderLocation: 2 },
            { format: 'float32x4', offset: 36, shaderLocation: 3 },
            { format: 'float32x4', offset: 52, shaderLocation: 4 },
            { format: 'float32x4', offset: 68, shaderLocation: 5 },
            { format: 'float32x4', offset: 84, shaderLocation: 6 }
        ]);
        expect(bindingFloats(fake, resource)).toEqual([
            ...new Array<number>(9).fill(1),
            ...new Array<number>(16).fill(10),
            ...new Array<number>(9).fill(2),
            ...new Array<number>(16).fill(20)
        ]);
    });

    it('bounds instance shader-layout variants and uses access-order eviction', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device, {
            instanceVariantsPerOwner: 2
        });
        const owner = {};
        const source = (location: number) => ({
            input: input(`instance${String(location)}`, 'float', location),
            getValue: () => [location]
        });
        const first = manager.getInterleavedInstanceBuffer(owner, 1, [source(0)]);
        const second = manager.getInterleavedInstanceBuffer(owner, 1, [source(1)]);

        expect(manager.getInterleavedInstanceBuffer(owner, 1, [source(0)])).toBe(first);
        const third = manager.getInterleavedInstanceBuffer(owner, 1, [source(2)]);

        expect(fake.record(first.buffer).destroyCount).toBe(0);
        expect(fake.record(second.buffer).destroyCount).toBe(1);
        expect(fake.record(third.buffer).destroyCount).toBe(0);
        expect(fake.records.filter(record => record.destroyCount === 0)).toHaveLength(2);
    });

    it('releases an owner, destroys globally once, and rebuilds fresh resources', () => {
        const fake = fakeGPU();
        const manager = new WebGPUBufferManager(fake.device);
        const owner = {};
        const geometry = new GeometryData(new Float32Array([0, 1, 2]), 1);
        const source = { geometryData: geometry, input: input('value', 'float', 0) };
        const vertex = manager.getInterleavedVertexBuffer(owner, [source]);
        const instance = manager.getInterleavedInstanceBuffer(owner, 1, [
            { input: input('instanceValue', 'float', 1), getValue: () => [1] }
        ]);
        const indexOwner = new GeometryData(new Uint16Array([0, 1, 2]), 1);
        const index = manager.getIndexBuffer(indexOwner);

        manager.releaseOwner(owner);
        expect(fake.record(vertex.buffer).destroyCount).toBe(1);
        expect(fake.record(instance.buffer).destroyCount).toBe(1);
        manager.releaseOwner(indexOwner);
        expect(fake.record(index.buffer).destroyCount).toBe(1);
        expect(manager.getIndexBuffer(indexOwner).buffer).not.toBe(index.buffer);
        const rebuilt = manager.getInterleavedVertexBuffer(owner, [source]);
        expect(rebuilt.buffer).not.toBe(vertex.buffer);

        manager.destroy();
        manager.destroy();
        expect(fake.record(rebuilt.buffer).destroyCount).toBe(1);
        const afterDestroy = manager.getInterleavedVertexBuffer(owner, [source]);
        expect(afterDestroy.buffer).not.toBe(rebuilt.buffer);
    });
});
