import { GLTFLoader, LocalTransform, createAnimationSystem, type SceneInstance } from 'hilo3d';
import { createExampleRuntime } from '../../shared/runtime';

function element(id: string): HTMLElement {
    const value = document.querySelector<HTMLElement>(`#${id}`);
    if (!value) throw new Error(`glTF Viewer requires #${id}.`);
    return value;
}

function inputElement(id: string): HTMLInputElement {
    const value = element(id);
    if (!(value instanceof HTMLInputElement)) {
        throw new Error(`glTF Viewer requires #${id} to be an input.`);
    }
    return value;
}

const runtime = await createExampleRuntime([createAnimationSystem()], {
    containerSelector: '#stageContainer'
});
runtime.controls.setView({ x: 0, y: 0.4, z: 0 }, 4.5, 0.55, 1.1);
element('backendBadge').textContent = runtime.engine.renderer.backend.toUpperCase();
let active: SceneInstance | null = null;

async function load(source: string, label: string): Promise<void> {
    document.body.dataset['viewState'] = 'loading';
    const model = await new GLTFLoader().load({ src: source });
    await model.ready;
    if (active) {
        for (const entity of active.entities) {
            if (runtime.world.isAlive(entity)) runtime.world.destroyEntity(entity);
        }
    }
    active = model.instantiate(runtime.world);
    for (const root of active.roots) {
        const scale = source.includes('/Tmall/') ? 0.001 : 1;
        runtime.world.set(root, LocalTransform, { scale: [scale, scale, scale] });
    }
    element('modelName').textContent = label;
    element('panelModelName').textContent = label;
    element('sourceValue').textContent = source;
    element('meshCount').textContent = String(active.meshEntities.length);
    element('animationCount').textContent = String(active.animatorEntities.length);
    document.body.dataset['viewState'] = 'ready';
}

const query = new URLSearchParams(location.search);
const initial = query.get('url') ?? '../models/Tmall/Tmall.gltf';
runtime.start();
await load(initial, initial.split('/').pop() ?? 'Model');

const loadUrl = (): void => {
    const source =
        inputElement('linkInput').value.trim() || inputElement('dialogLinkInput').value.trim();
    if (source) void load(source, source.split('/').pop() ?? 'Remote model');
};
element('showLinkBtn').addEventListener('click', loadUrl);
element('dialogShowLinkBtn').addEventListener('click', loadUrl);
element('loadSampleButton').addEventListener('click', () => {
    void load('../models/DamagedHelmet/DamagedHelmet.glb', 'Damaged Helmet');
});
element('uploadIcon').addEventListener('click', () => {
    inputElement('input').click();
});
element('openFileButton').addEventListener('click', () => {
    inputElement('input').click();
});
