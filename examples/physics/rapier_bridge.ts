import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem
} from '@hilo/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createBridgeExperiment, type BridgeAnchor } from './bridgeExperiment';
import { createPhysicsExhibit } from './showcase';

const system = createRapier3DPhysicsSystem({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 120,
    maxSubSteps: 8,
    solverIterations: 14,
    maxCcdSubsteps: 4
});
const exhibit = await createPhysicsExhibit({
    system,
    chapter: '06',
    title: 'Suspension atelier',
    subtitle: '悬索桥 · 将荷载交给缆索，观察桥面的真实挠曲与回弹。',
    accent: '#d99270',
    camera: [10, 7.2, 13.5],
    target: [0, 1.8, 0],
    mobileDistanceScale: 1.18
});
const { stage, ticker, material, box, cylinder, label, action, setMetric, setStatus } = exhibit;
const physics = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
const bridge = createBridgeExperiment(physics);
document.body.dataset['physicsScene'] = 'bridge';

const ivory = material(0xe7dfca, 0.42, 0.1);
const porcelain = material(0xf5eddc, 0.31, 0.08);
const brass = material(0xd0a763, 0.28, 0.76);
const copper = material(0xa54d38, 0.36, 0.56);
const teal = material(0x296660, 0.34, 0.33);
const deep = material(0x123938, 0.58, 0.15);
const water = material(0x234f50, 0.23, 0.32);
const steel = material(0xb5c6b7, 0.28, 0.72);
const scene = new Hilo3d.Node().addTo(stage);

/** Capped turned metal with explicit surface normals, including the beveled profile transitions. */
function latheGeometry(
    profile: readonly (readonly [number, number])[],
    segments = 32
): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let row = 1; row < profile.length; row += 1) {
        const lower = profile[row - 1];
        const upper = profile[row];
        if (!lower || !upper) continue;
        const rise = upper[1] - lower[1];
        const flare = upper[0] - lower[0];
        const normalLength = Math.hypot(rise, flare);
        const offset = positions.length / 3;
        for (const [radius, height] of [lower, upper]) {
            for (let segment = 0; segment <= segments; segment += 1) {
                const angle = (segment / segments) * Math.PI * 2;
                positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
                normals.push(
                    (Math.cos(angle) * rise) / normalLength,
                    -flare / normalLength,
                    (Math.sin(angle) * rise) / normalLength
                );
            }
        }
        for (let segment = 0; segment < segments; segment += 1) {
            const first = offset + segment;
            const next = first + segments + 1;
            indices.push(first, next, first + 1, first + 1, next, next + 1);
        }
    }
    for (const [edge, sign] of [
        [profile[0], -1],
        [profile[profile.length - 1], 1]
    ] as const) {
        if (!edge) continue;
        const centre = positions.length / 3;
        positions.push(0, edge[1], 0);
        normals.push(0, sign, 0);
        for (let segment = 0; segment <= segments; segment += 1) {
            const angle = (segment / segments) * Math.PI * 2;
            positions.push(Math.cos(angle) * edge[0], edge[1], Math.sin(angle) * edge[0]);
            normals.push(0, sign, 0);
            if (segment < segments) {
                const first = centre + segment + 1;
                if (sign < 0) indices.push(centre, first, first + 1);
                else indices.push(centre, first + 1, first);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

interface GeometryPlacement {
    readonly geometry: Hilo3d.Geometry;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly rotationX?: number;
}

/** Combine small fasteners in one reusable draw while retaining their authored normals. */
function combineGeometry(parts: readonly GeometryPlacement[]): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const part of parts) {
        const matrix = new Hilo3d.Matrix4().fromRotationTranslation(
            new Hilo3d.Quaternion().setAxisAngle(
                new Hilo3d.Vector3(1, 0, 0),
                ((part.rotationX ?? 0) * Math.PI) / 180
            ),
            new Hilo3d.Vector3(part.x, part.y, part.z)
        );
        const geometry = part.geometry.clone().transformMat4(matrix);
        const vertices = geometry.vertices;
        const surfaceNormals = geometry.normals;
        const triangles = geometry.indices;
        if (!vertices || !surfaceNormals || !triangles)
            throw new Error('Bridge detail requires indexed positions and normals.');
        const base = positions.length / 3;
        positions.push(...vertices.data);
        normals.push(...surfaceNormals.data);
        for (const index of triangles.data) indices.push(base + index);
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function ringArcGeometry(radius: number, wire: number, endAngle = Math.PI * 2): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 40;
    const sides = 10;
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * endAngle;
        for (let side = 0; side <= sides; side += 1) {
            const cross = (side / sides) * Math.PI * 2;
            const radial = radius + wire * Math.cos(cross);
            positions.push(
                radial * Math.cos(angle),
                radial * Math.sin(angle),
                wire * Math.sin(cross)
            );
            normals.push(
                Math.cos(angle) * Math.cos(cross),
                Math.sin(angle) * Math.cos(cross),
                Math.sin(cross)
            );
            if (segment < segments && side < sides) {
                const first = segment * (sides + 1) + side;
                const next = first + sides + 1;
                indices.push(first, next, first + 1, first + 1, next, next + 1);
            }
        }
    }
    if (endAngle < Math.PI * 2) {
        for (const [angle, sign] of [
            [0, -1],
            [endAngle, 1]
        ] as const) {
            const centre = positions.length / 3;
            positions.push(radius * Math.cos(angle), radius * Math.sin(angle), 0);
            normals.push(-Math.sin(angle) * sign, Math.cos(angle) * sign, 0);
            for (let side = 0; side <= sides; side += 1) {
                const cross = (side / sides) * Math.PI * 2;
                const radial = radius + wire * Math.cos(cross);
                positions.push(
                    radial * Math.cos(angle),
                    radial * Math.sin(angle),
                    wire * Math.sin(cross)
                );
                normals.push(-Math.sin(angle) * sign, Math.cos(angle) * sign, 0);
                if (side < sides) {
                    const first = centre + side + 1;
                    if (sign < 0) indices.push(centre, first, first + 1);
                    else indices.push(centre, first + 1, first);
                }
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

const boltGeometry = latheGeometry(
    [
        [0.028, 0],
        [0.035, 0.008],
        [0.035, 0.026],
        [0.024, 0.037]
    ],
    6
);
const saddleParts: GeometryPlacement[] = [
    {
        geometry: latheGeometry([
            [0.22, -0.025],
            [0.245, -0.008],
            [0.245, 0.008],
            [0.22, 0.025]
        ]),
        x: 0,
        y: 0,
        z: 0,
        rotationX: 90
    }
];
for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    saddleParts.push({
        geometry: boltGeometry,
        x: Math.cos(angle) * 0.175,
        y: Math.sin(angle) * 0.175,
        z: 0.029,
        rotationX: 90
    });
}
const saddleGeometry = combineGeometry(saddleParts);
const crossBeamGeometry = latheGeometry([
    [0.13, -1.48],
    [0.2, -1.4],
    [0.2, -1.18],
    [0.14, -1.07],
    [0.14, 1.07],
    [0.2, 1.18],
    [0.2, 1.4],
    [0.13, 1.48]
]);
const anchorParts: GeometryPlacement[] = [
    {
        geometry: latheGeometry([
            [0.215, 0],
            [0.23, 0.015],
            [0.23, 0.04],
            [0.205, 0.06]
        ]),
        x: 0,
        y: 0,
        z: 0
    }
];
for (const x of [-0.13, 0.13])
    for (const z of [-0.13, 0.13]) anchorParts.push({ geometry: boltGeometry, x, y: 0.059, z });
const anchorGeometry = combineGeometry(anchorParts);

// A cutaway valley model: the empty space under the deck is a real unsupported span.
box(scene, 0, -0.84, 0, 12.35, 0.3, 5.85, deep);
box(scene, 0, -0.65, 0, 12.12, 0.085, 5.68, brass);
box(scene, 0, -0.56, 0, 11.95, 0.1, 5.52, ivory);
box(scene, 0, -0.475, 0, 7.78, 0.06, 5.3, water);
for (const x of [-4.89, 4.89]) {
    box(scene, x, 0.03, 0, 2.2, 1.03, 5.45, teal);
    box(scene, x, 0.65, 0, 2.11, 0.16, 5.32, brass);
    box(scene, x, 1.1, 0, 2.03, 0.76, 5.18, ivory);
    box(scene, x, 1.53, 0, 1.96, 0.11, 5.04, porcelain);
    box(scene, x, 1.62, 0, 1.8, 0.15, 1.98, deep);
}
// Quiet horizontal lines in the channel give depth without animated or shader-driven water.
for (const z of [-1.9, 1.9]) box(scene, 0, -0.433, z, 7.58, 0.012, 0.018, steel);

const yAxis = new Hilo3d.Vector3(0, 1, 0);
const direction = new Hilo3d.Vector3();
const start = new Hilo3d.Vector3();
const end = new Hilo3d.Vector3();
function stretchRod(mesh: Hilo3d.Mesh, first: Hilo3d.Vector3, second: Hilo3d.Vector3): void {
    direction.copy(second).subtract(first);
    const length = direction.length();
    mesh.setPosition((first.x + second.x) / 2, (first.y + second.y) / 2, (first.z + second.z) / 2);
    mesh.scaleY = Math.max(0.001, length);
    if (length > 0.001) mesh.quaternion.rotationTo(yAxis, direction.normalize());
}
function staticCable(
    first: readonly [number, number, number],
    second: readonly [number, number, number]
): void {
    const mesh = cylinder(scene, 0, 0, 0, 0.039, 1, brass);
    stretchRod(mesh, start.set(...first), end.set(...second));
}

// Portal towers are assembled from ceramic piers, copper flutes, and exposed brass saddles.
for (const x of [-4.25, 4.25]) {
    for (const z of [-1.22, 1.22]) {
        box(scene, x, 1.65, z, 0.64, 0.2, 0.66, deep);
        box(scene, x, 2.94, z, 0.29, 2.66, 0.34, porcelain);
        box(scene, x + 0.175, 2.94, z, 0.045, 2.44, 0.19, copper);
        box(scene, x, 4.3, z, 0.45, 0.16, 0.51, brass);
    }
    new Hilo3d.Mesh({
        x,
        y: 4.35,
        geometry: crossBeamGeometry,
        material: copper,
        rotationX: 90,
        castShadows: true
    }).addTo(scene);
    box(scene, x, 4.51, 0, 0.28, 0.035, 2.7, brass);
    for (const z of [-0.88, 0.88]) {
        const saddle = cylinder(scene, x, 4.35, z, 0.15, 0.21, brass);
        saddle.rotationX = 90;
        const outward = Math.sign(z);
        new Hilo3d.Mesh({
            x,
            y: 4.35,
            z: z + outward * 0.15,
            geometry: saddleGeometry,
            material: brass,
            rotationY: outward < 0 ? 180 : 0,
            castShadows: true
        }).addTo(scene);
        const hub = cylinder(scene, x, 4.35, z + outward * 0.19, 0.094, 0.018, deep);
        hub.rotationX = 90;
        const outer = x < 0 ? -5.62 : 5.62;
        staticCable([x, 4.35, z], [outer, 1.69, z]);
        cylinder(scene, outer, 1.65, z, 0.145, 0.14, copper);
        new Hilo3d.Mesh({
            x: outer,
            y: 1.64,
            z,
            geometry: anchorGeometry,
            material: brass,
            castShadows: true
        }).addTo(scene);
    }
}

const views = new Map<number, Hilo3d.Node>();
const deckViews: Hilo3d.Node[] = [];
// A flared rivet foot and the slender railing post are a single turned metal part.
const postGeometry = latheGeometry([
    [0.065, 0.075],
    [0.065, 0.105],
    [0.024, 0.135],
    [0.024, 0.698],
    [0.039, 0.714],
    [0.039, 0.753],
    [0.025, 0.766]
]);
const deckBolts: GeometryPlacement[] = [];
for (const z of [-0.957, 0.957]) {
    for (const x of [-0.24, 0.24])
        deckBolts.push({ geometry: boltGeometry, x, y: -0.025, z, rotationX: Math.sign(z) * 90 });
}
const deckBoltGeometry = combineGeometry(deckBolts);
const railReturnGeometry = ringArcGeometry(0.2, 0.031, Math.PI / 2);
for (const body of bridge.deck) {
    const root = new Hilo3d.Node().addTo(stage);
    box(root, 0, 0, 0, 0.68, 0.17, 1.9, copper);
    box(root, 0, 0.107, 0, 0.63, 0.05, 1.72, porcelain);
    for (const z of [-0.92, 0.92]) {
        box(root, 0, 0.027, z, 0.675, 0.044, 0.055, brass);
        new Hilo3d.Mesh({ z, geometry: postGeometry, material: brass, castShadows: true }).addTo(
            root
        );
        if (body === bridge.deck[0] || body === bridge.deck[bridge.deck.length - 1]) {
            new Hilo3d.Mesh({
                y: 0.55,
                z,
                geometry: railReturnGeometry,
                material: copper,
                rotationY: body === bridge.deck[0] ? 180 : 0,
                castShadows: true
            }).addTo(root);
        }
    }
    new Hilo3d.Mesh({ geometry: deckBoltGeometry, material: steel, castShadows: true }).addTo(root);
    const column = bridge.deck.indexOf(body);
    if ([3, 4, 6, 7].includes(column)) {
        const marking = label(root, 'LOAD / 3.2', 0, 0.136, 0.16, 0.48, '#9c7252');
        marking.rotationX = -90;
        marking.castShadows = false;
    }
    bindNode3D(physics, body, root);
    views.set(body.handle, root);
    deckViews.push(root);
}
for (const body of bridge.cablePoints) {
    const root = new Hilo3d.Node().addTo(stage);
    bindNode3D(physics, body, root);
    views.set(body.handle, root);
}

const cableViews = bridge.cables
    .filter(cable => cable.kind !== 'link')
    .map(cable => ({
        cable,
        mesh: cylinder(
            stage,
            0,
            0,
            0,
            cable.kind === 'main' ? 0.044 : 0.021,
            1,
            cable.kind === 'main' ? brass : steel
        )
    }));
const railViews: {
    readonly first: Hilo3d.Node;
    readonly second: Hilo3d.Node;
    readonly z: number;
    readonly mesh: Hilo3d.Mesh;
}[] = [];
for (let index = 1; index < deckViews.length; index += 1) {
    const first = deckViews[index - 1];
    const second = deckViews[index];
    if (!first || !second) continue;
    for (const z of [-0.92, 0.92])
        railViews.push({ first, second, z, mesh: cylinder(stage, 0, 0, 0, 0.031, 1, copper) });
}
function anchorPosition(anchor: BridgeAnchor, output: Hilo3d.Vector3): void {
    output.set(anchor.local.x, anchor.local.y, anchor.local.z);
    const view = views.get(anchor.body.handle);
    if (view) output.transformQuat(view.quaternion).add(view.position);
}
await stage.systems.install({
    descriptor: {
        id: 'example/suspension-atelier/cables',
        version: '1.0.0',
        apiVersion: 1,
        requires: [system.descriptor.id]
    },
    setup(): Hilo3d.StageSystemRuntime {
        return {
            beforeRender(): void {
                // Every line follows the current interpolated rigid-body anchors, including roll and sway.
                for (const { cable, mesh } of cableViews) {
                    anchorPosition(cable.first, start);
                    anchorPosition(cable.second, end);
                    stretchRod(mesh, start, end);
                }
                for (const rail of railViews) {
                    start
                        .set(0, 0.75, rail.z)
                        .transformQuat(rail.first.quaternion)
                        .add(rail.first.position);
                    end.set(0, 0.75, rail.z)
                        .transformQuat(rail.second.quaternion)
                        .add(rail.second.position);
                    stretchRod(rail.mesh, start, end);
                }
            }
        };
    }
});

// Four reusable cargo visuals match the bounded number of dynamic load bodies.
const cargo: Hilo3d.Node[] = [];
const liftingRingGeometry = ringArcGeometry(0.105, 0.022);
for (let index = 0; index < 4; index += 1) {
    const root = new Hilo3d.Node({ visible: false }).addTo(stage);
    box(root, 0, 0, 0, 0.5, 0.54, 0.62, teal);
    for (const x of [-0.15, 0.15]) box(root, x, 0, 0, 0.042, 0.555, 0.635, brass);
    label(root, '3.2 kg', 0, 0.045, 0.325, 0.3, '#f3dfb6');
    new Hilo3d.Mesh({
        y: 0.36,
        geometry: liftingRingGeometry,
        material: brass,
        castShadows: true
    }).addTo(root);
    cargo.push(root);
}
label(scene, 'SUSPENSION  /  NO. 006', 0, -0.79, 2.97, 4.1, '#d7c9a5');
const chapter = label(scene, 'LOAD  /  DEFLECT  /  RECOVER', 4.91, 1.603, 1.95, 1.65, '#44665d');
chapter.rotationX = -90;

let sways = 0;
let resets = 0;
function readout(): void {
    const metrics = bridge.metrics();
    setMetric('load', '桥上荷载', `${(metrics.loads * bridge.loadMass).toFixed(1)} kg`);
    setMetric('deflection', '跨中挠度', `${(metrics.deflection * 1000).toFixed(0)} mm`);
    setMetric('cables', '物理约束', String(metrics.joints));
    setMetric('sway', '侧向位移', `${(Math.abs(metrics.lateralDisplacement) * 100).toFixed(1)} cm`);
    document.body.dataset['bridgeLoads'] = String(metrics.loads);
    document.body.dataset['bridgeDeflection'] = metrics.deflection.toFixed(5);
    document.body.dataset['bridgeJoints'] = String(metrics.joints);
    document.body.dataset['bridgeSway'] = metrics.lateralDisplacement.toFixed(5);
    document.body.dataset['bridgeSways'] = String(sways);
    document.body.dataset['bridgeResets'] = String(resets);
}
function hideCargo(): void {
    for (const node of cargo) node.visible = false;
}
action('bridge-load', '投放重物', (): void => {
    const body = bridge.addLoad();
    if (!body) {
        setStatus('已达到 4 件荷载上限 · 卸载后可以重新投放');
        return;
    }
    const node = cargo[bridge.metrics().loads - 1];
    if (!node) throw new Error('Bridge cargo visual is missing.');
    node.visible = true;
    bindNode3D(physics, body, node);
    readout();
    setStatus('3.2 kg 重物落向桥面 · 观察吊索受力伸长与桥面下挠');
});
action('bridge-unload', '卸下荷载', (): void => {
    bridge.clearLoads();
    hideCargo();
    readout();
    setStatus('荷载已移除 · 弹性吊索回缩，桥面逐渐回到空载位置');
});
action('bridge-sway', '侧向扰动', (): void => {
    bridge.sway();
    sways += 1;
    readout();
    setStatus('侧向冲量已施加 · 桥面与两条主缆共同摆动');
});
action('bridge-reset', '重置悬桥', (): void => {
    bridge.reset();
    hideCargo();
    sways = 0;
    resets += 1;
    readout();
    setStatus('桥面与缆索已复位 · 重新投放荷载进行对比');
});
action('bridge-focus', '观察跨中', (): void => {
    const middle = bridge.deck[5]?.pose.position;
    const height = middle?.y ?? 1.8;
    exhibit.orbitControls.setView(
        new Hilo3d.Vector3(4.5, height + 2.4, 7.9),
        new Hilo3d.Vector3(0, height + 0.2, 0)
    );
    setStatus('近看吊索、扶手接头与桥板铆钉 · 使用「复位视角」返回全景');
});
let readoutTime = 0;
ticker.addTick({
    tick(deltaTime: number): void {
        readoutTime += deltaTime;
        if (readoutTime < 120) return;
        readoutTime = 0;
        readout();
    }
});
readout();
setStatus('投放重物，看见力如何沿桥面、吊索与主缆传向两座桥塔');
exhibit.start();
