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

interface Stability {
    readonly meanDifference: number;
    readonly phases: readonly number[];
}

async function measureStaticEdges(
    backend: 'webgl2' | 'webgpu',
    compensateJitter: boolean,
    renderScale = 1
): Promise<Stability> {
    const scene = new Node();
    const geometry = new BoxGeometry();
    const material = new PBRMaterial({
        metallic: 0,
        roughness: 1,
        baseColor: new Color(0, 0, 0),
        emissionFactor: new Color(1, 1, 1)
    });
    for (const [x, y, width, height, angle] of [
        [-0.68, 0.12, 0.23, 2.3, 27],
        [0.42, 0.18, 0.31, 2.5, -19],
        [0, -0.6, 2.4, 0.19, 13],
        [0.14, 0.7, 2.1, 0.13, -11]
    ] as const) {
        scene.addChild(
            new Mesh({
                geometry,
                material,
                x,
                y,
                scaleX: width,
                scaleY: height,
                scaleZ: 0.1,
                rotationZ: angle,
                frustumTest: false
            })
        );
    }
    const temporalAA = { renderScale, historyWeight: 0.94, varianceGamma: 1, sharpness: 0 };
    const factory =
        backend === 'webgpu'
            ? new ClusteredForwardPlusPipelineFactory({
                  buckets: [{ geometry, material }],
                  maxObjects: 8,
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
            backend === 'webgl2'
                ? false
                : { format: 'depth32float', depthMode: 'reversed', sampled: true }
    });
    const camera = new PerspectiveCamera({
        aspect: 1,
        near: 0.1,
        far: 10,
        z: 4,
        fov: 50,
        depthMode: 'reversed'
    });
    const phases: number[] = [];
    const patchedShaders = new WeakSet();
    const resolve = Reflect.get(TemporalResolveController.prototype, 'resolve');
    const spy = vi
        .spyOn(TemporalResolveController.prototype, 'resolve')
        .mockImplementation(function (this: TemporalResolveController, context, frame, ...inputs) {
            phases.push(frame.state.pendingJitterIndex);
            expect(frame.historyValid).toBe(phases.length > 1);
            expect(frame.state.bindings.block.byteLength).toBe(32);
            expect(frame.state.bindings.block.layout.fields.u_jitterDelta.offset).toBe(16);
            // Causal control: retain TAA, the same jitter, weights and variance clipping, but
            // restore the three old resolve expressions that rejected legitimate edge history.
            if (!compensateJitter) {
                const shader =
                    frame.renderScale < 1
                        ? frame.state.bindings.upscale.shader
                        : frame.state.bindings.resolve.shader;
                if (!patchedShaders.has(shader))
                    shader.fs = shader.fs
                        .replace(
                            'vec2 physicalMotion = temporalPhysicalMotion(motion.xy);',
                            'vec2 physicalMotion = motion.xy;'
                        )
                        .replace(
                            'vec4 motion = temporalMotionAt(pixel, dimensions);',
                            'vec4 motion = texelFetch(u_velocity, pixel, 0);'
                        )
                        .replace(
                            'vec4 motion = temporalMotionAt(pixel, currentDimensions);',
                            'vec4 motion = texelFetch(u_velocity, pixel, 0);'
                        )
                        .replace(
                            /float luminanceDelta = temporalLuminanceDelta\([\s\S]*?\);/u,
                            'float luminanceDelta = abs(previousWorking.x - currentWorking.x) / max(max(abs(previousWorking.x), abs(currentWorking.x)), 0.1);'
                        );
                patchedShaders.add(shader);
            }
            return resolve.call(this, context, frame, ...inputs);
        });
    const frames: Uint8Array[] = [];
    try {
        for (let frame = 0; frame < 49; frame++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
            if (frame >= 40) frames.push((await target.readColorAttachment()).data.slice());
        }
    } finally {
        spy.mockRestore();
        target.destroy();
        renderer.destroy();
    }
    let difference = 0;
    for (let frame = 1; frame < frames.length; frame++) {
        const previous = frames[frame - 1],
            current = frames[frame];
        if (!previous || !current) throw new Error('Missing temporal fixture pixels');
        for (let index = 0; index < current.length; index++) {
            if (index % 4 !== 3)
                difference += Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
        }
    }
    return { meanDifference: difference / (8 * 64 * 64 * 3), phases };
}

describe('Temporal resolve fixed-grid jitter compensation', () => {
    it.each([
        ['webgl2', 1],
        ['webgpu', 1],
        ['webgpu', 0.75]
    ] as const)(
        'reduces eight-phase static edge flicker without disabling TAA on %s at scale %s',
        async (backend, renderScale) => {
            const before = await measureStaticEdges(backend, false, renderScale);
            const after = await measureStaticEdges(backend, true, renderScale);
            console.info('Temporal jitter stability', backend, renderScale, {
                before: before.meanDifference,
                after: after.meanDifference
            });
            expect(after.phases).toEqual(before.phases);
            expect(after.phases).toEqual(Array.from({ length: 49 }, (_value, index) => index % 8));
            expect(before.meanDifference).toBeGreaterThan(0.25);
            expect(after.meanDifference).toBeLessThan(before.meanDifference * 0.2);
        },
        60_000
    );
});
