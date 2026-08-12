import * as Hilo3d from '../src/Hilo3d';
import { buildUrl, createExampleContext } from './shared/init';

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const gtaoEnabled = search.get('gtao') !== 'false';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`Quiet Arches is missing ${selector}`);
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
        addQuad(frontOuter0, frontInner0, frontInner1, frontOuter1);

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
        addQuad(backOuter0, backOuter1, backInner1, backInner0);

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

const plaster = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.73, 0.56, 0.4),
    metallic: 0,
    roughness: 0.88
});
const palePlaster = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.9, 0.79, 0.62),
    metallic: 0,
    roughness: 0.82
});
const darkPlaster = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.055, 0.07, 0.08),
    metallic: 0.08,
    roughness: 0.74
});
const lapis = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.16, 0.3),
    metallic: 0.18,
    roughness: 0.32
});
const brass = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.71, 0.42, 0.12),
    metallic: 0.86,
    roughness: 0.24
});
const coral = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.72, 0.16, 0.09),
    metallic: 0.05,
    roughness: 0.48
});

const pipeline = new Hilo3d.PostProcessRenderPipelineFactory({
    groundTruthAmbientOcclusion: gtaoEnabled
        ? {
              resolutionScale: testMode ? 0.5 : 0.62,
              radius: 2.2,
              falloffStart: 0.58,
              thickness: 0.06,
              directionCount: testMode ? 4 : 6,
              stepCount: testMode ? 3 : 5,
              power: 1.24,
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
        exposure: -0.28,
        contrast: 0.08,
        saturation: -0.04,
        temperature: 0.035,
        vignetteIntensity: 0.34,
        vignetteSmoothness: 0.7,
        vignetteColor: new Hilo3d.Color(0.025, 0.018, 0.012, 0.42)
    }
});

const { stage, renderer, camera, directionLight, ambientLight, orbitControls } =
    await createExampleContext({
        camera: { fov: 38, near: 0.05, far: 50, x: 7.4, y: 3.8, z: 9.4 },
        stage: {
            pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
            clearColor: new Hilo3d.Color(0.045, 0.035, 0.026),
            renderPipeline: pipeline
        },
        controls: {
            target: new Hilo3d.Vector3(0, 0.05, -2.6),
            enablePan: false,
            minDistance: 8.5,
            maxDistance: 16,
            minPolarAngle: Math.PI * 0.25,
            maxPolarAngle: Math.PI * 0.48,
            rotateSpeed: 0.38,
            zoomSpeed: 0.55
        }
    });

renderer.clearColor.set(0.045, 0.035, 0.026, 1);
directionLight.amount = 2.1;
directionLight.color.set(1, 0.78, 0.56, 1);
directionLight.direction.set(-0.42, -0.86, -0.3);
ambientLight.amount = 0.72;
ambientLight.color.set(0.48, 0.58, 0.68, 1);

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

addBox(15, 0.3, 15, plaster, 0, -1.55, -2.2);
addBox(12.5, 6.2, 0.4, plaster, 0, 1.35, -6.15);
addBox(0.42, 6.2, 8.5, plaster, -6.05, 1.35, -2.1);
addBox(3.5, 3.4, 0.18, darkPlaster, 2.45, 0.12, -5.9);

const archCenterX = 2.45;
const archCenterY = 0.12;
addBox(0.56, 1.62, 0.4, palePlaster, archCenterX - 1.2, -0.69, -5.66);
addBox(0.56, 1.62, 0.4, palePlaster, archCenterX + 1.2, -0.69, -5.66);
new Hilo3d.Mesh({
    geometry: createArchCrownGeometry(),
    material: palePlaster,
    x: archCenterX,
    y: archCenterY,
    z: -5.66,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);

for (let index = 0; index < 6; index += 1) {
    addBox(
        0.12,
        4.6 - index * 0.18,
        0.34,
        index % 2 === 0 ? palePlaster : plaster,
        -5.55 + index * 0.42,
        0.48,
        -5.72
    );
}

addBox(4.7, 0.34, 3.4, plaster, -1.15, -1.24, -2.7);
addBox(3.85, 0.38, 2.65, palePlaster, -1.15, -0.88, -2.86);
addBox(2.9, 0.42, 1.92, plaster, -1.15, -0.49, -3.02);
addBox(1.45, 0.52, 1.15, darkPlaster, -1.15, -0.03, -3.12);

const sculptureRoot = new Hilo3d.Node({ x: -1.15, y: 0.62, z: -3.1 }).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.72, widthSegments: 40, heightSegments: 24 }),
    material: lapis,
    y: 0.08,
    pointerEnabled: false,
    frustumTest: false
}).addTo(sculptureRoot);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.31, widthSegments: 28, heightSegments: 16 }),
    material: brass,
    x: 0.58,
    y: 0.54,
    z: 0.08,
    pointerEnabled: false,
    frustumTest: false
}).addTo(sculptureRoot);
addBox(0.2, 2.4, 0.2, brass, -0.38, 0.42, -3.13).rotationZ = -16;

addBox(3.25, 0.18, 1.28, darkPlaster, 3.55, 0.72, -2.15);
addBox(0.22, 2.25, 0.22, darkPlaster, 2.24, -0.32, -2.15);
addBox(0.22, 2.25, 0.22, darkPlaster, 4.86, -0.32, -2.15);
const clusterGeometry = new Hilo3d.SphereGeometry({
    radius: 0.34,
    widthSegments: 26,
    heightSegments: 16
});
const clusterPlan = [
    [3.0, -1.03, -2.18, 0.42],
    [3.62, -1.1, -2.04, 0.35],
    [4.18, -1.0, -2.25, 0.45],
    [3.42, -0.62, -2.25, 0.3]
] as const;
for (let index = 0; index < clusterPlan.length; index += 1) {
    const [x, y, z, scale] = clusterPlan[index] ?? [0, 0, 0, 1];
    const sphere = new Hilo3d.Mesh({
        geometry: clusterGeometry,
        material: index === 2 ? coral : index === 1 ? brass : lapis,
        x,
        y,
        z,
        pointerEnabled: false,
        frustumTest: false
    }).addTo(stage);
    sphere.setScale(scale / 0.34);
}

new Hilo3d.PointLight({
    x: 4.2,
    y: 3.3,
    z: 0.8,
    amount: 10,
    range: 11,
    color: new Hilo3d.Color(1, 0.42, 0.2)
}).addTo(stage);
new Hilo3d.PointLight({
    x: -3.8,
    y: 2.4,
    z: 1.8,
    amount: 8,
    range: 12,
    color: new Hilo3d.Color(0.22, 0.46, 1)
}).addTo(stage);

if (!testMode && !reducedMotion) {
    sculptureRoot.onUpdate = deltaTime => {
        sculptureRoot.rotationY += deltaTime * 0.0045;
    };
}

const toggle = requireElement('#gtaoToggle');
const toggleLabel = requireElement('#gtaoToggleLabel');
const backendLabel = requireElement('#backendLabel');
toggle.setAttribute('aria-pressed', String(gtaoEnabled));
toggleLabel.textContent = gtaoEnabled ? 'GTAO on' : 'GTAO off';
backendLabel.textContent = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
toggle.addEventListener('click', () => {
    location.href = buildUrl(location.href, { gtao: !gtaoEnabled });
});

document.body.dataset['gtao'] = gtaoEnabled ? 'enabled' : 'disabled';
document.body.dataset['backend'] = renderer.backend;
document.body.dataset['gtaoPhase'] = 'ready';
orbitControls.setView(camera.position, new Hilo3d.Vector3(0, 0.05, -2.6));
