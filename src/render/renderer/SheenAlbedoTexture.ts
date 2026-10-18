import { CLAMP_TO_EDGE, NEAREST, RGBA, UNSIGNED_BYTE } from '../../constants/webgl';
import { RGBA8 } from '../../constants/webgl2';
import Texture from '../../texture/Texture';
import { requireNumber } from '../../math/numberArray';
import { sheenAlbedoData } from './SheenAlbedoData';

let texture: Texture<Uint8Array> | undefined;

/** Shared immutable CPU recipe; each renderer uploads and retires its own RHI allocation. */
export function getSheenAlbedoTexture(): Texture<Uint8Array> {
    if (texture !== undefined) return texture;
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let index = 0; index < sheenAlbedoData.length; index++) {
        // The integrated grazing peak remains below 8. Two unorm8 channels retain
        // 16-bit precision without optional float filtering support on either backend.
        const value = Math.round((requireNumber(sheenAlbedoData, index) / 8) * 65535);
        pixels[index * 4] = value >>> 8;
        pixels[index * 4 + 1] = value & 255;
        pixels[index * 4 + 3] = 255;
    }
    texture = new Texture({
        width: 32,
        height: 32,
        image: pixels,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        minFilter: NEAREST,
        magFilter: NEAREST,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        flipY: false
    });
    return texture;
}
