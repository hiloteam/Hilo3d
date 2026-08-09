import type PBRMaterial from '../../material/PBRMaterial';
import type Matrix3 from '../../math/Matrix3';

/** @internal Stable compact layout consumed by the first shared GPU PBR material database. */
export const PBR_GPU_MATERIAL_RECORD_LAYOUT = 'builtin-pbr-storage-v1';
/** @internal Nine vec4 values: surface parameters plus base-color and normal UV matrices. */
export const PBR_GPU_MATERIAL_RECORD_BYTES = 144;

function packUVMatrix(matrix: Matrix3 | null, target: Float32Array, offset: number): void {
    const elements = matrix?.elements;
    for (let column = 0; column < 3; column += 1) {
        for (let row = 0; row < 3; row += 1) {
            const index = column * 3 + row;
            target[offset + column * 4 + row] = elements?.[index] ?? (column === row ? 1 : 0);
        }
        target[offset + column * 4 + 3] = 0;
    }
}

/** @internal Pack one built-in metallic/roughness PBR instance into the shared storage layout. */
export function packPBRGPUMaterialRecord(material: PBRMaterial, target: Uint8Array): void {
    if (target.byteLength !== PBR_GPU_MATERIAL_RECORD_BYTES) {
        throw new RangeError(
            `PBR GPU material record must be ${String(PBR_GPU_MATERIAL_RECORD_BYTES)} bytes`
        );
    }
    const values = new Float32Array(
        target.buffer,
        target.byteOffset,
        PBR_GPU_MATERIAL_RECORD_BYTES / 4
    );
    values[0] = material.baseColor.r;
    values[1] = material.baseColor.g;
    values[2] = material.baseColor.b;
    values[3] = material.metallic;
    values[4] = material.emissionFactor.r;
    values[5] = material.emissionFactor.g;
    values[6] = material.emissionFactor.b;
    values[7] = material.roughness;
    values[8] = material.ior;
    values[9] = material.occlusionStrength;
    values[10] = material.normalScale;
    packUVMatrix(material.getTextureSlot('baseColor')?.transform ?? null, values, 12);
    packUVMatrix(material.getTextureSlot('normal')?.transform ?? null, values, 24);
}
