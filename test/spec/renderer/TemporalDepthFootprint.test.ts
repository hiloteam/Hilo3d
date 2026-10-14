import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import { PostProcessRenderPipelineFactory } from '../../../src/render/postprocessing/PostProcessRenderPipeline';
import { TemporalResolveController } from '../../../src/render/postprocessing/TemporalAA';

interface Measurement {
    meanDifference: number;
    peakChangedRatio: number;
    phases: readonly number[];
}

function halton(index: number, base: number): number {
    let result = 0;
    let fraction = 1 / base;
    while (index > 0) {
        result += fraction * (index % base);
        index = Math.floor(index / base);
        fraction /= base;
    }
    return result;
}

function expectBlack(pixels: Uint8Array): void {
    let maximum = 0;
    for (let index = 0; index < pixels.length; index++)
        if (index % 4 !== 3) maximum = Math.max(maximum, pixels[index] ?? 0);
    expect(
        maximum,
        'vacated geometry left temporal color after movement/removal'
    ).toBeLessThanOrEqual(1);
}

async function measure(
    backend: 'webgl2' | 'webgpu',
    symmetric: boolean,
    reverse: boolean,
    renderScale: number
): Promise<Measurement> {
    const root = new Node();
    const foreground = new Node().addTo(root);
    const geometry = new BoxGeometry();
    const white = new PBRMaterial({
        baseColor: new Color(0, 0, 0),
        metallic: 0,
        roughness: 1,
        emissionFactor: new Color(1, 1, 1)
    });
    const black = new PBRMaterial({ baseColor: new Color(0, 0, 0), metallic: 0, roughness: 1 });
    new Mesh({
        geometry,
        material: black,
        scaleX: 8,
        scaleY: 8,
        scaleZ: 0.1,
        z: -1.5,
        frustumTest: false
    }).addTo(root);
    for (const [x, y, width, height, rotation] of [
        [-0.71, 0.12, 0.07, 2.8, 27],
        [0.43, 0.18, 0.09, 2.7, -19],
        [0, -0.6, 2.8, 0.065, 13],
        [0.14, 0.7, 2.7, 0.075, -11]
    ] as const)
        new Mesh({
            geometry,
            material: white,
            x,
            y,
            scaleX: width,
            scaleY: height,
            scaleZ: 0.08,
            rotationZ: rotation,
            frustumTest: false
        }).addTo(foreground);
    // Repeat the subpixel lattice across the viewport so the causal signal is not dominated by
    // the few corner pixels of one silhouette on renderers with different output tone curves.
    for (let index = 0; index < 10; index++) {
        new Mesh({
            geometry,
            material: white,
            x: -1.15 + index * 0.25,
            y: 0.05,
            scaleX: 0.035,
            scaleY: 2.7,
            scaleZ: 0.08,
            rotationZ: -19,
            frustumTest: false
        }).addTo(foreground);
        new Mesh({
            geometry,
            material: white,
            x: 0.05,
            y: -1.15 + index * 0.25,
            scaleX: 2.7,
            scaleY: 0.035,
            scaleZ: 0.08,
            rotationZ: 13,
            frustumTest: false
        }).addTo(foreground);
    }
    // A nearer, thin diagonal occluder introduces a second real surface-depth discontinuity.
    new Mesh({
        geometry,
        material: black,
        x: 0.05,
        y: 0.04,
        z: 0.45,
        scaleX: 0.06,
        scaleY: 2.5,
        scaleZ: 0.08,
        rotationZ: 39,
        frustumTest: false
    }).addTo(foreground);
    const temporalAA = {
        renderScale,
        historyWeight: 0.94,
        varianceGamma: 1,
        depthThreshold: 0.02,
        sharpness: 0
    };
    const factory =
        backend === 'webgpu'
            ? new ClusteredForwardPlusPipelineFactory({
                  buckets: [
                      { geometry, material: white },
                      { geometry, material: black }
                  ],
                  maxObjects: 32,
                  maxLights: 1,
                  maxLightIndices: 32,
                  maxLightsPerCluster: 1,
                  maxViewportWidth: 64,
                  maxViewportHeight: 64,
                  hiZ: false,
                  bloomStrength: 0,
                  temporalAA
              })
            : new PostProcessRenderPipelineFactory({ temporalAA, bloom: false });
    const renderer = await Renderer.create({
        backend,
        domElement: document.createElement('canvas'),
        width: 64,
        height: 64,
        antialias: false,
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const target = renderer.createRenderTarget({
        width: 64,
        height: 64,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment:
            backend === 'webgpu'
                ? { format: 'depth32float', depthMode: 'reversed', sampled: true }
                : false
    });
    const camera = new PerspectiveCamera({
        z: 4,
        aspect: 1,
        near: 0.1,
        far: 12,
        fov: 50,
        depthMode: 'reversed'
    });
    const phases: number[] = [];
    const originalBegin = Reflect.get(TemporalResolveController.prototype, 'begin');
    const beginSpy = vi
        .spyOn(TemporalResolveController.prototype, 'begin')
        .mockImplementation(function (this: TemporalResolveController, context) {
            const frame: ReturnType<TemporalResolveController['begin']> = originalBegin.call(
                this,
                context
            );
            const phase = frame.state.pendingJitterIndex;
            phases.push(reverse ? 7 - phase : phase);
            if (reverse) {
                const index = 8 - phase;
                const width = Math.max(1, Math.floor(context.output.width * frame.renderScale));
                const height = Math.max(1, Math.floor(context.output.height * frame.renderScale));
                context.camera.setProjectionJitter(
                    ((halton(index, 2) - 0.5) * 2) / width,
                    ((halton(index, 3) - 0.5) * 2) / height
                );
                frame.state.pendingJitterUV[0] = context.camera.projectionJitterX * 0.5;
                frame.state.pendingJitterUV[1] = context.camera.projectionJitterY * 0.5;
            }
            return frame;
        });
    const patched = new WeakSet();
    const originalResolve = Reflect.get(TemporalResolveController.prototype, 'resolve');
    const resolveSpy = vi
        .spyOn(TemporalResolveController.prototype, 'resolve')
        .mockImplementation(function (this: TemporalResolveController, context, frame, ...inputs) {
            const shader =
                frame.renderScale < 1
                    ? frame.state.bindings.upscale.shader
                    : frame.state.bindings.resolve.shader;
            if (!symmetric && !patched.has(shader)) {
                const expression =
                    /float minimumHistoryDepthError\(vec2 historyUV, float expectedLogDepth\) \{[\s\S]*?\n\}/u;
                const match = expression.exec(shader.fs)?.[0];
                if (!match)
                    throw new Error('Missing depth footprint causal-control shader function');
                expect(match).toContain('round(samplePosition)');
                const old = match
                    .replace('round(samplePosition)', 'floor(samplePosition)')
                    .replace('int y = -1;', 'int y = 0;')
                    .replace('int x = -1;', 'int x = 0;');
                shader.fs = shader.fs.replace(expression, old);
                patched.add(shader);
            }
            return originalResolve.call(this, context, frame, ...inputs);
        });
    const capture = async (): Promise<Uint8Array> => {
        renderer.renderToTarget(target, root, camera);
        await renderer.waitForIdle();
        return (await target.readColorAttachment()).data.slice();
    };
    const frames: Uint8Array[] = [];
    try {
        for (let frame = 0; frame < 73; frame++) {
            const pixels = await capture();
            if (frame >= 64) frames.push(pixels);
        }
        expect(
            frames.some(pixels => pixels.some((value, index) => index % 4 !== 3 && value > 32))
        ).toBe(true);
        foreground.x = 8;
        expectBlack(await capture());
        foreground.x = 0;
        for (let frame = 0; frame < 8; frame++) await capture();
        foreground.removeFromParent();
        expectBlack(await capture());
    } finally {
        resolveSpy.mockRestore();
        beginSpy.mockRestore();
        target.destroy();
        renderer.destroy();
    }
    let total = 0;
    let peakChangedRatio = 0;
    for (let frame = 1; frame < frames.length; frame++) {
        const current = frames[frame],
            previous = frames[frame - 1];
        if (!current || !previous) throw new Error('Missing footprint capture');
        let changed = 0;
        for (let pixel = 0; pixel < 64 * 64; pixel++) {
            let maximum = 0;
            for (let channel = 0; channel < 3; channel++) {
                const index = pixel * 4 + channel;
                const delta = Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
                total += delta;
                maximum = Math.max(maximum, delta);
            }
            if (maximum > 3) changed++;
        }
        peakChangedRatio = Math.max(peakChangedRatio, changed / (64 * 64));
    }
    return { meanDifference: total / (8 * 64 * 64 * 3), peakChangedRatio, phases };
}

describe('symmetric temporal history depth footprint', () => {
    it.each([
        ['webgpu', false, 1],
        ['webgpu', true, 1],
        ['webgl2', false, 1],
        ['webgl2', true, 1],
        ['webgpu', false, 0.75],
        ['webgpu', true, 0.75]
    ] as const)(
        'reduces thin-edge depth rejection on %s (reverse phases: %s, scale: %s) without retaining moved or removed geometry',
        async (backend, reverse, scale) => {
            const before = await measure(backend, false, reverse, scale);
            const after = await measure(backend, true, reverse, scale);
            console.info('Depth footprint causal comparison', backend, reverse, scale, {
                before: { mean: before.meanDifference, peak: before.peakChangedRatio },
                after: { mean: after.meanDifference, peak: after.peakChangedRatio }
            });
            expect(after.phases).toEqual(before.phases);
            expect(after.phases.slice(0, 8)).toEqual(
                reverse ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7]
            );
            expect(before.meanDifference).toBeGreaterThan(0.05);
            expect(after.meanDifference).toBeLessThan(before.meanDifference * 0.8);
            expect(after.peakChangedRatio).toBeLessThanOrEqual(before.peakChangedRatio);
        },
        120_000
    );
});
