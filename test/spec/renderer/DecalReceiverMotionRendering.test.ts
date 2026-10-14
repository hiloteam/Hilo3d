import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import AmbientLight from '../../../src/light/AmbientLight';
import Color from '../../../src/math/Color';
import Texture from '../../../src/texture/Texture';
import Renderer from '../../../src/render/Renderer';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { TemporalAA } from '../../../src/render/postprocessing/TemporalAA';
import { DecalProjector } from '../../../src/render/decals/DecalProjector';
import { DecalReceiverPose } from '../../../src/render/decals/DecalReceiverPose';

function maximumDifference(a: Uint8Array, b: Uint8Array): number {
    expect(a.length).toBe(b.length);
    let maximum = 0;
    for (let index = 0; index < a.length; index++) {
        if (index % 4 !== 3)
            maximum = Math.max(maximum, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    }
    return maximum;
}

async function movedPaint(
    backend: 'webgl2' | 'webgpu',
    mode: 'old' | 'fixed' | 'fresh'
): Promise<Uint8Array> {
    const source = new Texture({ width: 1, height: 1, image: new Uint8Array([255, 0, 0, 255]) });
    const material = new PBRMaterial({
        baseColor: new Color(0, 1, 0),
        metallic: 0,
        roughness: 1,
        temporalReactiveFactor: mode === 'fresh' ? 1 : 0,
        decals: {
            projectors: [new DecalProjector({ edgeFade: 0 })],
            baseColorAtlas: source,
            baseColorEncoding: 'linear'
        }
    });
    const scene = new Node();
    const mesh = new Mesh({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }).addTo(
        scene
    );
    new AmbientLight({ amount: 1 }).addTo(scene);
    const camera = new PerspectiveCamera({ z: 2, aspect: 1, near: 0.1, far: 10, fov: 50 });
    const renderer = await Renderer.create({
        backend,
        width: 64,
        height: 64,
        domElement: document.createElement('canvas'),
        antialias: false,
        renderPipeline: new ForwardRenderPipelineFactory({
            sceneColorFormat: 'rgba16float',
            features: [new TemporalAA({ historyWeight: 0.94, varianceGamma: 2, sharpness: 0 })]
        })
    });
    const target = renderer.createRenderTarget({
        width: 64,
        height: 64,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: false
    });
    const original = Reflect.get(DecalReceiverPose.prototype, 'observe');
    const spy =
        mode === 'old'
            ? vi.spyOn(DecalReceiverPose.prototype, 'observe').mockImplementation(function (
                  this: DecalReceiverPose,
                  receiver
              ) {
                  original.call(this, receiver);
                  // Causal control: keep content tracking, jitter and all TAA rejection/clipping policies;
                  // reproduce the former omission of receiver pose from submitted decal history identity.
                  return 1;
              })
            : null;
    try {
        for (let frame = 0; frame < 16; frame++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        }
        mesh.x += 0.02;
        renderer.renderToTarget(target, scene, camera);
        await renderer.waitForIdle();
        return (await target.readColorAttachment()).data.slice();
    } finally {
        spy?.mockRestore();
        target.destroy();
        renderer.destroy();
        source.destroy();
    }
}

describe('moving receivers under fixed world-space decals', () => {
    it.each(['webgl2', 'webgpu'] as const)(
        'rejects shifted old paint on %s while neighboring paint remains inside the variance neighborhood',
        async backend => {
            const stale = await movedPaint(backend, 'old');
            const fixed = await movedPaint(backend, 'fixed');
            // Authored reactivity gives the same jittered current-frame shading without history. It is
            // an oracle only: the fixed production receiver retains its ordinary reactive factor zero.
            const fresh = await movedPaint(backend, 'fresh');
            let red = 0,
                green = 0;
            for (let index = 0; index < fresh.length; index += 4) {
                if ((fresh[index] ?? 0) > 40) red++;
                if ((fresh[index + 1] ?? 0) > 40) green++;
            }
            expect(red).toBeGreaterThan(100);
            expect(green).toBeGreaterThan(100);
            expect(maximumDifference(stale, fresh)).toBeGreaterThan(8);
            expect(maximumDifference(fixed, fresh)).toBeLessThanOrEqual(1);
        },
        120_000
    );
});
