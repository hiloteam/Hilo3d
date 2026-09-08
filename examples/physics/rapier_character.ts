import { bindNode3D, createRapier3DPhysicsSystem } from '@hilo/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createPhysicsExhibit } from './showcase';
import { CharacterExperiment, COURIER_PHYSICS, COURIER_TERRAIN } from './characterExperiment';

let experiment: CharacterExperiment | undefined;
const physicsSystem = createRapier3DPhysicsSystem({
    ...COURIER_PHYSICS,
    setup(world): void {
        experiment = new CharacterExperiment(world);
    }
});
const exhibit = await createPhysicsExhibit({
    system: physicsSystem,
    chapter: '05',
    title: 'Clockwork courier',
    subtitle: '机械信使 · 越过台阶、贴合坡面、推送包裹。每一步都由角色控制器寻找可行路径。',
    accent: '#e5ad65',
    camera: [10.3, 8.15, 13.8],
    target: [-0.15, 0.6, 0],
    floorY: -0.95
});
if (!experiment) throw new Error('The courier physics system did not initialize');
const courier = experiment;
const { stage, material, box, sphere, cylinder, label } = exhibit;
const cream = material(0xece5d4, 0.46, 0.05);
const porcelain = material(0xfff4df, 0.27, 0.08);
const teal = material(0x256e68, 0.32, 0.2);
const deep = material(0x1a3d3d, 0.46, 0.2);
const brass = material(0xd7ad66, 0.27, 0.76);
const copper = material(0xdd7851, 0.3, 0.15);
const steel = material(0x9fbbad, 0.28, 0.68);
const glass = material(0x84d5ba, 0.14, 0.28);
const rubber = material(0x283d36, 0.78);

/** Open circular metalwork: the key holes and lens bezels remain real geometry in close views. */
function ring(
    parent: Hilo3d.Node,
    x: number,
    y: number,
    z: number,
    radius: number,
    tube: number,
    surface: Hilo3d.PBRMaterial
): Hilo3d.Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 40;
    const sides = 10;
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        for (let side = 0; side <= sides; side += 1) {
            const cross = (side / sides) * Math.PI * 2;
            const radial = radius + Math.cos(cross) * tube;
            positions.push(
                Math.cos(angle) * radial,
                Math.sin(angle) * radial,
                Math.sin(cross) * tube
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
    return new Hilo3d.Mesh({
        x,
        y,
        z,
        geometry: new Hilo3d.Geometry({
            vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
            normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
            indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
        }),
        material: surface,
        castShadows: true,
        receiveShadows: true
    }).addTo(parent);
}

// The whole course is a miniature delivery yard on one machined, layered plinth.
box(stage, 0, -0.33, 0, 12.15, 0.29, 6.72, deep);
box(stage, 0, -0.17, 0, 12.02, 0.055, 6.57, brass);
box(stage, 0, -0.085, 0, 11.9, 0.17, 6.5, cream);
for (const x of [-5.15, 5.15])
    for (const z of [-2.57, 2.57]) {
        cylinder(stage, x, -0.65, z, 0.29, 0.33, deep);
        cylinder(stage, x, -0.82, z, 0.32, 0.055, brass);
    }
for (let index = 0; index <= 24; index += 1) {
    box(stage, -5.4 + index * 0.45, 0.009, 3.08, 0.022, 0.016, index % 4 === 0 ? 0.2 : 0.08, brass);
}
for (const piece of COURIER_TERRAIN) {
    const surface =
        piece.kind === 'hurdle'
            ? copper
            : piece.kind === 'column' || piece.kind === 'wall'
              ? teal
              : porcelain;
    box(
        stage,
        piece.x,
        piece.y,
        piece.z,
        piece.width,
        piece.height,
        piece.depth,
        surface
    ).rotationZ = piece.rotationZ ?? 0;
    if (piece.kind === 'step' || piece.kind === 'deck') {
        box(
            stage,
            piece.x,
            piece.y + piece.height / 2 + 0.01,
            piece.z,
            piece.width - 0.08,
            0.02,
            piece.depth - 0.13,
            teal
        );
        box(
            stage,
            piece.x - piece.width / 2 + 0.055,
            piece.y + piece.height / 2 + 0.025,
            piece.z,
            0.065,
            0.025,
            piece.depth - 0.15,
            brass
        );
    }
}
const ramp = new Hilo3d.Node({ x: 1.53, y: 0.29, z: 1.6, rotationZ: -17 }).addTo(stage);
for (const z of [-0.8, 0.8]) box(ramp, 0, 0.07, z, 2.02, 0.025, 0.045, brass);
for (let index = 0; index < 6; index += 1)
    box(ramp, -0.85 + index * 0.34, 0.066, 0, 0.025, 0.015, 1.38, steel);
for (const z of [0.54, 2.66]) {
    box(stage, 2.98, 0.11, z, 0.58, 0.22, 0.6, brass);
    box(stage, 2.98, 1.45, z, 0.41, 0.14, 0.41, brass);
    cylinder(stage, 2.98, 1.77, z, 0.1, 0.12, brass);
}
label(stage, 'CLEARANCE / 1.46 m', 3.23, 1.57, 1.6, 2.0, '#315b52').rotationY = 90;
for (let stripe = 0; stripe < 5; stripe += 1)
    box(stage, -0.615, 0.28, -2.3 + stripe * 0.27, 0.02, 0.35, 0.1, brass);
box(stage, 0, 0.915, -3.09, 11.4, 0.06, 0.21, brass);
for (const x of [-4.8, -2.4, 0, 2.4, 4.8]) {
    box(stage, x, 0.5, -2.985, 1.64, 0.46, 0.022, deep);
    cylinder(stage, x, 0.925, -3.09, 0.052, 0.035, porcelain);
}
label(stage, 'CLOCKWORK POST  /  DELIVERY DISTRICT', 0, 0.51, -2.965, 5.65, '#e8d4ad');
for (const [text, x, z, width] of [
    ['01 / STEP ASSIST', -2.82, 2.68, 2.15],
    ['02 / SLOPE FOLLOW', 0.4, 2.68, 2.1],
    ['03 / PARCEL TRANSFER', 4.1, 2.9, 2.18],
    ['04 / JUMP + LAND', -1.65, -0.67, 2.3]
] as const)
    label(stage, text, x, 0.02, z, width, '#476c61').rotationX = -90;
label(stage, 'COURIER No. 05  /  KINEMATIC STUDY', 0, -0.31, 3.367, 5.2, '#d8c69b');

// Dashed route markers are decoration; navigation targets never replace collision-constrained motion.
for (let index = 0; index < 15; index += 1) {
    const x = -4.65 + index * 0.66;
    if (Math.abs(x + 0.78) < 0.6) continue;
    box(stage, x, 0.009, -1.76, 0.18, 0.018, 0.075, brass);
}
for (const z of [-1.0, -0.25, 0.5])
    for (const x of [-4.7, 4.7]) {
        cylinder(stage, x, 0.014, z, 0.055, 0.025, brass);
    }
// The central depot leaves both travel lanes unobstructed.
box(stage, -2.4, 0.035, -0.15, 2.0, 0.055, 0.59, deep);
for (let index = 0; index < 3; index += 1) {
    cylinder(stage, -3.08 + index * 0.68, 0.18, -0.15, 0.19, 0.28, teal);
    cylinder(stage, -3.08 + index * 0.68, 0.34, -0.15, 0.2, 0.05, brass);
}
// Sorting drums carry inset porcelain lids and a post-office cancellation mark.
for (let index = 0; index < 3; index += 1) {
    cylinder(stage, -3.08 + index * 0.68, 0.371, -0.15, 0.15, 0.017, porcelain);
    label(
        stage,
        ['AIR', 'EXP', 'POST'][index] ?? 'POST',
        -3.08 + index * 0.68,
        0.381,
        -0.15,
        0.32,
        '#39665d'
    ).rotationX = -90;
}

for (const [index, crate] of courier.crates.entries()) {
    const parcel = new Hilo3d.Node().addTo(stage);
    box(parcel, 0, 0, 0, 0.44, 0.44, 0.44, index === 0 ? copper : teal);
    box(parcel, 0, 0, 0.226, 0.07, 0.44, 0.016, brass);
    box(parcel, 0, 0.226, 0, 0.07, 0.016, 0.44, brass);
    box(parcel, 0, 0.05, 0.24, 0.2, 0.12, 0.018, porcelain);
    box(parcel, 0, -0.065, 0.239, 0.11, 0.09, 0.018, brass);
    box(parcel, 0, -0.065, 0.252, 0.065, 0.044, 0.016, deep);
    bindNode3D(courier.physics, crate.body, parcel);
}

const robot = new Hilo3d.Node().addTo(stage);
box(robot, 0, -0.04, 0, 0.58, 0.43, 0.42, teal);
box(robot, 0, -0.035, 0.222, 0.43, 0.29, 0.055, porcelain);
cylinder(robot, 0, 0.17, 0, 0.19, 0.095, brass);
cylinder(robot, 0, 0.142, 0, 0.205, 0.025, deep);
cylinder(robot, 0, 0.197, 0, 0.205, 0.019, steel);
box(robot, 0, 0.365, 0.015, 0.76, 0.36, 0.56, porcelain);
box(robot, 0, 0.547, 0.015, 0.73, 0.025, 0.525, brass);
box(robot, 0, 0.345, 0.304, 0.63, 0.185, 0.055, deep);
for (const x of [-0.155, 0.155]) {
    cylinder(robot, x, 0.355, 0.34, 0.094, 0.026, steel).rotationX = 90;
    cylinder(robot, x, 0.355, 0.346, 0.076, 0.035, brass).rotationX = 90;
    cylinder(robot, x, 0.355, 0.371, 0.052, 0.027, glass).rotationX = 90;
    ring(robot, x, 0.355, 0.386, 0.064, 0.01, brass);
    cylinder(robot, x, 0.355, 0.389, 0.022, 0.012, deep).rotationX = 90;
}
label(robot, 'CP / 05', 0, -0.04, 0.257, 0.36, '#35574e');
box(robot, 0, 0.268, 0.344, 0.115, 0.014, 0.012, brass);
cylinder(robot, 0.22, 0.617, 0.015, 0.02, 0.145, brass);
const signal = sphere(robot, 0.22, 0.706, 0.015, 0.057, glass);
for (const x of [-0.405, 0.405]) {
    cylinder(robot, x, 0.366, 0.015, 0.085, 0.067, brass).rotationZ = 90;
    sphere(robot, x, -0.055, 0, 0.095, brass);
    box(robot, x, -0.2, 0.018, 0.13, 0.23, 0.14, porcelain);
    cylinder(robot, x, -0.14, 0.018, 0.075, 0.155, brass).rotationZ = 90;
    cylinder(robot, x, -0.284, 0.018, 0.078, 0.045, steel);
    sphere(robot, x, -0.325, 0.018, 0.084, teal);
}
box(robot, 0, -0.045, -0.335, 0.38, 0.31, 0.25, copper);
box(robot, 0, -0.045, -0.47, 0.055, 0.31, 0.016, brass);
box(robot, 0, 0.069, -0.477, 0.35, 0.085, 0.027, copper);
box(robot, 0, -0.02, -0.495, 0.105, 0.105, 0.025, brass);
box(robot, 0, -0.02, -0.512, 0.06, 0.056, 0.012, deep);
cylinder(robot, 0, 0.105, -0.475, 0.045, 0.16, brass).rotationX = 90;
box(robot, 0, 0.105, -0.585, 0.28, 0.065, 0.038, brass);
for (const x of [-0.12, 0.12]) ring(robot, x, 0.105, -0.585, 0.066, 0.022, brass);
const legs: Hilo3d.Node[] = [];
for (const x of [-0.19, 0.19]) {
    const leg = new Hilo3d.Node({ x, y: -0.28 }).addTo(robot);
    cylinder(leg, 0, -0.095, 0, 0.065, 0.19, brass);
    box(leg, 0, -0.23, 0.06, 0.21, 0.17, 0.35, rubber);
    box(leg, 0, -0.19, 0.073, 0.215, 0.055, 0.31, porcelain);
    legs.push(leg);
}
const groundMarker = cylinder(stage, 0, 0, 0, 0.39, 0.012, glass);
const probeBeam = box(stage, 0, 0, 0, 1, 0.023, 0.035, brass);
const probeTip = sphere(stage, 0, 0, 0, 0.054, brass);
const pressed = new Set<string>();
const moveKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's']);
const cameraHome = document.querySelector<HTMLButtonElement>('#camera-home');
if (!cameraHome) throw new Error('The courier exhibit requires its shared camera reset control');
const routeMinDistance = exhibit.orbitControls.minDistance;
let inspecting = false;
let restoreAutomatic = true;
const inspectionAnchor = new Hilo3d.Vector3();
const inspectionOffset = new Hilo3d.Vector3();
const inspectionEye = new Hilo3d.Vector3();
const inspectionTarget = new Hilo3d.Vector3();

function frameInspection(): void {
    const position = courier.body.pose.position;
    const heading = courier.heading;
    const distanceScale = innerWidth <= 700 ? 1.22 : 1;
    const target = new Hilo3d.Vector3(position.x, position.y + 0.1, position.z);
    const eye = target
        .clone()
        .add(
            new Hilo3d.Vector3(
                (heading.x * 3.1 + heading.z * 1.9) * distanceScale,
                1.45 * distanceScale,
                (heading.z * 3.1 - heading.x * 1.9) * distanceScale
            )
        );
    inspectionAnchor.set(position.x, position.y, position.z);
    exhibit.orbitControls.setView(eye, target);
}

function returnToRoute(): void {
    if (!inspecting) return;
    inspecting = false;
    exhibit.orbitControls.minDistance = routeMinDistance;
    courier.setAutomatic(restoreAutomatic);
}

function resizeInspection(): void {
    // The shared helper resets responsive framing first; reframe this opt-in portrait afterwards.
    if (inspecting) frameInspection();
}

cameraHome.addEventListener('click', returnToRoute);
window.addEventListener('resize', resizeInspection);

function readKeyboard(): void {
    const x =
        Number(pressed.has('ArrowRight') || pressed.has('d')) -
        Number(pressed.has('ArrowLeft') || pressed.has('a'));
    const z =
        Number(pressed.has('ArrowDown') || pressed.has('s')) -
        Number(pressed.has('ArrowUp') || pressed.has('w'));
    courier.setDirection(x, z);
}
function keyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
    if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) courier.requestJump();
        return;
    }
    if (!moveKeys.has(event.key)) return;
    event.preventDefault();
    pressed.add(event.key);
    readKeyboard();
}
function keyUp(event: KeyboardEvent): void {
    if (!moveKeys.has(event.key)) return;
    pressed.delete(event.key);
    readKeyboard();
}
function clearKeyboard(): void {
    if (pressed.size === 0) return;
    pressed.clear();
    courier.setDirection(0, 0);
}
window.addEventListener('keydown', keyDown);
window.addEventListener('keyup', keyUp);
window.addEventListener('blur', clearKeyboard);
const auto = exhibit.action('courier-auto', '巡游：开启', () => {
    courier.setAutomatic(!courier.automatic);
});
exhibit.action('courier-jump', '跳跃 ↑', () => {
    courier.requestJump();
});
exhibit.action('courier-reset', '返回起点', () => {
    pressed.clear();
    if (inspecting) cameraHome.click();
    courier.reset();
});
const assist = exhibit.action('courier-step', '台阶辅助：开', () => {
    courier.setStepAssist(!courier.stepAssist);
});
const inspect = exhibit.action('courier-inspect', '近看信使', () => {
    if (inspecting) {
        cameraHome.click();
        return;
    }
    restoreAutomatic = courier.automatic;
    courier.setAutomatic(false);
    pressed.clear();
    inspecting = true;
    exhibit.orbitControls.minDistance = 2.2;
    frameInspection();
});
for (const [id, text, x, z] of [
    ['left', '向左移动', -1, 0],
    ['right', '向右移动', 1, 0],
    ['forward', '向前移动', 0, -1],
    ['back', '向后移动', 0, 1]
] as const) {
    const arrows = { left: '←', right: '→', forward: '↑', back: '↓' } as const;
    const button = exhibit.action(`courier-${id}`, arrows[id], () => {
        pressed.clear();
        courier.setDirection(x, z, 0.65);
    });
    button.setAttribute('aria-label', text);
    button.title = text;
}

let gait = 0;
let lastX = courier.body.pose.position.x;
let lastZ = courier.body.pose.position.z;
function presentCourier(): void {
    courier.sample();
    const position = courier.body.pose.position;
    const travel = Math.hypot(position.x - lastX, position.z - lastZ);
    if (travel < 0.25 && courier.grounded) gait += travel * 9;
    lastX = position.x;
    lastZ = position.z;
    robot.position.set(position.x, position.y, position.z);
    robot.rotationY = (Math.atan2(courier.heading.x, courier.heading.z) * 180) / Math.PI;
    if (inspecting) {
        // Translate the user's current orbit with the courier; preserve their orbit angle and zoom.
        inspectionOffset.set(position.x, position.y, position.z).subtract(inspectionAnchor);
        if (inspectionOffset.squaredLength() > 0.0000001) {
            exhibit.orbitControls.setView(
                inspectionEye.copy(exhibit.camera.position).add(inspectionOffset),
                inspectionTarget.copy(exhibit.orbitControls.target).add(inspectionOffset)
            );
            inspectionAnchor.set(position.x, position.y, position.z);
        }
    }
    if (!courier.physics.paused && courier.physics.timeScale > 0) {
        for (const [index, leg] of legs.entries())
            leg.rotationX =
                courier.grounded && travel > 0.0001 ? Math.sin(gait + index * Math.PI) * 13 : 0;
    }
    signal.material = courier.grounded ? glass : copper;
    groundMarker.position.set(
        position.x,
        position.y - (courier.groundDistance ?? 0.6) + 0.014,
        position.z
    );
    groundMarker.material = courier.grounded ? glass : brass;
    const length = courier.obstacleDistance ?? 0.9;
    probeBeam.visible = length > 0.04;
    probeBeam.scaleX = Math.max(0.01, length);
    probeBeam.position.set(
        position.x + courier.heading.x * (0.32 + length / 2),
        position.y - 0.18,
        position.z + courier.heading.z * (0.32 + length / 2)
    );
    probeBeam.rotationY = (-Math.atan2(courier.heading.z, courier.heading.x) * 180) / Math.PI;
    probeTip.position.set(
        position.x + courier.heading.x * (0.32 + length),
        position.y - 0.18,
        position.z + courier.heading.z * (0.32 + length)
    );
    probeTip.material = courier.obstacleDistance === null ? glass : copper;
    auto.textContent = courier.automatic ? '巡游：开启' : '巡游：关闭';
    auto.setAttribute('aria-pressed', String(courier.automatic));
    assist.textContent = courier.stepAssist ? '台阶辅助：开' : '台阶辅助：关';
    assist.setAttribute('aria-pressed', String(courier.stepAssist));
    inspect.textContent = inspecting ? '全景路线' : '近看信使';
    inspect.setAttribute('aria-pressed', String(inspecting));
    const data = document.body.dataset;
    data['physicsScene'] = 'character';
    data['physicsSteps'] = String(courier.physics.getDiagnostics().simulatedSteps);
    data['courierPosition'] = [position.x, position.y, position.z]
        .map(value => value.toFixed(4))
        .join(',');
    data['courierGrounded'] = String(courier.grounded);
    data['courierJumps'] = String(courier.jumps);
    data['courierLandings'] = String(courier.landings);
    data['courierStepAssist'] = String(courier.stepAssist);
    data['courierAuto'] = String(courier.automatic);
    data['courierView'] = inspecting ? 'detail' : 'route';
    data['courierObstacle'] = courier.obstacleDistance?.toFixed(3) ?? 'clear';
    data['courierCrates'] = courier.crates
        .map(crate => (crate.body.pose.position.x - crate.position.x).toFixed(3))
        .join(',');
    data['courierLaps'] = String(courier.laps);
    exhibit.setMetric('mode', '脚下状态', courier.grounded ? '已接地' : '腾空中');
    exhibit.setMetric(
        'probe',
        '前向形状探测',
        courier.obstacleDistance === null ? '畅通' : `${courier.obstacleDistance.toFixed(2)} m`
    );
    exhibit.setMetric(
        'jump',
        '跳跃 / 着陆',
        `${String(courier.jumps)} / ${String(courier.landings)}`
    );
    exhibit.setMetric('route', '完成巡游', `${String(courier.laps)} 圈`);
    exhibit.setStatus(
        inspecting
            ? '近看信使 · 拖动环绕，检查分层镜片、邮包搭扣与开孔发条。'
            : courier.automatic
              ? '自动巡游 · 形状探测触发越障跳跃，角色控制器处理碰撞。'
              : '方向键 / WASD 移动 · 空格跳跃 · 关闭台阶辅助比较越阶能力。'
    );
}

await stage.systems.install({
    descriptor: {
        id: 'example/clockwork-courier/input',
        version: '1.0.0',
        apiVersion: 1,
        requires: [physicsSystem.descriptor.id]
    },
    setup(): Hilo3d.StageSystemRuntime {
        return {
            beforeUpdate(deltaTime: number): void {
                courier.prepare(deltaTime);
            },
            beforeRender(): void {
                presentCourier();
            },
            destroy(): void {
                window.removeEventListener('keydown', keyDown);
                window.removeEventListener('keyup', keyUp);
                window.removeEventListener('blur', clearKeyboard);
                window.removeEventListener('resize', resizeInspection);
                cameraHome.removeEventListener('click', returnToRoute);
            }
        };
    }
});
if (new URLSearchParams(location.search).get('view') === 'detail') inspect.click();
presentCourier();
exhibit.start();
