import {
    CameraOutput,
    GLTFLoader,
    LocalTransform,
    createAnimationSystem,
    type Entity,
    type GLTFLoadRequest,
    type GLTFModel,
    type SceneInstance
} from 'hilo3d';
import { createExampleRuntime } from '../shared/runtime';

interface ModelInfo extends GLTFLoadRequest {
    readonly name: string;
    readonly src: string;
    readonly scale: number;
}

const models: Readonly<Record<string, ModelInfo>> = {
    Tmall: { name: 'Tmall', scale: 0.001, src: '../models/Tmall/Tmall.gltf' },
    VC: { name: 'VC', scale: 0.01, src: '../models/VC/VC.gltf', isMultiAnim: false },
    DamagedHelmet: {
        name: 'DamagedHelmet',
        src: '../models/DamagedHelmet/DamagedHelmet.glb',
        scale: 0.5
    },
    MultiUVTest: {
        name: 'MultiUVTest',
        scale: 0.5,
        src: '../models/MultiUVTest/MultiUVTest.gltf'
    },
    Suzanne: { name: 'Suzanne', scale: 0.5, src: '../models/Suzanne/Suzanne.gltf' },
    AlphaBlendModeTest: {
        name: 'AlphaBlendModeTest',
        scale: 0.3,
        src: '../models/AlphaBlendModeTest/AlphaBlendModeTest.gltf'
    }
};

function requireSelect(id: string): HTMLSelectElement {
    const element = document.querySelector<HTMLSelectElement>(`#${id}`);
    if (!element) throw new Error(`glTF loader example requires #${id}.`);
    return element;
}

const runtime = await createExampleRuntime([createAnimationSystem()]);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4.5, 0.7, 1.1);
const modelSelect = requireSelect('modelSelect');
const cameraSelect = requireSelect('cameraSelect');
const query = new URLSearchParams(location.search);
let activeInstance: SceneInstance | null = null;
let activeModel: GLTFModel | null = null;
let activeCamera: Entity = runtime.camera;

function setCamera(entity: Entity): void {
    runtime.world.set(activeCamera, CameraOutput, { enabled: false });
    if (runtime.world.has(entity, CameraOutput))
        runtime.world.set(entity, CameraOutput, { enabled: true });
    else runtime.world.add(entity, CameraOutput, { enabled: true });
    activeCamera = entity;
}

function populateCameras(instance: SceneInstance): void {
    cameraSelect.replaceChildren(new Option('default', '-1'));
    instance.cameraEntities.forEach((_, index) => {
        cameraSelect.append(new Option(`model camera ${String(index + 1)}`, String(index)));
    });
}

async function showModel(info: ModelInfo): Promise<void> {
    if (activeInstance) {
        setCamera(runtime.camera);
        for (const entity of activeInstance.entities) {
            if (runtime.world.isAlive(entity)) runtime.world.destroyEntity(entity);
        }
    }
    activeModel = await new GLTFLoader().load(info);
    await activeModel.ready;
    activeInstance = activeModel.instantiate(runtime.world);
    for (const root of activeInstance.roots) {
        runtime.world.set(root, LocalTransform, {
            ...runtime.world.get(root, LocalTransform),
            scale: [info.scale, info.scale, info.scale]
        });
    }
    populateCameras(activeInstance);
}

for (const name of Object.keys(models)) modelSelect.append(new Option(name, name));
const selectedName = query.get('model') ?? 'Tmall';
const selected = models[selectedName] ?? models['Tmall'];
if (!selected) throw new Error('The default glTF model is unavailable.');
modelSelect.value = selected.name;
modelSelect.addEventListener('change', () => {
    const next = new URL(location.href);
    next.searchParams.set('model', modelSelect.value);
    location.assign(next);
});
cameraSelect.addEventListener('change', () => {
    const index = Number(cameraSelect.value);
    const entity = activeInstance?.cameraEntities[index] ?? runtime.camera;
    setCamera(entity);
});
await showModel(selected);
runtime.start();
