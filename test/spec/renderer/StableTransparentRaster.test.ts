import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import type { RenderPipelineFactory } from '../../../src/render/pipeline/RenderPipeline';
import {
    TemporalAA,
    TemporalResolveController
} from '../../../src/render/postprocessing/TemporalAA';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

type Lane = 'forward-webgl2' | 'forward-webgpu' | 'clustered-webgpu';
type Mode = 'sorted' | 'weighted' | 'transmission';
type Depth = 'standard' | 'reversed';

interface Fixture {
    readonly stableDepthPassName: string;
    readonly renderer: Renderer;
    readonly scene: Node;
    readonly transparent: Mesh;
    readonly opaque: Mesh;
    readonly phases: readonly number[];
    capture(): Promise<Uint8Array>;
    draw(): void;
    passNames(): readonly string[];
    failNextRecord(value: boolean): void;
    resize(size: number): void;
    release(): void;
    destroy(): void;
}

async function fixture(
    lane: Lane,
    mode: Mode,
    depthMode: Depth,
    renderScale: number,
    transmissionOnly = false
): Promise<Fixture> {
    const scene = new Node();
    const geometry = new PlaneGeometry({ width: 2.6, height: 1.7 });
    const material =
        mode === 'transmission'
            ? new PBRMaterial({
                  baseColor: new Color(1, 1, 1),
                  emissionFactor: new Color(0.8, 0, 0),
                  metallic: 0,
                  roughness: 0.25,
                  transmissionFactor: 0.8,
                  compositing: { mode: 'opaque' }
              })
            : new BasicMaterial({
                  lightType: 'NONE',
                  diffuse: new Color(1, 0, 0),
                  opacity: 0.6,
                  compositing:
                      mode === 'weighted'
                          ? { mode: 'weighted-blended' }
                          : { mode: 'alpha-blend', premultiplied: false }
              });
    const transparent = new Mesh({
        geometry,
        material,
        x: 0.18,
        y: 0.07,
        rotationZ: 23,
        frustumTest: false
    }).addTo(scene);
    const opaqueGeometry = new PlaneGeometry({ width: 0.65, height: 2.4 });
    const opaqueMaterial = new PBRMaterial({
        baseColor: new Color(0, 0, 0),
        metallic: 0,
        roughness: 1
    });
    const opaque = new Mesh({
        geometry: opaqueGeometry,
        material: opaqueMaterial,
        x: -0.35,
        z: 0.7,
        rotationZ: -13,
        frustumTest: false
    });
    if (!transmissionOnly) opaque.addTo(scene);
    const temporal = { renderScale, historyWeight: 0.94, sharpness: 0 };
    const pipeline: RenderPipelineFactory =
        lane === 'clustered-webgpu'
            ? new ClusteredForwardPlusPipelineFactory({
                  buckets: [{ geometry: opaqueGeometry, material: opaqueMaterial }],
                  maxObjects: 4,
                  maxLights: 1,
                  maxLightIndices: 32,
                  maxLightsPerCluster: 1,
                  maxViewportWidth: 96,
                  maxViewportHeight: 96,
                  hiZ: false,
                  bloomStrength: 0,
                  weightedBlendedTransparency: true,
                  temporalAA: temporal
              })
            : new ForwardRenderPipelineFactory({
                  sceneColorFormat: 'rgba16float',
                  weightedBlendedTransparency: true,
                  opaqueTexture: mode === 'transmission',
                  features: [new TemporalAA(temporal)]
              });
    let fail = false;
    const wrapped: RenderPipelineFactory = {
        name: 'stable transparent raster lifecycle',
        ...(pipeline.requirements === undefined ? {} : { requirements: pipeline.requirements }),
        async create(context) {
            const runtime = await pipeline.create(context);
            return {
                name: runtime.name,
                record(frame): void {
                    runtime.record(frame);
                    if (fail) throw new Error('discard stable transparent candidate');
                },
                frameSubmitted(index): void {
                    runtime.frameSubmitted?.(index);
                },
                frameDiscarded(index): void {
                    runtime.frameDiscarded?.(index);
                },
                destroy(): void {
                    runtime.destroy();
                }
            };
        }
    };
    const canvas = document.createElement('canvas');
    const diagnostics = registerRendererDiagnostics(canvas);
    const renderer = await Renderer.create({
        backend: lane === 'forward-webgl2' ? 'webgl2' : 'webgpu',
        domElement: canvas,
        width: 64,
        height: 64,
        antialias: false,
        renderPipeline: wrapped
    });
    renderer.clearColor = new Color(0, 0, 0);
    const camera = new PerspectiveCamera({
        z: 4,
        aspect: 1,
        near: 0.1,
        far: 10,
        fov: 50,
        depthMode
    });
    let size = 64;
    const createTarget = (): RenderTarget =>
        renderer.createRenderTarget({
            width: size,
            height: size,
            colorAttachments: [{ format: 'rgba8unorm', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
            depthStencilAttachment:
                lane === 'clustered-webgpu' ? { format: 'depth32float', depthMode } : false
        });
    let target = createTarget();
    const phases: number[] = [];
    const originalResolve = Reflect.get(TemporalResolveController.prototype, 'resolve');
    const phaseSpy = vi
        .spyOn(TemporalResolveController.prototype, 'resolve')
        .mockImplementation(function (this: TemporalResolveController, context, frame, ...inputs) {
            phases.push(frame.state.pendingJitterIndex);
            return originalResolve.call(this, context, frame, ...inputs);
        });
    const draw = (): void => {
        renderer.renderToTarget(target, scene, camera);
    };
    return {
        stableDepthPassName:
            lane === 'clustered-webgpu'
                ? 'Stable transparent GPU Scene depth buckets'
                : 'Stable transparent opaque depth',
        renderer,
        scene,
        transparent,
        opaque,
        phases,
        draw,
        async capture(): Promise<Uint8Array> {
            draw();
            await renderer.waitForIdle();
            return (await target.readColorAttachment()).data.slice();
        },
        passNames(): readonly string[] {
            return diagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
        },
        failNextRecord(value): void {
            fail = value;
        },
        resize(next): void {
            size = next;
            renderer.resize(next, next);
            target.resize(next, next);
        },
        release(): void {
            renderer.releaseGPUResources();
            target = createTarget();
        },
        destroy(): void {
            phaseSpy.mockRestore();
            target.destroy();
            renderer.destroy();
            unregisterRendererDiagnostics(canvas, diagnostics);
        }
    };
}

function redCount(pixels: Uint8Array): number {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 16) count++;
    return count;
}

function maximumDifference(a: Uint8Array, b: Uint8Array): number {
    expect(a.length).toBe(b.length);
    let result = 0;
    for (let index = 0; index < a.length; index++)
        if (index % 4 !== 3) result = Math.max(result, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    return result;
}

function expectBlack(pixels: Uint8Array): void {
    for (let index = 0; index < pixels.length; index++)
        if (index % 4 !== 3) expect(pixels[index]).toBeLessThanOrEqual(1);
}

async function expectStableFrames(state: Fixture, count: number): Promise<Uint8Array> {
    const reference = await state.capture();
    expect(redCount(reference)).toBeGreaterThan(64);
    expect(state.passNames()).toContain(state.stableDepthPassName);
    for (let frame = 1; frame < count; frame++) {
        const pixels = await state.capture();
        expect(
            maximumDifference(pixels, reference),
            `visible geometry/depth edges changed during static phase ${String(frame)}`
        ).toBeLessThanOrEqual(1);
    }
    return reference;
}

const matrix: { lane: Lane; mode: 'sorted' | 'weighted'; depth: Depth; scale: number }[] = [];
for (const lane of ['forward-webgl2', 'forward-webgpu', 'clustered-webgpu'] as const)
    for (const mode of ['sorted', 'weighted'] as const)
        for (const depth of ['standard', 'reversed'] as const)
            for (const scale of [1, 0.5]) matrix.push({ lane, mode, depth, scale });

describe('post-temporal transparent raster stability', () => {
    it.each(matrix)(
        '$lane $mode with $depth depth at scale $scale keeps 16 phases and both boundaries fixed',
        async ({ lane, mode, depth, scale }) => {
            const state = await fixture(lane, mode, depth, scale);
            try {
                const reference = await expectStableFrames(state, 16);
                expect(state.phases).toEqual(
                    Array.from({ length: 16 }, (_value, index) => index % 8)
                );
                // Both the mesh silhouette and a foreground depth silhouette contribute visible edges.
                // The occluder and opaque background are black, so opaque TAA edge convergence cannot
                // account for any red-pixel difference in this fixture.
                state.opaque.visible = false;
                const unobstructed = await state.capture();
                expect(redCount(unobstructed) - redCount(reference)).toBeGreaterThan(48);
                state.opaque.visible = true;
                expect(maximumDifference(await state.capture(), reference)).toBeLessThanOrEqual(1);
                state.transparent.visible = false;
                expectBlack(await state.capture());
                expect(state.passNames()).not.toContain(state.stableDepthPassName);
                state.transparent.visible = true;
                state.transparent.removeFromParent();
                expectBlack(await state.capture());
                expect(state.passNames()).not.toContain(state.stableDepthPassName);
            } finally {
                state.destroy();
            }
        },
        60_000
    );

    it.each(['forward-webgl2', 'forward-webgpu', 'clustered-webgpu'] as const)(
        '%s keeps movement, failed-record retry, resize and recovery on the same fixed grid',
        async lane => {
            const state = await fixture(lane, 'weighted', 'reversed', 0.5);
            try {
                const before = await expectStableFrames(state, 8);
                state.transparent.x += 0.8;
                const moved = await expectStableFrames(state, 8);
                let vacated = 0;
                for (let index = 0; index < before.length; index += 4)
                    if ((before[index] ?? 0) > 16 && (moved[index] ?? 0) <= 1) vacated++;
                expect(vacated).toBeGreaterThan(48);
                state.failNextRecord(true);
                expect(() => {
                    state.draw();
                }).toThrow(/discard stable transparent candidate/u);
                const discardedPhase = state.phases.at(-1);
                state.failNextRecord(false);
                expect(maximumDifference(await state.capture(), moved)).toBeLessThanOrEqual(1);
                expect(state.phases.at(-1)).toBe(discardedPhase);
                state.resize(80);
                const resized = await expectStableFrames(state, 8);
                state.release();
                expect(maximumDifference(await state.capture(), resized)).toBeLessThanOrEqual(1);
                state.transparent.visible = false;
                expectBlack(await state.capture());
                expect(state.passNames()).not.toContain(state.stableDepthPassName);
            } finally {
                state.destroy();
            }
        },
        60_000
    );

    it.each(['forward-webgl2', 'forward-webgpu'] as const)(
        '%s detects a transmission-only unblended PBR surface and stabilizes eight phases',
        async lane => {
            const state = await fixture(lane, 'transmission', 'standard', 0.5, true);
            try {
                expect(state.transparent.material?.isTransparent).toBe(false);
                expect(state.transparent.material?.forwardQueue).toBe('transparent');
                await expectStableFrames(state, 8);
                expect(state.phases).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
                state.transparent.visible = false;
                expectBlack(await state.capture());
                expect(state.passNames()).not.toContain(state.stableDepthPassName);
            } finally {
                state.destroy();
            }
        },
        60_000
    );
});
