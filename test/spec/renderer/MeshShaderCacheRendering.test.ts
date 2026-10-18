import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import { SubsurfaceScatteringProfile } from '../../../src/material/SubsurfaceScatteringProfile';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { PostProcessRenderPipelineFactory } from '../../../src/render/postprocessing/PostProcessRenderPipeline';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

describe.each(['webgl2', 'webgpu'] as const)('Multi-pass mesh shader retention on %s', backend => {
    it('reuses actual scene pipelines through GTAO, SSS and temporal passes after warmup', async () => {
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend,
            width: 12,
            height: 12,
            antialias: false,
            domElement: canvas,
            renderPipeline: new PostProcessRenderPipelineFactory({
                groundTruthAmbientOcclusion: { quality: 'low' },
                subsurfaceScattering: { sampleCount: 9 },
                temporalAA: { sharpness: 0 },
                bloom: false
            })
        });
        const scene = new Node();
        const geometry = new PlaneGeometry({ width: 1.5, height: 1.5 });
        const profile = new SubsurfaceScatteringProfile({ radius: [0.12, 0.06, 0.03] });
        const material = new PBRMaterial({
            roughness: 0.8,
            metallic: 0,
            baseColor: new Color(0.8, 0.3, 0.1),
            subsurfaceProfile: profile
        });
        const meshes = [
            new Mesh({ geometry, material, x: -0.6 }).addTo(scene),
            new Mesh({ geometry, material, x: 0.6, useInstanced: true }).addTo(scene),
            new Mesh({ geometry, material, y: 0.8, useInstanced: true }).addTo(scene)
        ];
        new DirectionalLight({ amount: 2, direction: new Vector3(0, 0, -1) }).addTo(scene);
        const camera = new PerspectiveCamera({ z: 4, near: 0.1, far: 20, aspect: 1 });
        const output = renderer.createRenderTarget({
            width: 12,
            height: 12,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
        const render = async (): Promise<void> => {
            renderer.renderToTarget(output, scene, camera);
            await renderer.waitForIdle();
        };
        const colorTotals = async (): Promise<readonly [number, number, number]> => {
            const pixels = (await output.readColorAttachment()).data;
            const totals: [number, number, number] = [0, 0, 0];
            for (let index = 0; index < pixels.length; index += 4) {
                totals[0] += pixels[index] ?? 0;
                totals[1] += pixels[index + 1] ?? 0;
                totals[2] += pixels[index + 2] ?? 0;
            }
            return totals;
        };
        try {
            await render();
            // Both temporal history slots must have received a real submitted frame.
            await render();
            const beforeColor = await colorTotals();
            expect(beforeColor[0]).toBeGreaterThan(beforeColor[1]);
            const warmed = diagnostics.snapshot();
            expect(warmed.frame.draws).toBeGreaterThan(8);
            expect(warmed.renderGraph?.passes.some(pass => pass.name.includes('Subsurface'))).toBe(
                true
            );
            material.roughness = 0.75;
            material.baseColor.set(0.05, 0.8, 0.05, 1);
            material.invalidateData();
            await render();
            const steady = diagnostics.snapshot();
            expect(steady.nativeObjects.pipeline.created).toBe(
                warmed.nativeObjects.pipeline.created
            );
            expect(steady.nativeObjects.shaderModule.created).toBe(
                warmed.nativeObjects.shaderModule.created
            );
            expect(steady.nativeObjects.program.created).toBe(warmed.nativeObjects.program.created);
            await render();
            expect(diagnostics.snapshot().nativeObjects.pipeline.created).toBe(
                steady.nativeObjects.pipeline.created
            );
            const changedColor = await colorTotals();
            expect(changedColor[1]).toBeGreaterThan(changedColor[0]);
            expect(changedColor[1]).toBeGreaterThan(beforeColor[1]);
            const replacement = new PBRMaterial({
                baseColor: new Color(0.05, 0.05, 0.8),
                metallic: 0,
                roughness: 0.8,
                sheenColor: new Color(0.05, 0.05, 0.2),
                subsurfaceProfile: profile
            });
            for (const mesh of meshes) mesh.material = replacement;
            await render();
            const replaced = diagnostics.snapshot();
            expect(replaced.nativeObjects.shaderModule.created).toBeGreaterThan(
                steady.nativeObjects.shaderModule.created
            );
            await render();
            expect(diagnostics.snapshot().nativeObjects.shaderModule.created).toBe(
                replaced.nativeObjects.shaderModule.created
            );
            const replacedColor = await colorTotals();
            expect(replacedColor[2]).toBeGreaterThan(replacedColor[1]);
            if (backend === 'webgpu') {
                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('Mesh cache recovery device unavailable');
                const restored = new Promise<void>(resolve => {
                    renderer.on(
                        'webgpuDeviceRestored',
                        () => {
                            resolve();
                        },
                        true
                    );
                });
                extension.device.destroy();
                await restored;
                await renderer.waitForIdle();
                await render();
                await render();
                const recovered = diagnostics.snapshot();
                await render();
                expect(diagnostics.snapshot().nativeObjects.pipeline.created).toBe(
                    recovered.nativeObjects.pipeline.created
                );
                const recoveredColor = await colorTotals();
                expect(recoveredColor[2]).toBeGreaterThan(recoveredColor[1]);
                expect(recoveredColor[2]).toBeGreaterThan(100);
            }
        } finally {
            output.destroy();
            renderer.destroy();
            unregisterRendererDiagnostics(canvas);
        }
    }, 30_000);
});
