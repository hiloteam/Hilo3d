import { describe, expect, it } from 'vitest';
import Renderer from '../../../src/render/Renderer';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type { RenderTarget } from '../../../src/render/RenderTarget';

describe('Auxiliary render views', () => {
    it('isolates leases, rejects nesting/async callbacks, and aborts caught callback failures', async () => {
        const scene = new Node();
        const camera = new PerspectiveCamera({ z: 3, near: 0.1, far: 10, aspect: 1 });
        const viewCamera = new PerspectiveCamera({ z: 3, near: 0.1, far: 10, aspect: 1 });
        const color = new Color(0.8, 0.1, 0.02);
        new Mesh({
            geometry: new PlaneGeometry({ width: 4, height: 4 }),
            material: new BasicMaterial({ lightType: 'NONE', diffuse: color })
        }).addTo(scene);
        let mode: 'normal' | 'throw' | 'nested' | 'async' | 'late' | 'invalid-target' = 'normal';
        let saved: RenderPipelineContext | null = null;
        let auxiliary: RenderTarget | null = null;
        const factory: RenderPipelineFactory = {
            name: 'auxiliary scope test',
            create(context) {
                const forward = new ForwardRenderPipelineFactory().create(context);
                const target = context.createRenderTarget({ width: 8, height: 8 });
                auxiliary = target;
                return {
                    name: 'auxiliary scope test',
                    record(parent) {
                        if (mode === 'invalid-target') {
                            parent.recordView(
                                viewCamera,
                                null as unknown as RenderTarget,
                                () => undefined
                            );
                        }
                        if (mode === 'late') parent.cull();
                        try {
                            parent.recordView(viewCamera, target, child => {
                                saved = child;
                                expect(() => parent.cull()).toThrow(/synchronous record/);
                                if (mode === 'nested')
                                    child.recordView(camera, target, () => undefined);
                                if (mode === 'throw') throw new Error('auxiliary callback failed');
                                if (mode === 'async') return Promise.resolve();
                                forward.record(child);
                                return undefined;
                            });
                        } catch (error) {
                            if (mode !== 'throw') throw error;
                        }
                        forward.record(parent);
                    },
                    frameSubmitted(index) {
                        forward.frameSubmitted?.(index);
                    },
                    frameDiscarded(index) {
                        forward.frameDiscarded?.(index);
                    },
                    destroy() {
                        target.destroy();
                        forward.destroy();
                    }
                };
            }
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: factory
        });
        const output = renderer.createRenderTarget({ width: 8, height: 8 });
        const draw = (): void => {
            renderer.renderToTarget(output, scene, camera);
        };
        try {
            draw();
            const initial = (await output.readColorAttachment()).data.slice();
            const leaked = saved as RenderPipelineContext | null;
            expect(() => leaked?.cull()).toThrow(/synchronous record/);
            color.r = 0;
            color.g = 1;
            mode = 'throw';
            expect(draw).toThrow(/abort|auxiliary callback failed/i);
            expect((await output.readColorAttachment()).data).toEqual(initial);
            mode = 'nested';
            expect(draw).toThrow(/cannot be nested/);
            mode = 'async';
            expect(draw).toThrow(/synchronous/);
            mode = 'late';
            expect(draw).toThrow(/precede parent/);
            mode = 'invalid-target';
            expect(draw).toThrow('Render target belongs to a different renderer');
            mode = 'normal';
            draw();
            expect((await output.readColorAttachment()).data).not.toEqual(initial);
        } finally {
            output.destroy();
            renderer.destroy();
        }
        expect((auxiliary as RenderTarget | null)?.isDestroyed).toBe(true);
    });
});
