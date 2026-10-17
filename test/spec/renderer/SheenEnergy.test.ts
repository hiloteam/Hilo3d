import { describe, expect, it } from 'vitest';
import { requireNumber } from '../../../src/math/numberArray';
import { sheenAlbedoData } from '../../../src/render/renderer/SheenAlbedoData';
import { getSheenAlbedoTexture } from '../../../src/render/renderer/SheenAlbedoTexture';

// Independent CPU quadrature of the published Charlie model verifies the checked
// integration data and the energy bound used by both portable rendering backends.
const table = sheenAlbedoData;

function albedo(nv: number, roughness: number, conservative: boolean): number {
    const x = Math.sqrt(Math.min(Math.max(nv, 0), 1)) * 31;
    const y = ((Math.min(Math.max(roughness, 0.05), 1) - 0.05) / 0.95) * 31;
    const column = Math.min(Math.floor(x), 30);
    const row = Math.min(Math.floor(y), 30);
    const index = row * 32 + column;
    const a = requireNumber(table, index);
    const b = requireNumber(table, index + 1);
    const c = requireNumber(table, index + 32);
    const d = requireNumber(table, index + 33);
    if (conservative) return Math.max(a, b, c, d) * 1.05 + 0.002;
    const top = a + (b - a) * (x - column);
    const bottom = c + (d - c) * (x - column);
    return top + (bottom - top) * (y - row);
}

function lambda(cosine: number, alpha: number): number {
    const weight = (1 - alpha) ** 2;
    const interpolate = (a: number, b: number): number => a + (b - a) * weight;
    const evaluate = (x: number): number =>
        interpolate(21.5473, 25.3245) /
            (1 + interpolate(3.82987, 3.32435) * x ** interpolate(0.19823, 0.16801)) +
        interpolate(-1.9776, -1.27393) * x +
        interpolate(-4.32054, -4.85967);
    return Math.exp(cosine < 0.5 ? evaluate(cosine) : 2 * evaluate(0.5) - evaluate(1 - cosine));
}

function integrate(nv: number, roughness: number, normalize: boolean): number {
    const alpha = roughness * roughness;
    const viewSine = Math.sqrt(1 - nv * nv);
    const viewLambda = lambda(nv, alpha);
    const viewBound = albedo(nv, roughness, true);
    let result = 0;
    for (let polar = 0; polar < 128; polar++) {
        const nl = (polar + 0.5) / 128;
        const lightSine = Math.sqrt(1 - nl * nl);
        const visibilityCosine = 1 / (4 * nv * (1 + viewLambda + lambda(nl, alpha)));
        const normalization = normalize ? Math.max(1, viewBound, albedo(nl, roughness, true)) : 1;
        for (let azimuth = 0; azimuth < 256; azimuth++) {
            const phi = ((azimuth + 0.5) * 2 * Math.PI) / 256;
            const lightX = lightSine * Math.cos(phi);
            const lightY = lightSine * Math.sin(phi);
            const hz = nv + nl;
            const halfLengthSquared = (viewSine + lightX) ** 2 + lightY * lightY + hz * hz;
            const sineSquared = Math.max(1 - (hz * hz) / halfLengthSquared, 0);
            const distribution = ((2 + 1 / alpha) * sineSquared ** (0.5 / alpha)) / (2 * Math.PI);
            result += (distribution * visibilityCosine) / normalization;
        }
    }
    return (result * 2 * Math.PI) / (128 * 256);
}

describe('Charlie sheen energy', () => {
    it('preserves integration precision in a portable managed RGBA8 lookup image', () => {
        const texture = getSheenAlbedoTexture();
        expect(getSheenAlbedoTexture()).toBe(texture);
        expect(texture.width).toBe(32);
        expect(texture.height).toBe(32);
        const pixels = texture.image;
        expect(pixels).toBeInstanceOf(Uint8Array);
        if (!(pixels instanceof Uint8Array)) throw new Error('Missing sheen LUT pixels');
        for (let index = 0; index < table.length; index++) {
            const decoded =
                ((requireNumber(pixels, index * 4) * 256 + requireNumber(pixels, index * 4 + 1)) *
                    8) /
                65535;
            expect(Math.abs(decoded - requireNumber(table, index))).toBeLessThanOrEqual(
                8 / 65535 / 2
            );
        }
    });

    it('keeps the checked directional-albedo table finite and reproducible against quadrature', () => {
        expect(table).toHaveLength(1024);
        expect(table.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
        for (const [nv, roughness] of [
            [0.02, 0.05],
            [0.1, 0.2],
            [0.25, 0.5],
            [0.75, 0.8],
            [1, 1]
        ] as const) {
            const integrated = integrate(nv, roughness, false);
            expect(Math.abs(albedo(nv, roughness, false) - integrated)).toBeLessThan(
                0.03 * Math.max(integrated, 1)
            );
            expect(integrated).toBeLessThanOrEqual(albedo(nv, roughness, true));
        }
    });

    it('keeps the combined dielectric base and sheen reciprocal when view and light swap', () => {
        const combined = (nv: number, nl: number, roughness: number): number => {
            const strength = 0.8;
            const vh2 = (1 + nv * nl + Math.sqrt((1 - nv * nv) * (1 - nl * nl)) * 0.3) / 2;
            const nh2 = (nv + nl) ** 2 / (4 * vh2);
            const alpha = roughness * roughness;
            const distribution =
                ((2 + 1 / alpha) * Math.max(1 - nh2, 0) ** (0.5 / alpha)) / (2 * Math.PI);
            const bound = Math.max(albedo(nv, roughness, true), albedo(nl, roughness, true));
            const sheen =
                distribution /
                (4 * nv * nl * (1 + lambda(nv, alpha) + lambda(nl, alpha)) * Math.max(1, bound));
            const fresnel = 0.04 + 0.96 * (1 - Math.sqrt(vh2)) ** 5;
            return (
                ((1 - strength * Math.min(bound, 1)) * (1 - fresnel)) / Math.PI + strength * sheen
            );
        };
        for (const roughness of [0.05, 0.2, 0.7, 1]) {
            for (const [view, light] of [
                [0.01, 0.6],
                [0.2, 0.9],
                [0.95, 0.4]
            ] as const) {
                expect(combined(view, light, roughness)).toBeCloseTo(
                    combined(light, view, roughness),
                    12
                );
            }
        }
    });

    it('never adds energy over a white diffuse furnace, including smooth grazing fibers', () => {
        for (const roughness of [0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
            for (const nv of [0.0001, 0.01, 0.1, 0.5, 1]) {
                const sheenEnergy = integrate(nv, roughness, true);
                const remainingBase = 1 - Math.min(albedo(nv, roughness, true), 1);
                expect(sheenEnergy).toBeGreaterThanOrEqual(0);
                expect(sheenEnergy + remainingBase).toBeLessThanOrEqual(1.005);
            }
        }
    });
});
