import { describe, expect, it, vi } from 'vitest';
import Renderer from '../../../src/render/Renderer';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import SphereGeometry from '../../../src/geometry/SphereGeometry';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import PBRMaterial from '../../../src/material/PBRMaterial';
import DirectionalLight from '../../../src/light/DirectionalLight';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import DataTexture from '../../../src/texture/DataTexture';
import CubeTexture from '../../../src/texture/CubeTexture';
import { NEAREST, RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import type { RHIDevice } from '../../../src/render/rhi/core';

const SIZE = 40;

async function createRenderer(backend: 'webgl2' | 'webgpu'): Promise<Renderer> {
    return await Renderer.create({
        backend,
        width: SIZE,
        height: SIZE,
        antialias: false,
        domElement: document.createElement('canvas'),
        clearColor: new Color(0, 0, 0, 0)
    });
}

function target(renderer: Renderer): RenderTarget {
    return renderer.createRenderTarget({
        width: SIZE,
        height: SIZE,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float' }
    });
}

function directionalScene(material: PBRMaterial): {
    root: Node;
    mesh: Mesh;
    light: DirectionalLight;
    camera: PerspectiveCamera;
} {
    const root = new Node();
    const mesh = new Mesh({
        geometry: new PlaneGeometry({ width: 2, height: 2 }),
        material
    }).addTo(root);
    const light = new DirectionalLight({ direction: new Vector3(0, 0, 1), amount: 1 }).addTo(root);
    const camera = new PerspectiveCamera({ z: 3, near: 0.1, far: 20, aspect: 1, fov: 45 });
    return { root, mesh, light, camera };
}

async function center(output: RenderTarget): Promise<Uint8Array> {
    return (await output.readColorAttachment({ x: 20, y: 20, width: 1, height: 1 })).data;
}

function channelSum(pixels: Uint8Array, channel: number): number {
    let sum = 0;
    for (let offset = channel; offset < pixels.length; offset += 4) sum += pixels[offset] ?? 0;
    return sum;
}

describe.each(['webgl2', 'webgpu'] as const)('MAT1 production surfaces on %s', backend => {
    it('transmits back lighting with its own color and preserves an exact disabled baseline', async () => {
        const material = new PBRMaterial({
            baseColor: new Color(1, 0, 0),
            metallic: 0,
            roughness: 1,
            diffuseTransmissionFactor: 1,
            diffuseTransmissionColor: new Color(0, 1, 0)
        });
        const { root, mesh, light, camera } = directionalScene(material);
        const renderer = await createRenderer(backend);
        const output = target(renderer);
        try {
            renderer.renderToTarget(output, root, camera);
            const transmitted = await center(output);
            expect(transmitted[1]).toBeGreaterThan(35);
            expect(transmitted[0]).toBeLessThan(3);
            expect(transmitted[2]).toBeLessThan(3);

            material.diffuseTransmissionFactor = 0;
            renderer.renderToTarget(output, root, camera);
            expect((await center(output))[1]).toBeLessThan(3);

            light.direction.set(0, 0, -1);
            renderer.renderToTarget(output, root, camera);
            const disabled = await center(output);
            expect(disabled[0]).toBeGreaterThan(35);
            mesh.material = new PBRMaterial({
                baseColor: new Color(1, 0, 0),
                metallic: 0,
                roughness: 1
            });
            renderer.renderToTarget(output, root, camera);
            expect(await center(output)).toEqual(disabled);
        } finally {
            output.destroy();
            renderer.destroy();
        }
    }, 30_000);

    it('keeps diffuse transmission texture rows directional and uses alpha for its factor', async () => {
        const colorMap = new DataTexture({
            width: 2,
            height: 2,
            image: new Uint8Array([
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255
            ]),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST
        });
        const factorMap = new DataTexture({
            width: 1,
            height: 1,
            image: new Uint8Array([0, 0, 0, 255]),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST
        });
        const material = new PBRMaterial({
            metallic: 0,
            diffuseTransmissionFactor: 1,
            diffuseTransmissionColorMap: colorMap,
            diffuseTransmissionMap: factorMap
        });
        const { root, mesh, camera } = directionalScene(material);
        if (mesh.geometry === null) throw new Error('Missing directional fixture geometry');
        // The legacy plane's top vertices use V=1. Author top-left logical UVs explicitly here.
        mesh.geometry.uvs = new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
        const renderer = await createRenderer(backend);
        const output = target(renderer);
        const read = async (x: number, y: number): Promise<Uint8Array> =>
            (await output.readColorAttachment({ x, y, width: 1, height: 1 })).data;
        try {
            renderer.renderToTarget(output, root, camera);
            const topLeft = await read(12, 12);
            const topRight = await read(28, 12);
            const bottomLeft = await read(12, 28);
            expect(topLeft[0]).toBeGreaterThan(35);
            expect(topLeft[1]).toBeLessThan(3);
            expect(topRight[1]).toBeGreaterThan(35);
            expect(bottomLeft[2]).toBeGreaterThan(35);
            factorMap.image = new Uint8Array([255, 255, 255, 0]);
            renderer.renderToTarget(output, root, camera);
            expect((await read(12, 12))[0]).toBeLessThan(3);
            expect((await read(28, 12))[1]).toBeLessThan(3);
        } finally {
            output.destroy();
            renderer.destroy();
            colorMap.destroy();
            factorMap.destroy();
        }
    }, 30_000);

    it('renders colored grazing sheen and updates roughness without changing material topology', async () => {
        const material = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            metallic: 0,
            roughness: 1,
            sheenColor: new Color(1, 0, 0),
            sheenRoughness: 0.6
        });
        const { root, mesh, camera, light } = directionalScene(material);
        mesh.geometry = new SphereGeometry({ radius: 0.8, widthSegments: 40, heightSegments: 24 });
        light.direction.set(-1, 0, -0.2);
        const renderer = await createRenderer(backend);
        const output = target(renderer);
        const read = async (): Promise<Uint8Array> => (await output.readColorAttachment()).data;
        try {
            renderer.renderToTarget(output, root, camera);
            const sheen = await read();
            expect(channelSum(sheen, 0)).toBeGreaterThan(channelSum(sheen, 1) + 200);
            const definition = material.definition;
            material.sheenRoughness = 0.15;
            renderer.renderToTarget(output, root, camera);
            const sharp = await read();
            expect(sharp).not.toEqual(sheen);
            expect(material.definition).toBe(definition);
            material.sheenColor.set(0, 0, 0, 1);
            material.invalidateData();
            renderer.renderToTarget(output, root, camera);
            const disabled = await read();
            expect(Math.abs(channelSum(disabled, 0) - channelSum(disabled, 1))).toBeLessThan(3);
            expect(channelSum(disabled, 0)).toBeLessThan(channelSum(sheen, 0));
        } finally {
            output.destroy();
            renderer.destroy();
        }
    }, 30_000);

    it('retains sheen under environment-only lighting and resource rebuilding', async () => {
        const environment = new CubeTexture({
            width: 1,
            height: 1,
            image: Array.from({ length: 6 }, () => new Uint8Array([255, 255, 255, 255])),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST
        });
        const material = new PBRMaterial({
            baseColor: new Color(0, 0, 0),
            metallic: 0,
            roughness: 1,
            sheenColor: new Color(0, 0, 1),
            sheenRoughness: 0.5,
            specularEnvMap: { texture: environment, encoding: 'linear' }
        });
        const { root, mesh, camera, light } = directionalScene(material);
        light.amount = 0;
        mesh.geometry = new SphereGeometry({ radius: 0.8 });
        const renderer = await createRenderer(backend);
        let output = target(renderer);
        try {
            renderer.renderToTarget(output, root, camera);
            const before = (await output.readColorAttachment()).data;
            expect(channelSum(before, 2)).toBeGreaterThan(channelSum(before, 0) + 100);
            await renderer.waitForIdle();
            const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
            if (extension === null) throw new Error('Missing RHI device recovery extension');
            const restored = vi.fn();
            const failed = vi.fn();
            renderer.on('rhiDeviceRestored', restored);
            renderer.on('rhiDeviceRecoveryFailed', failed);
            extension.device.destroy();
            await vi.waitFor(() => {
                expect(failed).not.toHaveBeenCalled();
                expect(restored).toHaveBeenCalledOnce();
                expect(renderer.isReady).toBe(true);
            });
            expect(output.isDestroyed).toBe(false);
            renderer.renderToTarget(output, root, camera);
            expect((await output.readColorAttachment()).data).toEqual(before);
            await renderer.waitForIdle();
            renderer.releaseGPUResources();
            output = target(renderer);
            renderer.renderToTarget(output, root, camera);
            expect((await output.readColorAttachment()).data).toEqual(before);
        } finally {
            output.destroy();
            renderer.destroy();
            environment.destroy();
        }
    }, 30_000);
});
