type ExampleEntry = string | readonly [name: string, path: string];

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
const examples: readonly ExampleEntry[] = [
    'areaLight',
    'billboard',
    'bloom',
    'cameraHelper',
    'compressed_texture',
    'cubeTexture_HDR',
    'custom_anim_state',
    'depthTexture',
    'drawBuffers',
    'fog',
    'MultiSampledRenderbuffers',
    'frameBuffer',
    'frustum_test',
    'geometry_box',
    'geometry_color',
    'geometry_custom',
    'geometry_dynamic',
    'geometry_dynamic2',
    'geometry_instanced',
    'geometry_line',
    'geometry_merge',
    'geometry_morph',
    'geometry_plane',
    'geometry_sphere',
    'geometry_triangles',
    'animation',
    'gltf_light',
    'hdr',
    'lifegame',
    'mesh_picker',
    'mouse_event',
    'normal_map',
    'pbr',
    'pbr2',
    'pointLight',
    'polly',
    'post_process',
    'quickStart',
    'raycast',
    'raycast_node',
    'refract',
    'resourceManagerTest',
    'sRGB',
    'shaderToy',
    'shader_material',
    'shadow',
    'skybox',
    'snow',
    'sphereEnvMap',
    'sphericalHarmonics',
    'spotLight',
    'ssao',
    'stencilTest',
    'textureLod',
    'texture_data',
    'texture_image_release',
    'transparent',
    'tween_walk',
    'uniformBufferObject',
    'update_sub_texture',
    'uv_map',
    'video',
    'webgl_support',
    'wireframe',
    ['physics', './physics/cannon']
];

function exampleName(entry: ExampleEntry): string {
    return typeof entry === 'string' ? entry : entry[0];
}

function examplePath(entry: ExampleEntry): string {
    return `${typeof entry === 'string' ? entry : entry[1]}.html`;
}

interface ExampleNavigationItem {
    readonly entry: ExampleEntry;
    readonly element: HTMLLIElement;
}

const navigation = new Map<string, ExampleNavigationItem>();
let currentName = '';

function showExample(entry: ExampleEntry, preservePageQuery = false): void {
    const name = exampleName(entry);
    if (name === currentName) return;
    const previous = navigation.get(currentName);
    if (previous) previous.element.classList.remove('active');

    const pageQuery = preservePageQuery
        ? location.search
        : (frame.contentWindow?.location.search ?? '');
    frame.src = `${examplePath(entry)}${pageQuery}`;
    location.hash = name;
    navigation.get(name)?.element.classList.add('active');
    currentName = name;
}

for (const entry of examples) {
    const name = exampleName(entry);
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

const versionForm = requireElement('#webglVersionForm', HTMLFormElement);
versionForm.addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement)) return;
    location.search = event.target.id === 'webglVersion1' ? '?webgl1=true' : '?webgl2=true';
});

const selectedVersion = location.search.includes('webgl2')
    ? requireElement('#webglVersion2', HTMLInputElement)
    : requireElement('#webglVersion1', HTMLInputElement);
selectedVersion.checked = true;
