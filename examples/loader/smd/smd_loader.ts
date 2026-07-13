import * as Hilo3d from '../../../src/Hilo3d';
import { createExampleContext } from '../../shared/init';
import './SMDLoader';

interface ExampleLoadRequest extends Hilo3d.LoaderRequest {
    name?: string;
}

interface LoadedItem {
    readonly content: unknown;
    readonly name?: string;
}

function readLoadedItem(value: unknown): LoadedItem {
    if (typeof value !== 'object' || value === null || !('content' in value)) {
        throw new TypeError('LoadQueue emitted an invalid item.');
    }
    const content: unknown = value.content;
    const name: unknown = 'name' in value ? value.name : undefined;
    if (name !== undefined && typeof name !== 'string') {
        throw new TypeError('LoadQueue item name must be a string.');
    }
    return name === undefined ? { content } : { content, name };
}

function requireSelectElement(id: string): HTMLSelectElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLSelectElement)) {
        throw new Error(`The SMD example requires a #${id} select element.`);
    }
    return element;
}

const selectElement = requireSelectElement('animSelect');

const { camera, stage, renderer } = createExampleContext();
stage.rotationX = 30;
camera.far = 5;
renderer.clearColor.set(0, 0, 0, 1);

const smdNames = [
    'attack',
    'attack2',
    'attack3',
    'death',
    'flail',
    'idle',
    'idle2',
    'idle3',
    'idle_angry',
    'loadout',
    'nasal_goo',
    'portrait',
    'portrait2',
    'portrait3',
    'quill_spray',
    'run',
    'run_angry',
    'stun',
    'teleport_end'
] as const;
const loadList: Hilo3d.LoadQueueItem<ExampleLoadRequest>[] = [
    ...smdNames.map(name => ({ name, src: `./res/${name}.smd` }))
];

let currentModel: Hilo3d.Node | null = null;
const animations: Record<string, Hilo3d.Animation> = {};

function changeAnimation(name: string): void {
    const model = currentModel;
    const animation = animations[name];
    if (!model || !animation) return;
    model.anim?.stop();
    model.setAnim(animation);
    animation.play();
}

function createPreviewModel(animation: Hilo3d.Animation): Hilo3d.Node {
    const model = new Hilo3d.Node({ name: 'SMD animation preview', rotationX: -90 });
    const geometry = new Hilo3d.SphereGeometry({
        radius: 0.5,
        widthSegments: 8,
        heightSegments: 6
    });
    const material = new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.9, 0.35, 0.2)
    });
    const nodeNames = new Set(animation.animStatesList.map(channel => channel.nodeName));
    for (const name of nodeNames) {
        if (name) new Hilo3d.Mesh({ name, geometry, material }).addTo(model);
    }
    model.setScale(0.02).addTo(stage);
    return model;
}

function selectAnimation(name: string): void {
    selectElement.value = name;
    changeAnimation(name);
}

selectElement.addEventListener('change', () => {
    changeAnimation(selectElement.value);
});

const loadQueue = new Hilo3d.LoadQueue<ExampleLoadRequest>();
loadQueue
    .add(loadList)
    .on('load', event => {
        const item = readLoadedItem(event.detail);
        if (!(item.content instanceof Hilo3d.Animation) || !item.name) {
            throw new TypeError('SMD queue item did not produce a named Animation.');
        }
        currentModel ??= createPreviewModel(item.content);
        animations[item.name] = item.content;
        const option = document.createElement('option');
        option.textContent = item.name;
        option.value = item.name;
        selectElement.append(option);
        if (!currentModel.anim) selectAnimation(item.name);
    })
    .on('error', event => {
        console.error('Failed to load an SMD example resource.', event.detail);
    })
    .start();

new Hilo3d.Mesh({
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry({ width: 2, height: 2 }),
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(1, 0, 0)
    })
}).addTo(stage);
