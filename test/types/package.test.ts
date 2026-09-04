import {
    BasicMaterial,
    BoxGeometry,
    CameraOutput,
    Engine,
    GLTFLoader,
    Hierarchy,
    LocalTransform,
    MeshRenderer,
    OrbitControls,
    PerspectiveCamera,
    RenderOrder,
    RenderVisibility,
    ScenePrefab,
    ScenePrefabRecord,
    Vector3,
    WORLD_SYSTEM_API_VERSION,
    World,
    defineComponent,
    defineWorldResource,
    type EngineParameters,
    type Entity,
    type MeshRendererValue,
    type OrbitControlsOptions,
    type PerspectiveCameraValue,
    type WorldSystem
} from 'hilo3d';
import {
    ParticleEmitter,
    ParticleSystem,
    ParticleSystemDefinition,
    createParticleWorldSystem,
    type ParticleEmitterValue
} from '@hilo3d/addon-particle';
import {
    AttachedBody as PhysicsAttachedBody,
    Collider as PhysicsCollider,
    RigidBody as PhysicsRigidBody,
    createPhysicsSystem,
    type ColliderValue,
    type RigidBodyValue
} from '@hilo3d/addon-physics';
import { Rapier2DBackend, createRapier2DPhysicsSystem } from '@hilo3d/addon-physics/rapier2d';
import { Rapier3DBackend, createRapier3DPhysicsSystem } from '@hilo3d/addon-physics/rapier3d';

const Health = defineComponent<Readonly<{ value: number }>>('consumer/health');
const Clock = defineWorldResource<Readonly<{ now: number }>>('consumer/clock');
const system = {
    descriptor: {
        id: 'consumer/update',
        version: '1.0.0',
        apiVersion: WORLD_SYSTEM_API_VERSION,
        phase: 'update',
        access: { reads: [Health], readsResources: [Clock] }
    },
    setup(context) {
        const health = context.world.getStore(Health);
        const query = context.world.query(Health);
        return {
            execute(): void {
                for (let index = 0; index < query.length; index++) {
                    health.get(query.entityIndices[index] ?? 0);
                }
            }
        };
    }
} satisfies WorldSystem;

const world = await World.create({
    initialCapacity: 1024,
    systems: [system]
});
const entity: Entity = world.createEntity(Health, { value: 100 });
world.add(entity, LocalTransform, {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
});
world.add(entity, Hierarchy, { parent: null });

const mesh = {
    geometry: new BoxGeometry(),
    material: new BasicMaterial(),
    castShadows: true,
    receiveShadows: true
} satisfies MeshRendererValue;
world.add(entity, MeshRenderer, mesh);
world.add(entity, RenderVisibility, { visible: true, layer: 1 });
world.add(entity, RenderOrder, { renderOrder: 0 });

const camera: Entity = world.createEntity(LocalTransform, { position: [0, 2, 6] });
world.add(camera, PerspectiveCamera, {
    fov: 60,
    near: 0.1,
    far: 1000,
    aspect: 16 / 9
} satisfies PerspectiveCameraValue);
world.add(camera, CameraOutput, { enabled: true });
const identityTransform: Entity = world.createEntity(LocalTransform);
void identityTransform;

const rigidBody = {
    type: 'dynamic',
    dimension: '3d',
    interpolate: true
} satisfies RigidBodyValue;
const collider = {
    dimension: '3d',
    shape: { type: 'ball', radius: 0.5 }
} satisfies ColliderValue;
world.add(entity, PhysicsRigidBody, rigidBody);
world.add(entity, PhysicsCollider, collider);
const compound = world.createEntity();
world.add(compound, PhysicsCollider, collider);
world.add(compound, PhysicsAttachedBody, { body: entity });

const prefabRecord = new ScenePrefabRecord({ name: 'root' });
prefabRecord.append(new ScenePrefabRecord({ name: 'child' }));
const prefab = new ScenePrefab([prefabRecord]);
const scene = prefab.instantiate(world);
const loader = new GLTFLoader();

const engineOptions = {
    backend: 'auto',
    width: 1280,
    height: 720
} satisfies EngineParameters;
const engine = await Engine.create(engineOptions);
const controlsOptions = {
    target: new Vector3(),
    distance: 6,
    minDistance: 1,
    maxDistance: 20
} satisfies OrbitControlsOptions;
const controls = new OrbitControls(engine, world, camera, controlsOptions);
controls.setView({ x: 0, y: 0, z: 0 }, 6, 0, Math.PI / 2);
engine.frame(world, 16.67);

const particleDefinition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'sparks',
            capacity: 64,
            emission: { rateOverTime: 8 },
            initialize: { lifetime: 1 },
            modules: [],
            renderers: [{ type: 'sprite' }]
        }
    ]
});
const particleSystem = new ParticleSystem({ definition: particleDefinition });
const particleValue = { system: particleSystem } satisfies ParticleEmitterValue;
world.add(entity, ParticleEmitter, particleValue);

void createParticleWorldSystem;
void createPhysicsSystem;
void createRapier2DPhysicsSystem;
void createRapier3DPhysicsSystem;
void Rapier2DBackend;
void Rapier3DBackend;
void scene;
void loader;

controls.destroy();
engine.destroy();
world.destroy();
