/** Stable MaterialBlock texture-slot indices shared by built-in families and shader source. */
export const MATERIAL_TEXTURE_SLOT_COUNT = 24;
export const MaterialTextureSlot = Object.freeze({
    NORMAL: 0,
    PARALLAX: 1,
    EMISSION: 2,
    OPACITY: 3,
    DIFFUSE: 4,
    SPECULAR: 5,
    AMBIENT: 6,
    BASE_COLOR: 7,
    METALLIC: 8,
    ROUGHNESS: 9,
    METALLIC_ROUGHNESS: 10,
    OCCLUSION: 11,
    SPECULAR_GLOSSINESS: 12,
    LIGHT: 13,
    CLEARCOAT: 14,
    CLEARCOAT_ROUGHNESS: 15,
    CLEARCOAT_NORMAL: 16,
    ANISOTROPY: 17,
    TRANSMISSION: 18,
    THICKNESS: 19,
    IRIDESCENCE: 20,
    IRIDESCENCE_THICKNESS: 21,
    DIFFUSE_ENVIRONMENT: 22,
    SPECULAR_ENVIRONMENT: 23
} as const);

export type BuiltInMaterialTextureSlotName = keyof typeof MaterialTextureSlot;
