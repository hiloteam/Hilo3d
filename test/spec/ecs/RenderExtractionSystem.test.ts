import { describe, expect, it } from 'vitest';
import { defineComponent } from '../../../src/ecs/Component';
import World from '../../../src/ecs/World';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import { DirectionalLight } from '../../../src/scene/components/Lighting';
import {
    CameraOutput,
    MeshRenderer,
    PerspectiveCamera,
    RenderOrder,
    RenderVisibility
} from '../../../src/scene/components/Rendering';
import { LocalTransform } from '../../../src/scene/components/Transform';
import {
    createRenderExtractionSystem,
    RENDER_WORLD
} from '../../../src/scene/systems/RenderExtractionSystem';
import { createTransformSystem } from '../../../src/scene/systems/TransformSystem';

const RigidBody = defineComponent<Readonly<{ type: 'dynamic' | 'fixed' }>>('test/rigid-body');

describe('ECS RenderWorld extraction', () => {
    it('extracts a composed Mesh + RigidBody Entity without an application binding', async () => {
        const world = await World.create({
            systems: [createRenderExtractionSystem(), createTransformSystem()]
        });
        const entity = world.createEntity();
        const geometry = new BoxGeometry();
        const material = new BasicMaterial();
        world.add(entity, LocalTransform, { position: [1, 2, 3] });
        world.add(entity, MeshRenderer, { geometry, material });
        world.add(entity, RenderVisibility, { layer: 4 });
        world.add(entity, RenderOrder, { renderOrder: 7, sortingLayer: 2, zIndex: 9 });
        world.add(entity, RigidBody, { type: 'dynamic' });

        world.update(0);

        const renderWorld = world.getResource(RENDER_WORLD);
        expect(renderWorld.length).toBe(1);
        expect(renderWorld.geometryData[0]).toBe(geometry);
        expect(renderWorld.materialData[0]).toBe(material);
        expect(renderWorld.layerData[0]).toBe(4);
        expect(renderWorld.renderOrderData[0]).toBe(7);
        expect(renderWorld.sortingLayerData[0]).toBe(2);
        expect(renderWorld.zIndexData[0]).toBe(9);
        expect(Array.from(renderWorld.worldMatrixData.slice(12, 15))).toEqual([1, 2, 3]);
        expect(world.query(LocalTransform, MeshRenderer, RigidBody).length).toBe(1);
        world.destroy();
    });

    it('preserves stable render ids and touches only dirty extracted rows', async () => {
        const entityCount = 10_000;
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [createTransformSystem(), createRenderExtractionSystem()]
        });
        const geometry = new BoxGeometry();
        const material = new BasicMaterial();
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            world.add(entity, LocalTransform, { position: [index, 0, 0] });
            world.add(entity, MeshRenderer, { geometry, material });
        }
        world.update(0);
        const renderWorld = world.getResource(RENDER_WORLD);
        const stableId = renderWorld.stableRenderIds[500] ?? 0;
        const entityIndex = renderWorld.entityIndices[500] ?? 0;
        const entity = world.entityAt(entityIndex);

        world.set(entity, LocalTransform, { position: [4, 5, 6] });
        world.update(0);

        expect(renderWorld.stableRenderIds[renderWorld.denseIndexOf(entityIndex)]).toBe(stableId);
        expect(renderWorld.getDiagnostics()).toMatchObject({
            renderObjectCount: entityCount,
            structuralUpdateCount: 0,
            transformUpdateCount: 1,
            boundsUpdateCount: 1
        });
        const denseIndex = renderWorld.denseIndexOf(entityIndex);
        expect(
            Array.from(renderWorld.worldBoundsData.slice(denseIndex * 4, denseIndex * 4 + 3))
        ).toEqual([4, 5, 6]);
        expect(renderWorld.worldBoundsData[denseIndex * 4 + 3]).toBeCloseTo(Math.sqrt(3) / 2);

        world.remove(entity, MeshRenderer);
        world.update(0);
        expect(renderWorld.length).toBe(entityCount - 1);
        expect(renderWorld.retiredRenderIdCount).toBe(1);
        expect(renderWorld.getRetiredRenderIds()[0]).toBe(stableId);
        world.destroy();
    });

    it('extracts camera projection and world transform into renderer-local views', async () => {
        const world = await World.create({
            systems: [createTransformSystem(), createRenderExtractionSystem()]
        });
        const cameraEntity = world.createEntity();
        world.add(cameraEntity, LocalTransform, { position: [0, 0, 5] });
        world.add(cameraEntity, PerspectiveCamera, {
            fov: 60,
            near: 0.5,
            far: 500,
            aspect: 2,
            priority: 10
        });
        world.add(cameraEntity, CameraOutput, { enabled: true });

        world.update(0);

        const cameras = world.getResource(RENDER_WORLD).cameras;
        expect(cameras.length).toBe(1);
        const camera = cameras.get(world.entityIndex(cameraEntity));
        expect(camera.isPerspectiveCamera).toBe(true);
        expect(camera.priority).toBe(10);
        expect(camera.viewMatrix.elements[14]).toBeCloseTo(-5);
        expect(cameras.isOutputEnabled(0)).toBe(true);

        world.set(cameraEntity, LocalTransform, { position: [0, 0, 8] });
        world.update(0);
        expect(camera.viewMatrix.elements[14]).toBeCloseTo(-8);
        world.destroy();
    });

    it('extracts light data without renderer hierarchy traversal', async () => {
        const world = await World.create({
            systems: [createTransformSystem(), createRenderExtractionSystem()]
        });
        const lightEntity = world.createEntity();
        world.add(lightEntity, LocalTransform, { rotation: [0, 1, 0, 0] });
        world.add(lightEntity, DirectionalLight, {
            color: [0.25, 0.5, 0.75],
            amount: 3,
            direction: [0, 0, 1],
            lightLayerMask: 5
        });

        world.update(0);

        const lights = world.getResource(RENDER_WORLD).lights;
        expect(lights.length).toBe(1);
        const light = lights.lights[0];
        expect(light?.isDirectionalLight).toBe(true);
        expect(light?.amount).toBe(3);
        expect(light?.lightLayerMask).toBe(5);
        expect(light?.color.toRGBArray()).toEqual([0.25, 0.5, 0.75]);
        world.destroy();
    });

    it('keeps renderer resource identities unique across independent Worlds', async () => {
        const geometry = new BoxGeometry();
        const material = new BasicMaterial();
        const createWorld = async (): Promise<World> => {
            const world = await World.create({
                systems: [createTransformSystem(), createRenderExtractionSystem()]
            });
            const entity = world.createEntity();
            world.add(entity, LocalTransform, {});
            world.add(entity, MeshRenderer, { geometry, material });
            world.update(0);
            return world;
        };
        const first = await createWorld();
        const second = await createWorld();
        const firstRenderWorld = first.getResource(RENDER_WORLD);
        const secondRenderWorld = second.getResource(RENDER_WORLD);

        expect(firstRenderWorld.stableRenderIds[0]).toBe(1);
        expect(secondRenderWorld.stableRenderIds[0]).toBe(1);
        expect(firstRenderWorld.meshes[0]?.id).not.toBe(secondRenderWorld.meshes[0]?.id);
        first.destroy();
        second.destroy();
    });
});
