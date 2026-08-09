import * as Hilo3d from '../../../src/Hilo3d';
import Stats from '../../shared/stats';
import {
    loadEnvironmentMaps,
    parseQuery,
    resolveExampleBackend,
    type EnvironmentMaps
} from '../../shared/init';
import { environmentMaterialDefaults } from '../../shared/environment';
import { hashReadback } from '../../shared/readbackDiagnostics';
import {
    ViewerBloomController,
    ViewerPostProcessController,
    type ViewerLookPreset,
    type ViewerToneMappingMode
} from './ViewerPostProcess';

type ViewerState = 'empty' | 'error' | 'loading' | 'ready';
type InspectorSection = 'scene' | 'material' | 'post';

const BACKEND_LABELS: Readonly<Record<Hilo3d.RendererBackend, string>> = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
});

interface MaterialSnapshot {
    readonly baseColor: readonly [number, number, number, number];
    readonly ior: number;
    readonly iridescenceFactor: number;
    readonly metallic: number;
    readonly normalScale: number;
    readonly opacity: number;
    readonly roughness: number;
    readonly transmissionFactor: number;
}

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
    document.querySelector<HTMLButtonElement>('#uploadIcon'),
    '#uploadIcon'
);
const openFileButton = requireElement(
    document.querySelector<HTMLButtonElement>('#openFileButton'),
    '#openFileButton'
);
const showLinkButton = requireElement(
    document.querySelector<HTMLButtonElement>('#showLinkBtn'),
    '#showLinkBtn'
);
const linkInput = requireElement(
    document.querySelector<HTMLInputElement>('#linkInput'),
    '#linkInput'
);
const importerStatus = requireElement(
    document.querySelector<HTMLElement>('.dropCopy .info'),
    '.dropCopy .info'
);
const loadSampleButton = requireElement(
    document.querySelector<HTMLButtonElement>('#loadSampleButton'),
    '#loadSampleButton'
);
const loadingSource = requireElement(
    document.querySelector<HTMLElement>('#loadingSource'),
    '#loadingSource'
);
const modelName = requireElement(document.querySelector<HTMLElement>('#modelName'), '#modelName');
const modelFormat = requireElement(
    document.querySelector<HTMLElement>('#modelFormat'),
    '#modelFormat'
);
const panelModelName = requireElement(
    document.querySelector<HTMLElement>('#panelModelName'),
    '#panelModelName'
);
const sourceValue = requireElement(
    document.querySelector<HTMLElement>('#sourceValue'),
    '#sourceValue'
);
const backendBadge = requireElement(
    document.querySelector<HTMLElement>('#backendBadge'),
    '#backendBadge'
);
const viewportStatusText = requireElement(
    document.querySelector<HTMLElement>('#viewportStatusText'),
    '#viewportStatusText'
);
const meshCount = requireElement(document.querySelector<HTMLElement>('#meshCount'), '#meshCount');
const materialCount = requireElement(
    document.querySelector<HTMLElement>('#materialCount'),
    '#materialCount'
);
const textureCount = requireElement(
    document.querySelector<HTMLElement>('#textureCount'),
    '#textureCount'
);
const animationCount = requireElement(
    document.querySelector<HTMLElement>('#animationCount'),
    '#animationCount'
);
const versionValue = requireElement(
    document.querySelector<HTMLElement>('#versionValue'),
    '#versionValue'
);
const generatorValue = requireElement(
    document.querySelector<HTMLElement>('#generatorValue'),
    '#generatorValue'
);
const sceneCount = requireElement(
    document.querySelector<HTMLElement>('#sceneCount'),
    '#sceneCount'
);
const cameraSection = requireElement(
    document.querySelector<HTMLElement>('#cameraSection'),
    '#cameraSection'
);
const cameraSelect = requireElement(
    document.querySelector<HTMLSelectElement>('#cameraSelect'),
    '#cameraSelect'
);
const cameraHint = requireElement(
    document.querySelector<HTMLElement>('#cameraHint'),
    '#cameraHint'
);
const dimensionsValue = requireElement(
    document.querySelector<HTMLElement>('#dimensionsValue'),
    '#dimensionsValue'
);
const extensionList = requireElement(
    document.querySelector<HTMLElement>('#extensionList'),
    '#extensionList'
);
const inspectorTabButtons = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]')
];
const scenePanel = requireElement(
    document.querySelector<HTMLElement>('#scenePanel'),
    '#scenePanel'
);
const materialPanel = requireElement(
    document.querySelector<HTMLElement>('#materialPanel'),
    '#materialPanel'
);
const postPanel = requireElement(document.querySelector<HTMLElement>('#postPanel'), '#postPanel');
const materialSelect = requireElement(
    document.querySelector<HTMLSelectElement>('#materialSelect'),
    '#materialSelect'
);
const materialModeBadge = requireElement(
    document.querySelector<HTMLElement>('#materialModeBadge'),
    '#materialModeBadge'
);
const materialCountLabel = requireElement(
    document.querySelector<HTMLElement>('#materialCountLabel'),
    '#materialCountLabel'
);
const baseColorInput = requireElement(
    document.querySelector<HTMLInputElement>('#baseColorInput'),
    '#baseColorInput'
);
const metallicInput = requireElement(
    document.querySelector<HTMLInputElement>('#metallicInput'),
    '#metallicInput'
);
const metallicValue = requireElement(
    document.querySelector<HTMLOutputElement>('#metallicValue'),
    '#metallicValue'
);
const roughnessInput = requireElement(
    document.querySelector<HTMLInputElement>('#roughnessInput'),
    '#roughnessInput'
);
const roughnessValue = requireElement(
    document.querySelector<HTMLOutputElement>('#roughnessValue'),
    '#roughnessValue'
);
const normalScaleInput = requireElement(
    document.querySelector<HTMLInputElement>('#normalScaleInput'),
    '#normalScaleInput'
);
const normalScaleValue = requireElement(
    document.querySelector<HTMLOutputElement>('#normalScaleValue'),
    '#normalScaleValue'
);
const opacityInput = requireElement(
    document.querySelector<HTMLInputElement>('#opacityInput'),
    '#opacityInput'
);
const opacityValue = requireElement(
    document.querySelector<HTMLOutputElement>('#opacityValue'),
    '#opacityValue'
);
const opacityHint = requireElement(
    document.querySelector<HTMLElement>('#opacityHint'),
    '#opacityHint'
);
const transmissionInput = requireElement(
    document.querySelector<HTMLInputElement>('#transmissionInput'),
    '#transmissionInput'
);
const transmissionValue = requireElement(
    document.querySelector<HTMLOutputElement>('#transmissionValue'),
    '#transmissionValue'
);
const iridescenceInput = requireElement(
    document.querySelector<HTMLInputElement>('#iridescenceInput'),
    '#iridescenceInput'
);
const iridescenceValue = requireElement(
    document.querySelector<HTMLOutputElement>('#iridescenceValue'),
    '#iridescenceValue'
);
const iorInput = requireElement(document.querySelector<HTMLInputElement>('#iorInput'), '#iorInput');
const iorValue = requireElement(
    document.querySelector<HTMLOutputElement>('#iorValue'),
    '#iorValue'
);
const resetMaterialButton = requireElement(
    document.querySelector<HTMLButtonElement>('#resetMaterialButton'),
    '#resetMaterialButton'
);
const lookPresetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-look-preset]')];
const toneMappingSelect = requireElement(
    document.querySelector<HTMLSelectElement>('#toneMappingSelect'),
    '#toneMappingSelect'
);
const exposureInput = requireElement(
    document.querySelector<HTMLInputElement>('#exposureInput'),
    '#exposureInput'
);
const exposureValue = requireElement(
    document.querySelector<HTMLOutputElement>('#exposureValue'),
    '#exposureValue'
);
const contrastInput = requireElement(
    document.querySelector<HTMLInputElement>('#contrastInput'),
    '#contrastInput'
);
const contrastValue = requireElement(
    document.querySelector<HTMLOutputElement>('#contrastValue'),
    '#contrastValue'
);
const saturationInput = requireElement(
    document.querySelector<HTMLInputElement>('#saturationInput'),
    '#saturationInput'
);
const saturationValue = requireElement(
    document.querySelector<HTMLOutputElement>('#saturationValue'),
    '#saturationValue'
);
const vignetteInput = requireElement(
    document.querySelector<HTMLInputElement>('#vignetteInput'),
    '#vignetteInput'
);
const vignetteValue = requireElement(
    document.querySelector<HTMLOutputElement>('#vignetteValue'),
    '#vignetteValue'
);
const resetPostButton = requireElement(
    document.querySelector<HTMLButtonElement>('#resetPostButton'),
    '#resetPostButton'
);
const bloomFeatureStatus = requireElement(
    document.querySelector<HTMLElement>('#bloomFeatureStatus'),
    '#bloomFeatureStatus'
);
const bloomEnabledInput = requireElement(
    document.querySelector<HTMLInputElement>('#bloomEnabledInput'),
    '#bloomEnabledInput'
);
const bloomStateLabel = requireElement(
    document.querySelector<HTMLElement>('#bloomStateLabel'),
    '#bloomStateLabel'
);
const inspectorPanel = requireElement(
    document.querySelector<HTMLElement>('#inspectorPanel'),
    '#inspectorPanel'
);
const toggleInspectorButton = requireElement(
    document.querySelector<HTMLButtonElement>('#toggleInspectorButton'),
    '#toggleInspectorButton'
);
const closeInspectorButton = requireElement(
    document.querySelector<HTMLButtonElement>('#closeInspectorButton'),
    '#closeInspectorButton'
);
const zoomOutButton = requireElement(
    document.querySelector<HTMLButtonElement>('#zoomOutButton'),
    '#zoomOutButton'
);
const zoomInButton = requireElement(
    document.querySelector<HTMLButtonElement>('#zoomInButton'),
    '#zoomInButton'
);
const resetViewButton = requireElement(
    document.querySelector<HTMLButtonElement>('#resetViewButton'),
    '#resetViewButton'
);
const fullscreenButton = requireElement(
    document.querySelector<HTMLButtonElement>('#fullscreenButton'),
    '#fullscreenButton'
);
const sourceDialog = requireElement(
    document.querySelector<HTMLDialogElement>('#sourceDialog'),
    '#sourceDialog'
);
const openUrlDialogButton = requireElement(
    document.querySelector<HTMLButtonElement>('#openUrlDialogButton'),
    '#openUrlDialogButton'
);
const closeSourceDialogButton = requireElement(
    document.querySelector<HTMLButtonElement>('#closeSourceDialogButton'),
    '#closeSourceDialogButton'
);
const cancelSourceDialogButton = requireElement(
    document.querySelector<HTMLButtonElement>('#cancelSourceDialogButton'),
    '#cancelSourceDialogButton'
);
const dialogLinkInput = requireElement(
    document.querySelector<HTMLInputElement>('#dialogLinkInput'),
    '#dialogLinkInput'
);
const dialogShowLinkButton = requireElement(
    document.querySelector<HTMLButtonElement>('#dialogShowLinkBtn'),
    '#dialogShowLinkBtn'
);
const query = parseQuery();
const viewerPostProcess = new ViewerPostProcessController();
const viewerBloom = new ViewerBloomController({
    threshold: 1.15,
    knee: 0.58,
    intensity: 0.16,
    scatter: 0.58,
    maxLevels: 6
});

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
    clearColor: new Hilo3d.Color(0.032, 0.04, 0.06),
    renderPipeline: new Hilo3d.ForwardRenderPipelineFactory({
        sceneColorFormat: 'rgba16float',
        opaqueTexture: true,
        features: [viewerBloom, viewerPostProcess.feature]
    }),
    width: innerWidth,
    height: innerHeight
});
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.addTick(Hilo3d.Tween);
ticker.addTick(Hilo3d.Animation);
ticker.start();
const stats = new Stats(ticker, stage.renderer);
const orbitControls = new Hilo3d.OrbitControls(stage, { enablePan: true });
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
let currentSourceLabel = '';
let dragDepth = 0;
const objectUrls = new Map<string, string>();
const viewerDecorations: Hilo3d.Node[] = [];
const viewerOwnedTextures = new Set<Hilo3d.Texture<unknown>>();
const materialDefaults = new Map<Hilo3d.PBRMaterial, MaterialSnapshot>();
let pbrMaterials: Hilo3d.PBRMaterial[] = [];
let modelCameras: Hilo3d.Camera[] = [];
let activeInspectorSection: InspectorSection = 'scene';

function setViewerState(state: ViewerState): void {
    document.body.dataset['viewState'] = state;
}

function setInspectorOpen(open: boolean): void {
    document.body.dataset['inspectorOpen'] = String(open);
    inspectorPanel.setAttribute('aria-hidden', String(!open));
    inspectorPanel.inert = !open;
    toggleInspectorButton.setAttribute('aria-expanded', String(open));
    toggleInspectorButton.setAttribute(
        'aria-label',
        open ? 'Hide model information' : 'Show model information'
    );
}

function isInspectorSection(value: string | undefined): value is InspectorSection {
    return value === 'scene' || value === 'material' || value === 'post';
}

function setInspectorSection(section: InspectorSection): void {
    activeInspectorSection = section;
    const panels: Readonly<Record<InspectorSection, HTMLElement>> = {
        scene: scenePanel,
        material: materialPanel,
        post: postPanel
    };
    for (const [name, panel] of Object.entries(panels)) {
        panel.hidden = name !== section;
    }
    for (const button of inspectorTabButtons) {
        button.setAttribute(
            'aria-selected',
            String(button.dataset['inspectorTab'] === activeInspectorSection)
        );
    }
}

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
    stage.camera = camera;
    orbitControls.reset();
    syncCameraInteraction();
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
    materialDefaults.clear();
    pbrMaterials = [];
    modelCameras = [];
    cameraSection.hidden = true;
    cameraSelect.replaceChildren();
    Hilo3d.BasicLoader.cache.clear();
}

function showInput(error?: unknown): void {
    const hasError = error !== undefined;
    if (hasError) {
        const message =
            error instanceof Error
                ? error.message
                : typeof error === 'string'
                  ? error
                  : 'The glTF model could not be loaded.';
        inputContainer.dataset['error'] = message;
        importerStatus.textContent = message;
    } else {
        delete inputContainer.dataset['error'];
        importerStatus.textContent = 'glTF, GLB, or a complete asset folder';
    }
    setInspectorOpen(false);
    setViewerState(hasError ? 'error' : 'empty');
    stats.container.style.display = 'none';
}

function showLoading(sourceLabel: string): void {
    currentSourceLabel = sourceLabel;
    modelName.textContent = displayNameForSource(sourceLabel);
    loadingSource.textContent = `Loading ${sourceLabel}…`;
    setInspectorOpen(false);
    setViewerState('loading');
    stats.container.style.display = 'none';
}

function queryEnabled(name: string): boolean {
    const value = query[name];
    return value !== undefined && value !== 'false';
}

function collectionSize<Value>(collection: Hilo3d.GLTFCollection<Value> | undefined): number {
    if (!collection) return 0;
    return Array.isArray(collection) ? collection.length : Object.keys(collection).length;
}

function sourceLabelForUrl(source: string): string {
    try {
        const pathname = new URL(source, location.href).pathname;
        const segment = pathname.split('/').filter(Boolean).at(-1);
        return segment ? decodeURIComponent(segment) : 'Remote model';
    } catch {
        return 'Remote model';
    }
}

function displayNameForSource(source: string): string {
    const filename = source.split('/').at(-1) ?? source;
    const decoded = decodeURIComponent(filename);
    return decoded.replace(/\.(?:gltf|glb)$/iu, '') || 'Untitled model';
}

function formatDimension(value: number): string {
    if (!Number.isFinite(value)) return '—';
    if (value === 0) return '0';
    if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) return value.toExponential(2);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function updateExtensionList(extensions: readonly string[]): void {
    if (extensions.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'emptyExtension';
        empty.textContent = 'No extensions declared';
        extensionList.replaceChildren(empty);
        return;
    }
    extensionList.replaceChildren(
        ...extensions.map(extension => {
            const badge = document.createElement('span');
            badge.textContent = extension;
            return badge;
        })
    );
}

function syncCameraInteraction(): void {
    const usesViewerCamera = stage.camera === camera;
    if (usesViewerCamera && !sourceDialog.open) orbitControls.enable();
    else orbitControls.disable();
    zoomOutButton.disabled = !usesViewerCamera;
    resetViewButton.disabled = !usesViewerCamera;
    zoomInButton.disabled = !usesViewerCamera;
}

function selectCamera(value: string): void {
    if (value === 'viewer') {
        stage.camera = camera;
        cameraSelect.value = 'viewer';
        cameraHint.textContent = 'Interactive viewer camera · orbit, zoom, and pan enabled';
        syncCameraInteraction();
        return;
    }

    const index = Number(value);
    const modelCamera = Number.isSafeInteger(index) ? modelCameras[index] : undefined;
    if (!modelCamera) throw new RangeError(`Unknown glTF camera: ${value}.`);
    stage.camera = modelCamera;
    cameraSelect.value = String(index);
    cameraHint.textContent = 'Authored glTF framing · viewer navigation is locked';
    syncCameraInteraction();
}

function populateCameraControls(cameras: readonly Hilo3d.Camera[]): void {
    modelCameras = [...cameras];
    cameraSection.hidden = modelCameras.length === 0;
    if (modelCameras.length === 0) {
        cameraSelect.replaceChildren();
        stage.camera = camera;
        syncCameraInteraction();
        return;
    }

    const viewerOption = new Option('Viewer camera (default)', 'viewer');
    const modelOptions = modelCameras.map((modelCamera, index) => {
        const name = modelCamera.name.trim();
        return new Option(name || `glTF camera ${String(index + 1)}`, String(index));
    });
    cameraSelect.replaceChildren(viewerOption, ...modelOptions);

    const requestedCamera = query['camera'];
    if (requestedCamera === undefined || requestedCamera === 'false') {
        selectCamera('viewer');
        return;
    }
    selectCamera(requestedCamera);
}

function averageMaterialValue(
    materials: readonly Hilo3d.PBRMaterial[],
    read: (material: Hilo3d.PBRMaterial) => number
): number {
    if (materials.length === 0) return 0;
    return materials.reduce((sum, material) => sum + read(material), 0) / materials.length;
}

function selectedMaterials(): Hilo3d.PBRMaterial[] {
    const selectedIndex = Number(materialSelect.value);
    const material = Number.isSafeInteger(selectedIndex) ? pbrMaterials[selectedIndex] : undefined;
    return material ? [material] : [];
}

function supportsFeature(material: Hilo3d.PBRMaterial, feature: string): boolean {
    return material.definition.staticFeatures[feature] === 1;
}

function setRangeControl(
    input: HTMLInputElement,
    output: HTMLOutputElement,
    value: number,
    suffix = ''
): void {
    input.value = String(value);
    output.textContent = `${value.toFixed(2)}${suffix}`;
}

function setMaterialControlsDisabled(disabled: boolean): void {
    for (const input of [
        baseColorInput,
        metallicInput,
        roughnessInput,
        normalScaleInput,
        opacityInput,
        transmissionInput,
        iridescenceInput,
        iorInput
    ]) {
        input.disabled = disabled;
    }
    resetMaterialButton.disabled = disabled;
}

function materialModeLabel(materials: readonly Hilo3d.PBRMaterial[]): string {
    const modes = new Set(
        materials.map(material => {
            if (material.requiresOpaqueSceneTexture) return 'Transmission';
            if (material.compositing.mode === 'alpha-blend') return 'Alpha blend';
            if (material.coverage.mode !== 'opaque') return 'Alpha mask';
            return 'Opaque';
        })
    );
    return modes.size === 1 ? ([...modes][0] ?? 'Opaque') : 'Mixed';
}

function syncMaterialControls(): void {
    const materials = selectedMaterials();
    const representative = materials[0];
    setMaterialControlsDisabled(representative === undefined);
    if (!representative) {
        materialModeBadge.textContent = 'Unavailable';
        materialCountLabel.textContent = 'No PBR materials in this asset';
        return;
    }

    materialModeBadge.textContent = materialModeLabel(materials);
    materialCountLabel.textContent =
        materials.length === 1
            ? (representative.name ?? '1 material selected')
            : `${String(materials.length)} materials selected`;
    baseColorInput.value = `#${representative.baseColor.toHEX()}`;
    setRangeControl(
        metallicInput,
        metallicValue,
        averageMaterialValue(materials, material => material.metallic)
    );
    setRangeControl(
        roughnessInput,
        roughnessValue,
        averageMaterialValue(materials, material => material.roughness)
    );
    setRangeControl(
        normalScaleInput,
        normalScaleValue,
        averageMaterialValue(materials, material => material.normalScale)
    );

    const alphaBlendMaterials = materials.filter(
        material => material.compositing.mode === 'alpha-blend'
    );
    opacityInput.disabled = alphaBlendMaterials.length === 0;
    opacityHint.textContent =
        alphaBlendMaterials.length === 0
            ? 'This asset uses opaque, masked, or physical transmission surfaces.'
            : `Editing ${String(alphaBlendMaterials.length)} alpha-blend ${alphaBlendMaterials.length === 1 ? 'material' : 'materials'}.`;
    setRangeControl(
        opacityInput,
        opacityValue,
        alphaBlendMaterials.length > 0
            ? averageMaterialValue(alphaBlendMaterials, material => material.opacity)
            : 1
    );

    const transmissiveMaterials = materials.filter(material =>
        supportsFeature(material, 'HAS_TRANSMISSION')
    );
    transmissionInput.disabled = transmissiveMaterials.length === 0;
    setRangeControl(
        transmissionInput,
        transmissionValue,
        transmissiveMaterials.length > 0
            ? averageMaterialValue(transmissiveMaterials, material => material.transmissionFactor)
            : 0
    );

    const iridescentMaterials = materials.filter(material =>
        supportsFeature(material, 'HAS_IRIDESCENCE')
    );
    iridescenceInput.disabled = iridescentMaterials.length === 0;
    setRangeControl(
        iridescenceInput,
        iridescenceValue,
        iridescentMaterials.length > 0
            ? averageMaterialValue(iridescentMaterials, material => material.iridescenceFactor)
            : 0
    );
    setRangeControl(
        iorInput,
        iorValue,
        averageMaterialValue(materials, material => material.ior)
    );
}

function captureMaterialDefaults(model: Hilo3d.GLTFModel): void {
    materialDefaults.clear();
    pbrMaterials = model.materials.filter(
        (material): material is Hilo3d.PBRMaterial => material instanceof Hilo3d.PBRMaterial
    );
    for (const material of pbrMaterials) {
        materialDefaults.set(material, {
            baseColor: [
                material.baseColor.r,
                material.baseColor.g,
                material.baseColor.b,
                material.baseColor.a
            ],
            ior: material.ior,
            iridescenceFactor: material.iridescenceFactor,
            metallic: material.metallic,
            normalScale: material.normalScale,
            opacity: material.opacity,
            roughness: material.roughness,
            transmissionFactor: material.transmissionFactor
        });
    }

    const options = pbrMaterials.map((material, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = material.name ?? `Material ${String(index + 1)}`;
        return option;
    });
    if (options.length > 0) {
        materialSelect.replaceChildren(...options);
        materialSelect.value = '0';
    } else {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'No PBR materials';
        materialSelect.replaceChildren(emptyOption);
        materialSelect.value = '';
    }
    materialSelect.disabled = pbrMaterials.length === 0;
    syncMaterialControls();
}

function applyToSelectedMaterials(
    update: (material: Hilo3d.PBRMaterial) => void,
    filter?: (material: Hilo3d.PBRMaterial) => boolean
): void {
    for (const material of selectedMaterials()) {
        if (!filter || filter(material)) update(material);
    }
}

function resetSelectedMaterials(): void {
    applyToSelectedMaterials(material => {
        const snapshot = materialDefaults.get(material);
        if (!snapshot) return;
        material.baseColor.set(...snapshot.baseColor);
        material.ior = snapshot.ior;
        material.iridescenceFactor = snapshot.iridescenceFactor;
        material.metallic = snapshot.metallic;
        material.normalScale = snapshot.normalScale;
        material.opacity = snapshot.opacity;
        material.roughness = snapshot.roughness;
        material.transmissionFactor = snapshot.transmissionFactor;
        material.invalidateData();
    });
    syncMaterialControls();
}

function setLookPresetSelection(preset: ViewerLookPreset | null): void {
    for (const button of lookPresetButtons) {
        button.setAttribute('aria-pressed', String(button.dataset['lookPreset'] === preset));
    }
}

function syncPostProcessControls(preset: ViewerLookPreset | null = null): void {
    const state = viewerPostProcess.state;
    toneMappingSelect.value = state.toneMapping;
    setRangeControl(exposureInput, exposureValue, state.exposure, ' EV');
    setRangeControl(contrastInput, contrastValue, state.contrast);
    setRangeControl(saturationInput, saturationValue, state.saturation);
    setRangeControl(vignetteInput, vignetteValue, state.vignette);
    setLookPresetSelection(preset);
}

function syncBloomControl(): void {
    const enabled = viewerBloom.enabled;
    bloomEnabledInput.checked = enabled;
    bloomStateLabel.textContent = enabled ? 'On' : 'Off';
    bloomFeatureStatus.dataset['enabled'] = String(enabled);
}

function isToneMappingMode(value: string): value is ViewerToneMappingMode {
    return value === 'pbr-neutral' || value === 'aces' || value === 'reinhard' || value === 'none';
}

function updateModelInterface(model: Hilo3d.GLTFModel, bounds: Hilo3d.Bounds): void {
    const sourceName = displayNameForSource(currentSourceLabel);
    const assetName = model.json.asset.name?.trim();
    const resolvedName = assetName && assetName.length > 0 ? assetName : sourceName;
    const sourceFormat = currentSourceLabel.toLowerCase().endsWith('.glb') ? 'GLB' : 'glTF';
    const version = model.json.asset.version;
    const meshTotal = model.meshes.length;
    const generator = model.json.asset.generator?.trim();
    const transmissionTotal = model.materials.filter(
        material => material.requiresOpaqueSceneTexture
    ).length;

    modelName.textContent = resolvedName;
    panelModelName.textContent = resolvedName;
    modelFormat.textContent = `${sourceFormat} · glTF ${version}`;
    sourceValue.textContent = currentSourceLabel;
    sourceValue.title = currentSourceLabel;
    backendBadge.textContent = BACKEND_LABELS[stage.renderer.backend];
    viewportStatusText.textContent = `${String(meshTotal)} ${meshTotal === 1 ? 'mesh' : 'meshes'} · ${transmissionTotal > 0 ? `${String(transmissionTotal)} transmission` : 'Ready'}`;
    meshCount.textContent = String(meshTotal);
    materialCount.textContent = String(model.materials.length);
    textureCount.textContent = String(model.textures.length);
    animationCount.textContent = String(collectionSize(model.json.animations));
    versionValue.textContent = `glTF ${version}`;
    generatorValue.textContent = generator && generator.length > 0 ? generator : 'Unknown';
    generatorValue.title = generatorValue.textContent;
    sceneCount.textContent = String(collectionSize(model.json.scenes));
    dimensionsValue.textContent = [bounds.width, bounds.height, bounds.depth]
        .map(formatDimension)
        .join(' × ');
    updateExtensionList(model.json.extensionsUsed ?? []);
}

function initializeModel(
    model: Hilo3d.GLTFModel,
    generation: number,
    environment: EnvironmentMaps
): void {
    if (generation !== modelLoadGeneration) {
        destroyModel(model);
        return;
    }
    currentModel = model;
    stage.addChild(model.node);
    const bounds = model.node.getBounds();
    if (!bounds) throw new Error('The glTF model has no renderable bounds.');
    if (!queryEnabled('noResize')) {
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

    populateCameraControls(model.cameras);

    if (query['addLight'] !== undefined || model.lights.length === 0) {
        const skybox = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                cullMode: 'front',
                diffuse: environment.skyboxMap
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
        captureMaterialDefaults(model);
        updateModelInterface(model, bounds);
        setViewerState('ready');
        stats.container.style.display = 'block';
        document.body.dataset['modelReady'] = 'true';
        document.body.dataset['modelGeneration'] = String(generation);
    }
}

async function loadModel(
    source: string,
    fromLocalFiles = false,
    sourceLabel = sourceLabelForUrl(source)
): Promise<void> {
    const generation = ++modelLoadGeneration;
    showLoading(sourceLabel);
    const resolveImage = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    const resolveBuffer = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    const resolveShader = (uri: string): string => resolveModelResource(uri, modelSourcePath);
    try {
        const environment = await loadEnvironmentMaps();
        if (generation !== modelLoadGeneration) {
            environment.brdfLUT.destroy();
            environment.diffuseEnvMap.destroy();
            environment.specularEnvMap.destroy();
            environment.skyboxMap.destroy();
            return;
        }
        viewerOwnedTextures.add(environment.brdfLUT);
        viewerOwnedTextures.add(environment.diffuseEnvMap);
        viewerOwnedTextures.add(environment.specularEnvMap);
        viewerOwnedTextures.add(environment.skyboxMap);
        const model = await loader.load({
            src: source,
            isUnQuantizeInShader: false,
            pbrMaterialDefaults: environmentMaterialDefaults(environment),
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
        initializeModel(model, generation, environment);
    } catch (error: unknown) {
        if (generation === modelLoadGeneration) releaseCurrentModel();
        throw error;
    }
}

function reportLoadFailure(error: unknown): void {
    console.error('Failed to load glTF model.', error);
    showInput(error);
}

function loadFiles(files: FileList): void {
    releaseCurrentModel();
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
    loadModel(source, true, modelFile.name).catch(reportLoadFailure);
}

function navigateToSource(source: string): void {
    const url = source.trim();
    if (!url) return;
    const next = new URL(location.href);
    next.searchParams.set('url', url);
    location.assign(next);
}

function openFilePicker(): void {
    fileInput.click();
}

function closeSourceDialog(): void {
    if (sourceDialog.open) sourceDialog.close();
}

function openSourceDialog(): void {
    dialogLinkInput.value = query['url'] ?? '';
    sourceDialog.showModal();
    orbitControls.disable();
    dialogLinkInput.focus();
}

async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
    }
    await document.documentElement.requestFullscreen();
}

function updateFullscreenButton(): void {
    const isFullscreen = document.fullscreenElement !== null;
    fullscreenButton.setAttribute(
        'aria-label',
        isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
    );
    fullscreenButton.dataset['tooltip'] = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
}

uploadButton.addEventListener('click', openFilePicker);
openFileButton.addEventListener('click', openFilePicker);
fileInput.addEventListener('change', () => {
    if (fileInput.files) loadFiles(fileInput.files);
    fileInput.value = '';
});

document.body.addEventListener('dragenter', event => {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    document.body.dataset['dragActive'] = 'true';
});
document.body.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
document.body.addEventListener('dragleave', event => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) delete document.body.dataset['dragActive'];
});
document.body.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    delete document.body.dataset['dragActive'];
    if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files);
});

showLinkButton.addEventListener('click', () => {
    navigateToSource(linkInput.value);
});
linkInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') navigateToSource(linkInput.value);
});
loadSampleButton.addEventListener('click', () => {
    navigateToSource('../models/KhronosPBR/IridescentDishWithOlives.glb');
});

toggleInspectorButton.addEventListener('click', () => {
    setInspectorOpen(document.body.dataset['inspectorOpen'] !== 'true');
});
closeInspectorButton.addEventListener('click', () => {
    setInspectorOpen(false);
    toggleInspectorButton.focus();
});
for (const button of inspectorTabButtons) {
    button.addEventListener('click', () => {
        const section = button.dataset['inspectorTab'];
        if (isInspectorSection(section)) setInspectorSection(section);
    });
}
cameraSelect.addEventListener('change', () => {
    selectCamera(cameraSelect.value);
});
materialSelect.addEventListener('change', syncMaterialControls);
baseColorInput.addEventListener('input', () => {
    applyToSelectedMaterials(material => {
        const alpha = material.baseColor.a;
        material.baseColor.fromHEX(baseColorInput.value);
        material.baseColor.a = alpha;
        material.invalidateData();
    });
});
metallicInput.addEventListener('input', () => {
    const value = Number(metallicInput.value);
    applyToSelectedMaterials(material => {
        material.metallic = value;
    });
    metallicValue.textContent = value.toFixed(2);
});
roughnessInput.addEventListener('input', () => {
    const value = Number(roughnessInput.value);
    applyToSelectedMaterials(material => {
        material.roughness = value;
    });
    roughnessValue.textContent = value.toFixed(2);
});
normalScaleInput.addEventListener('input', () => {
    const value = Number(normalScaleInput.value);
    applyToSelectedMaterials(material => {
        material.normalScale = value;
    });
    normalScaleValue.textContent = value.toFixed(2);
});
opacityInput.addEventListener('input', () => {
    const value = Number(opacityInput.value);
    applyToSelectedMaterials(
        material => {
            material.opacity = value;
        },
        material => material.compositing.mode === 'alpha-blend'
    );
    opacityValue.textContent = value.toFixed(2);
});
transmissionInput.addEventListener('input', () => {
    const value = Number(transmissionInput.value);
    applyToSelectedMaterials(
        material => {
            material.transmissionFactor = value;
        },
        material => supportsFeature(material, 'HAS_TRANSMISSION')
    );
    transmissionValue.textContent = value.toFixed(2);
});
iridescenceInput.addEventListener('input', () => {
    const value = Number(iridescenceInput.value);
    applyToSelectedMaterials(
        material => {
            material.iridescenceFactor = value;
        },
        material => supportsFeature(material, 'HAS_IRIDESCENCE')
    );
    iridescenceValue.textContent = value.toFixed(2);
});
iorInput.addEventListener('input', () => {
    const value = Number(iorInput.value);
    applyToSelectedMaterials(material => {
        material.ior = value;
    });
    iorValue.textContent = value.toFixed(2);
});
resetMaterialButton.addEventListener('click', resetSelectedMaterials);

for (const button of lookPresetButtons) {
    button.addEventListener('click', () => {
        const preset = button.dataset['lookPreset'];
        if (preset !== 'neutral' && preset !== 'studio' && preset !== 'cinematic') return;
        viewerPostProcess.applyPreset(preset);
        syncPostProcessControls(preset);
    });
}
bloomEnabledInput.addEventListener('change', () => {
    viewerBloom.setEnabled(bloomEnabledInput.checked);
    syncBloomControl();
});
toneMappingSelect.addEventListener('change', () => {
    if (!isToneMappingMode(toneMappingSelect.value)) return;
    viewerPostProcess.setToneMapping(toneMappingSelect.value);
    setLookPresetSelection(null);
});
exposureInput.addEventListener('input', () => {
    const value = Number(exposureInput.value);
    viewerPostProcess.setExposure(value);
    exposureValue.textContent = `${value.toFixed(2)} EV`;
    setLookPresetSelection(null);
});
contrastInput.addEventListener('input', () => {
    const value = Number(contrastInput.value);
    viewerPostProcess.setContrast(value);
    contrastValue.textContent = value.toFixed(2);
    setLookPresetSelection(null);
});
saturationInput.addEventListener('input', () => {
    const value = Number(saturationInput.value);
    viewerPostProcess.setSaturation(value);
    saturationValue.textContent = value.toFixed(2);
    setLookPresetSelection(null);
});
vignetteInput.addEventListener('input', () => {
    const value = Number(vignetteInput.value);
    viewerPostProcess.setVignette(value);
    vignetteValue.textContent = value.toFixed(2);
    setLookPresetSelection(null);
});
resetPostButton.addEventListener('click', () => {
    viewerBloom.setEnabled(true);
    viewerPostProcess.reset();
    syncBloomControl();
    syncPostProcessControls('neutral');
});
zoomOutButton.addEventListener('click', () => {
    orbitControls.dolly(1 / 1.18);
});
zoomInButton.addEventListener('click', () => {
    orbitControls.dolly(1.18);
});
resetViewButton.addEventListener('click', () => {
    orbitControls.reset();
});
fullscreenButton.addEventListener('click', () => {
    void toggleFullscreen().catch((error: unknown) => {
        console.error('Unable to change fullscreen state.', error);
    });
});
document.addEventListener('fullscreenchange', updateFullscreenButton);

openUrlDialogButton.addEventListener('click', openSourceDialog);
closeSourceDialogButton.addEventListener('click', closeSourceDialog);
cancelSourceDialogButton.addEventListener('click', closeSourceDialog);
dialogShowLinkButton.addEventListener('click', () => {
    closeSourceDialog();
    navigateToSource(dialogLinkInput.value);
});
dialogLinkInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    closeSourceDialog();
    navigateToSource(dialogLinkInput.value);
});
sourceDialog.addEventListener('close', () => {
    syncCameraInteraction();
});
sourceDialog.addEventListener('click', event => {
    if (!(event instanceof MouseEvent) || event.target !== sourceDialog) return;
    const bounds = sourceDialog.getBoundingClientRect();
    const isOutside =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;
    if (isOutside) closeSourceDialog();
});

setInspectorSection('scene');
syncBloomControl();
syncPostProcessControls('neutral');

const handleResize = (): void => {
    camera.aspect = innerWidth / innerHeight;
    if (stage.camera instanceof Hilo3d.PerspectiveCamera) {
        stage.camera.aspect = innerWidth / innerHeight;
    }
    stage.resize(innerWidth, innerHeight);
};
window.addEventListener('resize', handleResize);

const sourceFromQuery = query['url'];
if (sourceFromQuery) {
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
    window.removeEventListener('resize', handleResize);
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
