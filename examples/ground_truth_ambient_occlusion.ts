import * as Hilo3d from '../src/Hilo3d';
import { buildUrl, createExampleContext } from './shared/init';
import { createStudioEnvironmentMaps } from './shared/studioEnvironment';

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const gtaoEnabled = search.get('gtao') !== 'false';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BACKEND_LABELS = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
}) satisfies Readonly<Record<Hilo3d.RendererBackend, string>>;

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`Contact Gallery is missing ${selector}`);
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
    diffuseEnvIntensity: 0.82,
    specularEnvIntensity: 0.58
});
const createGalleryMaterial = (
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

const limestone = createGalleryMaterial([0.76, 0.62, 0.47], 0.9);
const chalk = createGalleryMaterial([0.94, 0.85, 0.7], 0.86);
const roseClay = createGalleryMaterial([0.72, 0.3, 0.2], 0.72);
const seaGlass = createGalleryMaterial([0.08, 0.32, 0.43], 0.48, 0.08);
const sage = createGalleryMaterial([0.34, 0.43, 0.35], 0.8);
const bronze = createGalleryMaterial([0.63, 0.36, 0.13], 0.38, 0.52);
const graphite = createGalleryMaterial([0.13, 0.15, 0.15], 0.68, 0.06);

const pipeline = new Hilo3d.PostProcessRenderPipelineFactory({
    groundTruthAmbientOcclusion: gtaoEnabled
        ? {
              resolutionScale: testMode ? 0.5 : 0.7,
              radius: 3.4,
              falloffStart: 0.28,
              thickness: 0.14,
              directionCount: testMode ? 4 : 8,
              stepCount: testMode ? 3 : 5,
              power: 3.2,
              historyWeight: 0.9,
              depthThreshold: 0.025
          }
        : false,
    bloom: {
        threshold: 1.25,
        knee: 0.45,
        intensity: 0.09,
        scatter: 0.55,
        maxLevels: 6
    },
    colorUber: {
        toneMapping: 'pbr-neutral',
        exposure: 0.08,
        contrast: 0.1,
        saturation: -0.03,
        temperature: 0.012,
        vignetteIntensity: 0.22,
        vignetteSmoothness: 0.78,
        vignetteColor: new Hilo3d.Color(0.018, 0.022, 0.024, 0.32)
    }
});

const { stage, renderer, camera, directionLight, ambientLight, orbitControls } =
    await createExampleContext({
        camera: { fov: 34, near: 0.05, far: 50, x: 7.6, y: 3.65, z: 11.8 },
        stage: {
            pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
            clearColor: new Hilo3d.Color(0.025, 0.031, 0.032),
            renderPipeline: pipeline
        },
        controls: {
            target: new Hilo3d.Vector3(0.6, -0.05, -3.1),
            enablePan: false,
            minDistance: 9,
            maxDistance: 18,
            minPolarAngle: Math.PI * 0.25,
            maxPolarAngle: Math.PI * 0.5,
            rotateSpeed: 0.38,
            zoomSpeed: 0.55
        }
    });

renderer.clearColor.set(0.025, 0.031, 0.032, 1);
directionLight.amount = 0.92;
directionLight.color.set(1, 0.86, 0.72, 1);
directionLight.direction.set(-0.5, -0.9, -0.28);
ambientLight.amount = 1.65;
ambientLight.color.set(0.56, 0.66, 0.74, 1);

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

addBox(28, 0.28, 25, limestone, 0.5, -1.58, -3.5);
addBox(24, 10, 0.42, limestone, 0.5, 3, -6.3);
addBox(0.38, 10, 13, chalk, -6.15, 3, -1.8);

const archCenterX = 2.35;
const archCenterY = 0.18;
new Hilo3d.Mesh({
    geometry: createArchOpeningGeometry(),
    material: graphite,
    x: archCenterX,
    y: archCenterY,
    z: -5.92,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
addBox(0.72, 1.86, 0.52, chalk, archCenterX - 1.5, -0.75, -5.68);
addBox(0.72, 1.86, 0.52, chalk, archCenterX + 1.5, -0.75, -5.68);
const archCrown = new Hilo3d.Mesh({
    geometry: createArchCrownGeometry(),
    material: chalk,
    x: archCenterX,
    y: archCenterY,
    z: -5.66,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
archCrown.setScale(1.25);

for (let index = 0; index < 7; index += 1) {
    addBox(
        0.16,
        4.9 - index * 0.16,
        0.38,
        index % 3 === 1 ? sage : chalk,
        -5.62 + index * 0.38,
        0.58,
        -5.82
    );
}

addBox(4.8, 0.32, 3.5, limestone, -1.25, -1.26, -2.85);
addBox(4.0, 0.36, 2.75, chalk, -1.25, -0.91, -3.02);
addBox(3.15, 0.4, 2.0, roseClay, -1.25, -0.53, -3.18);
addBox(1.65, 0.46, 1.22, graphite, -1.25, -0.09, -3.28);

const sculptureRoot = new Hilo3d.Node({ x: -1.25, y: 0.66, z: -3.24 }).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.76, widthSegments: 40, heightSegments: 24 }),
    material: seaGlass,
    y: 0.08,
    pointerEnabled: false,
    frustumTest: false
}).addTo(sculptureRoot);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.38, widthSegments: 28, heightSegments: 16 }),
    material: bronze,
    x: 0.66,
    y: 0.52,
    z: 0.06,
    pointerEnabled: false,
    frustumTest: false
}).addTo(sculptureRoot);
addBox(0.22, 2.5, 0.22, bronze, -0.42, 0.44, -3.28).rotationZ = -14;

addBox(3.65, 0.3, 1.8, sage, 3.85, -1.26, -2.55);
addBox(3.0, 0.34, 1.42, chalk, 3.85, -0.93, -2.7);
const clusterGeometry = new Hilo3d.SphereGeometry({
    radius: 0.4,
    widthSegments: 26,
    heightSegments: 16
});
const clusterPlan = [
    [3.12, -0.38, -2.62, 0.54],
    [3.78, -0.46, -2.48, 0.46],
    [4.5, -0.35, -2.68, 0.58],
    [3.55, 0.08, -2.68, 0.39]
] as const;
for (let index = 0; index < clusterPlan.length; index += 1) {
    const [x, y, z, scale] = clusterPlan[index] ?? [0, 0, 0, 1];
    const sphere = new Hilo3d.Mesh({
        geometry: clusterGeometry,
        material: index === 2 ? roseClay : index === 1 ? bronze : seaGlass,
        x,
        y,
        z,
        pointerEnabled: false,
        frustumTest: false
    }).addTo(stage);
    sphere.setScale(scale / 0.4);
}

addBox(2.7, 0.3, 1.1, roseClay, archCenterX, -1.34, -5.15);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.66, widthSegments: 36, heightSegments: 22 }),
    material: sage,
    x: archCenterX - 0.42,
    y: -0.54,
    z: -5.08,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.43, widthSegments: 30, heightSegments: 18 }),
    material: chalk,
    x: archCenterX + 0.52,
    y: -0.78,
    z: -5,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);

new Hilo3d.PointLight({
    x: 4.5,
    y: 3.8,
    z: 1.4,
    amount: 5.5,
    range: 12,
    color: new Hilo3d.Color(1, 0.52, 0.3)
}).addTo(stage);
new Hilo3d.PointLight({
    x: -3.6,
    y: 2.8,
    z: 2.2,
    amount: 4.5,
    range: 13,
    color: new Hilo3d.Color(0.3, 0.58, 1)
}).addTo(stage);

if (!testMode && !reducedMotion) {
    sculptureRoot.onUpdate = deltaTime => {
        sculptureRoot.rotationY += deltaTime * 0.0045;
    };
}

const toggle = requireElement('#gtaoToggle');
const toggleLabel = requireElement('#gtaoToggleLabel');
const backendLabel = requireElement('#backendLabel');
const searchLabel = requireElement('#gtaoSearchLabel');
toggle.setAttribute('aria-pressed', String(gtaoEnabled));
toggleLabel.textContent = gtaoEnabled ? 'GTAO on' : 'GTAO off';
backendLabel.textContent = BACKEND_LABELS[renderer.backend];
searchLabel.textContent = testMode ? '4 × 3' : '8 × 5';
toggle.addEventListener('click', () => {
    location.href = buildUrl(location.href, { gtao: !gtaoEnabled });
});

document.body.dataset['gtao'] = gtaoEnabled ? 'enabled' : 'disabled';
document.body.dataset['backend'] = renderer.backend;
document.body.dataset['gtaoPhase'] = 'ready';
orbitControls.setView(camera.position, new Hilo3d.Vector3(0.6, -0.05, -3.1));
