import * as Hilo3d from '../../src/Hilo3d';
import { createExampleContext, loadEnvironmentMaps, parseQuery } from '../shared/init';
import { environmentMaterialDefaults } from '../shared/environment';

const { camera, stage, ambientLight } = await createExampleContext();
new Hilo3d.AxisHelper({ size: 1 }).addTo(stage);

interface ModelInfo extends Hilo3d.GLTFLoadRequest {
    name: string;
    src: string;
    scale: number;
    ambient?: number;
    camera?: number;
}

const models: Readonly<Record<string, ModelInfo>> = {
    Tmall: {
        name: 'Tmall',
        scale: 0.001,
        src: '../models/Tmall/Tmall.gltf',
        ambient: 0.8
    },
    VC: {
        name: 'VC',
        scale: 0.01,
        src: '../models/VC/VC.gltf',
        isMultiAnim: false,
        camera: 6,
        ambient: 0.8
    },
    DamagedHelmet: {
        name: 'DamagedHelmet',
        src: '../models/DamagedHelmet/DamagedHelmet.glb',
        scale: 0.5,
        ambient: 0.8
    },
    MultiUVTest: {
        name: 'MultiUVTest',
        scale: 0.5,
        src: '../models/MultiUVTest/MultiUVTest.gltf',
        ambient: 0.8
    },
    Suzanne: {
        name: 'Suzanne',
        scale: 0.5,
        src: '../models/Suzanne/Suzanne.gltf',
        ambient: 0.8
    },
    AlphaBlendModeTest: {
        name: 'AlphaBlendModeTest',
        scale: 0.3,
        src: '../models/AlphaBlendModeTest/AlphaBlendModeTest.gltf',
        ambient: 0.8
    }
};

function requireSelect(id: string): HTMLSelectElement {
    const select = document.querySelector<HTMLSelectElement>(`#${id}`);
    if (!select) throw new Error(`glTF loader example requires #${id}.`);
    return select;
}

function positiveQueryNumber(value: string | undefined, fallback: number, name: string): number {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${name} must be a positive number; received ${value}.`);
    }
    return number;
}

const modelSelect = requireSelect('modelSelect');
const cameraSelect = requireSelect('cameraSelect');
const query = parseQuery();
let currentModel: Hilo3d.GLTFModel | null = null;

function addEnvironmentSkybox(environment: Awaited<ReturnType<typeof loadEnvironmentMaps>>): void {
    const skybox = new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            cullMode: 'front',
            diffuse: environment.skyboxMap
        })
    }).addTo(stage);
    skybox.setScale(20);
}

function populateCameras(model: Hilo3d.GLTFModel, preferredCamera?: number): void {
    cameraSelect.replaceChildren(new Option('default', '-1'));
    model.cameras.forEach((modelCamera, index) => {
        cameraSelect.append(new Option(modelCamera.name, String(index)));
    });
    if (preferredCamera !== undefined) {
        const modelCamera = model.cameras[preferredCamera];
        if (!modelCamera) throw new RangeError(`Unknown model camera ${String(preferredCamera)}.`);
        stage.camera = modelCamera;
        cameraSelect.value = String(preferredCamera);
    }
}

function addDebugBounds(model: Hilo3d.GLTFModel): void {
    model.meshes.forEach(mesh => {
        const geometry = mesh.geometry;
        if (!geometry) return;
        const sphere = geometry.getLocalSphereBounds();
        new Hilo3d.Mesh({
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse: new Hilo3d.Color(1, 0, 0),
                state: { wireframe: true }
            }),
            geometry: new Hilo3d.SphereGeometry({ radius: sphere.radius })
        })
            .setPosition(sphere.center.x, sphere.center.y, sphere.center.z)
            .addTo(mesh);
    });
}

async function showModel(modelInfo: ModelInfo): Promise<void> {
    const loader = new Hilo3d.GLTFLoader();
    const environment = await loadEnvironmentMaps();
    const model = await loader.load({
        ...modelInfo,
        pbrMaterialDefaults: environmentMaterialDefaults(environment)
    });
    await model.ready;
    currentModel = model;
    stage.addChild(model.node);
    model.node.setScale(modelInfo.scale);
    addEnvironmentSkybox(environment);
    populateCameras(model, modelInfo.camera);
    if (query['showSphere'] !== undefined) addDebugBounds(model);
}

function reportAsyncError(error: unknown): void {
    queueMicrotask(() => {
        throw error;
    });
}

function selectedModelInfo(): ModelInfo {
    const selectedName = query['model'] ?? 'Tmall';
    const configured = models[selectedName];
    const source = query['url'];
    if (!configured && !source) throw new RangeError(`Unknown model: ${selectedName}.`);
    const base: ModelInfo = configured ?? {
        name: 'url',
        scale: 1,
        src: source ?? '',
        ambient: 0.5
    };
    return {
        ...base,
        scale: positiveQueryNumber(query['scale'], base.scale, 'scale'),
        ambient: positiveQueryNumber(query['ambient'], base.ambient ?? 0.5, 'ambient')
    };
}

function initialize(): void {
    const modelInfo = selectedModelInfo();
    Object.keys(models).forEach(name => {
        modelSelect.append(new Option(name, name));
    });
    if (modelInfo.name === 'url') modelSelect.append(new Option('url', 'url'));
    modelSelect.value = modelInfo.name;
    ambientLight.amount = modelInfo.ambient ?? 0.5;

    modelSelect.addEventListener('change', () => {
        const next = new URL(location.href);
        next.searchParams.set('model', modelSelect.value);
        next.searchParams.delete('url');
        location.assign(next);
    });
    cameraSelect.addEventListener('change', () => {
        const cameraIndex = Number(cameraSelect.value);
        stage.camera = currentModel?.cameras[cameraIndex] ?? camera;
    });
    showModel(modelInfo).catch(reportAsyncError);
}

initialize();
