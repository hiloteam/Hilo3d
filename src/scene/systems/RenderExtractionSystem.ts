import type { ComponentStore, ComponentType } from '../../ecs/Component';
import { defineWorldResource } from '../../ecs/Resource';
import {
    WORLD_SYSTEM_API_VERSION,
    type WorldSystem,
    type WorldSystemRuntime
} from '../../ecs/System';
import type World from '../../ecs/World';
import Matrix4 from '../../math/Matrix4';
import { RenderWorld } from '../../render/world/RenderWorld';
import { getTransformStore, LocalTransform, WorldTransform } from '../components/Transform';
import {
    ChangedComponentStore,
    CameraOutput,
    MeshRenderer,
    OrthographicCamera,
    PerspectiveCamera,
    RenderOrder,
    RenderExtensionComponent,
    RenderVisibility
} from '../components/Rendering';
import { TRANSFORM_SYSTEM_ID } from './TransformSystem';
import {
    AmbientLight,
    AreaLight,
    DirectionalLight,
    PointLight,
    SpotLight
} from '../components/Lighting';
import { SpriteRenderer } from '../components/TwoD';
import { MorphPose, SkeletonPose, Skin } from '../components/Animation';

/** Stable identity used by renderer and addon ordering. */
export const RENDER_EXTRACTION_SYSTEM_ID = 'hilo3d/render-extraction';

/** Renderer-owned dense scene database published by render extraction. */
export const RENDER_WORLD = defineWorldResource<RenderWorld>('hilo3d/render-world');

function isChangedStore<T>(store: ComponentStore<T>): store is ChangedComponentStore<T> {
    return store instanceof ChangedComponentStore;
}

function changedStore<T>(world: World, component: ComponentType<T>): ChangedComponentStore<T> {
    const store = world.getStore(component);
    if (!isChangedStore(store)) {
        throw new TypeError(
            `Component ${component.name} is not backed by a render-extraction change queue.`
        );
    }
    return store;
}

/** Create incremental World-to-RenderWorld extraction without hierarchy traversal. */
export function createRenderExtractionSystem(): WorldSystem {
    return {
        descriptor: {
            id: RENDER_EXTRACTION_SYSTEM_ID,
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'render-extract',
            requires: [TRANSFORM_SYSTEM_ID],
            provides: [RENDER_WORLD],
            access: {
                reads: [
                    LocalTransform,
                    WorldTransform,
                    MeshRenderer,
                    RenderVisibility,
                    RenderOrder,
                    RenderExtensionComponent,
                    PerspectiveCamera,
                    OrthographicCamera,
                    CameraOutput,
                    AmbientLight,
                    DirectionalLight,
                    PointLight,
                    SpotLight,
                    AreaLight,
                    SpriteRenderer,
                    MorphPose,
                    Skin,
                    SkeletonPose
                ]
            }
        },
        setup(context): WorldSystemRuntime {
            const world = context.world;
            const transforms = getTransformStore(world);
            const meshes = changedStore(world, MeshRenderer);
            const sprites = changedStore(world, SpriteRenderer);
            const visibility = changedStore(world, RenderVisibility);
            const order = changedStore(world, RenderOrder);
            const extensions = changedStore(world, RenderExtensionComponent);
            const perspectiveCameras = changedStore(world, PerspectiveCamera);
            const orthographicCameras = changedStore(world, OrthographicCamera);
            const cameraOutputs = changedStore(world, CameraOutput);
            const ambientLights = changedStore(world, AmbientLight);
            const directionalLights = changedStore(world, DirectionalLight);
            const pointLights = changedStore(world, PointLight);
            const spotLights = changedStore(world, SpotLight);
            const areaLights = changedStore(world, AreaLight);
            const morphs = changedStore(world, MorphPose);
            const skins = world.getStore(Skin);
            const skeletons = world.getStore(SkeletonPose);
            const query = world.query(LocalTransform, MeshRenderer);
            const spriteQuery = world.query(LocalTransform, SpriteRenderer);
            const extensionQuery = world.query(RenderExtensionComponent);
            const perspectiveQuery = world.query(LocalTransform, PerspectiveCamera);
            const orthographicQuery = world.query(LocalTransform, OrthographicCamera);
            const ambientQuery = world.query(AmbientLight);
            const directionalQuery = world.query(LocalTransform, DirectionalLight);
            const pointQuery = world.query(LocalTransform, PointLight);
            const spotQuery = world.query(LocalTransform, SpotLight);
            const areaQuery = world.query(LocalTransform, AreaLight);
            const skinQuery = world.query(LocalTransform, MeshRenderer, Skin);
            const renderWorld = new RenderWorld(transforms.entityCapacity, query.length);
            let structuralDirty = new Uint8Array(transforms.entityCapacity);
            let structuralEntities = new Uint32Array(transforms.entityCapacity);
            let structuralCount = 0;
            let skinDirty = new Uint8Array(transforms.entityCapacity);
            let skinDirtyEntities = new Uint32Array(transforms.entityCapacity);
            let skinDirtyCount = 0;
            let jointDependents = new Array<number[] | undefined>(transforms.entityCapacity);
            let lastSkinRevision = -1;
            let lastSkeletonRevision = -1;
            let paletteScratch = new Float32Array(0);
            const meshWorld = new Matrix4();
            const meshWorldInverse = new Matrix4();
            const jointWorld = new Matrix4();
            const jointMatrix = new Matrix4();
            const matrixScratch = new Float32Array(16);
            const ensureStructuralCapacity = (capacity: number): void => {
                if (capacity <= structuralDirty.length) return;
                const dirty = new Uint8Array(capacity);
                dirty.set(structuralDirty);
                structuralDirty = dirty;
                const entities = new Uint32Array(capacity);
                entities.set(structuralEntities);
                structuralEntities = entities;
                const nextSkinDirty = new Uint8Array(capacity);
                nextSkinDirty.set(skinDirty);
                skinDirty = nextSkinDirty;
                const nextSkinEntities = new Uint32Array(capacity);
                nextSkinEntities.set(skinDirtyEntities);
                skinDirtyEntities = nextSkinEntities;
                jointDependents.length = capacity;
                renderWorld.ensureEntityCapacity(capacity);
            };
            const queueStructure = (entityIndex: number): void => {
                ensureStructuralCapacity(entityIndex + 1);
                if (structuralDirty[entityIndex] === 1) return;
                structuralDirty[entityIndex] = 1;
                structuralEntities[structuralCount] = entityIndex;
                structuralCount++;
            };
            const queueSkin = (entityIndex: number): void => {
                ensureStructuralCapacity(entityIndex + 1);
                if (skinDirty[entityIndex] === 1) return;
                skinDirty[entityIndex] = 1;
                skinDirtyEntities[skinDirtyCount] = entityIndex;
                skinDirtyCount++;
            };
            const rebuildSkinRelationships = (): void => {
                if (
                    lastSkinRevision === skins.dataRevision &&
                    lastSkeletonRevision === skeletons.dataRevision
                )
                    return;
                jointDependents = new Array<number[] | undefined>(transforms.entityCapacity);
                for (let index = 0; index < skinQuery.length; index++) {
                    const meshEntityIndex = skinQuery.entityIndices[index] ?? 0;
                    queueSkin(meshEntityIndex);
                    const skin = skins.get(meshEntityIndex);
                    if (!world.isAlive(skin.skeleton)) continue;
                    const skeletonIndex = world.entityIndex(skin.skeleton);
                    if (!skeletons.has(skeletonIndex)) continue;
                    for (const joint of skeletons.get(skeletonIndex).joints) {
                        if (!world.isAlive(joint)) continue;
                        const jointIndex = world.entityIndex(joint);
                        let dependents = jointDependents[jointIndex];
                        if (!dependents) {
                            dependents = [];
                            jointDependents[jointIndex] = dependents;
                        }
                        dependents.push(meshEntityIndex);
                    }
                }
                lastSkinRevision = skins.dataRevision;
                lastSkeletonRevision = skeletons.dataRevision;
            };
            const synchronizeSkin = (entityIndex: number): void => {
                if (!renderWorld.has(entityIndex) || !skins.has(entityIndex)) {
                    renderWorld.updateSkin(entityIndex, null);
                    return;
                }
                const skin = skins.get(entityIndex);
                if (!world.isAlive(skin.skeleton)) {
                    throw new ReferenceError('Skin references a stale SkeletonPose Entity.');
                }
                const skeletonIndex = world.entityIndex(skin.skeleton);
                if (!skeletons.has(skeletonIndex)) {
                    throw new TypeError('Skin Entity must reference a SkeletonPose component.');
                }
                const skeleton = skeletons.get(skeletonIndex);
                if (
                    skeleton.joints.length === 0 ||
                    skeleton.joints.length !== skeleton.inverseBindMatrices.length ||
                    skeleton.joints.length > 128
                ) {
                    throw new RangeError(
                        'SkeletonPose requires 1-128 joints and matching inverse bind matrices.'
                    );
                }
                const required = skeleton.joints.length * 16;
                if (paletteScratch.length < required) paletteScratch = new Float32Array(required);
                transforms.copyWorldMatrix(entityIndex, matrixScratch);
                meshWorld.fromArray(matrixScratch);
                meshWorldInverse.invert(meshWorld);
                for (let index = 0; index < skeleton.joints.length; index++) {
                    const joint = skeleton.joints[index];
                    if (joint === undefined || !world.isAlive(joint)) {
                        throw new ReferenceError(`SkeletonPose joint ${String(index)} is stale.`);
                    }
                    const jointIndex = world.entityIndex(joint);
                    if (!transforms.has(jointIndex)) {
                        throw new TypeError(
                            `SkeletonPose joint ${String(index)} has no LocalTransform.`
                        );
                    }
                    const inverseBind = skeleton.inverseBindMatrices[index];
                    if (!inverseBind) {
                        throw new RangeError(
                            `SkeletonPose inverse bind ${String(index)} is missing.`
                        );
                    }
                    transforms.copyWorldMatrix(jointIndex, matrixScratch);
                    jointWorld.fromArray(matrixScratch);
                    jointMatrix.copy(meshWorldInverse).multiply(jointWorld).multiply(inverseBind);
                    jointMatrix.toArray(paletteScratch, index * 16);
                }
                renderWorld.updateSkin(entityIndex, paletteScratch.subarray(0, required));
            };
            for (let index = 0; index < query.length; index++) {
                queueStructure(query.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < spriteQuery.length; index++) {
                queueStructure(spriteQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < extensionQuery.length; index++) {
                queueStructure(extensionQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < perspectiveQuery.length; index++) {
                queueStructure(perspectiveQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < orthographicQuery.length; index++) {
                queueStructure(orthographicQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < ambientQuery.length; index++) {
                queueStructure(ambientQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < directionalQuery.length; index++) {
                queueStructure(directionalQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < pointQuery.length; index++) {
                queueStructure(pointQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < spotQuery.length; index++) {
                queueStructure(spotQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < areaQuery.length; index++) {
                queueStructure(areaQuery.entityIndices[index] ?? 0);
            }
            const synchronizeCamera = (entityIndex: number): void => {
                const hasPerspective = perspectiveQuery.has(entityIndex);
                const hasOrthographic = orthographicQuery.has(entityIndex);
                if (!hasPerspective && !hasOrthographic) {
                    renderWorld.cameras.remove(entityIndex);
                    return;
                }
                renderWorld.cameras.synchronize(
                    entityIndex,
                    hasPerspective ? perspectiveCameras.get(entityIndex) : undefined,
                    hasOrthographic ? orthographicCameras.get(entityIndex) : undefined,
                    cameraOutputs.has(entityIndex) ? cameraOutputs.get(entityIndex) : undefined,
                    transforms
                );
            };
            const synchronizeLight = (entityIndex: number): void => {
                const hasAmbient = ambientQuery.has(entityIndex);
                const hasDirectional = directionalQuery.has(entityIndex);
                const hasPoint = pointQuery.has(entityIndex);
                const hasSpot = spotQuery.has(entityIndex);
                const hasArea = areaQuery.has(entityIndex);
                renderWorld.lights.synchronize(
                    entityIndex,
                    hasAmbient ? ambientLights.get(entityIndex) : undefined,
                    hasDirectional ? directionalLights.get(entityIndex) : undefined,
                    hasPoint ? pointLights.get(entityIndex) : undefined,
                    hasSpot ? spotLights.get(entityIndex) : undefined,
                    hasArea ? areaLights.get(entityIndex) : undefined,
                    transforms
                );
            };
            const unsubscribe = world.subscribeStructureChanges((entityIndex, component) => {
                if (
                    component === null ||
                    component === LocalTransform ||
                    component === MeshRenderer ||
                    component === SpriteRenderer ||
                    component === RenderExtensionComponent ||
                    component === PerspectiveCamera ||
                    component === OrthographicCamera ||
                    component === CameraOutput ||
                    component === AmbientLight ||
                    component === DirectionalLight ||
                    component === PointLight ||
                    component === SpotLight ||
                    component === AreaLight ||
                    component === Skin ||
                    component === SkeletonPose ||
                    component === MorphPose
                ) {
                    queueStructure(entityIndex);
                }
            });
            context.provide(RENDER_WORLD, renderWorld);
            return {
                execute(): void {
                    renderWorld.beginExtraction();
                    rebuildSkinRelationships();
                    for (let index = 0; index < structuralCount; index++) {
                        const entityIndex = structuralEntities[index] ?? 0;
                        structuralDirty[entityIndex] = 0;
                        const hasMesh = query.has(entityIndex);
                        const hasSprite = spriteQuery.has(entityIndex);
                        if (hasMesh && hasSprite) {
                            throw new TypeError(
                                `Entity index ${String(entityIndex)} cannot have MeshRenderer and SpriteRenderer.`
                            );
                        }
                        if (hasMesh || hasSprite) {
                            const sprite = hasSprite ? sprites.get(entityIndex) : undefined;
                            const visibleValue = visibility.has(entityIndex)
                                ? visibility.get(entityIndex)
                                : undefined;
                            const orderValue = order.has(entityIndex)
                                ? order.get(entityIndex)
                                : undefined;
                            renderWorld.add(
                                entityIndex,
                                hasMesh
                                    ? meshes.get(entityIndex)
                                    : {
                                          geometry: sprites.get(entityIndex).geometry,
                                          material: sprites.get(entityIndex).material,
                                          useInstanced: true,
                                          frustumTest: false,
                                          castShadows: false,
                                          receiveShadows: false
                                      },
                                visibleValue,
                                orderValue,
                                transforms,
                                sprite
                            );
                            if (morphs.has(entityIndex)) {
                                renderWorld.updateMorph(
                                    entityIndex,
                                    morphs.get(entityIndex).weights
                                );
                            }
                            if (skins.has(entityIndex)) queueSkin(entityIndex);
                        } else {
                            renderWorld.remove(entityIndex);
                        }
                        synchronizeCamera(entityIndex);
                        synchronizeLight(entityIndex);
                        renderWorld.synchronizeExtension(
                            entityIndex,
                            extensionQuery.has(entityIndex)
                                ? extensions.get(entityIndex).extension
                                : undefined
                        );
                        renderWorld.updateTransform(entityIndex, transforms);
                    }
                    structuralCount = 0;
                    for (let index = 0; index < transforms.changedWorldEntityCount; index++) {
                        const entityIndex = transforms.changedWorldEntityIndices[index] ?? 0;
                        renderWorld.updateTransform(entityIndex, transforms);
                        if (skins.has(entityIndex)) queueSkin(entityIndex);
                        const dependents = jointDependents[entityIndex];
                        if (dependents) {
                            for (const dependent of dependents) queueSkin(dependent);
                        }
                    }
                    for (let index = 0; index < meshes.changedEntityCount; index++) {
                        const entityIndex = meshes.changedEntityIndices[index] ?? 0;
                        if (meshes.has(entityIndex)) {
                            renderWorld.updateMesh(entityIndex, meshes.get(entityIndex));
                        }
                    }
                    for (let index = 0; index < sprites.changedEntityCount; index++) {
                        const entityIndex = sprites.changedEntityIndices[index] ?? 0;
                        if (sprites.has(entityIndex)) {
                            renderWorld.updateSprite(entityIndex, sprites.get(entityIndex));
                        }
                    }
                    for (let index = 0; index < morphs.changedEntityCount; index++) {
                        const entityIndex = morphs.changedEntityIndices[index] ?? 0;
                        renderWorld.updateMorph(
                            entityIndex,
                            morphs.has(entityIndex) ? morphs.get(entityIndex).weights : null
                        );
                    }
                    for (let index = 0; index < visibility.changedEntityCount; index++) {
                        const entityIndex = visibility.changedEntityIndices[index] ?? 0;
                        renderWorld.updateVisibility(
                            entityIndex,
                            visibility.has(entityIndex) ? visibility.get(entityIndex) : undefined
                        );
                    }
                    for (let index = 0; index < order.changedEntityCount; index++) {
                        const entityIndex = order.changedEntityIndices[index] ?? 0;
                        renderWorld.updateOrder(
                            entityIndex,
                            order.has(entityIndex) ? order.get(entityIndex) : undefined
                        );
                    }
                    for (let index = 0; index < extensions.changedEntityCount; index++) {
                        const entityIndex = extensions.changedEntityIndices[index] ?? 0;
                        renderWorld.synchronizeExtension(
                            entityIndex,
                            extensions.has(entityIndex)
                                ? extensions.get(entityIndex).extension
                                : undefined
                        );
                    }
                    for (let index = 0; index < perspectiveCameras.changedEntityCount; index++) {
                        synchronizeCamera(perspectiveCameras.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < orthographicCameras.changedEntityCount; index++) {
                        synchronizeCamera(orthographicCameras.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < cameraOutputs.changedEntityCount; index++) {
                        const entityIndex = cameraOutputs.changedEntityIndices[index] ?? 0;
                        renderWorld.cameras.updateOutput(
                            entityIndex,
                            cameraOutputs.has(entityIndex)
                                ? cameraOutputs.get(entityIndex)
                                : undefined
                        );
                    }
                    for (let index = 0; index < ambientLights.changedEntityCount; index++) {
                        synchronizeLight(ambientLights.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < directionalLights.changedEntityCount; index++) {
                        synchronizeLight(directionalLights.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < pointLights.changedEntityCount; index++) {
                        synchronizeLight(pointLights.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < spotLights.changedEntityCount; index++) {
                        synchronizeLight(spotLights.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < areaLights.changedEntityCount; index++) {
                        synchronizeLight(areaLights.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < skinDirtyCount; index++) {
                        const entityIndex = skinDirtyEntities[index] ?? 0;
                        skinDirty[entityIndex] = 0;
                        synchronizeSkin(entityIndex);
                    }
                    skinDirtyCount = 0;
                    transforms.clearChangedWorldEntities();
                    meshes.clearChangedEntities();
                    sprites.clearChangedEntities();
                    visibility.clearChangedEntities();
                    order.clearChangedEntities();
                    extensions.clearChangedEntities();
                    perspectiveCameras.clearChangedEntities();
                    orthographicCameras.clearChangedEntities();
                    cameraOutputs.clearChangedEntities();
                    ambientLights.clearChangedEntities();
                    directionalLights.clearChangedEntities();
                    pointLights.clearChangedEntities();
                    spotLights.clearChangedEntities();
                    areaLights.clearChangedEntities();
                    morphs.clearChangedEntities();
                },
                destroy(): void {
                    unsubscribe();
                    renderWorld.clear();
                }
            };
        }
    };
}
