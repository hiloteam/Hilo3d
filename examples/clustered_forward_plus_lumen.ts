import * as Hilo3d from '../src/Hilo3d';
import { createLumenRoundedBox } from './shared/lumenGeometry';

type Triple = readonly [number, number, number];
type PaletteName = 'nocturne' | 'ember' | 'spectrum';

interface LumenEvidence {
    readonly backend: 'webgpu';
    readonly activeLights: number;
    readonly lightCount: number;
    readonly objectCount: number;
    readonly visibleObjectCount: number;
    readonly fallbackObjectCount: number;
    readonly clusterLightIndexCount: number;
    readonly clusterOverflowCount: number;
    readonly droppedLightCount: number;
    readonly motionEnabled: boolean;
    readonly palette: string;
    readonly intensity: number;
    readonly elapsed: number;
    readonly movingLightCount: number;
    readonly lightDirectionChecksum: number;
}

interface MovingHead {
    readonly light: Hilo3d.SpotLight;
    readonly node: Hilo3d.Node;
    readonly target: Hilo3d.Vector3;
    readonly phase: number;
}

interface Lamp {
    readonly light: Hilo3d.PointLight | Hilo3d.SpotLight;
    readonly marker: Hilo3d.Mesh;
    readonly phase: number;
    readonly baseAmount: number;
    readonly colorIndex: number;
}

const TAU = Math.PI * 2;
const MAX_LIGHTS = 192;
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 1600;
const parameters = new URLSearchParams(location.search);
const testMode = parameters.get('test') === '1';
const palettes: Readonly<Record<PaletteName, readonly Triple[]>> = {
    nocturne: [
        [0.06, 0.6, 0.46],
        [0.12, 0.36, 0.6],
        [1, 0.43, 0.19],
        [0.78, 0.14, 0.23]
    ],
    ember: [
        [1, 0.29, 0.055],
        [1, 0.62, 0.18],
        [1, 0.12, 0.08],
        [0.8, 0.36, 0.14]
    ],
    spectrum: [
        [0.48, 0.11, 1],
        [0.035, 0.75, 1],
        [1, 0.08, 0.43],
        [0.16, 1, 0.42]
    ]
};

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
    const result = document.querySelector(selector);
    if (!(result instanceof kind)) throw new Error(`Lumen is missing ${selector}`);
    return result;
}

/** Revolves a rounded stone profile; explicit float32 streams also serve GPU Scene. */
function plinthGeometry(): Hilo3d.Geometry {
    const profile = [
        [0, -0.5],
        [0.96, -0.5],
        [1, -0.4],
        [1, 0.4],
        [0.96, 0.5],
        [0, 0.5]
    ] as const;
    const normals = [
        [0, -1],
        [0.4, -0.92],
        [1, -0.12],
        [1, 0.12],
        [0.4, 0.92],
        [0, 1]
    ] as const;
    const vertices: number[] = [];
    const normalData: number[] = [];
    const indices: number[] = [];
    const segments = 128;
    for (const [row, [radius, height]] of profile.entries()) {
        const normal = normals[row];
        if (normal === undefined) throw new Error('Incomplete plinth profile');
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * TAU;
            vertices.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
            normalData.push(Math.cos(angle) * normal[0], normal[1], Math.sin(angle) * normal[0]);
            if (row < profile.length - 1 && i < segments) {
                const a = row * (segments + 1) + i;
                const b = a + segments + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normalData), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

/** A unit ring in XY, used for both architectural portals and inset light tracks. */
function ringGeometry(tube: number): Hilo3d.Geometry {
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const radial = 128;
    const sides = 12;
    for (let i = 0; i <= radial; i++) {
        const angle = (i / radial) * TAU;
        for (let j = 0; j <= sides; j++) {
            const section = (j / sides) * TAU;
            const radius = 1 + Math.cos(section) * tube;
            vertices.push(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                Math.sin(section) * tube
            );
            normals.push(
                Math.cos(angle) * Math.cos(section),
                Math.sin(angle) * Math.cos(section),
                Math.sin(section)
            );
            if (i < radial && j < sides) {
                const a = i * (sides + 1) + j;
                const b = a + sides + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
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
    if (parameters.get('backend') === 'webgl2') {
        throw new Error(
            '光之庭需要 WebGPU 的 compute / storage 能力。请使用支持 WebGPU 的浏览器。'
        );
    }
    const container = element('#container', HTMLElement);
    const loading = element('#loadingPanel', HTMLElement);
    const fieldset = element('#controlsFieldset', HTMLFieldSetElement);
    const lightControl = element('#lightControl', HTMLInputElement);
    const intensityControl = element('#intensityControl', HTMLInputElement);
    const motionToggle = element('#motionToggle', HTMLButtonElement);
    const diagnosticsToggle = element('#diagnosticsToggle', HTMLButtonElement);
    const lightOutput = element('#lightOutput', HTMLOutputElement);
    const intensityOutput = element('#intensityOutput', HTMLOutputElement);
    const metricLights = element('#metricLights', HTMLElement);
    const metricFps = element('#metricFps', HTMLElement);
    const metricLinks = element('#metricLinks', HTMLElement);
    const metricVisible = element('#metricVisible', HTMLElement);
    const metricOverflow = element('#metricOverflow', HTMLElement);
    element('#loadingTitle', HTMLElement).textContent = '雕琢光的形状';
    element('#loadingDetail', HTMLElement).textContent = '正在载入 Blender 雕塑与 PBR 材质…';
    const model = await new Hilo3d.GLTFLoader().load({
        src: new URL('./models/Lumen/orbital-bloom.glb', import.meta.url).href,
        ignoreTextureError: false
    });
    await model.ready;
    const bounds = model.node.getBounds();
    if (bounds === undefined || bounds.height <= 0)
        throw new Error('The sculpture has no usable bounds.');
    const scale = 4.8 / bounds.height;
    model.node
        .setScale(scale)
        .setPosition(-bounds.x * scale, 0.9 - bounds.yMin * scale, -bounds.z * scale);

    model.node.rotationY = -24;
    const scene = new Hilo3d.Node({ name: 'Lumen exhibition pavilion' });
    model.node.addTo(scene);
    const buckets: Hilo3d.GPUSceneBucket[] = [];
    const registered = new Map<Hilo3d.Geometry, Set<Hilo3d.PBRMaterial>>();
    function register(geometry: Hilo3d.Geometry, material: Hilo3d.PBRMaterial): void {
        let materials = registered.get(geometry);
        if (materials === undefined) {
            materials = new Set();
            registered.set(geometry, materials);
        }
        if (materials.has(material)) return;
        materials.add(material);
        buckets.push({ geometry, material });
    }
    for (const sculptureMesh of model.meshes) {
        if (
            sculptureMesh.geometry === null ||
            !(sculptureMesh.material instanceof Hilo3d.PBRMaterial)
        ) {
            throw new Error('Lumen sculpture must contain indexed PBR meshes.');
        }
        sculptureMesh.material.metallic = 0.035;
        const surface = sculptureMesh.material.baseColor;
        surface.set(
            Math.min(surface.r + 0.12, 1),
            Math.min(surface.g + 0.15, 1),
            Math.min(surface.b + 0.22, 1),
            1
        );
        sculptureMesh.material.roughness = 0.32;
        register(sculptureMesh.geometry, sculptureMesh.material);
        sculptureMesh.castShadows = true;
        sculptureMesh.receiveShadows = true;
    }
    const box = new Hilo3d.BoxGeometry();
    const roundedBox = createLumenRoundedBox();
    const disc = plinthGeometry();
    const track = ringGeometry(0.0025);
    const bulb = new Hilo3d.SphereGeometry({ radius: 0.065, widthSegments: 10, heightSegments: 8 });
    const stone = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.22, 0.3, 0.46),
        metallic: 0,
        roughness: 0.48
    });
    const floorMaterial = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.52, 0.48, 0.43),
        metallic: 0,
        roughness: 0.65
    });
    const ivory = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.34, 0.68, 0.61),
        metallic: 0,
        roughness: 0.38
    });
    const gold = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.87, 0.6, 0.33),
        metallic: 0,
        roughness: 0.36
    });
    const trim = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.53, 0.37, 0.25),
        metallic: 0,
        roughness: 0.52
    });
    const lampMaterials = palettes.nocturne.map(
        color =>
            new Hilo3d.PBRMaterial({
                baseColor: new Hilo3d.Color(...color),
                emissionFactor: new Hilo3d.Color(color[0] * 2.6, color[1] * 2.6, color[2] * 2.6),
                roughness: 0.3,
                temporalReactiveFactor: 0.8
            })
    );
    function mesh(
        geometry: Hilo3d.Geometry,
        material: Hilo3d.PBRMaterial,
        position: Triple,
        size: Triple = [1, 1, 1]
    ): Hilo3d.Mesh {
        register(geometry, material);
        return new Hilo3d.Mesh({ geometry, material, castShadows: true, receiveShadows: true })
            .setPosition(...position)
            .setScale(...size)
            .addTo(scene);
    }

    // Dark, shallow concentric steps give each light a nearby surface to illuminate.
    mesh(disc, stone, [0, -0.34, 0], [9.7, 0.3, 9.7]);
    mesh(disc, floorMaterial, [0, -0.1, 0], [9.1, 0.2, 9.1]).castShadows = false;
    for (let spoke = 0; spoke < 16; spoke++) {
        const angle = (spoke / 16) * TAU;
        const line = mesh(
            box,
            trim,
            [Math.cos(angle) * 6.5, 0.004, Math.sin(angle) * 6.5],
            [0.012, 0.008, 4]
        );
        line.rotationY = 90 - (angle * 180) / Math.PI;
        line.castShadows = false;
    }
    mesh(disc, gold, [0, 0.11, 0], [2.75, 0.2, 2.75]);
    mesh(disc, stone, [0, 0.25, 0], [2.68, 0.14, 2.68]);
    mesh(disc, ivory, [0, 0.57, 0], [2.46, 0.5, 2.46]);
    mesh(disc, gold, [0, 0.85, 0], [2.4, 0.07, 2.4]);
    for (const radius of [2.72, 5.75, 8.5]) {
        mesh(
            track,
            trim,
            [0, radius === 2.72 ? 0.19 : 0.023, 0],
            [radius, radius, radius]
        ).rotationX = -90;
    }
    const housing = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.06, 0.12, 0.21),
        metallic: 0,
        roughness: 0.42
    });
    const wall = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.67, 0.7, 0.72),
        metallic: 0,
        roughness: 0.48
    });
    const bayHeights = Array.from(
        { length: 16 },
        (_unused, column) => 4.6 + Math.sin(((column + 0.5) / 16) * Math.PI) * 1.8
    );
    // Rounded resin fins carry grazing light; eight LEDs share each slim wall-washer housing.
    for (let column = 0; column < 16; column++) {
        const angle = Math.PI + ((column + 0.5) / 16) * Math.PI;
        const rotation = ((-angle - Math.PI / 2) * 180) / Math.PI;
        const x = Math.cos(angle);
        const z = Math.sin(angle);
        const height = bayHeights[column];
        if (height === undefined) throw new Error('Missing gallery fin height');
        mesh(roundedBox, stone, [x * 8.5, height * 0.5, z * 8.5], [1.54, height, 0.3]).rotationY =
            rotation;
        mesh(
            roundedBox,
            wall,
            [x * 8.3, height * 0.5, z * 8.3],
            [1.43, height - 0.06, 0.24]
        ).rotationY = rotation;
        mesh(roundedBox, gold, [x * 7.96, height - 0.16, z * 7.96], [1.18, 0.09, 0.27]).rotationY =
            rotation;
        mesh(box, housing, [x * 7.86, height - 0.21, z * 7.86], [1.08, 0.035, 0.1]).rotationY =
            rotation;
        mesh(box, gold, [x * 8.3, 0.14, z * 8.3], [1.46, 0.1, 0.32]).rotationY = rotation;
    }
    const lamps: Lamp[] = [];
    const movingHeads: MovingHead[] = [];
    for (let index = 0; index < MAX_LIGHTS; index++) {
        // Keep reduced counts spatially distributed, including both wall and floor illumination.
        const slot = (index * 73) % MAX_LIGHTS;
        let position: Triple;
        let direction: Hilo3d.Vector3 | undefined;
        let colorIndex: number;
        let baseAmount: number;
        const isMovingHead = slot >= 128 && slot < 144 && (slot - 128) % 4 === 0;
        if (slot < 128) {
            const column = Math.floor(slot / 8);
            const side = ((slot % 8) / 7 - 0.5) * 1.02;
            const angle = Math.PI + ((column + 0.5) / 16) * Math.PI;
            const dx = Math.cos(angle);
            const dz = Math.sin(angle);
            const x = dx * 7.82 - Math.sin(angle) * side;
            const z = dz * 7.82 + Math.cos(angle) * side;
            const height = bayHeights[column];
            if (height === undefined) throw new Error('Missing lamp fin height');
            const y = height - 0.24;
            position = [x, y, z];
            direction = new Hilo3d.Vector3(dx * 0.12, -1, dz * 0.12).normalize();
            colorIndex = Math.floor(column / 4);
            baseAmount = 7;
        } else {
            const floorSlot = slot - 128;
            const count = floorSlot < 16 ? 16 : 24;
            const laneSlot =
                floorSlot < 16 ? floorSlot : floorSlot < 40 ? floorSlot - 16 : floorSlot - 40;
            const front = floorSlot >= 40;
            const angle = front ? ((laneSlot + 0.5) / count) * Math.PI : (laneSlot / count) * TAU;
            const radius = floorSlot < 16 ? 3.5 : floorSlot < 40 ? 5.7 : 8.2;
            const elevated = isMovingHead;
            const height = elevated ? 1.9 : 0.14;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            position = [x, height, z];
            mesh(disc, housing, [x, 0.035, z], [0.18, 0.07, 0.18]);
            mesh(disc, gold, [x, 0.075, z], [0.13, 0.035, 0.13]);
            if (elevated) {
                mesh(box, gold, [x, height * 0.5, z], [0.065, height, 0.065]);
                direction = new Hilo3d.Vector3(-x, 0.6, -z).normalize();
            }
            colorIndex = Math.floor((laneSlot / count) * 4) % 4;
            baseAmount = isMovingHead ? 32 : floorSlot < 16 ? 15 : 8;
        }
        const material = lampMaterials[colorIndex];
        const color = palettes.nocturne[colorIndex];
        if (material === undefined || color === undefined)
            throw new Error('Incomplete lamp palette');
        const light =
            direction === undefined
                ? new Hilo3d.PointLight({
                      color: new Hilo3d.Color(...color),
                      range: slot < 144 ? 4.6 : 3.2,
                      amount: baseAmount
                  })
                : new Hilo3d.SpotLight({
                      color: new Hilo3d.Color(...color),
                      range: isMovingHead ? 10 : 7.2,
                      amount: baseAmount,
                      direction,
                      cutoff: isMovingHead ? 22 : 14,
                      outerCutoff: isMovingHead ? 33 : 25
                  });
        light.setPosition(...position).addTo(scene);
        const marker = mesh(bulb, material, position);
        if (slot < 128) marker.setScale(0.54);
        else if (slot >= 144 || (slot - 128) % 4 !== 0) marker.setScale(1.1, 0.28, 1.1);
        if (isMovingHead && light instanceof Hilo3d.SpotLight) {
            const head = new Hilo3d.Node({ name: 'Slow-sweeping toy spotlight' })
                .setPosition(...position)
                .addTo(scene);
            mesh(roundedBox, ivory, [0, 0, 0], [0.36, 0.27, 0.38]).addTo(head).castShadows = false;
            mesh(roundedBox, housing, [0, 0, 0.18], [0.29, 0.21, 0.065]).addTo(head).castShadows =
                false;
            marker.setPosition(0, 0, 0.225).setScale(1.4, 1.4, 0.28).addTo(head);
            movingHeads.push({
                light,
                node: head,
                target: new Hilo3d.Vector3(),
                phase: ((slot - 128) / 16) * TAU
            });
        }
        marker.castShadows = false;
        marker.receiveShadows = false;
        lamps.push({ light, marker, phase: slot * 0.37, baseAmount, colorIndex });
    }

    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: 1536,
        maxLights: MAX_LIGHTS + 1,
        maxLightsPerCluster: MAX_LIGHTS,
        maxLightIndices: 2_097_152,
        tileSize: 32,
        zSlices: 24,
        maxViewportWidth: testMode ? 960 : MAX_WIDTH,
        maxViewportHeight: testMode ? 600 : MAX_HEIGHT,
        hiZ: true,
        temporalAA: { renderScale: testMode ? 0.65 : 0.9, historyWeight: 0.9, sharpness: 0.16 },
        groundTruthAmbientOcclusion: {
            resolutionScale: testMode ? 0.25 : 0.5,
            radius: 0.85,
            directionCount: 4,
            stepCount: 4,
            power: 0.9
        },
        bloomStrength: 0.12,
        exposure: 1.12
    });
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / Math.max(innerHeight, 1),
        fov: 43,
        near: 0.1,
        far: 70,
        depthMode: 'reversed'
    });
    element('#loadingDetail', HTMLElement).textContent =
        '正在编译 Forward+ 灯光分簇与环境遮蔽管线…';
    const stage = await Hilo3d.Stage.create<'webgpu'>({
        backend: 'webgpu',
        container,
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: pixelRatio(),
        antialias: false,
        alpha: false,
        useInstanced: true,
        renderingProfile: 'high-end',
        clearColor: new Hilo3d.Color(0.012, 0.022, 0.038),
        renderPipeline: factory
    });
    stage.canvas.setAttribute(
        'aria-label',
        '光之庭：192 盏实时灯光照亮环形展庭与树脂雕塑，可拖动旋转视角'
    );
    scene.addTo(stage);
    new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.46, 0.58, 0.68), amount: 0.34 }).addTo(
        stage
    );
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.85, 0.65),
        amount: 1.65,
        direction: new Hilo3d.Vector3(-0.5, -1, -0.35),
        shadow: {
            width: 2048,
            height: 2048,
            cascadeMaxDistance: 40,
            minBias: 0.002,
            maxBias: 0.012,
            shadowStrength: 0.85
        }
    }).addTo(stage);
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: new Hilo3d.Vector3(0, 2.25, 0),
        enablePan: true,
        minDistance: 6,
        maxDistance: 34,
        minPolarAngle: 0.2,
        maxPolarAngle: Math.PI * 0.49,
        rotateSpeed: 0.55,
        zoomSpeed: 0.75,
        panSpeed: 0.6
    });
    const views = [
        [5.8, 7.4, 18.3],
        [-8, 6.8, 14.8],
        [1.8, 13.8, 16],
        [2.8, 5.3, 9.2]
    ] as const;
    let view = 0;
    function showView(): void {
        const position = views[view];
        if (position === undefined) throw new Error('Missing gallery view');
        const portraitScale = Math.max(1, Math.min(1.6, 0.95 / camera.aspect));
        controls.setView(
            new Hilo3d.Vector3(
                position[0] * portraitScale,
                position[1] * portraitScale,
                position[2] * portraitScale
            ),
            new Hilo3d.Vector3(0, 2.15, -0.35)
        );
    }
    showView();
    let activeLights = 144;
    let intensity = 1;
    let palette: PaletteName = 'nocturne';
    let elapsed = 0;
    let motionEnabled = !testMode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    function updateLamps(syncControls = true): void {
        for (const [index, lamp] of lamps.entries()) {
            lamp.light.enabled = index < activeLights;
            lamp.marker.visible = index < activeLights;
            lamp.light.amount =
                intensity * lamp.baseAmount * (1 + Math.sin(elapsed * 1.15 + lamp.phase) * 0.32);
        }
        for (const head of movingHeads) {
            const phase = elapsed * 0.5 + head.phase;
            head.target.set(
                Math.sin(phase) * 2.4,
                0.45 + (Math.sin(phase * 0.83 + head.phase * 0.5) + 1) * 1.7,
                Math.cos(phase * 1.13 + head.phase) * 2.1
            );
            head.light.direction
                .set(
                    head.target.x - head.light.x,
                    head.target.y - head.light.y,
                    head.target.z - head.light.z
                )
                .normalize();
            head.node.lookAt(head.target);
        }
        if (!syncControls) return;
        metricLights.textContent = String(activeLights);
        lightOutput.value = String(activeLights);
        intensityOutput.value = `${String(Math.round(intensity * 100))}%`;
        document.body.dataset['activeLights'] = String(activeLights);
        document.body.dataset['lightMotion'] = String(motionEnabled);
        motionToggle.setAttribute('aria-pressed', String(motionEnabled));
    }
    function changePalette(value: PaletteName): void {
        palette = value;
        for (const [index, material] of lampMaterials.entries()) {
            const color = palettes[value][index];
            if (color === undefined) throw new Error('Missing light color');
            material.baseColor.set(...color, 1);
            material.emissionFactor.set(color[0] * 2.6, color[1] * 2.6, color[2] * 2.6, 1);
            material.invalidateData();
        }
        for (const lamp of lamps) {
            const color = palettes[value][lamp.colorIndex];
            if (color !== undefined) lamp.light.color.set(...color, 1);
        }
        for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-palette]')) {
            button.setAttribute('aria-pressed', String(button.dataset['palette'] === value));
        }
        document.body.dataset['palette'] = value;
    }
    lightControl.addEventListener('input', () => {
        activeLights = Math.min(
            MAX_LIGHTS,
            Math.max(0, Math.round(Number(lightControl.value) / 24) * 24)
        );
        updateLamps();
    });
    intensityControl.addEventListener('input', () => {
        intensity = Number(intensityControl.value) / 100;
        updateLamps();
    });
    motionToggle.addEventListener('click', () => {
        motionEnabled = !motionEnabled;
        updateLamps();
    });
    element('#viewButton', HTMLButtonElement).addEventListener('click', () => {
        view = (view + 1) % views.length;
        showView();
    });
    diagnosticsToggle.addEventListener('click', () => {
        const panel = element('#diagnosticsPanel', HTMLElement);
        panel.hidden = !panel.hidden;
        diagnosticsToggle.setAttribute('aria-pressed', String(!panel.hidden));
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-palette]')) {
        button.addEventListener('click', () => {
            const value = button.dataset['palette'];
            if (value === 'nocturne' || value === 'ember' || value === 'spectrum')
                changePalette(value);
        });
    }
    const ticker = new Hilo3d.Ticker(60);
    const animation: Hilo3d.Tickable = {
        tick(deltaTime): void {
            if (!motionEnabled) return;
            elapsed += Math.min(deltaTime, 50) / 1000;
            updateLamps(false);
        }
    };
    ticker.addTick(animation);
    ticker.addTick(stage);
    let disposed = false;
    async function evidence(): Promise<LumenEvidence> {
        const data = await factory.readDiagnostics();
        metricLinks.textContent = data.clusterLightIndexCount.toLocaleString('en-US');
        metricVisible.textContent = `${String(data.visibleObjectCount)} / ${String(data.objectCount)}`;
        metricOverflow.textContent = String(data.clusterOverflowCount);
        metricFps.textContent = testMode ? '—' : String(ticker.getMeasuredFPS());
        return {
            backend: 'webgpu',
            activeLights,
            lightCount: data.lightCount,
            objectCount: data.objectCount,
            visibleObjectCount: data.visibleObjectCount,
            fallbackObjectCount: data.fallbackObjectCount,
            clusterLightIndexCount: data.clusterLightIndexCount,
            clusterOverflowCount: data.clusterOverflowCount,
            droppedLightCount: data.droppedLightCount,
            motionEnabled,
            palette,
            intensity,
            elapsed,
            movingLightCount: movingHeads.length,
            lightDirectionChecksum: movingHeads.reduce(
                (sum, head, index) =>
                    sum +
                    (index + 1) *
                        (head.light.direction.x * 13 +
                            head.light.direction.y * 7 +
                            head.light.direction.z * 3),
                0
            )
        };
    }
    async function settle(frames = 6): Promise<LumenEvidence> {
        for (let frame = 0; frame < frames; frame++) {
            if (testMode) animation.tick(1000 / 60);
            stage.tick(1000 / 60);
            await stage.renderer.waitForIdle();
        }
        return evidence();
    }
    let diagnosticsPending = false;
    const diagnosticTick = ticker.interval(() => {
        if (diagnosticsPending || disposed) return;
        diagnosticsPending = true;
        void evidence()
            .catch((error: unknown) => {
                if (!disposed) showFailure(error);
            })
            .finally(() => {
                diagnosticsPending = false;
            });
    }, 1500);
    const resize = (): void => {
        camera.aspect = innerWidth / Math.max(innerHeight, 1);
        stage.resize(Math.max(innerWidth, 1), Math.max(innerHeight, 1), pixelRatio());
    };
    window.addEventListener('resize', resize);
    stopScene = (): void => {
        disposed = true;
        ticker.removeTick(diagnosticTick);
        ticker.stop();
        controls.dispose();
        window.removeEventListener('resize', resize);
    };
    window.addEventListener(
        'pagehide',
        () => {
            stopScene?.();
            // Allow an outstanding diagnostic fence to settle before releasing the device.
            void stage.renderer
                .waitForIdle()
                .then(() => stage.destroy())
                .catch(() => stage.destroy());
        },
        { once: true }
    );
    updateLamps();
    changePalette('nocturne');
    await settle(4);
    window.__HILO3D_LUMEN_TEST_API__ = { settle };
    fieldset.disabled = false;
    loading.hidden = true;
    document.body.dataset['lumenReady'] = 'true';
    if (!testMode) ticker.start();
}

function showFailure(error: unknown): void {
    stopScene?.();
    const failure = error instanceof Error ? error : new Error(String(error));
    document.body.dataset['lumenReady'] = 'error';
    element('#loadingPanel', HTMLElement).hidden = false;
    element('#loadingPanel', HTMLElement).dataset['state'] = 'error';
    element('#loadingTitle', HTMLElement).textContent = '暂时无法点亮展庭';
    element('#loadingDetail', HTMLElement).textContent = failure.message;
    element('#controlsFieldset', HTMLFieldSetElement).disabled = true;
    console.error(failure);
}

declare global {
    interface Window {
        __HILO3D_LUMEN_TEST_API__?: Readonly<{ settle(frames?: number): Promise<LumenEvidence> }>;
    }
}

void run().catch(showFailure);
