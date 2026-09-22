import { afterEach, describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import type Material from '../../../src/material/MaterialInstance';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    CullingResultsHandle,
    RendererListHandle
} from '../../../src/render/pipeline/RendererList';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';

class OrderedPipeline implements RenderPipeline {
    readonly name = 'ordered-mesh-test';
    readonly pass = new SceneRenderPass('Explicit ordered meshes');
    readonly meshes: Mesh[] = [];
    overrideMaterial: Material | null = null;
    afterCreate: (() => void) | null = null;
    context: RenderPipelineContext | null = null;
    culling: CullingResultsHandle | null = null;
    previousList: RendererListHandle | null = null;
    usePreviousList = false;

    record(context: RenderPipelineContext): void {
        this.context = context;
        this.culling = context.cull();
        const rendererList = this.usePreviousList
            ? this.previousList
            : context.createOrderedRendererList({
                  cullingResults: this.culling,
                  meshes: this.meshes,
                  ...(this.overrideMaterial === null
                      ? {}
                      : { overrideMaterial: this.overrideMaterial })
              });
        if (rendererList === null) throw new Error('Previous list is unavailable');
        this.previousList = rendererList;
        this.afterCreate?.();
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: context.graph.importOutput().color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        this.meshes.length = 0;
        this.context = null;
    }
}

class OrderedFactory implements RenderPipelineFactory {
    readonly name = 'ordered-mesh-test';

    constructor(readonly runtime: OrderedPipeline) {}

    create(): RenderPipeline {
        return this.runtime;
    }
}

const renderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.destroy();
});

async function createRenderer(
    runtime: OrderedPipeline,
    backend: 'webgl2' | 'webgpu' = 'webgl2'
): Promise<Renderer> {
    const renderer = await Renderer.create({
        backend,
        domElement: document.createElement('canvas'),
        width: 8,
        height: 8,
        antialias: false,
        renderPipeline: new OrderedFactory(runtime)
    });
    renderers.push(renderer);
    return renderer;
}

function createMaterial(color: Color, transparent = false): BasicMaterial {
    return new BasicMaterial({
        lightType: 'NONE',
        diffuse: color,
        state: { depthTest: false, depthWrite: false, cullMode: 'none' },
        ...(transparent ? { compositing: { mode: 'alpha-blend', premultiplied: true } } : {})
    });
}

function createCamera(): OrthographicCamera {
    const camera = new OrthographicCamera({ near: 0.1, far: 10 });
    camera.setPosition(0, 0, 2);
    return camera;
}

describe('Explicit ordered renderer lists', () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        it(`preserves mixed queue order, hidden membership and direct draws on ${backend}`, async () => {
            const runtime = new OrderedPipeline();
            const renderer = await createRenderer(runtime, backend);
            const target = renderer.createRenderTarget({
                width: 8,
                height: 8,
                colorAttachments: [{ format: 'rgba8unorm' }]
            });
            const geometry = new PlaneGeometry();
            const red = createMaterial(new Color(1, 0, 0));
            const blue = createMaterial(new Color(0, 0, 1), true);
            const first = new Mesh({ geometry, material: red, useInstanced: true, visible: false });
            const middle = new Mesh({ geometry, material: blue, useInstanced: true });
            const last = new Mesh({ geometry, material: red, useInstanced: true, layer: 2 });
            first.renderOrder = 30;
            middle.renderOrder = 20;
            last.renderOrder = 10;
            const scene = new Node();
            scene.addChild(first).addChild(last);
            const detachedRoot = new Node();
            detachedRoot.setPosition(0.25, 0, 0);
            middle.setPosition(-0.25, 0, 0);
            detachedRoot.addChild(middle).updateMatrixWorld();
            const camera = createCamera();
            camera.visibility = 1;
            runtime.meshes.push(first, middle, last);
            const beforeRender = vi.fn();
            const afterRender = vi.fn();
            last.on('beforeRender', beforeRender);
            last.on('afterRender', afterRender);
            const prepare = vi.spyOn(MeshDrawProcessor.prototype, 'prepare');
            const prepareInstanced = vi.spyOn(MeshDrawProcessor.prototype, 'prepareInstancedBatch');

            renderer.renderToTarget(target, scene, camera, true);
            renderer.renderToTarget(target, scene, camera, true);
            await renderer.waitForIdle();
            const readback = await target.readColorAttachment();
            const center = (4 * 8 + 4) * 4;

            expect(prepare.mock.calls.map(call => call[0])).toEqual([
                first,
                middle,
                last,
                first,
                middle,
                last
            ]);
            expect(prepareInstanced).not.toHaveBeenCalled();
            expect(beforeRender).toHaveBeenCalledTimes(2);
            expect(afterRender).toHaveBeenCalledTimes(2);
            expect(renderer.renderInfo.drawCount).toBe(3);
            expect(readback.data[center]).toBeGreaterThan(240);
            expect(readback.data[center + 2]).toBeLessThan(8);
            expect(first.useInstanced && middle.useInstanced && last.useInstanced).toBe(true);
        });
    }

    it('snapshots membership and runs mesh hooks before preparing override materials', async () => {
        const runtime = new OrderedPipeline();
        const renderer = await createRenderer(runtime);
        const mesh = new Mesh({ geometry: new PlaneGeometry(), material: null });
        const color = new Color(1, 0, 0);
        const override = createMaterial(color);
        runtime.overrideMaterial = override;
        runtime.meshes.push(mesh);
        runtime.afterCreate = () => {
            runtime.meshes.length = 0;
        };
        let hookRan = false;
        mesh.on('beforeRender', () => {
            hookRan = true;
            color.r = 0;
            color.g = 1;
        });
        const original = Reflect.get(MeshDrawProcessor.prototype, 'prepare');
        const prepare = vi
            .spyOn(MeshDrawProcessor.prototype, 'prepare')
            .mockImplementation(function (
                this: MeshDrawProcessor,
                ...parameters: Parameters<MeshDrawProcessor['prepare']>
            ) {
                expect(hookRan).toBe(true);
                expect(parameters[2]).toBe(override);
                return original.apply(this, parameters);
            });

        renderer.render(new Node(), createCamera(), true);
        runtime.meshes.push(mesh);
        hookRan = false;
        renderer.render(new Node(), createCamera(), true);

        expect(runtime.meshes).toHaveLength(0);
        expect(prepare).toHaveBeenCalledTimes(2);
        expect(renderer.renderInfo.drawCount).toBe(1);
    });

    it('rejects duplicate and incomplete entries before submission and recovers next frame', async () => {
        const runtime = new OrderedPipeline();
        const renderer = await createRenderer(runtime);
        const mesh = new Mesh({
            geometry: new PlaneGeometry(),
            material: createMaterial(new Color(1, 0, 0))
        });
        const scene = new Node();
        const camera = createCamera();
        runtime.meshes.push(mesh, mesh);

        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/appears more than once/u);
        runtime.meshes.splice(1);
        const geometry = mesh.geometry;
        mesh.geometry = null;
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/requires geometry and material/u);
        mesh.geometry = geometry;
        renderer.render(scene, camera);
        renderer.render(scene, camera);
        expect(renderer.renderInfo.drawCount).toBe(1);
        mesh.destroy(renderer);
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/is destroyed/u);
    });

    it('retains invocation leases and rejects renderer-list handles from prior frames', async () => {
        const runtime = new OrderedPipeline();
        const renderer = await createRenderer(runtime);
        const scene = new Node();
        const camera = createCamera();
        renderer.render(scene, camera);
        const context = runtime.context;
        const cullingResults = runtime.culling;
        if (context === null || cullingResults === null)
            throw new Error('Pipeline context is missing');
        expect(() => context.createOrderedRendererList({ cullingResults, meshes: [] })).toThrow(
            /synchronous record/u
        );
        runtime.usePreviousList = true;
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/stale or invalid/u);
        runtime.usePreviousList = false;
        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
    });
});
