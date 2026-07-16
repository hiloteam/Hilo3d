import type { TextureParameters } from '../texture/Texture';

export type LoaderTextureOptions<Image> = Omit<TextureParameters<Image>, 'image' | 'type'>;

/** Copies only the public texture options, excluding loader transport metadata. */
export function textureOptions<Image>(
    source: LoaderTextureOptions<Image>
): LoaderTextureOptions<Image> {
    return {
        ...(source.mipmaps !== undefined ? { mipmaps: source.mipmaps } : {}),
        ...(source.isImageCanRelease !== undefined
            ? { isImageCanRelease: source.isImageCanRelease }
            : {}),
        ...(source.target !== undefined ? { target: source.target } : {}),
        ...(source.internalFormat !== undefined ? { internalFormat: source.internalFormat } : {}),
        ...(source.format !== undefined ? { format: source.format } : {}),
        ...(source.width !== undefined ? { width: source.width } : {}),
        ...(source.height !== undefined ? { height: source.height } : {}),
        ...(source.magFilter !== undefined ? { magFilter: source.magFilter } : {}),
        ...(source.minFilter !== undefined ? { minFilter: source.minFilter } : {}),
        ...(source.wrapS !== undefined ? { wrapS: source.wrapS } : {}),
        ...(source.wrapT !== undefined ? { wrapT: source.wrapT } : {}),
        ...(source.name !== undefined ? { name: source.name } : {}),
        ...(source.premultiplyAlpha !== undefined
            ? { premultiplyAlpha: source.premultiplyAlpha }
            : {}),
        ...(source.flipY !== undefined ? { flipY: source.flipY } : {}),
        ...(source.colorSpaceConversion !== undefined
            ? { colorSpaceConversion: source.colorSpaceConversion }
            : {}),
        ...(source.compressed !== undefined ? { compressed: source.compressed } : {}),
        ...(source.needUpdate !== undefined ? { needUpdate: source.needUpdate } : {}),
        ...(source.needDestroy !== undefined ? { needDestroy: source.needDestroy } : {}),
        ...(source.autoUpdate !== undefined ? { autoUpdate: source.autoUpdate } : {}),
        ...(source.uv !== undefined ? { uv: source.uv } : {}),
        ...(source.anisotropic !== undefined ? { anisotropic: source.anisotropic } : {})
    };
}
