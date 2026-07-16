import { resolveExampleBackend } from './shared/backend';
import examplePaths from 'virtual:hilo3d-example-manifest';

interface ExampleEntry {
    readonly name: string;
    readonly path: string;
}

type HTMLElementConstructor<ElementType extends HTMLElement> = new () => ElementType;

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    Constructor: HTMLElementConstructor<ElementType>
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof Constructor)) {
        throw new Error(`Example index requires ${selector}`);
    }
    return element;
}

const list = requireElement('#exampleList', HTMLUListElement);
const frame = requireElement('#exampleFrame', HTMLIFrameElement);
const backendSelect = requireElement('#backendSelect', HTMLSelectElement);
const backend = resolveExampleBackend();
backendSelect.value = backend;
backendSelect.addEventListener('change', () => {
    const nextBackend = backendSelect.value;
    if (nextBackend !== 'webgl2' && nextBackend !== 'webgpu') {
        throw new TypeError(`Unsupported example backend "${nextBackend}".`);
    }
    const target = new URL(location.href);
    target.searchParams.set('backend', nextBackend);
    location.assign(target);
});
const examples: readonly ExampleEntry[] = examplePaths
    .filter(path => path !== 'list.html' && (backend !== 'webgpu' || path !== 'webxr.html'))
    .map(path => ({ name: path.slice(0, -'.html'.length), path }));

interface ExampleNavigationItem {
    readonly entry: ExampleEntry;
    readonly element: HTMLLIElement;
}

const navigation = new Map<string, ExampleNavigationItem>();
let currentName = '';

function showExample(entry: ExampleEntry, preservePageQuery = false): void {
    const { name, path } = entry;
    if (name === currentName) return;
    const previous = navigation.get(currentName);
    if (previous) previous.element.classList.remove('active');

    const pageQuery = preservePageQuery
        ? location.search
        : (frame.contentWindow?.location.search ?? '');
    const target = new URL(path, location.href);
    const query = new URLSearchParams(pageQuery);
    query.set('backend', backend);
    if (path === 'glTFViewer/index.html' && !query.has('url')) {
        query.set('url', '/examples/models/Tmall/Tmall.gltf');
    }
    target.search = query.toString();
    frame.src = target.href;
    location.hash = name;
    navigation.get(name)?.element.classList.add('active');
    currentName = name;
}

for (const entry of examples) {
    const { name } = entry;
    const element = document.createElement('li');
    element.textContent = name;
    element.addEventListener('click', () => {
        showExample(entry);
    });
    navigation.set(name, { entry, element });
    list.appendChild(element);
}

frame.width = String(Math.max(0, window.innerWidth - 220));
frame.height = String(window.innerHeight);
const requestedName = location.hash.slice(1);
const initial = navigation.get(requestedName)?.entry ?? examples[0];
if (!initial) throw new Error('Example index has no entries');
showExample(initial, true);

window.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'w', 'W', 's', 'S'].includes(event.key)) return;
    const current = navigation.get(currentName);
    if (!current) return;
    const direction = ['ArrowUp', 'w', 'W'].includes(event.key) ? -1 : 1;
    const currentIndex = examples.indexOf(current.entry);
    const nextIndex = (currentIndex + direction + examples.length) % examples.length;
    const next = examples[nextIndex];
    if (next) showExample(next);
});
