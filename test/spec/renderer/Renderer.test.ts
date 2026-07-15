import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Renderer, { type RendererFrame } from '../../../src/render/Renderer';
import type * as RHIFactoryExports from '../../../src/render/rhi/RHIFactory';
import type {
    WebGL2RHIDeviceCreateOptions,
    WebGPURHIDeviceCreateOptions
} from '../../../src/render/rhi/RHIFactory';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { externalTextureBindingRegistry } from '../../../src/render/renderer/ExternalTextureBindingRegistry';

const rhiSupportControl = vi.hoisted(() => ({
    calls: vi.fn(),
    override: null as ((backend: 'webgl2' | 'webgpu', options?: unknown) => Promise<boolean>) | null
}));

vi.mock('../../../src/render/rhi/RHIFactory', async importOriginal => {
    const actual = await importOriginal<typeof RHIFactoryExports>();
    return {
        ...actual,
        isRHIBackendSupported(backend: 'webgl2' | 'webgpu', options?: unknown): Promise<boolean> {
            rhiSupportControl.calls(backend, options);
            if (rhiSupportControl.override !== null) {
                return rhiSupportControl.override(backend, options);
            }
            return backend === 'webgl2'
                ? actual.isRHIBackendSupported('webgl2', options as WebGL2RHIDeviceCreateOptions)
                : actual.isRHIBackendSupported('webgpu', options as WebGPURHIDeviceCreateOptions);
        }
    };
});

const activeRenderers: Renderer[] = [];

function rhiDevice(renderer: Renderer): RHIDevice {
    const extension = renderer.getExtension('rhi-v2') as { readonly device?: RHIDevice } | null;
    if (extension?.device === undefined) throw new Error('Renderer RHI v2 device is unavailable');
    return extension.device;
}

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
    rhiSupportControl.override = null;
    rhiSupportControl.calls.mockClear();
    vi.restoreAllMocks();
});

describe('Renderer public entry point', () => {
    it('returns the shared RHI v2 renderer directly behind the unified contract', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);
        await renderer.ready;

        expect(renderer).toBeInstanceOf(Renderer);
        expect(renderer).toMatchObject({
            backend: 'webgl2',
            className: 'Renderer',
            isReady: true
        });
        const extension = renderer.getExtension('rhi-v2');
        expect(extension).toMatchObject({
            device: { backend: 'webgl2' },
            surface: { state: 'configured' },
            recoveryState: 'ready'
        });
        const native = renderer.getExtension('webgl2-native');
        expect(native).toMatchObject({
            state: { bindSystemFramebuffer: expect.any(Function) },
            makeXRCompatible: expect.any(Function),
            createXRWebGLLayer: expect.any(Function),
            bindExternalFramebuffer: expect.any(Function),
            viewport: expect.any(Function),
            renderScene: expect.any(Function)
        });
        expect(native).not.toHaveProperty('gl');
        expect(renderer.getExtension('webgl2-native')).toBe(native);
        expect(renderer.getExtension('webgpu-native')).toBeNull();
        expect(renderer).not.toHaveProperty('isWebGLRenderer');
    });

    it('awaits an explicitly selected backend through create', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 12,
            height: 6
        });
        activeRenderers.push(renderer);

        expect(renderer.backend).toBe('webgl2');
        expect(renderer.isReady).toBe(true);
    });

    it('probes auto once and falls back to WebGL2 without a facade', async () => {
        rhiSupportControl.override = () => Promise.resolve(false);
        const renderer = await Renderer.create({
            backend: 'auto',
            domElement: document.createElement('canvas'),
            width: 20,
            height: 10
        });
        activeRenderers.push(renderer);

        expect(rhiSupportControl.calls).toHaveBeenCalledOnce();
        expect(renderer.backend).toBe('webgl2');
        expect(renderer.getExtension('rhi-v2')).toMatchObject({
            device: { backend: 'webgl2' }
        });
        expect(renderer.getExtension('webgl2-native')).toMatchObject({
            renderScene: expect.any(Function)
        });
    });

    it('snapshots create options before an asynchronous auto probe settles', async () => {
        let resolveSupport: ((supported: boolean) => void) | undefined;
        rhiSupportControl.override = () =>
            new Promise<boolean>(resolve => {
                resolveSupport = resolve;
            });
        const options = {
            backend: 'auto' as const,
            domElement: document.createElement('canvas'),
            width: 18,
            height: 9
        };
        const pendingRenderer = Renderer.create(options);
        options.width = 36;
        resolveSupport?.(false);
        const renderer = await pendingRenderer;
        activeRenderers.push(renderer);

        expect(renderer.width).toBe(18);
        expect(renderer.height).toBe(9);
    });

    it('repeats the last completed presentation without firing scene lifecycle events', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false
        });
        activeRenderers.push(renderer);
        await renderer.ready;
        const scene = new Node();
        const camera = new PerspectiveCamera({ aspect: 2, near: 0.1, far: 10, z: 2 });
        const updateScene = vi.spyOn(scene, 'updateMatrixWorld');
        const updateCamera = vi.spyOn(camera, 'updateViewProjectionMatrix');
        const beforeRender = vi.fn();
        const afterRender = vi.fn();
        renderer.on('beforeRender', beforeRender);
        renderer.on('afterRender', afterRender);
        const native = renderer.getExtension('webgl2-native') as {
            renderScene(): void;
        };

        expect(() => native.renderScene()).toThrow(/completed presentation inputs/u);
        renderer.render(scene, camera, true);
        const sceneUpdatesAfterFirstPresentation = updateScene.mock.calls.length;
        const cameraUpdatesAfterFirstPresentation = updateCamera.mock.calls.length;
        native.renderScene();

        expect(updateScene).toHaveBeenCalledTimes(sceneUpdatesAfterFirstPresentation * 2);
        expect(updateCamera).toHaveBeenCalledTimes(cameraUpdatesAfterFirstPresentation * 2);
        expect(beforeRender).toHaveBeenCalledOnce();
        expect(afterRender).toHaveBeenCalledOnce();
    });

    it('exposes recoverable render-target attachment bindings without native handles', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8
        });
        activeRenderers.push(renderer);
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: {
                format: 'depth24plus',
                sampled: true,
                compare: 'greater-equal'
            }
        });
        const color = target.getColorTexture();
        const depth = target.getDepthTexture();
        if (depth === null) throw new Error('Expected a sampled depth attachment');

        const firstColor = externalTextureBindingRegistry.resolve(color, 'sampler');
        const firstDepth = externalTextureBindingRegistry.resolve(depth, 'comparison-sampler');
        const firstNumericDepth = externalTextureBindingRegistry.resolve(depth, 'sampler');
        expect(firstColor).toBeDefined();
        expect(firstDepth).toBeDefined();
        expect(firstNumericDepth).toBeDefined();
        expect(externalTextureBindingRegistry.resolve(color, 'comparison-sampler')).toBeNull();
        expect(firstNumericDepth?.sampler).not.toBe(firstDepth?.sampler);

        const firstColorView = firstColor?.textureView;
        const firstDepthView = firstDepth?.textureView;
        target.resize(12, 6);
        const resizedColor = externalTextureBindingRegistry.resolve(color, 'sampler');
        const resizedDepth = externalTextureBindingRegistry.resolve(depth, 'comparison-sampler');
        const resizedNumericDepth = externalTextureBindingRegistry.resolve(depth, 'sampler');
        expect(resizedColor).toBe(firstColor);
        expect(resizedDepth).toBe(firstDepth);
        expect(resizedNumericDepth).toBe(firstNumericDepth);
        expect(resizedColor?.textureView).not.toBe(firstColorView);
        expect(resizedDepth?.textureView).not.toBe(firstDepthView);
        expect(resizedNumericDepth?.textureView).toBe(resizedDepth?.textureView);
        expect(resizedColor?.sampler).toBe(firstColor?.sampler);
        expect(resizedDepth?.sampler).toBe(firstDepth?.sampler);

        target.destroy();
        expect(externalTextureBindingRegistry.resolve(color, 'sampler')).toBeUndefined();
        expect(externalTextureBindingRegistry.resolve(depth, 'comparison-sampler')).toBeUndefined();
        expect(externalTextureBindingRegistry.resolve(depth, 'sampler')).toBeUndefined();
    });

    it('composes repeated mesh targets and presents into one immutable RHI submission', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false
        });
        activeRenderers.push(renderer);
        await renderer.ready;
        const firstTarget = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
        const secondTarget = renderer.createRenderTarget({
            width: 4,
            height: 8,
            colorAttachments: [{ format: 'rgba16float' }],
            depthStencilAttachment: false
        });
        const queue = rhiDevice(renderer).graphicsQueue;
        const beginFrameImplementation = queue.beginFrame.bind(queue);
        const pipelineFormats: (string | undefined)[] = [];
        const beginFrame = vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
            const commands = beginFrameImplementation(descriptor);
            const beginRenderPass = commands.beginRenderPass.bind(commands);
            vi.spyOn(commands, 'beginRenderPass').mockImplementation(passDescriptor => {
                const pass = beginRenderPass(passDescriptor);
                const setPipeline = pass.setPipeline.bind(pass);
                vi.spyOn(pass, 'setPipeline').mockImplementation(pipeline => {
                    pipelineFormats.push(pipeline.descriptor.fragment?.targets[0]?.format);
                    setPipeline(pipeline);
                });
                return pass;
            });
            return commands;
        });
        const endFrame = vi.spyOn(queue, 'endFrame');
        const stage = new Node();
        stage.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ lightType: 'NONE', depthTest: false }),
                frustumTest: false
            })
        );
        const camera = new PerspectiveCamera();

        renderer.renderFrame(frame => {
            frame.renderToTarget(firstTarget, stage, camera);
            frame.renderToTarget(secondTarget, stage, camera);
            frame.present(firstTarget);
            frame.present(firstTarget);
        });

        expect(beginFrame).toHaveBeenCalledOnce();
        expect(endFrame).toHaveBeenCalledOnce();
        expect(pipelineFormats).toEqual(['rgba8unorm', 'rgba16float', 'rgba8unorm', 'rgba8unorm']);
        firstTarget.destroy();
        secondTarget.destroy();
    });

    it('poisons caught command and nested-frame failures before any RHI submission', async () => {
        const renderer = new Renderer<'webgl2'>({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false
        });
        activeRenderers.push(renderer);
        await renderer.ready;
        const valid = renderer.createRenderTarget({
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });
        const destroyed = renderer.createRenderTarget({
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });
        destroyed.destroy();
        const queue = rhiDevice(renderer).graphicsQueue;
        const beginFrame = vi.spyOn(queue, 'beginFrame');
        const endFrame = vi.spyOn(queue, 'endFrame');

        expect(() => {
            renderer.renderFrame(frame => {
                frame.present(valid);
                try {
                    frame.present(destroyed);
                } catch {
                    // A caught command failure still invalidates all commands in this frame.
                }
                expect(() => {
                    frame.present(valid);
                }).toThrow(/frame recording was aborted/u);
            });
        }).toThrow(/frame recording was aborted/u);
        expect(beginFrame).not.toHaveBeenCalled();
        expect(endFrame).not.toHaveBeenCalled();

        expect(() => {
            renderer.renderFrame(frame => {
                try {
                    renderer.renderFrame(() => undefined);
                } catch {
                    // A nested frame attempt poisons the outer frame even when it is caught.
                }
                expect(() => {
                    frame.present(valid);
                }).toThrow(/frame recording was aborted/u);
            });
        }).toThrow(/frame recording was aborted/u);
        expect(beginFrame).not.toHaveBeenCalled();
        expect(endFrame).not.toHaveBeenCalled();

        let escaped: RendererFrame | undefined;
        renderer.renderFrame(frame => {
            escaped = frame;
        });
        expect(() => escaped?.present(valid)).toThrow(/only valid inside/u);
        valid.destroy();
    });

    it('delegates WebGL2 support probing to the RHI-owned context boundary', async () => {
        const canvas = document.createElement('canvas');
        const getContext = vi.spyOn(canvas, 'getContext');

        await expect(
            Renderer.isBackendSupported('webgl2', {
                backend: 'webgl2',
                domElement: canvas,
                alpha: false
            })
        ).resolves.toBe(true);
        expect(getContext).toHaveBeenCalledOnce();
        expect(getContext).toHaveBeenCalledWith(
            'webgl2',
            expect.objectContaining({ alpha: false })
        );
    });
});
