import type Camera from '../camera/Camera';
import type OrthographicCameraView from '../camera/OrthographicCamera';
import type PerspectiveCameraView from '../camera/PerspectiveCamera';
import type Mesh from '../core/Mesh';
import type AreaLightView from '../light/AreaLight';
import type DirectionalLightView from '../light/DirectionalLight';
import type { Entity } from '../ecs/Entity';
import type World from '../ecs/World';
import type LightView from '../light/Light';
import type SpotLightView from '../light/SpotLight';
import Matrix4 from '../math/Matrix4';
import Quaternion from '../math/Quaternion';
import Vector3 from '../math/Vector3';
import {
    AnimationClip,
    Animator,
    MorphPose,
    SkeletonPose,
    Skin,
    type AnimationInterpolation,
    type AnimationTargetProperty
} from './components/Animation';
import { Name } from './components/Identity';
import {
    AmbientLight,
    AreaLight,
    DirectionalLight,
    PointLight,
    SpotLight
} from './components/Lighting';
import {
    MeshRenderer,
    OrthographicCamera,
    PerspectiveCamera,
    RenderOrder,
    RenderVisibility
} from './components/Rendering';
import { Hierarchy, LocalTransform } from './components/Transform';

let nextPrefabRecordIdentity = 1;

/** One unresolved animation channel in a serialized prefab asset. */
export interface ScenePrefabAnimationChannel {
    readonly targetId: string;
    readonly property: AnimationTargetProperty;
    readonly times: Float32Array;
    readonly values: Float32Array;
    readonly width: number;
    readonly interpolation?: AnimationInterpolation;
}

/** One named immutable animation clip before Entity relationship resolution. */
export interface ScenePrefabAnimation {
    readonly name: string;
    readonly channels: readonly ScenePrefabAnimationChannel[];
}

/** Skin asset whose joint identifiers are resolved only when the prefab is instantiated. */
export interface ScenePrefabSkin {
    readonly jointIds: readonly string[];
    readonly inverseBindMatrices: readonly Matrix4[];
}

/** Loader-authored renderer attachment accepted by a prefab record. */
export type ScenePrefabAttachment = Mesh | Camera | LightView;

/**
 * Authoring-only prefab record. It stores serialized relationships but has no update, events,
 * component map, renderer traversal contract, or runtime ownership behavior.
 */
export class ScenePrefabRecord {
    readonly id = `prefab-record-${String(nextPrefabRecordIdentity++)}`;
    readonly children: ScenePrefabRecord[] = [];
    readonly attachments: ScenePrefabAttachment[] = [];
    readonly skins = new Map<Mesh, ScenePrefabSkin>();
    name: string;
    animationId: string;
    jointName: string;
    readonly matrix = new Matrix4();
    readonly position = new Vector3();
    readonly quaternion = new Quaternion();
    readonly scale = new Vector3(1, 1, 1);
    private matrixAuthored = false;

    constructor(parameters: { readonly name?: string; readonly animationId?: string } = {}) {
        this.name = parameters.name ?? '';
        this.animationId = parameters.animationId ?? this.id;
        this.jointName = this.animationId;
    }

    append(child: ScenePrefabRecord | ScenePrefabAttachment): void {
        if (child instanceof ScenePrefabRecord) this.children.push(child);
        else this.attachments.push(child);
    }

    attachSkin(mesh: Mesh, skin: ScenePrefabSkin): void {
        this.skins.set(mesh, skin);
    }

    setMatrix(values: ArrayLike<number>): void {
        this.matrix.fromArray(values);
        this.matrix.decompose(this.quaternion, this.position, this.scale);
        this.matrixAuthored = true;
    }

    setPosition(x: number, y: number, z: number): void {
        this.position.set(x, y, z);
        this.matrixAuthored = false;
    }

    setScale(x: number, y: number, z: number): void {
        this.scale.set(x, y, z);
        this.matrixAuthored = false;
    }

    localTransform(): {
        readonly position: readonly [number, number, number];
        readonly rotation: readonly [number, number, number, number];
        readonly scale: readonly [number, number, number];
    } {
        if (this.matrixAuthored) this.matrix.decompose(this.quaternion, this.position, this.scale);
        return {
            position: [this.position.x, this.position.y, this.position.z],
            rotation: [this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w],
            scale: [this.scale.x, this.scale.y, this.scale.z]
        };
    }

    traverse(visitor: (record: ScenePrefabRecord) => void): void {
        const stack: ScenePrefabRecord[] = [this];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            visitor(node);
            for (let index = node.children.length - 1; index >= 0; index--) {
                const child = node.children[index];
                if (child) stack.push(child);
            }
        }
    }
}

/** Entity handles created by one prefab instantiation. */
export interface SceneInstance {
    readonly roots: readonly Entity[];
    readonly entities: readonly Entity[];
    readonly entitiesByAssetId: ReadonlyMap<string, Entity>;
    readonly meshEntities: readonly Entity[];
    readonly cameraEntities: readonly Entity[];
    readonly lightEntities: readonly Entity[];
    readonly animatorEntities: readonly Entity[];
}

/** Immutable scene/prefab data instantiated into any compatible World. */
export class ScenePrefab {
    readonly roots: readonly ScenePrefabRecord[];
    readonly animations: readonly ScenePrefabAnimation[];

    constructor(
        roots: readonly ScenePrefabRecord[],
        animations: readonly ScenePrefabAnimation[] = []
    ) {
        this.roots = Object.freeze(Array.from(roots));
        this.animations = Object.freeze(Array.from(animations));
    }

    /** Resolve serialized relationships and add the complete prefab to a World. */
    instantiate(world: World): SceneInstance {
        const entities: Entity[] = [];
        const meshEntities: Entity[] = [];
        const cameraEntities: Entity[] = [];
        const lightEntities: Entity[] = [];
        const animatorEntities: Entity[] = [];
        const entitiesByAssetId = new Map<string, Entity>();
        const jointEntitiesByName = new Map<string, Entity>();
        const pendingSkins: { readonly entity: Entity; readonly skin: ScenePrefabSkin }[] = [];

        const instantiateRecord = (node: ScenePrefabRecord, parent: Entity | null): Entity => {
            const entity = world.createEntity();
            entities.push(entity);
            entitiesByAssetId.set(node.animationId, entity);
            jointEntitiesByName.set(node.jointName, entity);
            world.add(entity, Name, { value: node.name });
            world.add(entity, LocalTransform, node.localTransform());
            world.add(entity, Hierarchy, { parent });

            let meshUsed = false;
            let perspectiveUsed = false;
            let orthographicUsed = false;
            let lightKind = '';
            for (const attachment of node.attachments) {
                const kind = attachmentKind(attachment);
                const duplicate =
                    (kind === 'mesh' && meshUsed) ||
                    (kind === 'perspective-camera' && perspectiveUsed) ||
                    (kind === 'orthographic-camera' && orthographicUsed) ||
                    (kind.endsWith('-light') && lightKind === kind);
                let target = entity;
                if (duplicate) {
                    target = world.createEntity();
                    entities.push(target);
                    world.add(target, Name, { value: attachment.name });
                    world.add(target, LocalTransform, {});
                    world.add(target, Hierarchy, { parent: entity });
                }
                if (kind === 'mesh') {
                    meshUsed = true;
                    addMesh(world, target, attachment as Mesh);
                    meshEntities.push(target);
                    const skin = node.skins.get(attachment as Mesh);
                    if (skin) pendingSkins.push({ entity: target, skin });
                } else if (kind === 'perspective-camera') {
                    perspectiveUsed = true;
                    addPerspectiveCamera(world, target, attachment as PerspectiveCameraView);
                    cameraEntities.push(target);
                } else if (kind === 'orthographic-camera') {
                    orthographicUsed = true;
                    addOrthographicCamera(world, target, attachment as OrthographicCameraView);
                    cameraEntities.push(target);
                } else {
                    lightKind = kind;
                    addLight(world, target, attachment as LightView);
                    lightEntities.push(target);
                }
            }
            for (const child of node.children) instantiateRecord(child, entity);
            return entity;
        };

        const roots = this.roots.map(root => instantiateRecord(root, null));
        for (const pending of pendingSkins) {
            const joints = pending.skin.jointIds.map(jointId => {
                const joint = jointEntitiesByName.get(jointId);
                if (joint === undefined) {
                    throw new RangeError(`Prefab skin references missing joint ${jointId}.`);
                }
                return joint;
            });
            const skeleton = world.createEntity();
            entities.push(skeleton);
            world.add(skeleton, SkeletonPose, {
                joints,
                inverseBindMatrices: pending.skin.inverseBindMatrices
            });
            world.add(pending.entity, Skin, { skeleton });
        }

        for (const animation of this.animations) {
            const channels = animation.channels.map(channel => {
                const target = entitiesByAssetId.get(channel.targetId);
                if (target === undefined) {
                    throw new RangeError(
                        `Prefab animation ${animation.name} references missing target ${channel.targetId}.`
                    );
                }
                if (channel.property === 'weights' && !world.has(target, MorphPose)) {
                    world.add(target, MorphPose, { weights: new Float32Array(channel.width) });
                }
                return { ...channel, target };
            });
            const animator = world.createEntity();
            entities.push(animator);
            world.add(animator, Animator, {
                clip: new AnimationClip(animation.name, channels),
                playing: true,
                loop: true
            });
            animatorEntities.push(animator);
        }

        return {
            roots: Object.freeze(roots),
            entities: Object.freeze(entities),
            entitiesByAssetId,
            meshEntities: Object.freeze(meshEntities),
            cameraEntities: Object.freeze(cameraEntities),
            lightEntities: Object.freeze(lightEntities),
            animatorEntities: Object.freeze(animatorEntities)
        };
    }
}

function attachmentKind(attachment: ScenePrefabAttachment): string {
    if ('isMesh' in attachment) return 'mesh';
    if ('isPerspectiveCamera' in attachment && attachment.isPerspectiveCamera)
        return 'perspective-camera';
    if ('isOrthographicCamera' in attachment && attachment.isOrthographicCamera)
        return 'orthographic-camera';
    if ('isAmbientLight' in attachment && attachment.isAmbientLight) return 'ambient-light';
    if ('isDirectionalLight' in attachment && attachment.isDirectionalLight)
        return 'directional-light';
    if ('isPointLight' in attachment && attachment.isPointLight) return 'point-light';
    if ('isSpotLight' in attachment && attachment.isSpotLight) return 'spot-light';
    if ('isAreaLight' in attachment && attachment.isAreaLight) return 'area-light';
    throw new TypeError(`Unsupported prefab attachment ${attachment.className}.`);
}

function addMesh(world: World, entity: Entity, mesh: Mesh): void {
    if (!mesh.geometry || !mesh.material) {
        throw new TypeError('A prefab mesh requires geometry and material before instantiation.');
    }
    world.add(entity, MeshRenderer, {
        geometry: mesh.geometry,
        material: mesh.material,
        useInstanced: mesh.useInstanced,
        frustumTest: mesh.frustumTest,
        castShadows: mesh.castShadows,
        receiveShadows: mesh.receiveShadows,
        instanceCount: mesh.instanceCount
    });
    world.add(entity, RenderVisibility, { visible: mesh.visible, layer: mesh.layer });
    world.add(entity, RenderOrder, { renderOrder: mesh.renderOrder });
    if (mesh.morphWeights) world.add(entity, MorphPose, { weights: mesh.morphWeights.slice() });
}

function commonCamera(camera: Camera): {
    readonly depthMode: Camera['depthMode'];
    readonly visibility: number;
    readonly clearColor: boolean;
    readonly clearDepth: boolean;
    readonly clearStencil: boolean;
    readonly priority: number;
} {
    return {
        depthMode: camera.depthMode,
        visibility: camera.visibility,
        clearColor: camera.clearColor,
        clearDepth: camera.clearDepth,
        clearStencil: camera.clearStencil,
        priority: camera.priority
    };
}

function addPerspectiveCamera(world: World, entity: Entity, camera: PerspectiveCameraView): void {
    world.add(entity, PerspectiveCamera, {
        ...commonCamera(camera),
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        aspect: camera.aspect
    });
}

function addOrthographicCamera(world: World, entity: Entity, camera: OrthographicCameraView): void {
    world.add(entity, OrthographicCamera, {
        ...commonCamera(camera),
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
        near: camera.near,
        far: camera.far
    });
}

function commonLight(light: LightView): {
    readonly color: readonly [number, number, number];
    readonly amount: number;
    readonly enabled: boolean;
    readonly constantAttenuation: number;
    readonly linearAttenuation: number;
    readonly quadraticAttenuation: number;
    readonly range: number;
    readonly lightLayerMask: number;
} {
    return {
        color: [light.color.r, light.color.g, light.color.b],
        amount: light.amount,
        enabled: light.enabled,
        constantAttenuation: light.constantAttenuation,
        linearAttenuation: light.linearAttenuation,
        quadraticAttenuation: light.quadraticAttenuation,
        range: light.range,
        lightLayerMask: light.lightLayerMask
    };
}

function addLight(world: World, entity: Entity, light: LightView): void {
    const common = commonLight(light);
    if (light.isAmbientLight) world.add(entity, AmbientLight, common);
    else if (light.isDirectionalLight) {
        const directional = light as DirectionalLightView;
        world.add(entity, DirectionalLight, {
            ...common,
            direction: [directional.direction.x, directional.direction.y, directional.direction.z],
            shadow: directional.shadow
        });
    } else if (light.isPointLight) {
        const point = light;
        world.add(entity, PointLight, { ...common, shadow: point.shadow });
    } else if (light.isSpotLight) {
        const spot = light as SpotLightView;
        world.add(entity, SpotLight, {
            ...common,
            direction: [spot.direction.x, spot.direction.y, spot.direction.z],
            cutoff: spot.cutoff,
            outerCutoff: spot.outerCutoff,
            cookie: spot.cookie,
            iesProfile: spot.iesProfile,
            shadow: spot.shadow
        });
    } else if (light.isAreaLight) {
        const area = light as AreaLightView;
        world.add(entity, AreaLight, { ...common, width: area.width, height: area.height });
    } else throw new TypeError(`Unsupported prefab light ${light.className}.`);
}
