import { afterEach, describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Renderer from '../../../src/render/Renderer';
import { RenderWorld } from '../../../src/render/world/RenderWorld';

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('Renderer ECS entry point', () => {
    it('is created asynchronously and exposes only the selected portable backend', async () => {
        expect(() => {
            Reflect.construct(Renderer, []);
        }).toThrow(/Renderer\.create/u);
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);

        expect(renderer).toBeInstanceOf(Renderer);
        expect(renderer.backend).toBe('webgl2');
        expect(renderer.getExtension('rhi')).toMatchObject({
            device: { backend: 'webgl2' },
            surface: { state: 'configured' }
        });
        expect(renderer.getExtension('webgpu-native')).toBeNull();
    });

    it('consumes a renderer-owned RenderWorld without any scene hierarchy callback', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);
        const renderWorld = new RenderWorld();
        const camera = new PerspectiveCamera({ aspect: 2, near: 0.1, far: 100 });

        expect(() => {
            renderer.render(renderWorld, camera);
        }).not.toThrow();
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it('keeps render-target work on the Render Graph and portable RHI path', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 12,
            height: 6
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({ width: 12, height: 6 });
        const renderWorld = new RenderWorld();
        const camera = new PerspectiveCamera({ aspect: 2, near: 0.1, far: 100 });

        expect(() => {
            renderer.renderToTarget(target, renderWorld, camera);
        }).not.toThrow();
        target.destroy();
    });

    it('prepares extracted renderer extensions before graph recording', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);
        const renderWorld = new RenderWorld();
        const camera = new PerspectiveCamera({ aspect: 2, near: 0.1, far: 100 });
        const calls: string[] = [];
        renderWorld.extensions.push({
            gpu: null,
            prepareRenderer(value): void {
                expect(value).toBe(renderer);
                calls.push('renderer');
            },
            prepareView(value): void {
                expect(value).toBe(camera);
                calls.push('view');
            }
        });

        renderer.render(renderWorld, camera);

        expect(calls).toEqual(['renderer', 'view']);
    });
});
