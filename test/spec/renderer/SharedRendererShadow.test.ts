import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import SpotLight from '../../../src/light/SpotLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { externalTextureBindingRegistry } from '../../../src/render/renderer/ExternalTextureBindingRegistry';

interface RHIExtension {
    readonly device: RHIDevice;
    readonly recoveryState: string;
}

const activeRenderers: Renderer[] = [];

function rhiExtension(renderer: Renderer): RHIExtension {
    const extension = renderer.getExtension('rhi');
    if (extension === null) throw new Error('Shared renderer RHI extension is unavailable');
    return extension as RHIExtension;
}

function observePassLabels(device: RHIDevice): {
    readonly labels: string[];
    restore(): void;
} {
    const labels: string[] = [];
    const queue = device.graphicsQueue;
    const beginFrame = queue.beginFrame.bind(queue);
    const spy = vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
        const commands = beginFrame(descriptor);
        const beginRenderPass = commands.beginRenderPass.bind(commands);
        vi.spyOn(commands, 'beginRenderPass').mockImplementation(pass => {
            labels.push(pass.label ?? '');
            return beginRenderPass(pass);
        });
        return commands;
    });
    return {
        labels,
        restore: () => {
            spy.mockRestore();
        }
    };
}

function waitForRecovery(renderer: Renderer): Promise<void> {
    const canvas = renderer.domElement;
    if (canvas === null) throw new Error('Shared renderer recovery test requires a canvas');
    return new Promise<void>((resolve, reject) => {
        const timeout = globalThis.setTimeout(() => {
            reject(new Error('Shared renderer recovery timed out'));
        }, 5_000);
        renderer.on(
            'rhiDeviceRestored',
            () => {
                globalThis.clearTimeout(timeout);
                resolve();
            },
            true
        );
        renderer.on(
            'rhiDeviceRecoveryFailed',
            event => {
                globalThis.clearTimeout(timeout);
                reject(
                    event.detail instanceof Error
                        ? event.detail
                        : new Error(`Shared renderer recovery failed: ${String(event.detail)}`)
                );
            },
            true
        );
        const event = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
}

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
    vi.restoreAllMocks();
});

describe('SharedRendererDriver shadow production wiring', () => {
    it('renders all shadow kinds before the main pass, rolls back failures, detaches empty plans, and recovers', async () => {
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: canvas,
            width: 16,
            height: 8,
            antialias: false
        });
        activeRenderers.push(renderer);

        const scene = new Node();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial(),
            frustumTest: false
        });
        const target = new Vector3(0, 0, 0);
        const directional = new DirectionalLight({ shadow: {} });
        directional.setPosition(2, 4, 3).lookAt(target);
        const spot = new SpotLight({ shadow: { width: 32, height: 16 } });
        spot.setPosition(-2, 3, 3).lookAt(target);
        const point = new PointLight({ shadow: { width: 8, height: 8 } });
        point.setPosition(1, 2, 2);
        scene.addChild(mesh).addChild(directional);

        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);

        const firstPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(firstPasses.labels).toEqual([
            'Shadow atlas directional 0',
            'Forward scene',
            'Forward linear-to-sRGB output transfer'
        ]);
        const atlasTexture = renderer.lightManager.shadowAtlas;
        if (atlasTexture === null) throw new Error('Directional shadow atlas was not attached');
        expect(renderer.lightManager.shadowAtlasSize).toEqualishValues(16, 8, 1 / 16, 1 / 8);
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 3,
            passes: 3,
            submissions: 1
        });
        const firstDiagnostics = diagnostics.snapshot();
        for (const cache of [
            firstDiagnostics.caches.pipeline,
            firstDiagnostics.caches.bindGroup,
            firstDiagnostics.caches.vertexArray,
            firstDiagnostics.caches.framebuffer
        ]) {
            expect(cache.misses).not.toBeNull();
            expect(cache.size).not.toBeNull();
            expect(cache.highWater).not.toBeNull();
            expect(cache.misses ?? 0).toBeGreaterThan(0);
            expect(cache.size ?? 0).toBeGreaterThan(0);
            expect(cache.highWater ?? 0).toBeGreaterThanOrEqual(cache.size ?? 0);
        }
        for (const nativeObject of [
            firstDiagnostics.nativeObjects.buffer,
            firstDiagnostics.nativeObjects.texture,
            firstDiagnostics.nativeObjects.sampler,
            firstDiagnostics.nativeObjects.shaderModule,
            firstDiagnostics.nativeObjects.program,
            firstDiagnostics.nativeObjects.framebuffer,
            firstDiagnostics.nativeObjects.vertexArray
        ]) {
            expect(nativeObject.created).toBeGreaterThan(0);
            expect(nativeObject.live).not.toBeNull();
            expect(nativeObject.live ?? 0).toBeGreaterThan(0);
        }
        firstPasses.restore();

        scene.addChild(spot).addChild(point);
        const allPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        const shadowLabels = allPasses.labels.filter(label => label.startsWith('Shadow atlas'));
        expect(shadowLabels).toHaveLength(8);
        expect(shadowLabels.map(label => label.split(' ')[2])).toEqual([
            'directional',
            'spot',
            'point',
            'point',
            'point',
            'point',
            'point',
            'point'
        ]);
        expect(allPasses.labels.at(-1)).toBe('Forward linear-to-sRGB output transfer');
        expect(renderer.lightManager.shadowAtlas).toBe(atlasTexture);
        expect(renderer.lightManager.shadowAtlasSize).toEqualishValues(96, 48, 1 / 96, 1 / 48);
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 10,
            passes: 10,
            submissions: 1
        });
        const stableDiagnostics = diagnostics.snapshot();
        expect(stableDiagnostics.caches.pipeline.hits ?? 0).toBeGreaterThan(
            firstDiagnostics.caches.pipeline.hits ?? 0
        );
        expect(stableDiagnostics.caches.bindGroup.hits ?? 0).toBeGreaterThan(
            firstDiagnostics.caches.bindGroup.hits ?? 0
        );
        expect(stableDiagnostics.caches.vertexArray.hits ?? 0).toBeGreaterThan(
            firstDiagnostics.caches.vertexArray.hits ?? 0
        );
        expect(stableDiagnostics.caches.framebuffer.hits ?? 0).toBeGreaterThan(
            firstDiagnostics.caches.framebuffer.hits ?? 0
        );
        allPasses.restore();

        const renderTarget = renderer.createRenderTarget({
            label: 'Shadow integration target',
            width: 12,
            height: 6,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: { format: 'depth24plus' }
        });
        const targetPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.renderToTarget(renderTarget, scene, camera);
        await renderer.waitForIdle();
        expect(targetPasses.labels.filter(label => label.startsWith('Shadow atlas'))).toHaveLength(
            8
        );
        expect(targetPasses.labels.at(-1)).toBe('Forward scene');
        expect(renderer.lightManager.shadowAtlas).toBe(atlasTexture);
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 9,
            passes: 9,
            submissions: 1
        });
        targetPasses.restore();
        renderTarget.destroy();

        point.shadow = { width: 8, height: 4 };
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow('Point-light atlas shadows require equal width and height');
        expect(renderer.lightManager.shadowAtlas).toBeNull();
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 0,
            passes: 0,
            submissions: 0
        });

        directional.shadow = null;
        spot.shadow = null;
        point.shadow = null;
        const emptyPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(emptyPasses.labels).toEqual([
            'Forward scene',
            'Forward linear-to-sRGB output transfer'
        ]);
        expect(renderer.lightManager.shadowAtlas).toBeNull();
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 2,
            passes: 2,
            submissions: 1
        });
        emptyPasses.restore();

        directional.shadow = {};
        spot.shadow = { width: 32, height: 16 };
        point.shadow = { width: 8, height: 8 };
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(renderer.lightManager.shadowAtlas).toBe(atlasTexture);
        const bindingBeforeRecovery = externalTextureBindingRegistry.resolve(
            atlasTexture,
            'comparison-sampler'
        );
        if (bindingBeforeRecovery === undefined || bindingBeforeRecovery === null) {
            throw new Error('Shadow atlas comparison binding is unavailable');
        }
        const viewHandle = bindingBeforeRecovery.textureView;
        const samplerHandle = bindingBeforeRecovery.sampler;
        const previousDevice = rhiExtension(renderer).device;

        await waitForRecovery(renderer);
        expect(rhiExtension(renderer)).toMatchObject({ recoveryState: 'ready' });
        expect(rhiExtension(renderer).device).not.toBe(previousDevice);
        const recoveredPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(
            recoveredPasses.labels.filter(label => label.startsWith('Shadow atlas'))
        ).toHaveLength(8);
        expect(recoveredPasses.labels.at(-1)).toBe('Forward linear-to-sRGB output transfer');
        expect(renderer.lightManager.shadowAtlas).toBe(atlasTexture);
        const bindingAfterRecovery = externalTextureBindingRegistry.resolve(
            atlasTexture,
            'comparison-sampler'
        );
        expect(bindingAfterRecovery).toBe(bindingBeforeRecovery);
        expect(bindingAfterRecovery?.textureView).toBe(viewHandle);
        expect(bindingAfterRecovery?.sampler).toBe(samplerHandle);
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 10,
            passes: 10,
            submissions: 1
        });

        recoveredPasses.restore();
        renderer.releaseGPUResources();
        expect(renderer.lightManager.shadowAtlas).toBeNull();
        expect(
            externalTextureBindingRegistry.resolve(atlasTexture, 'comparison-sampler')
        ).toBeUndefined();
        const rebuiltPasses = observePassLabels(rhiExtension(renderer).device);
        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(rebuiltPasses.labels.filter(label => label.startsWith('Shadow atlas'))).toHaveLength(
            8
        );
        expect(rebuiltPasses.labels.at(-1)).toBe('Forward linear-to-sRGB output transfer');
        expect(renderer.lightManager.shadowAtlas).not.toBeNull();
        expect(renderer.lightManager.shadowAtlas).not.toBe(atlasTexture);
        expect(diagnostics.snapshot().frame).toMatchObject({
            draws: 10,
            passes: 10,
            submissions: 1
        });
        rebuiltPasses.restore();

        renderer.destroy();
        activeRenderers.splice(activeRenderers.indexOf(renderer), 1);
        expect(unregisterRendererDiagnostics(canvas, diagnostics)).toBe(true);
    }, 30_000);
});
