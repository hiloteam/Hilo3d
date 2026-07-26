import * as Hilo3d from '../../../src/Hilo3d';
import OrbitControls from '../../shared/OrbitControls';
import Stats from '../../shared/stats';
import { loadEnvironmentMaps, parseQuery, resolveExampleBackend } from '../../shared/init';
import { hashReadback } from '../../shared/readbackDiagnostics';

function requireElement<ElementType extends Element>(
    element: ElementType | null,
    selector: string
): ElementType {
    if (!element) throw new Error(`glTF Viewer requires ${selector}.`);
    return element;
}

const fileInput = requireElement(document.querySelector<HTMLInputElement>('#input'), '#input');
const inputContainer = requireElement(
    document.querySelector<HTMLElement>('#inputContainer'),
    '#inputContainer'
);
const stageContainer = requireElement(
    document.querySelector<HTMLElement>('#stageContainer'),
    '#stageContainer'
);
const uploadButton = requireElement(
    document.querySelector<HTMLElement>('#uploadIcon'),
    '#uploadIcon'
);
const showLinkButton = requireElement(
    document.querySelector<HTMLButtonElement>('#showLinkBtn'),
    '#showLinkBtn'
);
const linkInput = requireElement(
    document.querySelector<HTMLInputElement>('#linkInput'),
    '#linkInput'
);
const query = parseQuery();

const camera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 100,
    near: 0.1,
    z: 3
});
const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
    backend: resolveExampleBackend(),
    container: stageContainer,
    camera,
    clearColor: new Hilo3d.Color(0.4, 0.4, 0.4),
    width: innerWidth,
    height: innerHeight
});
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.addTick(Hilo3d.Tween);
ticker.addTick(Hilo3d.Animation);
ticker.start();
const stats = new Stats(ticker, stage.renderer);
const orbitControls = new OrbitControls(stage, { enablePan: false });
const loader = new Hilo3d.GLTFLoader();
const diagnosticTarget = stage.renderer.createRenderTarget({
    width: 320,
    height: 180,
    colorAttachments: [{ format: 'rgba8unorm' }],
    depthStencilAttachment: { format: 'depth24plus' },
    label: 'glTF Viewer model diagnostics'
});

let currentModel: Hilo3d.GLTFModel | null = null;
let modelLoadGeneration = 0;
let modelSourcePath = '';
const objectUrls = new Map<string, string>();
const viewerDecorations: Hilo3d.Node[] = [];
const viewerOwnedTextures = new Set<Hilo3d.Texture<unknown>>();

function destroyModel(model: Hilo3d.GLTFModel): void {
    model.node.destroy(stage.renderer);
    model.textures.forEach(texture => texture.destroy());
}

function normalizeFilePath(path: string): string {
    return `/${path.replaceAll('\\', '/').replace(/^\/+/, '')}`;
}

function resolveModelResource(uri: string, sourcePath: string): string {
    if (/^(?:https?:|blob:|data:)/u.test(uri)) return uri;
    const base = new URL(normalizeFilePath(sourcePath), 'https://local.hilo3d.invalid');
    const resolvedPath = normalizeFilePath(
        new URL(uri, base).pathname
            .split('/')
            .map(segment => decodeURIComponent(segment))
            .join('/')
    );
    return objectUrls.get(resolvedPath) ?? uri;
}

function releaseCurrentModel(): void {
    modelLoadGeneration++;
    delete document.body.dataset['modelReady'];
    delete document.body.dataset['modelGeneration'];
    if (currentModel) {
        destroyModel(currentModel);
        currentModel = null;
    }
    viewerDecorations.forEach(node => {
        node.destroy(stage.renderer);
    });
    viewerDecorations.length = 0;
    viewerOwnedTextures.forEach(texture => texture.destroy());
    viewerOwnedTextures.clear();
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
    Hilo3d.BasicLoader.cache.clear();
}

function showInput(error?: unknown): void {
    if (error !== undefined) {
        const message =
            error instanceof Error
                ? error.message
                : typeof error === 'string'
                  ? error
                  : 'The glTF model could not be loaded.';
        inputContainer.dataset['error'] = message;
        requireElement(document.querySelector<HTMLElement>('.info'), '.info').textContent = message;
    }
    stats.container.style.display = 'none';
    stageContainer.style.visibility = 'hidden';
    inputContainer.style.display = 'block';
}

function showStage(): void {
    stats.container.style.display = 'block';
    stageContainer.style.visibility = 'visible';
    inputContainer.style.display = 'none';
}

function queryEnabled(name: string): boolean {
    const value = query[name];
    return value !== undefined && value !== 'false';
}

async function initializeModel(model: Hilo3d.GLTFModel, generation: number): Promise<void> {
    if (generation !== modelLoadGeneration) {
        destroyModel(model);
        return;
    }
    currentModel = model;
    stage.addChild(model.node);
    if (!queryEnabled('depthMask')) {
        model.materials.forEach(material => {
            material.depthMask = true;
        });
    }

    const bounds = model.node.getBounds();
    if (!queryEnabled('noResize')) {
        if (!bounds) throw new Error('The glTF model has no renderable bounds.');
        const largestDimension = Math.max(bounds.width, bounds.height, bounds.depth);
        if (largestDimension > 0) {
            const scale = 1.5 / largestDimension;
            model.node.setPosition(-bounds.x * scale, -bounds.y * scale, -bounds.z * scale);
            model.node.setScale(scale);
        }
    }

    const requestedScale = query['scale'];
    if (requestedScale !== undefined) {
        const scale = Number(requestedScale);
        if (!Number.isFinite(scale) || scale <= 0) {
            throw new RangeError(`Scale must be positive; received ${requestedScale}.`);
        }
        model.node.setScale(scale);
    }

    const requestedCamera = query['camera'];
    if (requestedCamera !== 'false' && model.cameras.length > 0) {
        const cameraIndex = requestedCamera === undefined ? 0 : Number(requestedCamera);
        const modelCamera = Number.isSafeInteger(cameraIndex)
            ? model.cameras[cameraIndex]
            : undefined;
        if (!modelCamera) throw new RangeError(`Unknown glTF camera: ${requestedCamera ?? '0'}.`);
        stage.camera = modelCamera;
    }

    if (query['addLight'] !== undefined || model.lights.length === 0) {
        const environment = await loadEnvironmentMaps();
        if (generation !== modelLoadGeneration) {
            environment.brdfLUT.destroy();
            environment.diffuseEnvMap.destroy();
            environment.specularEnvMap.destroy();
            return;
        }
        viewerOwnedTextures.add(environment.brdfLUT);
        viewerOwnedTextures.add(environment.diffuseEnvMap);
        viewerOwnedTextures.add(environment.specularEnvMap);
        model.materials.forEach(material => {
            if (material instanceof Hilo3d.PBRMaterial) {
                material.brdfLUT = environment.brdfLUT;
                material.diffuseEnvMap = environment.diffuseEnvMap;
                material.specularEnvMap = environment.specularEnvMap;
                material.isDirty = true;
            } else if (material instanceof Hilo3d.BasicMaterial) {
                material.specularEnvMap = environment.specularEnvMap;
                material.isDirty = true;
            }
        });
        const skybox = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                side: Hilo3d.constants.BACK,
                diffuse: environment.specularEnvMap
            })
        }).addTo(stage);
        skybox.setScale(20);
        const light = new Hilo3d.DirectionalLight({
            color: new Hilo3d.Color(1, 1, 1),
            direction: new Hilo3d.Vector3(0, -1, 0)
        }).addTo(stage);
        viewerDecorations.push(skybox, light);
    }
    if (generation === modelLoadGeneration) {
        document.body.dataset['modelReady'] = 'true';
        document.body.dataset['modelGeneration'] = String(generation);
    }
}

async function loadModel(source: string, fromLocalFiles = false): Promise<void> {
    const generation = ++modelLoadGeneration;
    const resolveImage = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    const resolveBuffer = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    const resolveShader = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    try {
        const model = await loader.load({
            src: source,
            isUnQuantizeInShader: false,
            ...(fromLocalFiles
                ? {
                      preHandlerImageURI: resolveImage,
                      preHandlerBufferURI: resolveBuffer,
                      preHandlerShaderURI: resolveShader
                  }
                : {})
        });
        await model.ready;
        if (generation !== modelLoadGeneration) {
            destroyModel(model);
            return;
        }
        await initializeModel(model, generation);
    } catch (error: unknown) {
        if (generation === modelLoadGeneration) releaseCurrentModel();
        throw error;
    }
}

function reportLoadFailure(error: unknown): void {
    showInput(error);
}

function loadFiles(files: FileList): void {
    releaseCurrentModel();
    showStage();
    const selectedFiles = [...files];
    const modelFile = selectedFiles.find(file => {
        const extension = (Hilo3d.util.getExtension(file.name) ?? '').toLowerCase();
        return extension === 'gltf' || extension === 'glb';
    });
    if (!modelFile) {
        showInput('Select a .gltf or .glb file.');
        return;
    }

    for (const file of selectedFiles) {
        const path = normalizeFilePath(file.webkitRelativePath || file.name);
        objectUrls.set(path, URL.createObjectURL(file));
    }
    modelSourcePath = normalizeFilePath(modelFile.webkitRelativePath || modelFile.name);
    const source = objectUrls.get(modelSourcePath);
    if (!source) throw new Error('Selected glTF file has no object URL.');
    loadModel(source, true).catch(reportLoadFailure);
}

uploadButton.addEventListener('click', () => {
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    if (fileInput.files) loadFiles(fileInput.files);
});
document.body.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
document.body.addEventListener('drop', event => {
    event.preventDefault();
    if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files);
});
showLinkButton.addEventListener('click', () => {
    const url = linkInput.value.trim();
    if (!url) return;
    const next = new URL(location.href);
    next.searchParams.set('url', url);
    location.assign(next);
});

const sourceFromQuery = query['url'];
if (sourceFromQuery) {
    showStage();
    loadModel(sourceFromQuery).catch(reportLoadFailure);
} else {
    showInput();
}

window.__HILO3D_GLTF_VIEWER_DIAGNOSTICS__ = {
    async capture() {
        if (!currentModel || document.body.dataset['modelReady'] !== 'true') {
            throw new Error('glTF Viewer cannot capture before the current model is ready.');
        }
        ticker.stop();
        try {
            stage.traverseUpdate(0);
            const activeCamera = stage.camera ?? camera;
            stage.renderer.renderToTarget(diagnosticTarget, stage, activeCamera, true);
            const readback = await diagnosticTarget.readColorAttachment();
            let coloredPixelCount = 0;
            for (let offset = 0; offset < readback.data.byteLength; offset += 4) {
                if (
                    readback.data[offset] !== 0 ||
                    readback.data[offset + 1] !== 0 ||
                    readback.data[offset + 2] !== 0
                ) {
                    coloredPixelCount++;
                }
            }
            return {
                backend: stage.renderer.backend,
                generation: modelLoadGeneration,
                hash: hashReadback(readback.data),
                coloredPixelCount
            };
        } finally {
            ticker.start();
        }
    }
};

window.addEventListener('beforeunload', () => {
    diagnosticTarget.destroy();
    releaseCurrentModel();
    orbitControls.dispose();
    stats.stop();
    ticker.stop();
});

declare global {
    interface Window {
        __HILO3D_GLTF_VIEWER_DIAGNOSTICS__?: {
            capture(): Promise<{
                readonly backend: Hilo3d.RendererBackend;
                readonly generation: number;
                readonly hash: string;
                readonly coloredPixelCount: number;
            }>;
        };
    }
}
