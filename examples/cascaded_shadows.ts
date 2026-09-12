import * as Hilo3d from '../src/Hilo3d';
import { createCsmToyWeather, type WeatherType } from './scenes/csm-toy-weather';
import { createCsmToySnow } from './scenes/csm-toy-snow';
import { createCsmToySurroundings } from './scenes/csm-toy-surroundings';
import { createCsmShadowStudy } from './scenes/csm-shadow-study';
import { createCsmToyDiorama } from './scenes/csm-toy-diorama';
import { environmentMaterialDefaults } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

type ShadowMode = 0 | 1 | 4;
type ViewName = 'courtyard' | 'detail' | 'distance' | 'water' | 'compare' | 'seascape';
type TimeOfDay = 'morning' | 'dusk';
const BACKEND_LABELS: Readonly<Record<Hilo3d.RendererBackend, string>> = {
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
};
type ShadowBudget = 'study' | 'balanced';
const SHADOW_MAP_SIZES: Readonly<Record<ShadowBudget, number>> = {
    study: 1024,
    balanced: 2048
};
interface CameraView {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly caption: string;
}
const VIEWS: Readonly<Record<ViewName, CameraView>> = {
    courtyard: {
        position: [68, 58, 90],
        target: [0, 2, -10],
        caption: '把一整个晴天，装进小小的玩具世界。'
    },
    compare: {
        position: [11, 10, -14],
        target: [16, 1, -3],
        caption: '观察白色露台上的细杆投影：同样 1.05M 日光阴影像素，四级 CSM 能保留更多空隙。'
    },
    seascape: {
        position: [-60, 22, 98],
        target: [0, 7, -10],
        caption: '卡通海面环绕小镇，天空和海水随清晨、黄昏一起变换。'
    },
    detail: {
        position: [29, 17, 47],
        target: [1, 2, 19],
        caption: '看近处栅栏与小树的投影，切换单层 / CSM 比较细节。'
    },
    water: {
        position: [-4, 15, 16],
        target: [4, 1, -10],
        caption: '树脂般的浅色岸线、细波纹和流动高光，也接收桥梁的真实投影。'
    },
    distance: {
        position: [42, 30, 2],
        target: [-2, 5, -38],
        caption: '从桥边望向风车和灯塔，观察远端阴影的覆盖。'
    }
};
function viewPosition(view: ViewName): readonly [number, number, number] {
    return view === 'courtyard' && window.innerWidth <= 740 ? [32, 73, 137] : VIEWS[view].position;
}
function viewTarget(view: ViewName): readonly [number, number, number] {
    return view === 'courtyard' && window.innerWidth <= 740 ? [-4, 2, -10] : VIEWS[view].target;
}
function requireElement<ElementType extends HTMLElement>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor)) throw new Error(`Missing control ${selector}`);
    return element;
}
const sceneContext = await createExampleContext({
    camera: { fov: 36, near: 0.5, far: 600, x: 68, y: 58, z: 90 },
    stage: {
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        useInstanced: true,
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { intensity: 0.13, threshold: 1.05, knee: 0.4, maxLevels: 4 },
            opaqueTexture: false,
            colorUber: {
                exposure: 0.02,
                contrast: 0.06,
                saturation: 0.025,
                temperature: 0.01,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.055,
                vignetteSmoothness: 0.9,
                vignetteColor: new Hilo3d.Color(0.24, 0.32, 0.35, 0.25)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(...VIEWS.courtyard.target),
        enablePan: true,
        minDistance: 15,
        maxDistance: 230,
        minPolarAngle: Math.PI * 0.1,
        maxPolarAngle: Math.PI * 0.47,
        rotateSpeed: 0.55,
        zoomSpeed: 0.65,
        panSpeed: 0.65
    },
    autoStart: false
});
const { stage, renderer, camera, directionLight, ambientLight, ticker, orbitControls } =
    sceneContext;
renderer.clearColor.set(0.67, 0.76, 0.77, 1);
directionLight.amount = 2.4;
directionLight.color.set(1, 0.97, 0.92, 1);
directionLight.direction.set(-0.7, -1, -0.45);
ambientLight.amount = 0.28;
ambientLight.color.set(0.58, 0.72, 0.85, 1);
const fillLight = new Hilo3d.DirectionalLight({
    direction: new Hilo3d.Vector3(0.7, -0.65, -0.25),
    color: new Hilo3d.Color(0.7, 0.82, 1),
    amount: 0.32
}).addTo(stage);
// Every preset keeps the total directional-shadow texel count identical between one and four maps.
let shadowBudget: ShadowBudget = 'balanced';
const shadowConfiguration: Hilo3d.DirectionalLightShadowOptions = {
    width: 1024,
    height: 1024,
    minBias: 0.0015,
    maxBias: 0.006,
    cascadeCount: 4,
    cascadeSplitLambda: 0.3,
    cascadeMaxDistance: 220,
    cascadeBlend: 0.12,
    stabilizeCascades: true,
    shadowStrength: 1
};
directionLight.shadow = shadowConfiguration;
const environmentMaps = await loadEnvironmentMaps();
const surroundings = createCsmToySurroundings(stage);
const toyWorld = createCsmToyDiorama(stage, environmentMaps);
createCsmShadowStudy(stage, environmentMaps);
const landmarks = await new Hilo3d.GLTFLoader().load({
    src: new URL('./model/csm/toy-landmarks.glb', import.meta.url).href
});
await landmarks.ready;
if (landmarks.resourceErrors.length > 0) {
    throw new AggregateError(landmarks.resourceErrors, 'Could not load the toy landmarks');
}
for (const node of landmarks.node.getChildrenByClassName('Mesh')) {
    if (!(node instanceof Hilo3d.Mesh) || !(node.material instanceof Hilo3d.PBRMaterial)) continue;
    const original = node.material;
    node.material = new Hilo3d.PBRMaterial({
        ...environmentMaterialDefaults(environmentMaps),
        baseColor: original.baseColor,
        roughness: original.roughness,
        metallic: original.metallic,
        clearcoatFactor: 0.22,
        clearcoatRoughnessFactor: 0.28,
        diffuseEnvIntensity: 0.5,
        specularEnvIntensity: 0.45
    });
    node.useInstanced = true;
}
landmarks.node.addTo(stage);
const windmillRotor = landmarks.node.getChildByName('ToyWindmillRotor');
if (!windmillRotor) throw new Error('Toy windmill has no rotor pivot');

function glowingMaterials(name: string): Hilo3d.PBRMaterial[] {
    const node = landmarks.node.getChildByName(name);
    if (!node) throw new Error(`Missing toy light group ${name}`);
    const children = node instanceof Hilo3d.Mesh ? [node] : node.getChildrenByClassName('Mesh');
    const materials: Hilo3d.PBRMaterial[] = [];
    for (const child of children) {
        if (!(child instanceof Hilo3d.Mesh) || !(child.material instanceof Hilo3d.PBRMaterial))
            continue;
        child.castShadows = false;
        materials.push(child.material);
    }
    if (materials.length === 0) throw new Error(`Toy light group ${name} has no PBR meshes`);
    return materials;
}
const houseWindowMaterials = glowingMaterials('ToyHouseWindows');
const lanternMaterials = glowingMaterials('ToyLighthouseLantern');
const windowSpillLights = [
    new Hilo3d.PointLight({
        x: -10,
        y: 3.7,
        z: -22.7,
        color: new Hilo3d.Color(1, 0.62, 0.23),
        amount: 5,
        range: 5,
        quadraticAttenuation: 1
    }).addTo(stage),
    new Hilo3d.PointLight({
        x: -12,
        y: 3.6,
        z: 17.2,
        color: new Hilo3d.Color(1, 0.62, 0.23),
        amount: 5,
        range: 5,
        quadraticAttenuation: 1
    }).addTo(stage)
];
const snowCover = createCsmToySnow(stage, environmentMaps);
const weatherEffects = createCsmToyWeather(stage);
const materialLighting = new Map<Hilo3d.PBRMaterial, { diffuse: number; specular: number }>();
for (const node of stage.getChildrenByClassName('Mesh')) {
    if (
        node instanceof Hilo3d.Mesh &&
        node.material instanceof Hilo3d.PBRMaterial &&
        !materialLighting.has(node.material)
    ) {
        materialLighting.set(node.material, {
            diffuse: node.material.diffuseEnvIntensity,
            specular: node.material.specularEnvIntensity
        });
    }
}

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-cascade-count]')];
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const stabilizeToggle = requireElement('#stabilizeToggle', HTMLButtonElement);
const tourToggle = requireElement('#tourToggle', HTMLButtonElement);
const trainToggle = requireElement('#trainToggle', HTMLButtonElement);
const weatherButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-weather]')];
const lightningButton = requireElement('#lightningButton', HTMLButtonElement);
const snowAmount = requireElement('#snowAmount', HTMLInputElement);
const snowAmountOutput = requireElement('#snowAmountOutput', HTMLOutputElement);
const timeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-time]')];
const shadowQuality = requireElement('#shadowQuality', HTMLSelectElement);
const budgetNote = requireElement('#budgetNote', HTMLElement);
const localShadowToggle = requireElement('#localShadowToggle', HTMLButtonElement);
let sceneMoving = false;
function setSceneMotion(enabled: boolean): void {
    sceneMoving = enabled;
    toyWorld.setMotion(enabled);
    toyWorld.setWaterMotion(enabled);
    surroundings.setMotion(enabled);
    weatherEffects.setMotion(enabled);
    snowCover.setMotion(enabled);
    trainToggle.setAttribute('aria-pressed', String(enabled));
    document.body.dataset['csmTrain'] = String(enabled);
    document.body.dataset['csmMotion'] = String(enabled);
}
trainToggle.addEventListener('click', () => {
    setSceneMotion(!sceneMoving);
});
const lambdaControl = requireElement('#lambdaControl', HTMLInputElement);
const blendControl = requireElement('#blendControl', HTMLInputElement);
const strengthControl = requireElement('#strengthControl', HTMLInputElement);
const distanceControl = requireElement('#distanceControl', HTMLInputElement);
const lambdaOutput = requireElement('#lambdaOutput', HTMLOutputElement);
const blendOutput = requireElement('#blendOutput', HTMLOutputElement);
const strengthOutput = requireElement('#strengthOutput', HTMLOutputElement);
const distanceOutput = requireElement('#distanceOutput', HTMLOutputElement);
const splitTrack = requireElement('#splitTrack', HTMLDivElement);
const splitValues = requireElement('#splitValues', HTMLDivElement);
const modeSummary = requireElement('#modeSummary', HTMLElement);
const modeDescription = requireElement('#modeDescription', HTMLElement);
const viewCaption = requireElement('#viewCaption', HTMLElement);
const backendBadge = requireElement('#backendBadge', HTMLElement);
const splitSegments = [...splitTrack.querySelectorAll<HTMLElement>('i')];
let shadowMode: ShadowMode = 4;
let stabilization = true;
let touring = false;
let tourTime = 0;
let localShadows = true;
let currentWeather: WeatherType = 'clear';
let currentTime: TimeOfDay = 'morning';
let lightingStartedAt = 0;
let lightingTransitionReady = true;
const DAYLIGHT_TRANSITION_DURATION = 5000;
const WINDOW_FADE_DURATION = 1800;
const LANTERN_START_DELAY = 3000;
let duskAmount = 0;
let duskStartAmount = 0;
let windowAmount = 0;
let windowStartAmount = 0;
let lanternAmount = 0;
let lanternStartAmount = 0;
let nextSnowReadout = 0;
let baseFillAmount = 0.32;

function transitionEase(elapsed: number, duration: number): number {
    const progress = Math.max(0, Math.min(1, elapsed / duration));
    return progress * progress * (3 - 2 * progress);
}

function mixLighting(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

function applyDaylight(): void {
    const cloudCover = currentWeather === 'clear' ? 1 : currentWeather === 'snow' ? 0.65 : 0.42;
    directionLight.amount = mixLighting(2.4, 0.2, duskAmount) * cloudCover;
    directionLight.color.set(
        1,
        mixLighting(0.97, 0.43, duskAmount),
        mixLighting(0.92, 0.23, duskAmount),
        1
    );
    directionLight.direction.set(
        -0.7,
        mixLighting(-0.75, -0.12, duskAmount),
        mixLighting(-0.45, 0.7, duskAmount)
    );
    directionLight.isDirty = true;
    ambientLight.amount = mixLighting(0.28, 0.09, duskAmount);
    ambientLight.color.set(
        mixLighting(0.58, 0.32, duskAmount),
        mixLighting(0.72, 0.4, duskAmount),
        mixLighting(0.85, 0.78, duskAmount),
        1
    );
    ambientLight.isDirty = true;
    baseFillAmount = mixLighting(0.32, 0.22, duskAmount);
    fillLight.color.set(
        mixLighting(0.7, 0.3, duskAmount),
        mixLighting(0.82, 0.43, duskAmount),
        1,
        1
    );
    fillLight.isDirty = true;
    renderer.clearColor.set(
        mixLighting(0.67, 0.036, duskAmount),
        mixLighting(0.76, 0.061, duskAmount),
        mixLighting(0.77, 0.15, duskAmount),
        1
    );
    for (const [material, day] of materialLighting) {
        material.diffuseEnvIntensity = day.diffuse * mixLighting(1, 0.2, duskAmount);
        material.specularEnvIntensity = day.specular * mixLighting(1, 0.3, duskAmount);
    }
    document.body.dataset['csmDuskProgress'] = duskAmount.toFixed(4);
}

function applyHouseLights(): void {
    for (const material of houseWindowMaterials)
        material.emissionFactor.set(3.4 * windowAmount, 1.3 * windowAmount, 0.34 * windowAmount, 1);
    for (const material of lanternMaterials)
        material.emissionFactor.set(
            4.5 * lanternAmount,
            2.5 * lanternAmount,
            0.75 * lanternAmount,
            1
        );
    for (const light of windowSpillLights) {
        light.amount = 5 * windowAmount;
        light.enabled = currentTime === 'dusk' || windowAmount > 0;
        light.isDirty = true;
    }
}

function updateLighting(now: number): void {
    if (lightingTransitionReady) return;
    const elapsed = now - lightingStartedAt;
    const target = currentTime === 'dusk' ? 1 : 0;
    duskAmount = mixLighting(
        duskStartAmount,
        target,
        transitionEase(elapsed, DAYLIGHT_TRANSITION_DURATION)
    );
    windowAmount = mixLighting(
        windowStartAmount,
        target,
        transitionEase(elapsed, WINDOW_FADE_DURATION)
    );
    lanternAmount = mixLighting(
        lanternStartAmount,
        target,
        transitionEase(elapsed - (target === 1 ? LANTERN_START_DELAY : 0), WINDOW_FADE_DURATION)
    );
    applyDaylight();
    applyHouseLights();
    lightingTransitionReady = elapsed >= DAYLIGHT_TRANSITION_DURATION && toyWorld.lightsReady;
    if (lightingTransitionReady) document.body.dataset['csmLightsReady'] = 'true';
}

function refreshDepthReadout(): void {
    const near = camera.near;
    const far = Math.min(shadowConfiguration.cascadeMaxDistance ?? 220, camera.far ?? 900);
    const lambda = shadowConfiguration.cascadeSplitLambda ?? 0.3;
    const splits: number[] = [];
    for (let index = 1; index <= shadowMode; index += 1) {
        const ratio = index / shadowMode;
        splits.push(
            (near + (far - near) * ratio) * (1 - lambda) +
                near * Math.pow(far / near, ratio) * lambda
        );
    }
    splitSegments.forEach((segment, index) => {
        const split = splits[index];
        segment.hidden = split === undefined;
        if (split !== undefined)
            segment.style.flexGrow = String(split - (splits[index - 1] ?? near));
    });
    const singleSize = SHADOW_MAP_SIZES[shadowBudget];
    modeSummary.textContent =
        shadowMode === 0
            ? 'Sun shadows off'
            : shadowMode === 1
              ? `single ${String(singleSize)}²`
              : `4 × ${String(singleSize / 2)}²`;
    budgetNote.textContent = `单层 ${String(singleSize)}² / 四级各 ${String(singleSize / 2)}²，日光阴影总像素相同（${((singleSize * singleSize) / 1e6).toFixed(2)}M）。局部灯光另有阴影预算；四级会增加投影和绘制开销。`;
    splitValues.textContent =
        shadowMode === 0
            ? 'Directional shadows off'
            : splits
                  .map((split, index) => `C${String(index + 1)} ${split.toFixed(1)} m`)
                  .join(' · ');
    document.body.dataset['csmSplits'] = splits.map(split => split.toFixed(1)).join(',');
}

function setShadowMode(mode: ShadowMode): void {
    shadowMode = mode;
    const singleSize = SHADOW_MAP_SIZES[shadowBudget];
    const mapSize = mode === 1 ? singleSize : singleSize / 2;
    const biasScale = 4096 / singleSize;
    shadowConfiguration.minBias = 0.0015 * biasScale;
    shadowConfiguration.maxBias = 0.006 * biasScale;
    shadowConfiguration.width = mapSize;
    shadowConfiguration.height = mapSize;
    shadowConfiguration.cascadeCount = mode === 0 ? 1 : mode;
    directionLight.shadow = mode === 0 ? null : shadowConfiguration;
    directionLight.isDirty = true;
    for (const button of modeButtons)
        button.setAttribute(
            'aria-pressed',
            String(Number(button.dataset['cascadeCount']) === mode)
        );
    document.body.dataset['csmMode'] = mode === 0 ? 'off' : String(mode);
    document.body.dataset['csmMapSize'] = String(mapSize);
    document.body.dataset['csmShadowTexels'] = String(mode === 0 ? 0 : mapSize * mapSize * mode);
    modeDescription.textContent =
        mode === 0
            ? '已关闭日光阴影；黄昏的局部灯光阴影单独控制。'
            : mode === 1
              ? '同样的阴影预算，一张图照顾整个小镇。'
              : '四级 CSM，把清晰投影留给近处，也照顾远方。';
    refreshDepthReadout();
}

function setBudget(budget: ShadowBudget): void {
    shadowBudget = budget;
    shadowQuality.value = budget;
    document.body.dataset['csmBudget'] = budget;
    setShadowMode(shadowMode);
}
function setTimeOfDay(value: TimeOfDay): void {
    const timeChanged = currentTime !== value;
    const dusk = value === 'dusk';
    if (timeChanged) {
        const now = performance.now();
        // Reversing a partly completed sunset starts from the light already on screen.
        updateLighting(now);
        duskStartAmount = duskAmount;
        windowStartAmount = windowAmount;
        lanternStartAmount = lanternAmount;
        lightingStartedAt = now;
        lightingTransitionReady = false;
        currentTime = value;
        toyWorld.setNight(dusk);
        surroundings.setDusk(dusk);
        weatherEffects.setDusk(dusk);
    }
    // Weather changes reuse the visible daylight amount and do not restart the sunset.
    applyDaylight();
    applyHouseLights();
    document.body.dataset['csmLightsReady'] = String(lightingTransitionReady);
    for (const button of timeButtons)
        button.setAttribute('aria-pressed', String(button.dataset['time'] === value));
    document.body.dataset['timeOfDay'] = value;
    document.body.dataset['csmLocalLights'] = dusk ? '5' : '0';
    document.body.dataset['csmWindowsLit'] = String(dusk);
}
for (const button of timeButtons)
    button.addEventListener('click', () => {
        const time = button.dataset['time'];
        if (time === 'morning' || time === 'dusk') setTimeOfDay(time);
    });
function setWeather(value: WeatherType): void {
    currentWeather = value;
    weatherEffects.setWeather(value);
    surroundings.setWeather(value);
    snowCover.setSnowing(value === 'snow');
    for (const button of weatherButtons)
        button.setAttribute('aria-pressed', String(button.dataset['weather'] === value));
    document.body.dataset['weather'] = value;
    lightningButton.hidden = value !== 'storm';
    setTimeOfDay(currentTime);
}
for (const button of weatherButtons)
    button.addEventListener('click', () => {
        const value = button.dataset['weather'];
        if (value === 'clear' || value === 'rain' || value === 'snow' || value === 'storm')
            setWeather(value);
    });
lightningButton.addEventListener('click', () => {
    weatherEffects.triggerLightning();
    document.body.dataset['csmLightning'] = String(weatherEffects.lightningFlash > 0);
});
snowAmount.addEventListener('input', () => {
    snowCover.setAccumulation(snowAmount.valueAsNumber / 100);
    snowAmountOutput.value = `${snowAmount.value}%`;
    document.body.dataset['csmSnowAmount'] = snowAmount.value;
});
shadowQuality.addEventListener('change', () => {
    const budget = shadowQuality.value;
    if (budget === 'study' || budget === 'balanced') setBudget(budget);
});
localShadowToggle.addEventListener('click', () => {
    localShadows = !localShadows;
    toyWorld.setLocalShadows(localShadows);
    localShadowToggle.setAttribute('aria-pressed', String(localShadows));
    document.body.dataset['csmLocalShadows'] = String(localShadows);
});

function setStabilization(enabled: boolean): void {
    stabilization = enabled;
    shadowConfiguration.stabilizeCascades = enabled;
    directionLight.isDirty = true;
    stabilizeToggle.setAttribute('aria-pressed', String(enabled));
    document.body.dataset['csmStabilized'] = String(enabled);
}

function setTour(enabled: boolean): void {
    touring = enabled;
    tourToggle.setAttribute('aria-pressed', String(enabled));
    tourToggle.textContent = enabled ? 'Ⅱ 暂停环游' : '▷ 环游小镇';
    document.body.dataset['csmTour'] = String(enabled);
}

function setView(view: ViewName): void {
    setTour(false);
    tourTime = 0;
    if (view === 'compare') {
        setTimeOfDay('morning');
        shadowConfiguration.cascadeSplitLambda = 0.65;
        lambdaControl.value = '0.65';
        lambdaOutput.value = '0.65';
        setBudget('study');
    } else if (document.body.dataset['csmView'] === 'compare') {
        shadowConfiguration.cascadeSplitLambda = 0.3;
        lambdaControl.value = '0.30';
        lambdaOutput.value = '0.30';
        setBudget('balanced');
    }
    const preset = VIEWS[view];
    orbitControls.setView(
        new Hilo3d.Vector3(...viewPosition(view)),
        new Hilo3d.Vector3(...viewTarget(view))
    );
    viewCaption.textContent = preset.caption;
    document.body.dataset['csmView'] = view;
    for (const button of viewButtons)
        button.setAttribute('aria-pressed', String(button.dataset['view'] === view));
}
for (const button of modeButtons) {
    button.addEventListener('click', () => {
        const mode = Number(button.dataset['cascadeCount']);
        if (mode === 0 || mode === 1 || mode === 4) setShadowMode(mode);
    });
}
for (const button of viewButtons) {
    button.addEventListener('click', () => {
        const view = button.dataset['view'];
        if (
            view === 'courtyard' ||
            view === 'detail' ||
            view === 'distance' ||
            view === 'water' ||
            view === 'compare' ||
            view === 'seascape'
        )
            setView(view);
    });
}
stabilizeToggle.addEventListener('click', () => {
    setStabilization(!stabilization);
});
tourToggle.addEventListener('click', () => {
    setTour(!touring);
});
lambdaControl.addEventListener('input', () => {
    shadowConfiguration.cascadeSplitLambda = lambdaControl.valueAsNumber;
    lambdaOutput.value = lambdaControl.valueAsNumber.toFixed(2);
    directionLight.isDirty = true;
    refreshDepthReadout();
});
blendControl.addEventListener('input', () => {
    shadowConfiguration.cascadeBlend = blendControl.valueAsNumber;
    blendOutput.value = `${String(Math.round(blendControl.valueAsNumber * 100))}%`;
    directionLight.isDirty = true;
});
strengthControl.addEventListener('input', () => {
    shadowConfiguration.shadowStrength = strengthControl.valueAsNumber;
    strengthOutput.value = strengthControl.valueAsNumber.toFixed(2);
    document.body.dataset['csmStrength'] = strengthControl.value;
    directionLight.isDirty = true;
});
distanceControl.addEventListener('input', () => {
    shadowConfiguration.cascadeMaxDistance = distanceControl.valueAsNumber;
    distanceOutput.value = `${String(distanceControl.valueAsNumber)} m`;
    directionLight.isDirty = true;
    refreshDepthReadout();
});
const stopTour = (): void => {
    if (touring) setTour(false);
};
stage.canvas.addEventListener('pointerdown', stopTour);
stage.canvas.addEventListener('wheel', stopTour, { passive: true });
const handleKeyboard = (event: KeyboardEvent): void => {
    if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLButtonElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
    )
        return;
    if (event.code === 'Digit1') setShadowMode(1);
    else if (event.code === 'Digit4') setShadowMode(4);
    else if (event.code === 'KeyO') setShadowMode(shadowMode === 0 ? 4 : 0);
    else if (event.code === 'KeyS') setStabilization(!stabilization);
    else if (event.code === 'KeyR') setView('courtyard');
};
window.addEventListener('keydown', handleKeyboard);
const resizeView = (): void => {
    camera.fov = window.innerWidth <= 740 ? 53 : 36;
    if (document.body.dataset['csmView'] === 'courtyard' && !touring) {
        orbitControls.setView(
            new Hilo3d.Vector3(...viewPosition('courtyard')),
            new Hilo3d.Vector3(...viewTarget('courtyard'))
        );
    }
};
window.addEventListener('resize', resizeView);
resizeView();
const tourPosition = new Hilo3d.Vector3();
const tourTarget = new Hilo3d.Vector3();
ticker.addTick({
    tick(dt: number): void {
        toyWorld.tick(dt);
        surroundings.tick(dt);
        weatherEffects.tick(dt);
        snowCover.tick(dt);
        const now = performance.now();
        updateLighting(now);
        const flash = weatherEffects.lightningFlash;
        fillLight.amount = baseFillAmount + flash * 3.2;
        surroundings.setLightning(flash);
        if (now >= nextSnowReadout) {
            nextSnowReadout = now + 200;
            const amount = Math.round(snowCover.accumulation * 100);
            if (document.activeElement !== snowAmount) snowAmount.value = String(amount);
            snowAmountOutput.value = `${String(amount)}%`;
            document.body.dataset['csmSnowAmount'] = String(amount);
            document.body.dataset['csmLightning'] = flash > 0 ? 'true' : 'false';
        }
        if (sceneMoving)
            windmillRotor.rotationZ = (windmillRotor.rotationZ + Math.min(dt, 50) * 0.012) % 360;
        if (!touring) return;
        tourTime += Math.min(dt, 50) / 1000;
        const travel = (1 - Math.cos((tourTime * Math.PI) / 28)) * 0.5;
        tourPosition.set(68 - 44 * travel, 58 - 22 * travel, 90 - 108 * travel);
        tourTarget.set(0, 3, -10 - 20 * travel);
        orbitControls.setView(tourPosition, tourTarget);
    }
});
backendBadge.textContent = `${BACKEND_LABELS[renderer.backend]} / 4× MSAA`;
document.body.dataset['csmMsaa'] = '4';
document.body.dataset['csmAa'] = 'msaa';
document.body.dataset['csmStrength'] = strengthControl.value;
setBudget('balanced');
setTimeOfDay('morning');
setWeather('clear');
toyWorld.setLocalShadows(true);
document.body.dataset['csmLocalShadows'] = 'true';
setStabilization(true);
setView('courtyard');
setSceneMotion(true);
ticker.start();
document.body.dataset['csmReady'] = 'true';
window.addEventListener(
    'pagehide',
    () => {
        window.removeEventListener('keydown', handleKeyboard);
        window.removeEventListener('resize', resizeView);
        stage.canvas.removeEventListener('pointerdown', stopTour);
        stage.canvas.removeEventListener('wheel', stopTour);
        sceneContext.dispose();
    },
    { once: true }
);
