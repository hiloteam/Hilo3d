import * as Hilo3d from '../src/Hilo3d';
import {
    DDGI_EVIDENCE_PROTOCOL,
    type DDGIEvidenceFixture,
    type DDGIEvidenceFrame
} from '../benchmarks/ddgi/fixture-contract';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../src/render/diagnostics/RendererDiagnosticsRegistry';
import { createTestFrameControl } from './shared/test-frame-control';

type WallPalette = 'sage' | 'clay' | 'chalk';
type TimeOfDay = 'day' | 'night';
type Triple = readonly [number, number, number];

interface AtelierEvidence {
    readonly backend: 'webgpu';
    readonly giEnabled: boolean;
    readonly doorAngle: number;
    readonly lampPosition: number;
    readonly wallPalette: WallPalette;
    readonly timeOfDay: TimeOfDay;
    readonly view: number;
    readonly triangleCount: number;
    readonly diagnostics: Readonly<Hilo3d.ClusteredForwardPlusDiagnostics>;
}

const parameters = new URLSearchParams(location.search);
const testMode = parameters.get('test') === '1';
const benchmarkMode = parameters.get('benchmark') === '1';
const pipelineGIEnabled = !benchmarkMode || parameters.get('ddgi') !== '0';
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const wallColors: Readonly<Record<WallPalette, Triple>> = {
    sage: [0.13, 0.43, 0.24],
    clay: [0.76, 0.17, 0.065],
    chalk: [0.88, 0.82, 0.68]
};

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
    const found = document.querySelector(selector);
    if (!(found instanceof kind)) throw new Error(`Atelier is missing ${selector}`);
    return found;
}

function setColor(color: Hilo3d.Color, value: Triple): void {
    color.set(value[0], value[1], value[2], 1);
}

function pixelRatio(): number {
    return Math.min(
        testMode ? 1 : devicePixelRatio,
        1.5,
        (testMode ? 960 : MAX_WIDTH) / Math.max(innerWidth, 1),
        (testMode ? 600 : MAX_HEIGHT) / Math.max(innerHeight, 1)
    );
}

let stopScene: (() => void) | undefined;

async function run(): Promise<void> {
    if (
        benchmarkMode &&
        (testMode || innerWidth !== 960 || innerHeight !== 600 || !crossOriginIsolated)
    ) {
        throw new Error(
            'Atelier evidence requires an isolated 960×600 benchmark page without test pacing.'
        );
    }
    if (parameters.get('backend') === 'webgl2') {
        throw new Error('午后书房需要 WebGPU。请使用支持 WebGPU 的浏览器与设备。');
    }
    const fieldset = element('#controlsFieldset', HTMLFieldSetElement);
    const giToggle = element('#giToggle', HTMLButtonElement);
    const doorControl = element('#doorControl', HTMLInputElement);
    const lampControl = element('#lampControl', HTMLInputElement);
    const doorOutput = element('#doorOutput', HTMLOutputElement);
    const lampOutput = element('#lampOutput', HTMLOutputElement);
    const loading = element('#loadingPanel', HTMLElement);
    const eventScope = new AbortController();
    const events = { signal: eventScope.signal };
    element('#loadingDetail', HTMLElement).textContent = '正在搬入橡木家具、亚麻织物与陶器…';
    const model = await new Hilo3d.GLTFLoader().load({
        src: new URL('./models/Atelier/afternoon-atelier.glb', import.meta.url).href,
        ignoreTextureError: false
    });
    await model.ready;
    const door = model.node.getChildByName('DoorPivot');
    const lamp = model.node.getChildByName('LampPivot');
    const readingEmitter = model.node.getChildByName('ReadingEmitter');
    const wallWashEmitter = model.node.getChildByName('WallWashEmitter');
    const wall = model.materials.find(material => material.name === 'WallPigment');
    if (
        door === null ||
        lamp === null ||
        readingEmitter === null ||
        wallWashEmitter === null ||
        !(wall instanceof Hilo3d.PBRMaterial)
    ) {
        throw new Error('The original atelier asset is missing its interactive parts.');
    }
    const doorNode: Hilo3d.Node = door;
    const lampNode: Hilo3d.Node = lamp;
    const wallMaterial: Hilo3d.PBRMaterial = wall;
    const secondaryWall = model.materials.find(
        material => material.name === 'WallSecondaryPigment'
    );
    const shade = model.materials.find(material => material.name === 'LinenLampshade');
    const diffuser = model.materials.find(material => material.name === 'WarmDiffuser');
    const buckets: Hilo3d.GPUSceneBucket[] = [];
    let triangleCount = 0;
    for (const mesh of model.meshes) {
        if (mesh.geometry === null || !(mesh.material instanceof Hilo3d.PBRMaterial)) {
            throw new Error('Atelier requires indexed opaque PBR geometry.');
        }
        // The Blender preview uses a distant sky card. Runtime rays must escape
        // the open window and sample the actual probe environment instead.
        if (mesh.material.name === 'WindowDaylight') {
            mesh.visible = false;
            continue;
        }
        mesh.castShadows = true;
        mesh.receiveShadows = true;
        triangleCount += (mesh.geometry.indices?.count ?? 0) / 3;
        buckets.push({ geometry: mesh.geometry, material: mesh.material });
    }
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: 64,
        maxLights: 8,
        maxLightsPerCluster: 8,
        maxLightIndices: 262_144,
        tileSize: 32,
        zSlices: 16,
        maxViewportWidth: testMode ? 960 : MAX_WIDTH,
        maxViewportHeight: testMode ? 600 : MAX_HEIGHT,
        hiZ: true,
        temporalAA: { renderScale: 1, historyWeight: 0.85, sharpness: 0.12 },
        dynamicGlobalIllumination: !pipelineGIEnabled
            ? false
            : {
                  origin: new Hilo3d.Vector3(-3.15, 0.25, -2.25),
                  spacing: new Hilo3d.Vector3(0.78, 0.67, 0.75),
                  probeCounts: [9, 5, 7],
                  raysPerProbe: 128,
                  maxProbesPerFrame: 48,
                  hysteresis: 0.88,
                  intensity: 1,
                  maxRayDistance: 14,
                  environment: new Hilo3d.Color(0.48, 0.44, 0.35),
                  bounceStrength: 0.75,
                  relocation: true,
                  maxTriangles: 32_768,
                  maxLights: 8
              },
        bloomStrength: 0.035,
        exposure: 1.1
    });
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / Math.max(innerHeight, 1),
        fov: 46,
        near: 0.06,
        far: 45,
        depthMode: 'reversed'
    });
    element('#loadingDetail', HTMLElement).textContent = '正在让阳光走进房间，等待第一束间接光…';
    const benchmarkCanvas = benchmarkMode ? document.createElement('canvas') : undefined;
    const benchmarkDiagnostics =
        benchmarkCanvas === undefined ? undefined : registerRendererDiagnostics(benchmarkCanvas);
    const stage = await Hilo3d.Stage.create<'webgpu'>({
        backend: 'webgpu',
        container: element('#container', HTMLElement),
        ...(benchmarkCanvas === undefined
            ? {}
            : {
                  canvas: benchmarkCanvas,
                  requiredFeatures: ['timestamp-query'],
                  powerPreference: 'high-performance',
                  forceFallbackAdapter: false
              }),
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: pixelRatio(),
        antialias: false,
        alpha: false,
        useInstanced: true,
        renderingProfile: 'high-end',
        clearColor: new Hilo3d.Color(0.51, 0.44, 0.34),
        renderPipeline: factory
    });
    stage.canvas.setAttribute(
        'aria-label',
        '午后书房：拖动探索温暖的室内空间，观察光在墙面与家具之间的反射'
    );
    model.node.addTo(stage);
    const sunlight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.83, 0.59),
        amount: 2,
        direction: new Hilo3d.Vector3(0.85, -1, -0.35),
        shadow: {
            width: 2048,
            height: 2048,
            cascadeMaxDistance: 18,
            minBias: 0.0015,
            maxBias: 0.006
        }
    }).addTo(stage);
    const readingLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(1, 0.59, 0.25),
        amount: 4.8,
        range: 5,
        shadow: { width: 512, height: 512, minBias: 0.001, maxBias: 0.004 }
    }).addTo(readingEmitter);
    const readingPool = new Hilo3d.SpotLight({
        color: new Hilo3d.Color(1, 0.62, 0.29),
        amount: 24,
        range: 7,
        direction: new Hilo3d.Vector3(0, -1, 0),
        cutoff: 31,
        outerCutoff: 46,
        shadow: { width: 1024, height: 1024, minBias: 0.0007, maxBias: 0.002 }
    }).addTo(readingEmitter);
    const wallWash = new Hilo3d.SpotLight({
        color: new Hilo3d.Color(1, 0.92, 0.75),
        amount: 32,
        range: 7,
        direction: new Hilo3d.Vector3(0, 1, 0),
        cutoff: 16,
        outerCutoff: 24,
        shadow: { width: 1024, height: 1024, minBias: 0.0007, maxBias: 0.002 }
    }).addTo(wallWashEmitter);
    const hallLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.25, 0.5, 1),
        amount: 6,
        range: 4,
        shadow: { width: 512, height: 512, minBias: 0.001, maxBias: 0.004 }
    })
        .setPosition(2.3, 2.1, -3.22)
        .addTo(stage);
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: new Hilo3d.Vector3(-0.3, 1.25, -0.3),
        minDistance: 2.8,
        maxDistance: 36,
        minPolarAngle: 0.28,
        maxPolarAngle: Math.PI * 0.49,
        rotateSpeed: 0.45,
        zoomSpeed: 0.65,
        panSpeed: 0.55,
        enablePan: true
    });
    const views = [
        { position: [7, 5.2, 9.7], target: [-0.75, 0.42, -0.15] },
        { position: [6.8, 6.1, 8.3], target: [0, 1.05, -0.15] },
        { position: [0.6, 1.8, 3.0], target: [-1.65, 1.0, -1.0] }
    ] as const;
    let giEnabled = true;
    let doorAngle = 0;
    let lampPosition = 0;
    let wallPalette: WallPalette = 'chalk';
    let timeOfDay: TimeOfDay = parameters.get('time') === 'day' ? 'day' : 'night';
    let view = 0;
    let disposed = false;
    let lifecyclePaused = false;
    function showView(): void {
        const next = views[view];
        if (next === undefined) throw new Error('Atelier view is unavailable.');
        const target = new Hilo3d.Vector3(...next.target);
        const portraitScale = Math.max(1, Math.min(2.8, 1.05 / camera.aspect));
        const framingTarget =
            camera.aspect < 0.85 ? new Hilo3d.Vector3(0, target.y + 0.2, target.z) : target;
        const position = new Hilo3d.Vector3(...next.position)
            .subtract(target)
            .scale(portraitScale)
            .add(framingTarget);
        controls.setView(position, framingTarget);
        if (sunlight.shadow !== null) {
            // Portrait framing moves the camera back; retain sunlight shadows
            // at the room's new camera distance instead of clipping the casters.
            sunlight.shadow.cascadeMaxDistance = camera.aspect < 0.85 ? 40 : 18;
        }
        document.body.dataset['view'] = String(view);
    }
    function setGI(enabled: boolean): void {
        if (!pipelineGIEnabled && enabled) throw new Error('This benchmark has no DDGI runtime.');
        giEnabled = enabled;
        if (pipelineGIEnabled) factory.setDynamicGlobalIlluminationIntensity(enabled ? 1 : 0);
        giToggle.setAttribute('aria-pressed', String(enabled));
        element('#giLabel', HTMLElement).textContent = enabled ? '间接光已开启' : '仅直接照明';
        element('#sceneNote', HTMLElement).textContent = enabled
            ? timeOfDay === 'night'
                ? '换墙色，看白座垫的反光；挪灯，看两个光斑移动。'
                : '换一种墙色，看看反射到沙发上的光。'
            : '开启间接光，看看阴影里的温度。';
        document.body.dataset['giEnabled'] = String(enabled);
    }
    function setDoor(angle: number): void {
        doorAngle = Math.max(0, Math.min(105, angle));
        doorNode.rotationY = -doorAngle;
        doorControl.value = String(doorAngle);
        doorOutput.value = `${String(Math.round(doorAngle))}°`;
        const button = element('#doorButton', HTMLButtonElement);
        button.textContent = doorAngle > 10 ? '合上木门 ↙' : '打开木门 ↗';
        button.setAttribute('aria-pressed', String(doorAngle > 10));
        element('#sceneNote', HTMLElement).textContent =
            doorAngle > 10 ? '门外蓝光照进地毯，看看门后的影子。' : '门合上了，留下书房里的暖光。';
        document.body.dataset['doorAngle'] = String(doorAngle);
    }
    function setLamp(value: number): void {
        lampPosition = Math.max(0, Math.min(100, value));
        const travel = lampPosition / 100;
        lampNode.x = -2.75 + travel * 5.6;
        // Walk the lamp around the coffee table, keeping its foot on the floor.
        lampNode.z = 0.45 + Math.sin(travel * Math.PI) * 1.35 + travel * 0.8;
        // Both light sources inherit the authored LampPivot hierarchy. Their
        // axes and positions are the same as the visible openings in the GLB.
        lampControl.value = String(lampPosition);
        lampOutput.value =
            lampPosition === 0
                ? '窗边'
                : lampPosition === 100
                  ? '椅旁'
                  : `${String(Math.round(lampPosition))}%`;
        document.body.dataset['lampPosition'] = String(lampPosition);
        for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lamp]')) {
            button.setAttribute(
                'aria-pressed',
                String(Number(button.dataset['lamp']) === lampPosition)
            );
        }
        element('#sceneNote', HTMLElement).textContent = '看灯下的暖色光斑，和家具投下的新影子。';
    }
    function setWall(palette: WallPalette): void {
        wallPalette = palette;
        wallMaterial.baseColor.set(...wallColors[palette], 1);
        wallMaterial.invalidateData();
        if (secondaryWall instanceof Hilo3d.PBRMaterial) {
            secondaryWall.baseColor.set(...wallColors[palette], 1);
            secondaryWall.invalidateData();
        }
        for (const button of document.querySelectorAll<HTMLButtonElement>('[data-wall]')) {
            button.setAttribute('aria-pressed', String(button.dataset['wall'] === palette));
        }
        document.body.dataset['wallPalette'] = palette;
        element('#sceneNote', HTMLElement).textContent =
            palette === 'clay'
                ? '看白色座垫染上的陶土反光。'
                : palette === 'sage'
                  ? '看看白色座垫上的绿色反光。'
                  : '暖白墙面，让反射的光更明亮。';
    }
    function setTimeOfDay(value: TimeOfDay): void {
        timeOfDay = value;
        const night = value === 'night';
        sunlight.amount = night ? 0.055 : 2;
        setColor(sunlight.color, night ? [0.35, 0.48, 0.85] : [1, 0.83, 0.59]);
        readingLight.amount = night ? 3 : 4.8;
        readingPool.amount = night ? 8 : 6;
        wallWash.amount = night ? 80 : 5;
        hallLight.amount = night ? 14 : 6;
        setColor(hallLight.color, night ? [0.23, 0.48, 1] : [0.5, 0.69, 1]);
        const environment = night
            ? new Hilo3d.Color(0.018, 0.024, 0.043)
            : new Hilo3d.Color(0.48, 0.44, 0.35);
        if (pipelineGIEnabled) factory.setDynamicGlobalIlluminationEnvironment(environment);
        stage.renderer.clearColor = night
            ? new Hilo3d.Color(0.016, 0.025, 0.041)
            : new Hilo3d.Color(0.51, 0.44, 0.34);
        if (shade instanceof Hilo3d.PBRMaterial) {
            setColor(shade.emissionFactor, night ? [0.35, 0.22, 0.09] : [0.2624, 0.2112, 0.1344]);
            shade.invalidateData();
        }
        if (diffuser instanceof Hilo3d.PBRMaterial) {
            setColor(diffuser.emissionFactor, night ? [0.6, 0.38, 0.15] : [1.8, 1.17, 0.54]);
            diffuser.invalidateData();
        }
        document.body.dataset['time'] = value;
        document.title = night ? 'EVENING · 灯下书房 — Hilo3D' : 'AFTERNOON · 午后书房 — Hilo3D';
        element('#sceneWord', HTMLElement).textContent = night ? 'Evening' : 'Afternoon';
        element('#roomTitle', HTMLElement).textContent = night ? '灯下书房' : '午后书房';
        element('#roomCopy', HTMLElement).textContent = night
            ? '夜色渐深，留一盏温暖的灯。'
            : '一页书，一杯茶，让光多停留一会。';
        for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-time]')) {
            button.setAttribute('aria-pressed', String(button.dataset['time'] === value));
        }
        setGI(giEnabled);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-time]')) {
        button.addEventListener(
            'click',
            () => {
                const value = button.dataset['time'];
                if (value === 'night' || value === 'day') setTimeOfDay(value);
            },
            events
        );
    }
    element('#doorButton', HTMLButtonElement).addEventListener(
        'click',
        () => {
            setDoor(doorAngle > 10 ? 0 : 90);
        },
        events
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-lamp]')) {
        button.addEventListener(
            'click',
            () => {
                setLamp(Number(button.dataset['lamp']));
            },
            events
        );
    }
    giToggle.addEventListener(
        'click',
        () => {
            setGI(!giEnabled);
        },
        events
    );
    doorControl.addEventListener(
        'input',
        () => {
            setDoor(Number(doorControl.value));
        },
        events
    );
    lampControl.addEventListener(
        'input',
        () => {
            setLamp(Number(lampControl.value));
        },
        events
    );
    element('#viewButton', HTMLButtonElement).addEventListener(
        'click',
        () => {
            view = (view + 1) % views.length;
            showView();
        },
        events
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-wall]')) {
        button.addEventListener(
            'click',
            () => {
                const palette = button.dataset['wall'];
                if (palette === 'sage' || palette === 'clay' || palette === 'chalk')
                    setWall(palette);
            },
            events
        );
    }
    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(stage);
    const capture = testMode
        ? createTestFrameControl(ticker, () => stage.renderer.waitForIdle())
        : undefined;
    if (capture !== undefined) window.__HILO3D_TEST_CAPTURE__ = capture;
    async function evidence(): Promise<AtelierEvidence> {
        if (disposed) throw new Error('Atelier has been disposed.');
        const diagnostics = await factory.readDiagnostics();
        return {
            backend: 'webgpu',
            giEnabled,
            doorAngle,
            lampPosition,
            wallPalette,
            timeOfDay,
            view,
            triangleCount,
            diagnostics
        };
    }
    async function settle(frames = 16): Promise<AtelierEvidence> {
        if (!Number.isInteger(frames) || frames < 1 || frames > 180)
            throw new RangeError('Atelier settle requires 1–180 frames.');
        ticker.pause();
        try {
            await capture?.pause();
            await stage.renderer.waitForIdle();
            for (let frame = 0; frame < frames; frame++) {
                if (disposed) throw new Error('Atelier has been disposed.');
                stage.tick(1000 / 60);
                await stage.renderer.waitForIdle();
            }
            return await evidence();
        } finally {
            if (!disposed && !lifecyclePaused && !benchmarkMode) {
                if (capture === undefined) ticker.resume();
                else capture.resume();
            }
        }
    }
    const resize = (): void => {
        camera.aspect = innerWidth / Math.max(innerHeight, 1);
        stage.resize(Math.max(innerWidth, 1), Math.max(innerHeight, 1), pixelRatio());
        showView();
    };
    window.addEventListener('resize', resize, events);
    async function dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        ticker.stop();
        capture?.dispose();
        if (window.__HILO3D_TEST_CAPTURE__ === capture) delete window.__HILO3D_TEST_CAPTURE__;
        controls.dispose();
        eventScope.abort();
        fieldset.disabled = true;
        document.body.dataset['atelierDisposed'] = 'true';
        try {
            await stage.renderer.waitForIdle();
        } finally {
            stage.destroy();
            if (benchmarkCanvas !== undefined && benchmarkDiagnostics !== undefined) {
                unregisterRendererDiagnostics(benchmarkCanvas, benchmarkDiagnostics);
            }
        }
    }
    stopScene = (): void => {
        ticker.stop();
    };
    window.addEventListener(
        'pagehide',
        (event: PageTransitionEvent) => {
            ticker.stop();
            if (event.persisted) {
                lifecyclePaused = true;
                void capture?.pause();
                return;
            }
            void dispose().catch(showFailure);
        },
        events
    );
    window.addEventListener(
        'pageshow',
        (event: PageTransitionEvent) => {
            if (event.persisted && !disposed && !benchmarkMode) {
                lifecyclePaused = false;
                capture?.resume();
                ticker.start();
            }
        },
        events
    );
    let measuring = false;
    let measurementIndex = 0;
    let lastMeasuredTimeline: number | undefined;
    async function measureFrame(): Promise<DDGIEvidenceFrame> {
        if (!benchmarkMode || benchmarkDiagnostics === undefined || measuring || disposed) {
            throw new Error('Atelier benchmark frame requires one live, idle benchmark fixture.');
        }
        if (
            lastMeasuredTimeline !== undefined &&
            benchmarkDiagnostics.snapshot().renderGraph?.frameIndex !== lastMeasuredTimeline
        ) {
            throw new Error('Uncontrolled rendering occurred between Atelier measurements.');
        }
        measuring = true;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const recordStart = performance.now();
            stage.tick(1000 / 60);
            const cpuRecordMs = performance.now() - recordStart;
            const recorded = benchmarkDiagnostics.snapshot();
            const frameIndex = recorded.renderGraph?.frameIndex;
            if (frameIndex === undefined)
                throw new Error('Atelier Render Graph timeline is unavailable.');
            const fenceStart = performance.now();
            await Promise.race([
                stage.renderer.waitForIdle(),
                new Promise<never>((_resolve, reject) => {
                    timeout = setTimeout(() => {
                        reject(new Error('Atelier benchmark GPU fence timed out.'));
                    }, 10_000);
                })
            ]);
            const fenceWaitMs = performance.now() - fenceStart;
            if (timeout !== undefined) clearTimeout(timeout);
            const timestampStart = performance.now();
            let timeline = benchmarkDiagnostics.snapshot().renderGraph;
            while (timeline?.frameIndex === frameIndex && timeline.gpuStatus === 'pending') {
                if (performance.now() - timestampStart > 10_000) {
                    throw new Error('Atelier native GPU timestamps did not resolve.');
                }
                await new Promise<void>(resolve => {
                    setTimeout(resolve, 0);
                });
                timeline = benchmarkDiagnostics.snapshot().renderGraph;
            }
            const timestampReadbackWaitMs = performance.now() - timestampStart;
            if (timeline?.frameIndex !== frameIndex || timeline.gpuStatus !== 'ready') {
                throw new Error(
                    `Atelier GPU timestamps unavailable: ${timeline?.gpuStatus ?? 'missing'}.`
                );
            }
            let gpuPassTimeSumMs = 0;
            for (const pass of timeline.passes) {
                if (pass.kind === null) continue;
                if (pass.gpuDurationMs === null || !Number.isFinite(pass.gpuDurationMs)) {
                    throw new Error(`Atelier GPU timestamp missing for ${pass.name}.`);
                }
                gpuPassTimeSumMs += pass.gpuDurationMs;
            }
            const diagnosticStart = performance.now();
            const diagnostics = await factory.readDiagnostics();
            lastMeasuredTimeline = benchmarkDiagnostics.snapshot().renderGraph?.frameIndex;
            return {
                measurementIndex: measurementIndex++,
                frameIndex,
                cpuRecordMs,
                fenceWaitMs,
                timestampReadbackWaitMs,
                diagnosticReadbackMs: performance.now() - diagnosticStart,
                graphRecordMs: timeline.recordDurationMs,
                graphCompileMs: timeline.compileDurationMs,
                graphPrepareMs: timeline.prepareDurationMs,
                graphExecuteMs: timeline.executeDurationMs,
                gpuPassTimeSumMs,
                gpuPasses: timeline.passes,
                commands: recorded.frame,
                dynamicGlobalIllumination: diagnostics.dynamicGlobalIllumination
            };
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            measuring = false;
        }
    }
    showView();
    setGI(pipelineGIEnabled && parameters.get('gi') !== '0');
    setDoor(0);
    setLamp(0);
    setWall('chalk');
    setTimeOfDay(timeOfDay);
    // Populate every spatial probe before revealing the room; these are real
    // submitted frames, using the same budget and shader as interactive updates.
    if (!benchmarkMode) await settle(21);
    window.__HILO3D_ATELIER_TEST_API__ = {
        settle,
        evidence,
        setGI,
        setDoor,
        setLamp,
        setWall,
        setTimeOfDay,
        dispose
    };
    if (benchmarkMode) {
        window.__HILO3D_ATELIER_BENCHMARK__ = {
            protocol: DDGI_EVIDENCE_PROTOCOL,
            mode: pipelineGIEnabled ? 'enabled' : 'disabled',
            timeOfDay,
            width: stage.canvas.width,
            height: stage.canvas.height,
            crossOriginIsolated,
            measureFrame,
            dispose
        };
    }
    fieldset.disabled = benchmarkMode;
    loading.hidden = true;
    document.body.dataset['atelierReady'] = 'true';
    if (!benchmarkMode) ticker.start();
}

function showFailure(error: unknown): void {
    stopScene?.();
    const failure = error instanceof Error ? error : new Error(String(error));
    document.body.dataset['atelierReady'] = 'error';
    element('#loadingPanel', HTMLElement).hidden = false;
    element('#loadingPanel', HTMLElement).dataset['state'] = 'error';
    element('#loadingTitle', HTMLElement).textContent = '暂时无法打开书房';
    element('#loadingDetail', HTMLElement).textContent = failure.message;
    element('#controlsFieldset', HTMLFieldSetElement).disabled = true;
    console.error(failure);
}

declare global {
    interface Window {
        __HILO3D_ATELIER_BENCHMARK__?: DDGIEvidenceFixture;
        __HILO3D_ATELIER_TEST_API__?: Readonly<{
            settle(frames?: number): Promise<AtelierEvidence>;
            evidence(): Promise<AtelierEvidence>;
            setGI(enabled: boolean): void;
            setDoor(angle: number): void;
            setLamp(value: number): void;
            setWall(palette: WallPalette): void;
            setTimeOfDay(value: TimeOfDay): void;
            dispose(): Promise<void>;
        }>;
    }
}

void run().catch(showFailure);
