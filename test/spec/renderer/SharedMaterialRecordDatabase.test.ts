import { describe, expect, it, vi } from 'vitest';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Matrix3 from '../../../src/math/Matrix3';
import SharedMaterialRecordDatabase from '../../../src/render/renderer/SharedMaterialRecordDatabase';
import {
    packPBRGPUMaterialRecord,
    PBR_GPU_MATERIAL_RECORD_BYTES,
    PBR_GPU_MATERIAL_RECORD_LAYOUT
} from '../../../src/render/renderer/PBRGPUMaterialRecord';
import {
    RendererStorageBuffer,
    type StorageBuffer,
    type StorageBufferHost,
    type StorageBufferReadback
} from '../../../src/render/StorageBuffer';
import Texture from '../../../src/texture/Texture';

interface UploadRecord {
    readonly buffer: StorageBuffer;
    readonly byteOffset: number;
    readonly data: Uint8Array;
}

function createHost(): StorageBufferHost {
    return {
        backend: 'webgpu',
        assertStorageBufferMutationAllowed: vi.fn(),
        storageBufferWritten: vi.fn(),
        readStorageBuffer(
            buffer: RendererStorageBuffer,
            byteOffset: number,
            byteLength: number
        ): Promise<StorageBufferReadback> {
            return Promise.resolve({
                data: new Uint8Array(buffer.cpuData(), byteOffset, byteLength).slice(),
                byteOffset,
                byteLength
            });
        },
        storageBufferDestroyed: vi.fn()
    };
}

function createDatabase(materials: readonly PBRMaterial[]): {
    readonly database: SharedMaterialRecordDatabase<PBRMaterial>;
    readonly buffer: RendererStorageBuffer;
    readonly uploads: UploadRecord[];
} {
    const host = createHost();
    const database = new SharedMaterialRecordDatabase(
        {
            createStorageBuffer(descriptor) {
                return new RendererStorageBuffer(host, descriptor);
            }
        },
        {
            label: 'Shared PBR material database',
            family: 'pbr',
            layout: PBR_GPU_MATERIAL_RECORD_LAYOUT,
            recordByteLength: PBR_GPU_MATERIAL_RECORD_BYTES,
            materials,
            packRecord: packPBRGPUMaterialRecord
        }
    );
    if (!(database.buffer instanceof RendererStorageBuffer)) {
        throw new Error('Expected the database to create a renderer storage buffer');
    }
    const uploads: UploadRecord[] = [];
    return { database, buffer: database.buffer, uploads };
}

function stage(
    database: SharedMaterialRecordDatabase<PBRMaterial>,
    uploads: UploadRecord[],
    frameIndex: number
): void {
    database.stage({
        frameIndex,
        writeStorageBuffer(buffer, byteOffset, data): void {
            if (!(buffer instanceof RendererStorageBuffer)) {
                throw new TypeError('Expected a renderer storage buffer upload');
            }
            buffer.writeFromRenderPipeline(byteOffset, data);
            uploads.push({
                buffer,
                byteOffset,
                data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
            });
        }
    });
}

describe('SharedMaterialRecordDatabase', () => {
    it('deduplicates stable handles and snapshots the shared PBR record layout', () => {
        const first = new PBRMaterial({
            baseColor: new Color(0.25, 0.5, 0.75),
            metallic: 0.4,
            roughness: 0.3,
            emissionFactor: new Color(0.1, 0.2, 0.3),
            normalScale: 0.8,
            ior: 1.4
        });
        const second = new PBRMaterial({ metallic: 0.9 });
        const { database, buffer } = createDatabase([first, second, first]);

        expect(database.recordCount).toBe(2);
        expect(buffer.byteLength).toBe(PBR_GPU_MATERIAL_RECORD_BYTES * 2);
        expect([...buffer.usage]).toEqual(['storage', 'copy-destination']);
        expect(buffer.recovery).toBe('cpu-shadow');
        expect(database.getHandle(first)).toEqual({
            materialId: first.materialId,
            family: 'pbr',
            layout: PBR_GPU_MATERIAL_RECORD_LAYOUT,
            recordIndex: 0,
            byteOffset: 0,
            byteLength: PBR_GPU_MATERIAL_RECORD_BYTES
        });
        expect(database.getHandle(second).recordIndex).toBe(1);
        expect(() => database.getHandle(new PBRMaterial())).toThrow(/is not registered/u);

        const values = new Float32Array(buffer.cpuData());
        const expectedValues = [0.25, 0.5, 0.75, 0.4, 0.1, 0.2, 0.3, 0.3, 1.4, 1, 0.8];
        for (let index = 0; index < expectedValues.length; index += 1) {
            expect(values[index]).toBeCloseTo(expectedValues[index] ?? 0);
        }
        expect([...values.slice(12, 24)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    });

    it('coalesces adjacent revision uploads and retries discarded frames', () => {
        const materials = [new PBRMaterial(), new PBRMaterial(), new PBRMaterial()];
        const { database, uploads } = createDatabase(materials);
        const first = materials[0];
        const second = materials[1];
        const third = materials[2];
        if (first === undefined || second === undefined || third === undefined) {
            throw new Error('Expected three material records');
        }

        stage(database, uploads, 1);
        expect(uploads).toHaveLength(0);
        database.frameSubmitted(1);

        first.metallic = 0.2;
        second.roughness = 0.4;
        stage(database, uploads, 2);
        expect(uploads).toHaveLength(1);
        expect(uploads[0]).toMatchObject({
            byteOffset: 0,
            data: { byteLength: PBR_GPU_MATERIAL_RECORD_BYTES * 2 }
        });
        database.frameDiscarded(2);

        uploads.length = 0;
        stage(database, uploads, 3);
        expect(uploads).toHaveLength(1);
        database.frameSubmitted(3);

        uploads.length = 0;
        stage(database, uploads, 4);
        expect(uploads).toHaveLength(0);
        database.frameSubmitted(4);

        first.metallic = 0.3;
        third.roughness = 0.6;
        stage(database, uploads, 5);
        expect(uploads.map(upload => [upload.byteOffset, upload.data.byteLength])).toEqual([
            [0, PBR_GPU_MATERIAL_RECORD_BYTES],
            [PBR_GPU_MATERIAL_RECORD_BYTES * 2, PBR_GPU_MATERIAL_RECORD_BYTES]
        ]);
        database.frameSubmitted(5);
    });

    it('commits initial texture dirtiness only after a submitted frame', () => {
        const transform = new Matrix3().fromRotationTranslationScale(0, 0.2, 0.3, 0.5, 0.75);
        const material = new PBRMaterial({
            baseColorMap: { texture: new Texture(), transform }
        });
        const { database, uploads } = createDatabase([material]);

        expect(material.getDirtyTextureSlots().length).toBeGreaterThan(0);
        stage(database, uploads, 7);
        expect(uploads).toHaveLength(0);
        database.frameDiscarded(7);
        expect(material.getDirtyTextureSlots().length).toBeGreaterThan(0);

        stage(database, uploads, 8);
        database.frameSubmitted(8);
        expect(material.getDirtyTextureSlots()).toEqual([]);
    });

    it('keeps a post-stage mutation dirty for the following submission', () => {
        const material = new PBRMaterial();
        const { database, uploads } = createDatabase([material]);
        stage(database, uploads, 1);
        database.frameSubmitted(1);

        material.metallic = 0.25;
        stage(database, uploads, 2);
        material.metallic = 0.5;
        database.frameSubmitted(2);

        uploads.length = 0;
        stage(database, uploads, 3);
        expect(uploads).toHaveLength(1);
        const upload = uploads[0];
        if (upload === undefined) throw new Error('Expected a material upload');
        expect(new Float32Array(upload.data.buffer)[3]).toBe(0.5);
        database.frameSubmitted(3);
    });

    it('destroys its renderer-owned buffer exactly once', () => {
        const { database, buffer } = createDatabase([new PBRMaterial()]);

        database.destroy();
        database.destroy();

        expect(database.isDestroyed).toBe(true);
        expect(buffer.isDestroyed).toBe(true);
        expect(() => database.getHandle(new PBRMaterial())).toThrow(/destroyed/u);
    });
});

describe('packPBRGPUMaterialRecord', () => {
    it('rejects an incompatible destination layout', () => {
        expect(() => {
            packPBRGPUMaterialRecord(new PBRMaterial(), new Uint8Array(16));
        }).toThrow(/must be 144 bytes/u);
    });
});
