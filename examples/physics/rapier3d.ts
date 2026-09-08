import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem,
    type PhysicsPose3D,
    type PhysicsRigidBody
} from '@hilo/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createPhysicsExhibit } from './showcase';

const system = createRapier3DPhysicsSystem({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 120,
    maxSubSteps: 8,
    maxDeltaSeconds: 0.1,
    solverIterations: 10,
    maxCcdSubsteps: 4
});
const exhibit = await createPhysicsExhibit({
    system,
    chapter: '01',
    title: 'Impulse garden',
    subtitle: '轻推一枚骨牌，释放一场连锁反应。探索刚体、堆叠、复合碰撞体与动量传递。',
    accent: '#ed966c',
    camera: [9, 8, 13.8],
    target: [-1, 1.1, 0]
});
const { stage, ticker, material, box, sphere, cylinder, label } = exhibit;
const physics = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
const ivory = material(0xe4dec8, 0.34, 0.08);
const porcelain = material(0xf3ebd9, 0.23, 0.04);
const teal = material(0x247e77, 0.27, 0.28);
const dark = material(0x163f43, 0.35, 0.35);
const brass = material(0xc59a53, 0.24, 0.78);
const coral = material(0xda6644, 0.28, 0.16);
const palette = [porcelain, ivory, teal, coral];
const resettable: { body: PhysicsRigidBody<'3d'>; pose: PhysicsPose3D }[] = [];
const dominoes: PhysicsRigidBody<'3d'>[] = [];
let contactCount = 0;
let shots = 0;
let pushes = 0;
let lowGravity = false;

function remember(body: PhysicsRigidBody<'3d'>): void {
    resettable.push({ body, pose: body.pose });
}

// The circular layered plinth is a real cylinder collider, with a recessed brass reveal.
const ground = physics.createRigidBody({ type: 'fixed', position: { x: 0, y: -0.28, z: 0 } });
physics.createCollider(
    {
        shape: { type: 'cylinder', radius: 5.7, halfHeight: 0.28 },
        friction: 0.68,
        restitution: 0.04
    },
    ground
);
cylinder(stage, 0, -0.62, 0, 5.64, 0.22, dark);
cylinder(stage, 0, -0.46, 0, 5.73, 0.08, brass);
cylinder(stage, 0, -0.23, 0, 5.7, 0.45, ivory);
for (let index = 0; index < 64; index++) {
    const angle = (index / 64) * Math.PI * 2;
    const tick = box(
        stage,
        Math.sin(angle) * 5.43,
        0.012,
        Math.cos(angle) * 5.43,
        0.022,
        0.015,
        index % 4 === 0 ? 0.2 : 0.09,
        brass
    );
    tick.rotationY = (angle * 180) / Math.PI;
}
for (const [x, z] of [
    [-3.1, -3],
    [3.1, -3],
    [-3.1, 3],
    [3.1, 3]
] as const) {
    cylinder(stage, x, -0.78, z, 0.36, 0.38, dark);
    cylinder(stage, x, -0.92, z, 0.39, 0.07, brass);
}

// Tangentially aligned dominoes form a colour-graded wave across the front of the plinth.
for (let index = 0; index < 29; index++) {
    const angle = -1.72 + index * 0.114;
    const x = Math.sin(angle) * 4.38;
    const z = Math.cos(angle) * 4.38;
    const body = physics.createRigidBody({
        type: 'dynamic',
        position: { x, y: 0.55, z },
        rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
        angularDamping: 0.02
    });
    physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: 0.11, y: 0.55, z: 0.31 } },
            friction: 0.52,
            restitution: 0.05,
            collisionEvents: true
        },
        body
    );
    const root = new Hilo3d.Node().addTo(stage);
    const color = index < 10 ? porcelain : index < 20 ? teal : coral;
    box(root, 0, 0, 0, 0.22, 1.1, 0.62, color);
    box(root, 0, 0.28, 0.316, 0.15, 0.026, 0.012, brass);
    bindNode3D(physics, body, root);
    dominoes.push(body);
    remember(body);
}

// Alternating stack directions make both static friction and impact-driven collapse legible.
for (let level = 0; level < 6; level++) {
    for (let column = 0; column < 3; column++) {
        const alternate = level % 2 === 1;
        const x = -1.7 + (alternate ? (column - 1) * 0.65 : 0);
        const z = -1.7 + (alternate ? 0 : (column - 1) * 0.65);
        const width = alternate ? 0.6 : 1.94;
        const depth = alternate ? 1.94 : 0.6;
        const y = 0.23 + level * 0.46;
        const body = physics.createRigidBody({ type: 'dynamic', position: { x, y, z } });
        physics.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: width / 2, y: 0.23, z: depth / 2 } },
                density: 0.65,
                friction: 0.64,
                collisionEvents: true
            },
            body
        );
        const mesh = box(stage, x, y, z, width, 0.46, depth, level % 3 === 2 ? teal : porcelain);
        bindNode3D(physics, body, mesh);
        remember(body);
    }
}
const crown = physics.createRigidBody({
    type: 'dynamic',
    position: { x: -1.7, y: 3.14, z: -1.7 },
    continuousCollisionDetection: true
});
physics.createCollider(
    {
        shape: { type: 'ball', radius: 0.38 },
        restitution: 0.58,
        density: 1.2,
        collisionEvents: true
    },
    crown
);
bindNode3D(physics, crown, sphere(stage, -1.7, 3.14, -1.7, 0.38, brass));
remember(crown);

// A compound jack uses three independent collider shapes on one body and one visual root.
for (let index = 0; index < 3; index++) {
    const position = { x: 0.3 + index * 1.0, y: 0.5 + index * 0.12, z: 0.45 };
    const body = physics.createRigidBody({ type: 'dynamic', position, angularDamping: 0.12 });
    const root = new Hilo3d.Node().addTo(stage);
    const color = palette[index + 1] ?? teal;
    for (const dimensions of [
        [0.86, 0.23, 0.23],
        [0.23, 0.86, 0.23],
        [0.23, 0.23, 0.86]
    ] as const) {
        const [width, height, depth] = dimensions;
        physics.createCollider(
            {
                shape: {
                    type: 'cuboid',
                    halfExtents: { x: width / 2, y: height / 2, z: depth / 2 }
                },
                friction: 0.45,
                restitution: 0.3,
                collisionEvents: true
            },
            body
        );
        box(root, 0, 0, 0, width, height, depth, color);
    }
    sphere(root, 0, 0, 0, 0.23, brass);
    bindNode3D(physics, body, root);
    remember(body);
}

// The launcher is an intentionally mechanical assembly; the projectile itself uses CCD.
box(stage, 3.7, 0.19, -1.7, 1.65, 0.35, 1.4, dark);
for (const z of [-2.17, -1.23]) {
    box(stage, 3.88, 0.55, z, 0.28, 0.82, 0.18, brass);
    const axle = cylinder(stage, 3.88, 0.87, z, 0.22, 0.11, teal);
    axle.rotationX = 90;
}
const barrel = cylinder(stage, 3.93, 0.88, -1.7, 0.38, 1.25, coral);
barrel.rotationZ = 90;
for (const x of [3.31, 4.5]) {
    const band = cylinder(stage, x, 0.88, -1.7, 0.41, 0.1, brass);
    band.rotationZ = 90;
}
const muzzle = cylinder(stage, 3.245, 0.88, -1.7, 0.3, 0.013, dark);
muzzle.rotationZ = 90;
const projectile = physics.createRigidBody({
    type: 'dynamic',
    position: { x: 2.78, y: 0.36, z: -1.7 },
    continuousCollisionDetection: true
});
physics.createCollider(
    {
        shape: { type: 'ball', radius: 0.34 },
        density: 7.5,
        restitution: 0.22,
        collisionEvents: true
    },
    projectile
);
bindNode3D(physics, projectile, sphere(stage, 2.78, 0.36, -1.7, 0.34, brass));
remember(projectile);

for (const [text, x, z, width] of [
    ['01   /   CHAIN REACTION', -1.1, 3.38, 3.2],
    ['02   /   IMPACT & INERTIA', -1.7, -3.2, 3.0],
    ['03   /   COMPOUND BODIES', 1.35, 1.6, 2.9]
] as const) {
    const caption = label(stage, text, x, 0.018, z, width, '#46665d');
    caption.rotationX = -90;
}
label(stage, 'IMPULSE GARDEN   /   NO. 001', 0, -0.28, 5.76, 4.4, '#244c49');

function pushDomino(): void {
    const first = dominoes[0];
    if (!first) return;
    first.applyImpulse({ x: Math.cos(-1.72) * 0.28, y: 0, z: -Math.sin(-1.72) * 0.28 });
    // An impulse above the centre gives torque = up × tangent, tipping toward the next domino.
    first.applyTorqueImpulse({ x: -Math.sin(-1.72) * 0.11, y: 0, z: -Math.cos(-1.72) * 0.11 });
    pushes++;
    document.body.dataset['pushes'] = String(pushes);
    exhibit.setStatus('一次轻推，沿着 29 枚骨牌传递。');
}
function fire(): void {
    projectile.setPose({
        position: { x: 2.78, y: 0.88, z: -1.7 },
        rotation: { x: 0, y: 0, z: 0, w: 1 }
    });
    // An off-centre impact removes support unevenly and makes the alternating stack collapse.
    projectile.setLinearVelocity({ x: -20, y: 1, z: 2.2 });
    projectile.setAngularVelocity({ x: 0, y: 0, z: 0 });
    shots++;
    document.body.dataset['shots'] = String(shots);
    exhibit.setStatus('黄铜球已发射 · CCD 连续碰撞检测开启');
}
function reset(): void {
    for (const { body, pose } of resettable) {
        body.setPose(pose);
        body.setLinearVelocity({ x: 0, y: 0, z: 0 });
        body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    }
    contactCount = 0;
    document.body.dataset['resets'] = String(Number(document.body.dataset['resets'] ?? 0) + 1);
    exhibit.setStatus('展品已复原，可以重新触发连锁反应。');
}
exhibit.action('push', '推动骨牌 ↗', pushDomino);
exhibit.action('launch', '发射撞击球', fire);
exhibit.action('reset', '重建展品', reset);
const gravityButton = exhibit.action('gravity', '月球重力', () => {
    lowGravity = !lowGravity;
    physics.setGravity({ x: 0, y: lowGravity ? -1.62 : -9.81, z: 0 });
    gravityButton.textContent = lowGravity ? '地球重力' : '月球重力';
    document.body.dataset['gravity'] = lowGravity ? 'moon' : 'earth';
});

// Double-click is an object impulse interaction. Camera gestures remain owned by OrbitControls.
const canvas = stage.canvas;
const ray = new Hilo3d.Ray();
canvas.addEventListener('dblclick', (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    ray.fromCamera(
        exhibit.camera,
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height
    );
    const hit = physics.castRay(ray.origin, ray.direction, 70, true, { excludeFixed: true });
    if (!hit) return;
    const body = physics.getCollider(hit.colliderHandle)?.parent;
    body?.applyImpulse({ x: ray.direction.x * 1.8, y: 1.7, z: ray.direction.z * 1.8 });
    document.body.dataset['picked'] = String(Number(document.body.dataset['picked'] ?? 0) + 1);
    exhibit.setStatus('射线命中刚体 · 已施加定向冲量');
});
physics.on('collisionstart', () => {
    contactCount++;
});
let elapsed = 0;
let lastReadout = 0;
let autoPush = false;
ticker.addTick({
    tick(deltaTime: number): void {
        if (!physics.paused) elapsed += deltaTime * physics.timeScale;
        if (!autoPush && elapsed > 1600) {
            autoPush = true;
            pushDomino();
        }
        lastReadout += deltaTime;
        if (lastReadout < 120) return;
        lastReadout = 0;
        const toppled = dominoes.filter(body => {
            const { x, z } = body.pose.rotation;
            // Fallen neighbours can support each other above the floor; measure tilt, independent of yaw.
            return 1 - 2 * (x * x + z * z) < 0.65;
        }).length;
        exhibit.setMetric('dominoes', '连锁倒下', `${String(toppled)} / 29`);
        exhibit.setMetric('contacts', '碰撞事件', String(contactCount));
        exhibit.setMetric('bodies', '动态刚体', String(resettable.length));
        exhibit.setMetric('gravity', '重力加速度', lowGravity ? '1.62 m/s²' : '9.81 m/s²');
        document.body.dataset['toppled'] = String(toppled);
        document.body.dataset['contacts'] = String(contactCount);
        if (!physics.paused) {
            for (const { body, pose } of resettable) {
                if (body.pose.position.y < -8) {
                    body.setPose(pose);
                    body.setLinearVelocity({ x: 0, y: 0, z: 0 });
                    body.setAngularVelocity({ x: 0, y: 0, z: 0 });
                }
            }
        }
    }
});
document.body.dataset['physicsScene'] = 'impulse';
exhibit.setStatus('双击任意刚体施加冲量，或从推动骨牌开始。');
exhibit.start();
