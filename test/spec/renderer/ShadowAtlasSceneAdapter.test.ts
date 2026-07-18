import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import PointLight from '../../../src/light/PointLight';
import { POINT_SHADOW_DIRECTIONS, POINT_SHADOW_UPS } from '../../../src/light/PointShadowCamera';
import SpotLight from '../../../src/light/SpotLight';
import Vector3 from '../../../src/math/Vector3';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from '../../../src/render/ubo/BuiltInUniformBlocks';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function mainCamera(): PerspectiveCamera {
    const camera = new PerspectiveCamera({ near: 0.1, far: 100, fov: 60, aspect: 1.5 });
    camera.setPosition(3, 4, 8);
    camera.lookAt(new Vector3(0, 0, 0));
    camera.updateViewProjectionMatrix();
    return camera;
}

function expectNumbers(
    actual: ArrayLike<number>,
    expected: readonly number[],
    precision = 5
): void {
    expect(actual.length).toBe(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
        expect(actual[index]).toBeCloseTo(expected[index] ?? 0, precision);
    }
}

function cameraForward(camera: PerspectiveCamera): readonly number[] {
    const forward = new Vector3(0, 0, -1).transformDirection(camera.worldMatrix).normalize();
    return [forward.x, forward.y, forward.z];
}

describe.each([
    ['WebGL capabilities', () => new FakeWebGLRHIBackend()],
    ['WebGPU capabilities', () => new FakeWebGPURHIBackend()]
] as const)('ShadowAtlasSceneAdapter with %s', (_name, createBackend) => {
    it('preserves a reversed directional shadow projection axis', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const directional = new DirectionalLight({
            direction: new Vector3(-0.8, -1, 0),
            shadow: {
                cameraInfo: {
                    left: -0.5,
                    right: 0.5,
                    near: -0.5,
                    far: 0.5,
                    top: -0.5,
                    bottom: 0.5
                }
            }
        });
        const manager = new LightManager();
        manager.addLight(directional);
        const adapter = new ShadowAtlasSceneAdapter();

        const result = adapter.prepare(manager, mainCamera(), device.capabilities, {
            width: 32,
            height: 32
        });

        expect(result.slices[0]?.camera).toMatchObject({
            left: -0.5,
            right: 0.5,
            near: -0.5,
            far: 0.5,
            top: -0.5,
            bottom: 0.5
        });
        adapter.destroy();
        backend.destroy();
    });

    it('converts real directional, spot, and point lights into cameras and LightBlock state', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        const directional = new DirectionalLight({
            direction: new Vector3(0.25, -1, 0.5),
            shadow: { width: 64, height: 32, minBias: 0.002, maxBias: 0.04 }
        });
        const spot = new SpotLight({
            direction: new Vector3(0, -1, 0.25),
            outerCutoff: 30,
            shadow: { width: 32, height: 64, minBias: 0.003, maxBias: 0.06 }
        });
        const point = new PointLight({
            range: 50,
            shadow: { width: 32, cameraInfo: { near: 0.25, far: 25 } }
        });
        directional.setPosition(2, 6, 3);
        spot.setPosition(-3, 5, 1);
        point.setPosition(4, 2, -1);
        manager.addLight(directional).addLight(spot).addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();

        const result = adapter.prepare(manager, mainCamera(), device.capabilities, {
            width: 128,
            height: 96
        });

        expect(result.requests.directional).toEqual([
            { owner: directional, width: 64, height: 32 }
        ]);
        expect(result.requests.spot).toEqual([{ owner: spot, width: 32, height: 64 }]);
        expect(result.requests.point).toEqual([{ owner: point, width: 32, height: 32 }]);
        expect(result.atlas).toMatchObject({
            sliceCount: 8,
            tileWidth: 64,
            tileHeight: 64,
            width: 192,
            height: 192
        });
        expect(result.slices.map(slice => slice.kind)).toEqual([
            'directional',
            'spot',
            'point',
            'point',
            'point',
            'point',
            'point',
            'point'
        ]);
        expect(result.slices.map(slice => slice.face)).toEqual([null, null, 0, 1, 2, 3, 4, 5]);
        expect(result.slices[0]?.camera.isOrthographicCamera).toBe(true);
        expect(result.slices.slice(1).every(slice => slice.camera.isPerspectiveCamera)).toBe(true);
        expect(
            result.slices.every(
                slice => slice.viewProjectionMatrix === slice.camera.viewProjectionMatrix
            )
        ).toBe(true);
        expect(result.lightBlock).toMatchObject({
            directionalShadowCount: 1,
            spotShadowCount: 1,
            pointShadowCount: 1
        });
        expectNumbers(result.lightBlock.atlasSize, [192, 192, 1 / 192, 1 / 192]);
        expectNumbers(result.lightBlock.directionalMapSizes.subarray(0, 2), [64, 64]);
        expectNumbers(result.lightBlock.spotMapSizes.subarray(0, 2), [64, 64]);
        expectNumbers(result.lightBlock.directionalBiases.subarray(0, 2), [0.002, 0.04]);
        expectNumbers(result.lightBlock.spotBiases.subarray(0, 2), [0.003, 0.06]);
        expectNumbers(result.lightBlock.pointCameraPlanes.subarray(0, 2), [0.25, 25]);
        expectNumbers(result.slices[0]?.atlasRect ?? [], [1 / 3, -1 / 3, 0, 1 / 3]);
        expect(
            result.slices.every(slice =>
                Array.from(slice.lightSpaceMatrix.elements).every(value => Number.isFinite(value))
            )
        ).toBe(true);

        adapter.destroy();
        backend.destroy();
    });

    it('locks point faces and matrices to +X,-X,+Y,-Y,+Z,-Z order', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const point = new PointLight({
            shadow: {
                width: 16,
                cameraInfo: { near: 0.5, far: 12 },
                minBias: 0.01,
                maxBias: 0.08
            }
        });
        point.setPosition(2, 3, 4);
        const manager = new LightManager();
        manager.addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();
        const result = adapter.prepare(manager, mainCamera(), device.capabilities, {
            width: 32,
            height: 32
        });

        expect(result.atlas.slices.map(slice => slice.face)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(result.atlas.slices.map(slice => slice.sliceIndex)).toEqual([
            16, 17, 18, 19, 20, 21
        ]);
        result.slices.forEach((slice, face) => {
            expectNumbers(
                cameraForward(slice.camera as PerspectiveCamera),
                POINT_SHADOW_DIRECTIONS[face] ?? []
            );
            expectNumbers(slice.camera.up.elements, POINT_SHADOW_UPS[face] ?? []);
            expectNumbers(
                result.lightBlock.pointMatrices.subarray(face * 16, face * 16 + 16),
                Array.from(slice.lightSpaceMatrix.elements)
            );
            expect(slice.near).toBe(0.5);
            expect(slice.far).toBe(12);
        });
        const uniqueMatrices = new Set(
            result.slices.map(slice => Array.from(slice.lightSpaceMatrix.elements).join(','))
        );
        expect(uniqueMatrices.size).toBe(6);

        adapter.destroy();
        backend.destroy();
    });

    it('preserves independent min and max bias controls in shader ABI order', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const point = new PointLight({ shadow: { minBias: 0.1 } });
        const manager = new LightManager();
        manager.addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();

        const result = adapter.prepare(manager, mainCamera(), device.capabilities, {
            width: 32,
            height: 32
        });

        expectNumbers(result.lightBlock.pointBiases.subarray(0, 2), [0.1, 0.05]);
        expect(result.slices).toHaveLength(6);
        result.slices.forEach(slice => {
            expect(slice.minBias).toBeCloseTo(0.1);
            expect(slice.maxBias).toBeCloseTo(0.05);
        });

        adapter.destroy();
        backend.destroy();
    });

    it('reuses result, requests, slices, cameras, and typed arrays while parameters change', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const directional = new DirectionalLight({ shadow: {} });
        const spot = new SpotLight({ shadow: {} });
        const point = new PointLight({ shadow: {} });
        point.setPosition(1, 2, 3);
        const manager = new LightManager();
        manager.addLight(directional).addLight(spot).addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();
        const camera = mainCamera();
        const first = adapter.prepare(manager, camera, device.capabilities, {
            width: 32,
            height: 24
        });
        const atlas = first.atlas;
        const requests = first.requests;
        const requestArrays = [requests.directional, requests.spot, requests.point];
        const requestRecords = [requests.directional[0], requests.spot[0], requests.point[0]];
        const slices = first.slices;
        const sliceRecords = [...slices];
        const shadowCameras = slices.map(slice => slice.camera);
        const lightSpaceMatrices = slices.map(slice => slice.lightSpaceMatrix);
        const sliceAtlasRects = slices.map(slice => slice.atlasRect);
        const atlasSize = first.lightBlock.atlasSize;
        const atlasRects = first.lightBlock.atlasRects;
        const pointMatrices = first.lightBlock.pointMatrices;
        const oldPointMatrices = Array.from(pointMatrices);

        directional.direction.set(1, -1, 0.25);
        if (!directional.shadow || !spot.shadow || !point.shadow) {
            throw new Error('Shadow options are missing');
        }
        directional.shadow.maxBias = 0.09;
        directional.shadow.cameraInfo = {
            near: -5,
            far: 25,
            left: -4,
            right: 4,
            bottom: -3,
            top: 3
        };
        spot.shadow.cameraInfo = { near: 0.5, far: 30, fov: 45, aspect: 2 };
        point.shadow.cameraInfo = { near: 1, far: 40 };
        point.setPosition(8, 3, -2);
        const second = adapter.prepare(manager, camera, device.capabilities, {
            width: 64,
            height: 48
        });

        expect(second).toBe(first);
        expect(second.atlas).toBe(atlas);
        expect(second.requests).toBe(requests);
        expect(second.requests.directional).toBe(requestArrays[0]);
        expect(second.requests.spot).toBe(requestArrays[1]);
        expect(second.requests.point).toBe(requestArrays[2]);
        expect(second.requests.directional[0]).toBe(requestRecords[0]);
        expect(second.requests.spot[0]).toBe(requestRecords[1]);
        expect(second.requests.point[0]).toBe(requestRecords[2]);
        expect(second.slices).toBe(slices);
        second.slices.forEach((slice, index) => {
            expect(slice).toBe(sliceRecords[index]);
            expect(slice.camera).toBe(shadowCameras[index]);
            expect(slice.lightSpaceMatrix).toBe(lightSpaceMatrices[index]);
            expect(slice.atlasRect).toBe(sliceAtlasRects[index]);
        });
        expect(second.lightBlock.atlasSize).toBe(atlasSize);
        expect(second.lightBlock.atlasRects).toBe(atlasRects);
        expect(second.lightBlock.pointMatrices).toBe(pointMatrices);
        expect(second.requests.directional[0]).toMatchObject({ width: 64, height: 48 });
        expect(second.requests.point[0]).toMatchObject({ width: 48, height: 48 });
        expect(second.lightBlock.directionalBiases[1]).toBeCloseTo(0.09);
        expect(second.slices[0]).toMatchObject({ near: -5, far: 25 });
        expect(second.slices[1]).toMatchObject({ near: 0.5, far: 30 });
        const resizedSpotCamera = second.slices[1]?.camera;
        if (resizedSpotCamera === undefined) throw new Error('Spot shadow slice is missing');
        expect(Reflect.get(resizedSpotCamera, 'fov')).toBe(45);
        expect(Reflect.get(resizedSpotCamera, 'aspect')).toBe(2);
        expectNumbers(second.lightBlock.pointCameraPlanes.subarray(0, 2), [1, 40]);
        expect(Array.from(second.lightBlock.pointMatrices)).not.toEqual(oldPointMatrices);

        adapter.destroy();
        backend.destroy();
    });

    it('prunes disabled, removed, and shadow-disabled owners with bounded high-water storage', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const directional = new DirectionalLight({ shadow: {} });
        const spot = new SpotLight({ shadow: {} });
        const point = new PointLight({ shadow: {} });
        const manager = new LightManager();
        manager.addLight(directional).addLight(spot).addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();
        const camera = mainCamera();
        const populated = adapter.prepare(manager, camera, device.capabilities, {
            width: 16,
            height: 16
        });
        expect(adapter.diagnostics()).toEqual({
            activeLightCount: 3,
            activeCameraCount: 8,
            activeSliceCount: 8,
            retainedLightCapacity: 3,
            retainedSliceCapacity: 8
        });
        const spotCamera = populated.slices[1]?.camera;
        const pointCameras = populated.slices.slice(2).map(slice => slice.camera);

        manager.directionalLights.length = 0;
        adapter.prepare(manager, camera, device.capabilities, { width: 16, height: 16 });
        expect(adapter.hasLight(directional)).toBe(false);
        expect(adapter.hasLight(spot)).toBe(true);
        expect(adapter.hasLight(point)).toBe(true);
        expect(populated.slices[0]?.camera).toBe(spotCamera);
        populated.slices.slice(1).forEach((slice, face) => {
            expect(slice.camera).toBe(pointCameras[face]);
        });
        expect(adapter.diagnostics()).toEqual({
            activeLightCount: 2,
            activeCameraCount: 7,
            activeSliceCount: 7,
            retainedLightCapacity: 3,
            retainedSliceCapacity: 8
        });

        spot.enabled = false;
        point.shadow = null;
        const empty = adapter.prepare(manager, camera, device.capabilities, {
            width: 32,
            height: 32
        });
        expect(empty).toBe(populated);
        expect(empty.atlas.sliceCount).toBe(0);
        expect(empty.slices).toHaveLength(0);
        expect(adapter.hasLight(directional)).toBe(false);
        expect(adapter.hasLight(spot)).toBe(false);
        expect(adapter.hasLight(point)).toBe(false);
        expect(adapter.diagnostics()).toEqual({
            activeLightCount: 0,
            activeCameraCount: 0,
            activeSliceCount: 0,
            retainedLightCapacity: 3,
            retainedSliceCapacity: 8
        });

        const replacement = new PointLight({ shadow: {} });
        manager.addLight(replacement);
        adapter.prepare(manager, camera, device.capabilities, { width: 8, height: 8 });
        expect(adapter.hasLight(replacement)).toBe(true);
        expect(adapter.diagnostics().retainedLightCapacity).toBe(3);
        expect(adapter.diagnostics().retainedSliceCapacity).toBe(8);
        manager.shadowEnabled = false;
        adapter.prepare(manager, camera, device.capabilities, { width: 8, height: 8 });
        expect(adapter.diagnostics().activeLightCount).toBe(0);

        adapter.destroy();
        backend.destroy();
    });

    it('accepts the exact ABI limits, ignores disabled overflow, and rejects enabled overflow', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        for (let index = 0; index < MAX_DIRECTIONAL_LIGHTS; index += 1) {
            manager.addLight(new DirectionalLight({ shadow: { width: 1, height: 1 } }));
        }
        for (let index = 0; index < MAX_SPOT_LIGHTS; index += 1) {
            manager.addLight(new SpotLight({ shadow: { width: 1, height: 1 } }));
        }
        for (let index = 0; index < MAX_POINT_LIGHTS; index += 1) {
            manager.addLight(new PointLight({ shadow: { width: 1, height: 1 } }));
        }
        const overflow = new DirectionalLight({
            enabled: false,
            shadow: { width: 1, height: 1 }
        });
        manager.addLight(overflow);
        manager.directionalLights.push(overflow);
        const adapter = new ShadowAtlasSceneAdapter();
        const valid = adapter.prepare(manager, mainCamera(), device.capabilities, {
            width: 1,
            height: 1
        });

        expect(valid.atlas.sliceCount).toBe(MAX_SHADOW_ATLAS_SLICES);
        expect(valid.lightBlock).toMatchObject({
            directionalShadowCount: MAX_DIRECTIONAL_LIGHTS,
            spotShadowCount: MAX_SPOT_LIGHTS,
            pointShadowCount: MAX_POINT_LIGHTS
        });
        expect(adapter.diagnostics()).toEqual({
            activeLightCount: MAX_DIRECTIONAL_LIGHTS + MAX_SPOT_LIGHTS + MAX_POINT_LIGHTS,
            activeCameraCount: MAX_SHADOW_ATLAS_SLICES,
            activeSliceCount: MAX_SHADOW_ATLAS_SLICES,
            retainedLightCapacity: MAX_DIRECTIONAL_LIGHTS + MAX_SPOT_LIGHTS + MAX_POINT_LIGHTS,
            retainedSliceCapacity: MAX_SHADOW_ATLAS_SLICES
        });
        overflow.enabled = true;
        expect(() =>
            adapter.prepare(manager, mainCamera(), device.capabilities, { width: 1, height: 1 })
        ).toThrow(`Directional shadow count ${String(MAX_DIRECTIONAL_LIGHTS + 1)}`);
        expect(valid.atlas.sliceCount).toBe(MAX_SHADOW_ATLAS_SLICES);

        adapter.destroy();
        backend.destroy();
    });

    it('stages every camera before planner mutation and preserves the last plan on failures', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const directional = new DirectionalLight({ shadow: { width: 16, height: 16 } });
        const point = new PointLight({ shadow: { width: 16, height: 16 } });
        const manager = new LightManager();
        manager.addLight(directional).addLight(point);
        const adapter = new ShadowAtlasSceneAdapter();
        const camera = mainCamera();
        const valid = adapter.prepare(manager, camera, device.capabilities, {
            width: 16,
            height: 16
        });
        const cameraIdentity = valid.slices[0]?.camera;
        const matrixSnapshot = Array.from(valid.lightBlock.directionalMatrices);
        const atlasSnapshot = {
            sliceCount: valid.atlas.sliceCount,
            width: valid.atlas.width,
            height: valid.atlas.height,
            owners: valid.atlas.slices.map(slice => slice.owner)
        };
        const build = vi.spyOn(adapter.planner, 'build');

        directional.direction.set(0, 0, 0);
        expect(() =>
            adapter.prepare(manager, camera, device.capabilities, { width: 16, height: 16 })
        ).toThrow('direction must be non-zero');
        expect(build).not.toHaveBeenCalled();
        expect(valid.slices[0]?.camera).toBe(cameraIdentity);
        expect(Array.from(valid.lightBlock.directionalMatrices)).toEqual(matrixSnapshot);
        expect({
            sliceCount: valid.atlas.sliceCount,
            width: valid.atlas.width,
            height: valid.atlas.height,
            owners: valid.atlas.slices.map(slice => slice.owner)
        }).toEqual(atlasSnapshot);

        directional.direction.set(0, 0, 1);
        if (!directional.shadow) throw new Error('Directional shadow options are missing');
        directional.shadow.width = device.capabilities.limits.maxTextureDimension2D + 1;
        expect(() =>
            adapter.prepare(manager, camera, device.capabilities, { width: 16, height: 16 })
        ).toThrow('exceeds maxTextureDimension2D');
        expect(build).toHaveBeenCalledOnce();
        expect(valid.slices[0]?.camera).toBe(cameraIdentity);
        expect(Array.from(valid.lightBlock.directionalMatrices)).toEqual(matrixSnapshot);
        expect({
            sliceCount: valid.atlas.sliceCount,
            width: valid.atlas.width,
            height: valid.atlas.height,
            owners: valid.atlas.slices.map(slice => slice.owner)
        }).toEqual(atlasSnapshot);

        directional.shadow.width = 16;
        point.shadow = { width: 16, height: 8 };
        expect(() =>
            adapter.prepare(manager, camera, device.capabilities, { width: 16, height: 16 })
        ).toThrow('require equal width and height');
        expect({
            sliceCount: valid.atlas.sliceCount,
            width: valid.atlas.width,
            height: valid.atlas.height,
            owners: valid.atlas.slices.map(slice => slice.owner)
        }).toEqual(atlasSnapshot);

        adapter.destroy();
        backend.destroy();
    });
});
