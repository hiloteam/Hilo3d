import { describe, expect, it } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import { SubsurfaceScatteringProfile } from '../../../src/material/SubsurfaceScatteringProfile';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';

const CLEAR = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

class SubsurfaceExtractionPipeline implements RenderPipeline {
    readonly name = 'Custom subsurface target validation';
    readonly #depthPass = new SceneRenderPass('Custom subsurface depth');
    readonly #surfacePass = new SceneRenderPass('Custom subsurface extraction');

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        const cullingResults = context.cull();
        if (output.depthStencil !== null) {
            context.graph.addPass(this.#depthPass, {
                rendererList: context.createRendererList({
                    cullingResults,
                    queue: 'opaque',
                    sorting: 'none',
                    materialPass: 'depth-only'
                }),
                colorAttachments: [],
                depthStencilAttachment: {
                    texture: output.depthStencil,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    depthClearValue: 1
                }
            });
        }
        context.graph.addPass(this.#surfacePass, {
            rendererList: context.createRendererList({
                cullingResults,
                queue: 'opaque',
                sorting: 'none',
                materialPass: 'subsurface'
            }),
            colorAttachments: [0, 1, 2].map(index => ({
                texture: output.color(index),
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: CLEAR
            })),
            ...(output.depthStencil === null
                ? {}
                : { depthStencilAttachment: { texture: output.depthStencil, depthReadOnly: true } })
        });
    }

    destroy(): void {
        /* Graph owns all per-frame resources. */
    }
}

class SubsurfaceExtractionFactory implements RenderPipelineFactory {
    readonly name = 'Custom subsurface target validation';
    create(): RenderPipeline {
        return new SubsurfaceExtractionPipeline();
    }
}

async function diffuseAlpha(target: RenderTarget): Promise<number> {
    const pixels = await target.readColorAttachment({ x: 8, y: 8, width: 1, height: 1 });
    expect(pixels.format).toBe('rgba16float');
    return new DataView(
        pixels.data.buffer,
        pixels.data.byteOffset,
        pixels.data.byteLength
    ).getUint16(6, true);
}

const cases = (['direct', 'instanced'] as const).flatMap(mode =>
    (['rgba8', 'missing-depth', 'multisample'] as const).map(invalid => ({ mode, invalid }))
);

describe.each(['webgl2', 'webgpu'] as const)(
    'subsurface SceneRenderPass target validation on %s',
    backend => {
        it.each(cases)(
            'rejects $invalid for $mode draws and permits a valid HDR retry',
            async ({ mode, invalid }) => {
                const renderer = await Renderer.create({
                    backend,
                    width: 16,
                    height: 16,
                    antialias: false,
                    useInstanced: mode === 'instanced',
                    domElement: document.createElement('canvas'),
                    renderPipeline: new SubsurfaceExtractionFactory()
                });
                const target = renderer.createRenderTarget({
                    width: 16,
                    height: 16,
                    colorAttachments: [
                        { format: 'rgba16float' },
                        { format: 'rgba16float' },
                        { format: 'rgba16float' }
                    ]
                });
                const format = invalid === 'rgba8' ? 'rgba8unorm' : 'rgba16float';
                const invalidTarget = renderer.createRenderTarget({
                    width: 16,
                    height: 16,
                    sampleCount: invalid === 'multisample' ? 4 : 1,
                    depthStencilAttachment:
                        invalid === 'missing-depth' ? false : { format: 'depth24plus' },
                    colorAttachments: [{ format }, { format }, { format }]
                });
                const scene = new Node();
                const geometry = new PlaneGeometry({ width: 2, height: 2 });
                const material = new PBRMaterial({
                    metallic: 0,
                    roughness: 1,
                    subsurfaceProfile: new SubsurfaceScatteringProfile()
                });
                new Mesh({ geometry, material, useInstanced: mode === 'instanced' }).addTo(scene);
                if (mode === 'instanced')
                    new Mesh({ geometry, material, useInstanced: true, z: -0.1 }).addTo(scene);
                new DirectionalLight({ direction: new Vector3(0, 0, -1), amount: 2 }).addTo(scene);
                const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
                try {
                    renderer.renderToTarget(target, scene, camera);
                    expect(await diffuseAlpha(target)).toBe(0x3c00);
                    expect(() => {
                        renderer.renderToTarget(invalidTarget, scene, camera);
                    }).toThrow(
                        'Material subsurface role requires three single-sample rgba16float targets and opaque depth'
                    );
                    renderer.renderToTarget(target, scene, camera);
                    expect(await diffuseAlpha(target)).toBe(0x3c00);
                    expect(renderer.isReady).toBe(true);
                } finally {
                    invalidTarget.destroy();
                    target.destroy();
                    renderer.destroy();
                }
            }
        );
    }
);
