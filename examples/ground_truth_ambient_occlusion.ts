import * as Hilo3d from '../src/Hilo3d';
import { buildUrl, createExampleContext } from './shared/init';
import { createStudioEnvironmentMaps } from './shared/studioEnvironment';

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
let gtaoEnabled = search.get('gtao') !== 'false';
const mobileLayout = matchMedia('(max-width: 760px)');
const BACKEND_LABELS = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
}) satisfies Readonly<Record<Hilo3d.RendererBackend, string>>;

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`The Silent Dragon is missing ${selector}`);
    return element;
}

function createArchCrownGeometry(segments = 48): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const texcoords: number[] = [];
    const indices: number[] = [];
    const innerRadius = 0.92;
    const outerRadius = 1.48;
    const halfDepth = 0.2;

    const addVertex = (
        x: number,
        y: number,
        z: number,
        normalX: number,
        normalY: number,
        normalZ: number,
        u: number,
        v: number
    ): number => {
        const index = positions.length / 3;
        positions.push(x, y, z);
        normals.push(normalX, normalY, normalZ);
        texcoords.push(u, v);
        return index;
    };
    const addQuad = (a: number, b: number, c: number, d: number): void => {
        indices.push(a, b, c, a, c, d);
    };

    for (let segment = 0; segment < segments; segment += 1) {
        const u0 = segment / segments;
        const u1 = (segment + 1) / segments;
        const angle0 = u0 * Math.PI;
        const angle1 = u1 * Math.PI;
        const cosine0 = Math.cos(angle0);
        const sine0 = Math.sin(angle0);
        const cosine1 = Math.cos(angle1);
        const sine1 = Math.sin(angle1);

        const frontOuter0 = addVertex(
            cosine0 * outerRadius,
            sine0 * outerRadius,
            halfDepth,
            0,
            0,
            1,
            u0,
            0
        );
        const frontInner0 = addVertex(
            cosine0 * innerRadius,
            sine0 * innerRadius,
            halfDepth,
            0,
            0,
            1,
            u0,
            1
        );
        const frontInner1 = addVertex(
            cosine1 * innerRadius,
            sine1 * innerRadius,
            halfDepth,
            0,
            0,
            1,
            u1,
            1
        );
        const frontOuter1 = addVertex(
            cosine1 * outerRadius,
            sine1 * outerRadius,
            halfDepth,
            0,
            0,
            1,
            u1,
            0
        );
        addQuad(frontOuter0, frontOuter1, frontInner1, frontInner0);

        const backOuter0 = addVertex(
            cosine0 * outerRadius,
            sine0 * outerRadius,
            -halfDepth,
            0,
            0,
            -1,
            u0,
            0
        );
        const backOuter1 = addVertex(
            cosine1 * outerRadius,
            sine1 * outerRadius,
            -halfDepth,
            0,
            0,
            -1,
            u1,
            0
        );
        const backInner1 = addVertex(
            cosine1 * innerRadius,
            sine1 * innerRadius,
            -halfDepth,
            0,
            0,
            -1,
            u1,
            1
        );
        const backInner0 = addVertex(
            cosine0 * innerRadius,
            sine0 * innerRadius,
            -halfDepth,
            0,
            0,
            -1,
            u0,
            1
        );
        addQuad(backOuter0, backInner0, backInner1, backOuter1);

        const outer0Front = addVertex(
            cosine0 * outerRadius,
            sine0 * outerRadius,
            halfDepth,
            cosine0,
            sine0,
            0,
            u0,
            0
        );
        const outer1Front = addVertex(
            cosine1 * outerRadius,
            sine1 * outerRadius,
            halfDepth,
            cosine1,
            sine1,
            0,
            u1,
            0
        );
        const outer1Back = addVertex(
            cosine1 * outerRadius,
            sine1 * outerRadius,
            -halfDepth,
            cosine1,
            sine1,
            0,
            u1,
            1
        );
        const outer0Back = addVertex(
            cosine0 * outerRadius,
            sine0 * outerRadius,
            -halfDepth,
            cosine0,
            sine0,
            0,
            u0,
            1
        );
        addQuad(outer0Front, outer1Front, outer1Back, outer0Back);

        const inner0Front = addVertex(
            cosine0 * innerRadius,
            sine0 * innerRadius,
            halfDepth,
            -cosine0,
            -sine0,
            0,
            u0,
            0
        );
        const inner0Back = addVertex(
            cosine0 * innerRadius,
            sine0 * innerRadius,
            -halfDepth,
            -cosine0,
            -sine0,
            0,
            u0,
            1
        );
        const inner1Back = addVertex(
            cosine1 * innerRadius,
            sine1 * innerRadius,
            -halfDepth,
            -cosine1,
            -sine1,
            0,
            u1,
            1
        );
        const inner1Front = addVertex(
            cosine1 * innerRadius,
            sine1 * innerRadius,
            halfDepth,
            -cosine1,
            -sine1,
            0,
            u1,
            0
        );
        addQuad(inner0Front, inner0Back, inner1Back, inner1Front);
    }

    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(texcoords), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function createArchOpeningGeometry(segments = 48): Hilo3d.Geometry {
    const radius = 1.15;
    const bottom = -1.55;
    const positions: number[] = [0, 0, 0];
    const normals: number[] = [0, 0, 1];
    const indices: number[] = [];
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI;
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        normals.push(0, 0, 1);
        if (segment > 0) indices.push(0, segment, segment + 1);
    }
    const rectangleStart = positions.length / 3;
    positions.push(-radius, bottom, 0, radius, bottom, 0, radius, 0, 0, -radius, 0, 0);
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    indices.push(
        rectangleStart,
        rectangleStart + 1,
        rectangleStart + 2,
        rectangleStart,
        rectangleStart + 2,
        rectangleStart + 3
    );
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function createCylinderGeometry(radius: number, height: number, segments = 64): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const halfHeight = height * 0.5;

    const topCenter = positions.length / 3;
    positions.push(0, halfHeight, 0);
    normals.push(0, 1, 0);
    const bottomCenter = positions.length / 3;
    positions.push(0, -halfHeight, 0);
    normals.push(0, -1, 0);

    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        positions.push(x, halfHeight, z, x, -halfHeight, z);
        normals.push(0, 1, 0, 0, -1, 0);
    }
    for (let segment = 0; segment < segments; segment += 1) {
        const top0 = 2 + segment * 2;
        const bottom0 = top0 + 1;
        const top1 = top0 + 2;
        const bottom1 = bottom0 + 2;
        indices.push(topCenter, top1, top0, bottomCenter, bottom0, bottom1);
    }

    const sideStart = positions.length / 3;
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        positions.push(cosine * radius, halfHeight, sine * radius);
        normals.push(cosine, 0, sine);
        positions.push(cosine * radius, -halfHeight, sine * radius);
        normals.push(cosine, 0, sine);
    }
    for (let segment = 0; segment < segments; segment += 1) {
        const top0 = sideStart + segment * 2;
        const bottom0 = top0 + 1;
        const top1 = top0 + 2;
        const bottom1 = bottom0 + 2;
        indices.push(top0, top1, bottom1, top0, bottom1, bottom0);
    }

    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

const { diffuseEnvMap, specularEnvMap } = createStudioEnvironmentMaps();
const brdfLUT = await new Hilo3d.TextureLoader().load({
    src: new URL('./image/brdfLUT.png', import.meta.url).href,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const environment = Object.freeze({
    brdfLUT,
    diffuseEnvMap: Object.freeze({ texture: diffuseEnvMap, encoding: 'srgb' as const }),
    specularEnvMap: Object.freeze({ texture: specularEnvMap, encoding: 'srgb' as const }),
    diffuseEnvIntensity: 1.32,
    specularEnvIntensity: 0.3
});
const createMuseumMaterial = (
    color: Readonly<[number, number, number]>,
    roughness: number,
    metallic = 0
): Hilo3d.PBRMaterial =>
    new Hilo3d.PBRMaterial({
        ...environment,
        baseColor: new Hilo3d.Color(color[0], color[1], color[2]),
        metallic,
        roughness
    });

const earthenPlaster = createMuseumMaterial([0.48, 0.19, 0.12], 0.96);
const travertine = createMuseumMaterial([0.76, 0.61, 0.46], 0.92);
const warmIvory = createMuseumMaterial([0.89, 0.77, 0.6], 0.84);
const dragonClay = createMuseumMaterial([0.9, 0.57, 0.31], 0.82);
const oxblood = createMuseumMaterial([0.095, 0.025, 0.022], 0.9);
const bronzeLine = createMuseumMaterial([0.53, 0.27, 0.1], 0.54, 0.22);

class ToggleableGroundTruthAmbientOcclusion implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'ground-truth-ambient-occlusion';
    readonly injectionPoint = 'before-opaque' as const;
    readonly requirements: Readonly<Hilo3d.ForwardRenderFeatureRequirements>;
    readonly #feature: Hilo3d.GroundTruthAmbientOcclusion;
    enabled: boolean;

    constructor(enabled: boolean, options: Readonly<Hilo3d.GroundTruthAmbientOcclusionOptions>) {
        this.enabled = enabled;
        this.#feature = new Hilo3d.GroundTruthAmbientOcclusion(options);
        this.requirements = this.#feature.requirements;
    }

    create(
        _context: Hilo3d.RenderPipelineCreateContext
    ): Hilo3d.ForwardRenderPipelineFeatureRuntime {
        const runtime = this.#feature.create();
        return {
            record: (featureContext: Hilo3d.ForwardRenderFeatureContext): unknown =>
                this.enabled ? runtime.record(featureContext) : undefined,
            frameSubmitted(frameIndex: number): void {
                runtime.frameSubmitted?.(frameIndex);
            },
            frameDiscarded(frameIndex: number): void {
                runtime.frameDiscarded?.(frameIndex);
            },
            destroy(): void {
                runtime.destroy();
            }
        };
    }
}

const gtao = new ToggleableGroundTruthAmbientOcclusion(gtaoEnabled, {
    quality: testMode ? 'medium' : 'ultra',
    resolutionScale: testMode ? 0.5 : 0.7,
    radius: 1.12,
    falloffStart: 0.66,
    thickness: 0.045,
    thicknessBlend: 0.58,
    directionCount: testMode ? 3 : 6,
    stepCount: testMode ? 5 : 8,
    intensity: 1.06,
    power: 1.18,
    bias: 0.03,
    contactRadiusScale: 0.18,
    contactStrength: 0.3,
    normalSource: 'hybrid',
    geometricNormalWeight: 0.64,
    bentNormalStrength: 0.94,
    multiBounce: 0.92,
    distanceFadeStart: 36,
    distanceFadeEnd: 54,
    historyWeight: 0.9,
    depthThreshold: 0.025,
    normalThreshold: 0.84
});

const pipeline = new Hilo3d.PostProcessRenderPipelineFactory({
    groundTruthAmbientOcclusion: false,
    bloom: {
        threshold: 1.45,
        knee: 0.38,
        intensity: 0.045,
        scatter: 0.55,
        maxLevels: 6
    },
    colorUber: {
        toneMapping: 'pbr-neutral',
        exposure: 0.14,
        contrast: 0.075,
        saturation: -0.055,
        temperature: 0.018,
        vignetteIntensity: 0.18,
        vignetteSmoothness: 0.82,
        vignetteColor: new Hilo3d.Color(0.035, 0.012, 0.009, 0.3)
    },
    features: [gtao]
});

const desktopCameraPosition = new Hilo3d.Vector3(7.85, 3.05, 9.05);
const mobileCameraPosition = new Hilo3d.Vector3(11.2, 4.65, 16.4);
const viewTarget = new Hilo3d.Vector3(1.55, 0.18, -4.62);
const initialCameraPosition = mobileLayout.matches ? mobileCameraPosition : desktopCameraPosition;

const { stage, renderer, directionLight, ambientLight, orbitControls } = await createExampleContext(
    {
        camera: {
            fov: 32,
            near: 0.05,
            far: 60,
            x: initialCameraPosition.x,
            y: initialCameraPosition.y,
            z: initialCameraPosition.z
        },
        stage: {
            pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
            clearColor: new Hilo3d.Color(0.032, 0.012, 0.011),
            renderPipeline: pipeline
        },
        controls: {
            target: viewTarget,
            enablePan: false,
            minDistance: 9,
            maxDistance: 32,
            minPolarAngle: Math.PI * 0.25,
            maxPolarAngle: Math.PI * 0.5,
            rotateSpeed: 0.38,
            zoomSpeed: 0.55
        }
    }
);

renderer.clearColor.set(0.032, 0.012, 0.011, 1);
directionLight.amount = 0.42;
directionLight.color.set(1, 0.79, 0.63, 1);
directionLight.direction.set(-0.58, -0.82, -0.38);
ambientLight.amount = 1.58;
ambientLight.color.set(0.72, 0.63, 0.58, 1);

const addBox = (
    width: number,
    height: number,
    depth: number,
    material: Hilo3d.PBRMaterial,
    x: number,
    y: number,
    z: number
): Hilo3d.Mesh =>
    new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry({ width, height, depth }),
        material,
        x,
        y,
        z,
        pointerEnabled: false,
        frustumTest: false
    }).addTo(stage);

addBox(28, 0.32, 25, travertine, 0.5, -1.66, -3.7);
addBox(24, 11, 0.48, earthenPlaster, 0.5, 3.7, -7.2);
addBox(0.44, 11, 14, earthenPlaster, -6.2, 3.7, -1.9);

const archCenterX = 2.05;
const archCenterY = 0.72;
const archScale = 2.45;
new Hilo3d.Mesh({
    geometry: createArchOpeningGeometry(),
    material: oxblood,
    x: archCenterX,
    y: archCenterY,
    z: -6.9,
    pointerEnabled: false,
    frustumTest: false
})
    .setScale(archScale)
    .addTo(stage);
addBox(1.38, 2.34, 0.62, warmIvory, archCenterX - 2.94, -0.45, -6.5);
addBox(1.38, 2.34, 0.62, warmIvory, archCenterX + 2.94, -0.45, -6.5);
const archCrown = new Hilo3d.Mesh({
    geometry: createArchCrownGeometry(),
    material: warmIvory,
    x: archCenterX,
    y: archCenterY,
    z: -6.48,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
archCrown.setScale(archScale);

const addPlinth = (
    radius: number,
    height: number,
    material: Hilo3d.PBRMaterial,
    y: number,
    z: number
): Hilo3d.Mesh =>
    new Hilo3d.Mesh({
        geometry: createCylinderGeometry(radius, height),
        material,
        x: archCenterX,
        y,
        z,
        pointerEnabled: false,
        frustumTest: false
    }).addTo(stage);

addPlinth(3.05, 0.3, travertine, -1.36, -4.88);
addPlinth(2.68, 0.3, warmIvory, -1.06, -4.93);
addPlinth(2.28, 0.38, bronzeLine, -0.72, -4.96);
addPlinth(2.14, 0.24, warmIvory, -0.43, -4.98);

const dragonModel = await new Hilo3d.GLTFLoader().load({
    // Keep the external dragon.bin URI adjacent to its glTF in production builds. Resolving
    // against import.meta.url would make Vite emit only the JSON into the hashed assets directory.
    src: new URL('./models/dragon/dragon.gltf', location.href).href,
    pbrMaterialDefaults: environment
});
await dragonModel.ready;
for (const mesh of dragonModel.meshes) {
    mesh.material = dragonClay;
    mesh.pointerEnabled = false;
    mesh.frustumTest = false;
}
dragonModel.node.setScale(0.335);
dragonModel.node.setPosition(archCenterX, -0.31, -4.98);
dragonModel.node.rotationY = 18;
stage.addChild(dragonModel.node);

new Hilo3d.PointLight({
    x: 4.8,
    y: 4.6,
    z: 0.5,
    amount: 1.35,
    range: 14,
    color: new Hilo3d.Color(1, 0.48, 0.24)
}).addTo(stage);
new Hilo3d.PointLight({
    x: -3.8,
    y: 3.3,
    z: 1.5,
    amount: 0.85,
    range: 15,
    color: new Hilo3d.Color(0.35, 0.47, 0.72)
}).addTo(stage);

const toggle = requireElement('#gtaoToggle');
const toggleLabel = requireElement('#gtaoToggleLabel');
const backendLabel = requireElement('#backendLabel');
const searchLabel = requireElement('#gtaoSearchLabel');
toggle.setAttribute('aria-pressed', String(gtaoEnabled));
toggleLabel.textContent = gtaoEnabled ? 'GTAO on' : 'GTAO off';
backendLabel.textContent = BACKEND_LABELS[renderer.backend];
searchLabel.textContent = testMode ? '3 × 5' : '6 × 8';
toggle.addEventListener('click', () => {
    gtaoEnabled = !gtaoEnabled;
    gtao.enabled = gtaoEnabled;
    toggle.setAttribute('aria-pressed', String(gtaoEnabled));
    toggleLabel.textContent = gtaoEnabled ? 'GTAO on' : 'GTAO off';
    document.body.dataset['gtao'] = gtaoEnabled ? 'enabled' : 'disabled';
    history.replaceState(history.state, '', buildUrl(location.href, { gtao: gtaoEnabled }));
});
mobileLayout.addEventListener('change', event => {
    orbitControls.setView(event.matches ? mobileCameraPosition : desktopCameraPosition, viewTarget);
});

document.body.dataset['gtao'] = gtaoEnabled ? 'enabled' : 'disabled';
document.body.dataset['backend'] = renderer.backend;
document.body.dataset['gtaoPhase'] = 'ready';
orbitControls.setView(initialCameraPosition, viewTarget);
