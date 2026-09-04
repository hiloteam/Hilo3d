import { Texture, constants } from 'hilo3d';

export type ParticleTextureStyle = 'disc' | 'spark' | 'ring' | 'smoke';

export function createParticleTexture(
    style: ParticleTextureStyle = 'disc',
    size = 64
): Texture<Uint8Array> {
    const pixels = new Uint8Array(size * size * 4);
    const center = (size - 1) * 0.5;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const nx = (x - center) / center;
            const ny = (y - center) / center;
            const radius = Math.hypot(nx, ny);
            const radial = Math.max(0, 1 - radius);
            let alpha = radial * radial;
            if (style === 'spark') {
                const rays = Math.pow(Math.abs(Math.cos(Math.atan2(ny, nx) * 4)), 18) * radial;
                alpha = Math.max(Math.pow(radial, 5), rays * 0.72);
            } else if (style === 'ring') {
                alpha = Math.max(
                    Math.exp(-Math.pow((radius - 0.58) * 8, 2)) * 0.82,
                    Math.pow(radial, 8)
                );
            } else if (style === 'smoke') {
                const turbulence =
                    Math.sin(nx * 11 + ny * 7) * 0.08 + Math.cos(ny * 13 - nx * 5) * 0.07;
                alpha = Math.pow(Math.max(0, radial + turbulence), 1.8) * 0.72;
            }
            const offset = (y * size + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        }
    }
    return new Texture({
        image: pixels,
        width: size,
        height: size,
        internalFormat: constants.RGBA8,
        format: constants.RGBA,
        type: constants.UNSIGNED_BYTE,
        wrapS: constants.CLAMP_TO_EDGE,
        wrapT: constants.CLAMP_TO_EDGE,
        magFilter: constants.LINEAR,
        minFilter: constants.LINEAR
    });
}
