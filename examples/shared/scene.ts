import {
    Hierarchy,
    LocalTransform,
    MeshRenderer,
    PointLight,
    Quaternion,
    Euler,
    type Entity,
    type Geometry,
    type LocalTransformValue,
    type MaterialInstance,
    type MeshRendererValue,
    type PointLightValue,
    type World
} from 'hilo3d';

export interface ExampleMeshParameters extends LocalTransformValue, MeshRendererValue {
    readonly parent?: Entity;
}

export function createMeshEntity(world: World, parameters: ExampleMeshParameters): Entity {
    const entity = world.createEntity();
    world.add(entity, LocalTransform, {
        ...(parameters.position === undefined ? {} : { position: parameters.position }),
        ...(parameters.rotation === undefined ? {} : { rotation: parameters.rotation }),
        ...(parameters.scale === undefined ? {} : { scale: parameters.scale })
    });
    if (parameters.parent !== undefined) {
        world.add(entity, Hierarchy, { parent: parameters.parent });
    }
    world.add(entity, MeshRenderer, {
        geometry: parameters.geometry,
        material: parameters.material,
        ...(parameters.useInstanced === undefined ? {} : { useInstanced: parameters.useInstanced }),
        ...(parameters.frustumTest === undefined ? {} : { frustumTest: parameters.frustumTest }),
        ...(parameters.castShadows === undefined ? {} : { castShadows: parameters.castShadows }),
        ...(parameters.receiveShadows === undefined
            ? {}
            : { receiveShadows: parameters.receiveShadows }),
        ...(parameters.instanceCount === undefined
            ? {}
            : { instanceCount: parameters.instanceCount })
    });
    return entity;
}

export function createPointLightEntity(
    world: World,
    parameters: PointLightValue & LocalTransformValue & { readonly parent?: Entity }
): Entity {
    const entity = world.createEntity();
    world.add(entity, LocalTransform, {
        ...(parameters.position === undefined ? {} : { position: parameters.position }),
        ...(parameters.rotation === undefined ? {} : { rotation: parameters.rotation }),
        ...(parameters.scale === undefined ? {} : { scale: parameters.scale })
    });
    if (parameters.parent !== undefined) {
        world.add(entity, Hierarchy, { parent: parameters.parent });
    }
    world.add(entity, PointLight, parameters);
    return entity;
}

export function quaternionFromDegrees(
    xDegrees = 0,
    yDegrees = 0,
    zDegrees = 0
): readonly [number, number, number, number] {
    const quaternion = new Quaternion().fromEuler(
        new Euler(
            (xDegrees * Math.PI) / 180,
            (yDegrees * Math.PI) / 180,
            (zDegrees * Math.PI) / 180
        )
    );
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

export function replaceMesh(
    world: World,
    entity: Entity,
    geometry: Geometry,
    material: MaterialInstance
): void {
    world.set(entity, MeshRenderer, { geometry, material });
}
