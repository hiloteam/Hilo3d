import type PBRMaterial from '../../material/PBRMaterial';
import type {
    MaterialTextureChannel,
    MaterialTextureEncoding
} from '../../material/MaterialDefinition';
import type Matrix3 from '../../math/Matrix3';

/** @internal Stable compact layout consumed by the first shared GPU PBR material database. */
export const PBR_GPU_MATERIAL_RECORD_LAYOUT = 'builtin-pbr-storage-v2';

/** @internal Common opaque PBR slots supported by the clustered storage profile. */
export const PBR_GPU_MATERIAL_TEXTURE_SLOTS = Object.freeze([
    'baseColor',
    'metallic',
    'roughness',
    'metallicRoughness',
    'occlusion',
    'emission',
    'normal'
] as const);

/** @internal Three surface vec4s plus five vec4s for every supported texture slot. */
export const PBR_GPU_MATERIAL_RECORD_BYTES = (3 + PBR_GPU_MATERIAL_TEXTURE_SLOTS.length * 5) * 16;
const DEFAULT_CHANNELS = Object.freeze(['r', 'g', 'b', 'a'] as const);

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

function textureEncodingCode(encoding: MaterialTextureEncoding): number {
    return encoding === 'linear' ? 0 : encoding === 'srgb' ? 1 : 2;
}

function textureChannelCode(channel: MaterialTextureChannel): number {
    switch (channel) {
        case 'r':
            return 0;
        case 'g':
            return 1;
        case 'b':
            return 2;
        case 'a':
            return 3;
        case 'zero':
            return 4;
        case 'one':
            return 5;
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
    for (let slotIndex = 0; slotIndex < PBR_GPU_MATERIAL_TEXTURE_SLOTS.length; slotIndex += 1) {
        const name = PBR_GPU_MATERIAL_TEXTURE_SLOTS[slotIndex];
        if (name === undefined) throw new Error('PBR GPU texture slot table is incomplete');
        const definition = material.definition.textureSlots.find(slot => slot.name === name);
        const binding = material.getTextureSlot(name);
        if (binding !== null && definition === undefined) {
            throw new Error(`PBR material definition is missing active texture slot ${name}`);
        }
        const slotFloatOffset = 12 + slotIndex * 20;
        packUVMatrix(binding?.transform ?? null, values, slotFloatOffset);
        const infoOffset = slotFloatOffset + 12;
        values[infoOffset] = binding?.uvSet ?? definition?.uvSets[0] ?? 0;
        values[infoOffset + 1] = textureEncodingCode(
            binding?.encoding ??
                definition?.encoding ??
                (name === 'baseColor' || name === 'emission' ? 'srgb' : 'data')
        );
        values[infoOffset + 2] = binding === null ? 0 : 1;
        values[infoOffset + 3] = 0;
        const channels = binding?.channels ?? definition?.channels ?? DEFAULT_CHANNELS;
        const channelOffset = slotFloatOffset + 16;
        for (let component = 0; component < 4; component += 1) {
            const channel = channels[component];
            values[channelOffset + component] = textureChannelCode(
                channel ?? DEFAULT_CHANNELS[component] ?? 'zero'
            );
        }
    }
}
