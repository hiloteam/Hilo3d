import { describe, expect, it } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import GeometryData from '../../../src/geometry/GeometryData';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';

type RGBA = readonly [number, number, number, number];
type RGB = readonly [number, number, number];

function decodeFloat16(bits: number): number {
    const sign = (bits & 0x8000) === 0 ? 1 : -1;
    const exponent = (bits >>> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
    if (exponent === 0) return sign * fraction * 2 ** -24;
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

async function center(target: RenderTarget): Promise<RGBA> {
    const readback = await target.readColorAttachment({
        x: Math.floor(target.width / 2),
        y: Math.floor(target.height / 2),
        width: 1,
        height: 1
    });
    // Public readback returns native binary16 texels, not Float32Array or normalized RGBA8.
    expect(readback).toMatchObject({
        format: 'rgba16float',
        width: 1,
        height: 1,
        bytesPerPixel: 8,
        bytesPerRow: 8
    });
    expect(readback.data.byteLength).toBe(8);
    const view = new DataView(
        readback.data.buffer,
        readback.data.byteOffset,
        readback.data.byteLength
    );
    const rgba: RGBA = [
        decodeFloat16(view.getUint16(0, true)),
        decodeFloat16(view.getUint16(2, true)),
        decodeFloat16(view.getUint16(4, true)),
        decodeFloat16(view.getUint16(6, true))
    ];
    for (const component of rgba) expect(Number.isFinite(component)).toBe(true);
    return rgba;
}

function createTarget(renderer: Renderer): RenderTarget {
    return renderer.createRenderTarget({
        width: 16,
        height: 16,
        colorAttachments: [{ format: 'rgba16float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
    });
}

function weightedMaterial(color: RGB, opacity: number): BasicMaterial {
    return new BasicMaterial({
        lightType: 'NONE',
        diffuse: new Color(...color),
        opacity,
        compositing: { mode: 'weighted-blended' }
    });
}

function createLayers(count: number, color: RGB, opacity: number, useInstanced = false): Node {
    const scene = new Node();
    const geometry = new PlaneGeometry({ width: 2, height: 2 });
    const material = weightedMaterial(color, opacity);
    for (let index = 0; index < count; index++) {
        new Mesh({ geometry, material, useInstanced, z: -index / 1000 }).addTo(scene);
    }
    return scene;
}

describe('weighted transparency fragment budget validation', () => {
    it('rejects alpha-to-coverage on a weighted material', () => {
        expect(
            () =>
                new BasicMaterial({
                    coverage: { mode: 'alpha-to-coverage', cutoff: 0.5 },
                    compositing: { mode: 'weighted-blended' }
                })
        ).toThrow(/alpha-to-coverage/u);
    });

    it.each([0, -1, 1.5, NaN, Infinity, 1_048_577])('rejects maxFragmentCount %s', value => {
        expect(
            () =>
                new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: { maxFragmentCount: value }
                })
        ).toThrow(/maxFragmentCount/u);
    });
});

describe.each(['webgl2', 'webgpu'] as const)(
    'weighted transparency precision through %s',
    backend => {
        it.each([false, true])(
            'retains finite HDR through 70 opaque weighted layers with planner instancing %s',
            async useInstanced => {
                const renderer = await Renderer.create({
                    backend,
                    width: 16,
                    height: 16,
                    antialias: false,
                    useInstanced,
                    domElement: document.createElement('canvas'),
                    renderPipeline: new ForwardRenderPipelineFactory({
                        weightedBlendedTransparency: { maxFragmentCount: 140 }
                    })
                });
                const target = createTarget(renderer);
                const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
                const radiance: RGB = [1000, 500, 250];
                const scene = createLayers(70, radiance, 1, useInstanced);
                try {
                    renderer.renderToTarget(target, scene, camera);
                    const actual = await center(target);
                    // Equal colors have weighted mean C and 1 - product(1 - alpha) = 1.
                    // The old RGBA16 sum of 70 * 1000 = 70,000 overflowed before division.
                    // Summing half-ULP bounds at each of the 70 partial sums gives <= 12.497
                    // error in the red mean. Allow 0.5 for the final HDR texel conversion.
                    for (const index of [0, 1, 2] as const) {
                        expect(Math.abs(actual[index] - radiance[index])).toBeLessThanOrEqual(
                            (13 * radiance[index]) / 1000
                        );
                    }
                    expect(actual[3]).toBe(1);
                } finally {
                    target.destroy();
                    renderer.destroy();
                }
            }
        );

        it('retains the largest finite FP16 radiance through eight opaque layers', async () => {
            const renderer = await Renderer.create({
                backend,
                width: 16,
                height: 16,
                antialias: false,
                domElement: document.createElement('canvas'),
                renderPipeline: new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: true
                })
            });
            const target = createTarget(renderer);
            const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
            const scene = createLayers(8, [65504, 65504, 65504], 1);
            try {
                renderer.renderToTarget(target, scene, camera);
                const actual = await center(target);
                for (const index of [0, 1, 2] as const) {
                    // The exact weighted mean is 65504. Summed half-ULP bounds give
                    // <= 102 error in the eight-term mean; final conversion adds <= 16.
                    expect(Math.abs(actual[index] - 65504)).toBeLessThanOrEqual(128);
                    expect(actual[index]).toBeLessThanOrEqual(65504);
                }
                expect(actual[3]).toBe(1);
            } finally {
                target.destroy();
                renderer.destroy();
            }
        });

        it('retains coverage from 256 coincident planner instances below revealage unit precision', async () => {
            const renderer = await Renderer.create({
                backend,
                width: 16,
                height: 16,
                antialias: false,
                useInstanced: true,
                domElement: document.createElement('canvas'),
                renderPipeline: new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: true
                })
            });
            const target = createTarget(renderer);
            const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
            const opacity = 1 / 16384;
            const layerCount = 256;
            const expectedAlpha = -Math.expm1(layerCount * Math.log1p(-opacity));
            const geometry = new PlaneGeometry({ width: 2, height: 2 });
            const material = weightedMaterial([1, 1, 1], opacity);
            const scene = new Node();
            for (let index = 0; index < layerCount; index++) {
                // Every transform is identical: every interior pixel receives all 256 layers.
                new Mesh({ geometry, material, useInstanced: true }).addTo(scene);
            }
            try {
                renderer.renderToTarget(target, scene, camera);
                const actual = await center(target);
                // tau=-log(1-2^-14) rounds to 2^-14 in binary16; 256 equal terms
                // sum exactly to 2^-6. The resulting coverage error is < 4.7e-7.
                // Two output ULPs at alpha~0.0155 also cover shader/final FP16 rounding.
                const tolerance = 2 * 2 ** -17;
                for (const component of actual) {
                    expect(component).toBeGreaterThan(0);
                    expect(Math.abs(component - expectedAlpha)).toBeLessThanOrEqual(tolerance);
                }
            } finally {
                target.destroy();
                renderer.destroy();
            }
        });

        it('retains dark low-opacity radiance separately from revealage rounding', async () => {
            const renderer = await Renderer.create({
                backend,
                width: 16,
                height: 16,
                antialias: false,
                domElement: document.createElement('canvas'),
                renderPipeline: new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: true
                })
            });
            const target = createTarget(renderer);
            const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
            const radiance: RGB = [1 / 256, 1 / 128, 1 / 64];
            const opacity = 1 / 64;
            const layerCount = 16;
            const expectedAlpha = 1 - (1 - opacity) ** layerCount;
            const scene = createLayers(layerCount, radiance, opacity);
            try {
                renderer.renderToTarget(target, scene, camera);
                const actual = await center(target);
                // For binary16 u=2^-11, gamma(16)=16u/(1-16u). The accumulated
                // optical depth is ~0.252; its error and final alpha rounding stay < 0.004.
                expect(Math.abs(actual[3] - expectedAlpha)).toBeLessThanOrEqual(0.004);
                for (const index of [0, 1, 2] as const) {
                    // For binary16 u=2^-11, gamma(16)=16u/(1-16u). The quotient of
                    // two positive accumulated sums has relative error <= 2gamma/(1-gamma).
                    // Including output rounding, 1.7% bounds normalized color independently
                    // of the revealage error; black or flushed-to-zero results cannot pass.
                    expect(
                        Math.abs(actual[index] / actual[3] - radiance[index]) / radiance[index]
                    ).toBeLessThanOrEqual(0.017);
                    expect(
                        Math.abs(actual[index] - radiance[index] * expectedAlpha)
                    ).toBeLessThanOrEqual(
                        radiance[index] * (0.004 + expectedAlpha * 0.017 + 0.004 * 0.017)
                    );
                }
            } finally {
                target.destroy();
                renderer.destroy();
            }
        });

        it.each(['separate meshes', 'planner instances', 'direct instances'] as const)(
            'rejects excess primitive counts in %s before submission and can retry',
            async mode => {
                const canvas = document.createElement('canvas');
                const diagnostics = registerRendererDiagnostics(canvas);
                const useInstanced = mode === 'planner instances';
                const renderer = await Renderer.create({
                    backend,
                    width: 16,
                    height: 16,
                    antialias: false,
                    useInstanced,
                    domElement: canvas,
                    renderPipeline: new ForwardRenderPipelineFactory({
                        weightedBlendedTransparency: { maxFragmentCount: 4 }
                    })
                });
                const target = createTarget(renderer);
                const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
                const geometry = new PlaneGeometry({ width: 2, height: 2 });
                const material = weightedMaterial([1, 1, 1], 0.5);
                const scene = new Node();
                const first = new Mesh({ geometry, material, useInstanced });
                first.addTo(scene);
                const excess = new Mesh({ geometry, material, useInstanced, z: -0.002 });
                if (mode === 'direct instances') {
                    geometry.colors = new GeometryData(new Float32Array(12).fill(1), 4, {
                        stepMode: 'instance'
                    });
                    first.instanceCount = 2;
                } else {
                    new Mesh({ geometry, material, useInstanced, z: -0.001 }).addTo(scene);
                }
                try {
                    // Two quads contribute a conservative four triangles to the bound.
                    renderer.renderToTarget(target, scene, camera);
                    const before = await center(target);
                    expect(before[3]).toBe(0.75);
                    if (mode === 'direct instances') first.instanceCount = 3;
                    else excess.addTo(scene);

                    expect(() => {
                        renderer.renderToTarget(target, scene, camera);
                    }).toThrow(/maxFragmentCount/u);
                    expect(diagnostics.snapshot().frame).toMatchObject({
                        submissions: 0,
                        draws: 0,
                        passes: 0
                    });
                    expect(await center(target)).toEqual(before);

                    if (mode === 'direct instances') first.instanceCount = 2;
                    else excess.removeFromParent();
                    renderer.renderToTarget(target, scene, camera);
                    expect(await center(target)).toEqual(before);
                } finally {
                    unregisterRendererDiagnostics(canvas);
                    target.destroy();
                    renderer.destroy();
                }
            }
        );
    }
);
