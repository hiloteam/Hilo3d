import { describe, expect, it, vi } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import type Node from '../../../src/core/Node';
import type Stage from '../../../src/core/Stage';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Material from '../../../src/material/Material';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import {
    decodeMeshPickingId,
    getMeshPickingIdentity
} from '../../../src/renderer/common/PickingIdentity';
import type { Renderer, RendererBackend } from '../../../src/renderer/common/Renderer';
import type {
    RenderTarget,
    RenderTargetColorAttachmentReadback
} from '../../../src/renderer/common/RenderTarget';
import MeshPicker from '../../../src/utils/MeshPicker';

function encodedIdentity(id: number): Uint8Array {
    return new Uint8Array([(id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff, 0xff]);
}

function createHarness(backend: RendererBackend) {
    const mesh = new Mesh({
        geometry: new BoxGeometry(),
        material: new BasicMaterial({ lightType: 'NONE' })
    });
    const identity = getMeshPickingIdentity(mesh);
    const texel = encodedIdentity(identity.id);
    const data = new Uint8Array([...texel, ...texel]);
    const readback: RenderTargetColorAttachmentReadback = {
        data,
        format: 'rgba8unorm',
        width: 2,
        height: 1,
        bytesPerPixel: 4,
        bytesPerRow: 8
    };
    const readColorAttachment = vi.fn(() => Promise.resolve(readback));
    const destroyTarget = vi.fn();
    const target = {
        backend,
        label: 'MeshPicker test',
        sampleCount: 1,
        colorAttachmentCount: 1,
        colorFormats: ['rgba8unorm'],
        depthStencilFormat: 'depth24plus',
        isDestroyed: false,
        width: 64,
        height: 64,
        getColorTexture: vi.fn(),
        getDepthTexture: vi.fn(() => null),
        readColorAttachment,
        resize: vi.fn(),
        destroy: destroyTarget
    } as unknown as RenderTarget;
    const previousMaterial = new Material();
    const createRenderTarget = vi.fn(() => target);
    const renderToTarget = vi.fn((selectedTarget: RenderTarget) => {
        expect(selectedTarget).toBe(target);
        expect(renderer.useInstanced).toBe(false);
        expect(renderer.forceMaterial).not.toBe(previousMaterial);
    });
    const renderer = {
        backend,
        width: 64,
        height: 64,
        pixelRatio: 1,
        useInstanced: true,
        forceMaterial: previousMaterial,
        createRenderTarget,
        renderToTarget
    } as unknown as Renderer;
    const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 10, z: 3 });
    const stage = {
        renderer,
        camera,
        ready: Promise.resolve(),
        traverse(callback: (node: Node) => number) {
            callback(mesh);
            return this;
        }
    } as unknown as Stage<RendererBackend>;
    return {
        stage,
        renderer,
        target,
        mesh,
        identity,
        previousMaterial,
        createRenderTarget,
        renderToTarget,
        readColorAttachment,
        destroyTarget
    };
}

describe('MeshPicker', () => {
    it.each<RendererBackend>(['webgl2', 'webgpu'])(
        'renders and asynchronously reads a dedicated %s object-ID pass',
        async backend => {
            const {
                stage,
                renderer,
                mesh,
                previousMaterial,
                createRenderTarget,
                renderToTarget,
                readColorAttachment,
                destroyTarget
            } = createHarness(backend);
            const raycast = vi.spyOn(mesh, 'raycast');
            const picker = new MeshPicker({ stage });

            const selection = picker.getSelection(0, 0, 2, 1);
            expect(selection).toBeInstanceOf(Promise);
            await expect(selection).resolves.toEqual([mesh]);
            expect(createRenderTarget).toHaveBeenCalledWith(
                expect.objectContaining({
                    width: 64,
                    height: 64,
                    sampleCount: 1,
                    colorAttachments: [expect.objectContaining({ format: 'rgba8unorm' })]
                })
            );
            expect(renderToTarget).toHaveBeenCalledOnce();
            expect(readColorAttachment).toHaveBeenCalledWith({
                x: 0,
                y: 0,
                width: 2,
                height: 1
            });
            expect(renderer.forceMaterial).toBe(previousMaterial);
            expect(renderer.useInstanced).toBe(true);
            expect(raycast).not.toHaveBeenCalled();

            picker.destroy();
            picker.destroy();
            await Promise.resolve();
            expect(destroyTarget).toHaveBeenCalledOnce();
            await expect(picker.getSelection(0, 0)).resolves.toEqual([]);
        }
    );

    it('assigns stable distinct 24-bit identities with exact rgba8unorm round trips', () => {
        const first = new Mesh();
        const second = new Mesh();
        const firstIdentity = getMeshPickingIdentity(first);
        const secondIdentity = getMeshPickingIdentity(second);

        expect(getMeshPickingIdentity(first)).toBe(firstIdentity);
        expect(secondIdentity.id).not.toBe(firstIdentity.id);
        expect(decodeMeshPickingId(encodedIdentity(firstIdentity.id))).toBe(firstIdentity.id);
        expect(decodeMeshPickingId(encodedIdentity(secondIdentity.id))).toBe(secondIdentity.id);
    });

    it('validates CSS-space readback rectangles before allocating a target', async () => {
        const { stage, createRenderTarget } = createHarness('webgpu');
        const picker = new MeshPicker({ stage });

        await expect(picker.getSelection(-1, 0)).rejects.toThrow(/non-negative origin/u);
        expect(createRenderTarget).not.toHaveBeenCalled();
        picker.destroy();
    });
});
