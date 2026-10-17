import * as H from '../../src/Hilo3d';

interface PaintedSurface {
    readonly color: H.Texture;
    readonly normal: H.Texture;
}

function hash(x: number, y: number): number {
    const value = Math.imul(x + 67, 374761393) ^ Math.imul(y + 113, 668265263);
    return ((Math.imul(value ^ (value >>> 13), 1274126177) ^ value) >>> 0) / 4294967295;
}

function noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const sx = (x - ix) ** 2 * (3 - 2 * (x - ix));
    const sy = (y - iy) ** 2 * (3 - 2 * (y - iy));
    const a = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
    const b = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
    return a * (1 - sy) + b * sy;
}

function texture(size: number, pixels: Uint8ClampedArray, repeat: boolean): H.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null)
        throw new Error('Soft Matter requires a canvas for authored surface maps');
    const image = context.createImageData(size, size);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
    return new H.Texture({
        image: canvas,
        wrapS: repeat ? H.constants.webgl.REPEAT : H.constants.webgl.CLAMP_TO_EDGE,
        wrapT: repeat ? H.constants.webgl.REPEAT : H.constants.webgl.CLAMP_TO_EDGE,
        minFilter: H.constants.webgl.LINEAR_MIPMAP_LINEAR,
        magFilter: H.constants.webgl.LINEAR,
        anisotropic: 4
    });
}

/** Deterministic pigment and tangent-normal maps; none of the MAT1 lighting is baked into them. */
export function paintSoftMatterSurface(
    kind: 'velvet' | 'stone' | 'petal' | 'leaf'
): PaintedSurface {
    const size = 512;
    const color = new Uint8ClampedArray(size * size * 4);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const index = y * size + x;
            const offset = index * 4;
            const u = x / (size - 1);
            const v = y / (size - 1);
            const grain = hash(x, y);
            if (kind === 'velvet') {
                const weave = Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2);
                const pigment = 0.82 + grain * 0.14 + weave * 0.04;
                color[offset] = 255 * pigment;
                color[offset + 1] = 243 * pigment;
                color[offset + 2] = 247 * pigment;
                height[index] = grain * 0.035 + weave * 0.035;
                color[offset + 3] = 255;
            } else if (kind === 'stone') {
                const broad = noise(u * 9, v * 9);
                const fine = noise(u * 47, v * 47);
                const pigment = 0.84 + broad * 0.18 + fine * 0.08;
                color[offset] = 26 * pigment + grain * 4;
                color[offset + 1] = 42 * pigment + grain * 4;
                color[offset + 2] = 35 * pigment + grain * 4;
                height[index] = fine * 0.04 + grain * 0.025;
                color[offset + 3] = 255;
            } else {
                const side = Math.abs(u - 0.5 - Math.sin(v * 8) * 0.007);
                const midrib = Math.exp((-side * side) / 0.000025);
                const phase = (v - side * 0.62) * 12;
                const distance = Math.abs(phase - Math.round(phase));
                const ribs = Math.exp((-distance * distance) / 0.0014) * (1 - side);
                const fineRibs = Math.pow(Math.max(0, Math.cos((v - side * 0.55) * 390)), 18);
                const vein = Math.min(1, midrib * 0.8 + ribs * 0.65 + fineRibs * 0.15);
                const pigment =
                    (0.88 + grain * 0.1 + noise(u * 12, v * 16) * 0.12) * (1 - vein * 0.35);
                const tip = 0.45 + 0.55 * v;
                const channels =
                    kind === 'petal'
                        ? [255, 110 + 85 * tip, 28 + 55 * tip]
                        : [90 + 40 * tip, 145 + 55 * tip, 45 + 25 * tip];
                for (let channel = 0; channel < 3; channel++) {
                    color[offset + channel] = (channels[channel] ?? 0) * pigment;
                }
                // The same authored thickness pattern is sampled through the factor's alpha slot.
                color[offset + 3] = 255 * (1 - vein * 0.7);
                height[index] = vein * 0.11 + grain * 0.009;
            }
        }
    }
    const normal = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const dx =
                ((height[y * size + Math.min(size - 1, x + 1)] ?? 0) -
                    (height[y * size + Math.max(0, x - 1)] ?? 0)) *
                6;
            const dy =
                ((height[Math.min(size - 1, y + 1) * size + x] ?? 0) -
                    (height[Math.max(0, y - 1) * size + x] ?? 0)) *
                6;
            const length = Math.hypot(dx, dy, 1);
            normal[offset] = 128 - (dx / length) * 127;
            normal[offset + 1] = 128 - (dy / length) * 127;
            normal[offset + 2] = 128 + 127 / length;
            normal[offset + 3] = 255;
        }
    }
    return {
        color: texture(size, color, kind === 'velvet' || kind === 'stone'),
        normal: texture(size, normal, kind === 'velvet' || kind === 'stone')
    };
}
