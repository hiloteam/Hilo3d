/**
 * Regenerate the checked Charlie directional-albedo constants:
 *   npx jiti scripts/generate-sheen-albedo.ts
 *
 * Distribution/visibility: Conty Estevez and Kulla, SIGGRAPH 2017, as specified by
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_sheen
 * Integrates D * V * NdotL over the light hemisphere using 128-point Gauss-Legendre
 * polar quadrature and 256 midpoint azimuth samples. No external assets or fits.
 */
import { writeFile } from 'node:fs/promises';
import { requireNumber } from '../src/math/numberArray';
import { format, resolveConfig } from 'prettier';

function gaussLegendre(count: number): readonly [number[], number[]] {
    const nodes: number[] = [];
    const weights: number[] = [];
    for (let index = 0; index < count; index++) {
        let root = Math.cos((Math.PI * (index + 0.75)) / (count + 0.5));
        let derivative = 0;
        for (let iteration = 0; iteration < 20; iteration++) {
            let p0 = 1;
            let p1 = root;
            for (let degree = 2; degree <= count; degree++) {
                const next = ((2 * degree - 1) * root * p1 - (degree - 1) * p0) / degree;
                p0 = p1;
                p1 = next;
            }
            derivative = (count * (root * p1 - p0)) / (root * root - 1);
            const delta = p1 / derivative;
            root -= delta;
            if (Math.abs(delta) < 1e-14) break;
        }
        nodes.push((root + 1) / 2);
        weights.push(1 / ((1 - root * root) * derivative * derivative));
    }
    return [nodes, weights];
}

function lambda(cosine: number, alpha: number): number {
    const t = (1 - alpha) ** 2;
    const a = 21.5473 + (25.3245 - 21.5473) * t;
    const b = 3.82987 + (3.32435 - 3.82987) * t;
    const c = 0.19823 + (0.16801 - 0.19823) * t;
    const d = -1.9776 + (-1.27393 + 1.9776) * t;
    const e = -4.32054 + (-4.85967 + 4.32054) * t;
    const curve = (x: number): number => a / (1 + b * x ** c) + d * x + e;
    return Math.exp(cosine < 0.5 ? curve(cosine) : 2 * curve(0.5) - curve(1 - cosine));
}

const [nodes, weights] = gaussLegendre(128);
const values: string[] = [];
for (let row = 0; row < 32; row++) {
    const roughness = 0.05 + (row / 31) * 0.95;
    const alpha = roughness * roughness;
    for (let column = 0; column < 32; column++) {
        const nv = Math.max((column / 31) ** 2, 1e-4);
        const vx = Math.sqrt(1 - nv * nv);
        let integral = 0;
        for (let polar = 0; polar < nodes.length; polar++) {
            const nl = requireNumber(nodes, polar);
            const weight = requireNumber(weights, polar);
            const sine = Math.sqrt(1 - nl * nl);
            for (let azimuth = 0; azimuth < 256; azimuth++) {
                const phi = ((azimuth + 0.5) * 2 * Math.PI) / 256;
                const hx = vx + sine * Math.cos(phi);
                const hy = sine * Math.sin(phi);
                const hz = nv + nl;
                const nh2 = (hz * hz) / (hx * hx + hy * hy + hz * hz);
                const distribution =
                    ((2 + 1 / alpha) * Math.max(1 - nh2, 0) ** (0.5 / alpha)) / (2 * Math.PI);
                integral +=
                    (distribution * weight * ((2 * Math.PI) / 256)) /
                    (4 * nv * (1 + lambda(nv, alpha) + lambda(nl, alpha)));
            }
        }
        values.push(integral.toFixed(7));
    }
}
const rows = Array.from(
    { length: 128 },
    (_, row) => `    ${values.slice(row * 8, row * 8 + 8).join(', ')}`
);
const output = new URL('../src/render/renderer/SheenAlbedoData.ts', import.meta.url);
const source =
    '// Checked integration data. Regenerate with scripts/generate-sheen-albedo.ts.\n' +
    '// Rows: roughness in [0.05, 1]; columns: sqrt(NdotV) in [0, 1].\n' +
    `export const sheenAlbedoData: readonly number[] = [\n${rows.join(',\n')}\n];\n`;
await writeFile(
    output,
    await format(source, {
        ...(await resolveConfig(output)),
        parser: 'typescript'
    })
);
