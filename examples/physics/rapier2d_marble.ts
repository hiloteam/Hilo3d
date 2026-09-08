import {
    PHYSICS_WORLD_2D_SERVICE,
    bindNode2D,
    createRapier2DPhysicsSystem,
    type PhysicsColliderEvent,
    type PhysicsJoint,
    type PhysicsRigidBody
} from '@hilo/addon-physics/rapier2d';
import * as Hilo3d from '../../src/Hilo3d';
import { createPhysicsExhibit } from './showcase';

const FIXED_STEP = 1 / 60;
const MARBLE_COUNT = 30;
const physicsSystem = createRapier2DPhysicsSystem({
    gravity: { x: 0, y: -7.4 },
    fixedTimeStep: FIXED_STEP,
    maxSubSteps: 5,
    solverIterations: 10,
    maxCcdSubsteps: 3
});
const exhibit = await createPhysicsExhibit({
    system: physicsSystem,
    chapter: '04',
    title: 'Marble works',
    subtitle: '弹珠工坊 · 重力、碰撞、电机关节与传感器，合奏一台永不停歇的机器。',
    accent: '#d99b52',
    camera: [0.7, 0.8, 19.5],
    target: [0, 0, 0],
    floorY: -5.96
});
const { stage, ticker, material, box, sphere, cylinder, label, setMetric, setStatus, action } =
    exhibit;
const physics = stage.systems.get(PHYSICS_WORLD_2D_SERVICE);

const cream = material(0xf3ebd9, 0.66);
const porcelain = material(0xfff7e8, 0.3);
const teal = material(0x205c59, 0.32, 0.2);
const darkTeal = material(0x173c3e, 0.52, 0.14);
const vermilion = material(0xd8583d, 0.28, 0.12);
const brass = material(0xd4aa60, 0.28, 0.7);
const paleBrass = material(0xf0d6a0, 0.42, 0.45);
const shadow = material(0x59706a, 0.78);
const marbleMaterials = [
    material(0xdd593e, 0.18, 0.2),
    material(0x2e8480, 0.17, 0.3),
    material(0xe7b75c, 0.2, 0.44),
    material(0xfff7e4, 0.16, 0.15)
] as const;

function disc(
    parent: Hilo3d.Node,
    x: number,
    y: number,
    z: number,
    radius: number,
    depth: number,
    surface: Hilo3d.PBRMaterial
): Hilo3d.Mesh {
    const mesh = cylinder(parent, x, y, z, radius, depth, surface);
    mesh.rotationX = 90;
    return mesh;
}

function rail(x: number, y: number, width: number, angle = 0, surface = teal, height = 0.15): void {
    const body = physics.createRigidBody({ type: 'fixed', position: { x, y }, rotation: angle });
    physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: width / 2, y: height / 2 } },
            friction: 0.22,
            restitution: 0.28
        },
        body
    );
    const railNode = new Hilo3d.Node({ x, y, rotationZ: (angle * 180) / Math.PI }).addTo(stage);
    box(railNode, 0, 0, 0.12, width, height, 0.48, surface);
    box(railNode, 0, height / 2 + 0.018, 0.27, width, 0.035, 0.1, paleBrass);
}

// The entire mechanism occupies the XY plane; the cabinet is a layered 3D presentation.
box(stage, 0, 0, -0.95, 12.45, 10.85, 0.9, darkTeal);
box(stage, 0, 0, -0.42, 12.06, 10.46, 0.18, brass);
box(stage, 0, 0, -0.25, 11.77, 10.17, 0.2, cream);
box(stage, 0, 4.66, -0.07, 11.2, 0.72, 0.15, teal);
box(stage, 0, -4.76, -0.06, 11.2, 0.42, 0.15, teal);
label(stage, 'MARBLE  /  WORKS', -2.2, 4.67, 0.055, 5.35, '#fff5df');
label(stage, 'No. 04   /   GRAVITY AS A MATERIAL', 3.1, 4.67, 0.055, 3.62, '#efd29a');
label(stage, 'PRECISION PLAY  ·  CLOSED-LOOP MARBLE MACHINE', 0, -4.77, 0.055, 7.5, '#f4deb4');

for (const x of [-5.98, 5.98]) {
    for (const y of [-5.05, -2.5, 0, 2.5, 5.05]) {
        disc(stage, x, y, -0.11, 0.095, 0.08, paleBrass);
        box(stage, x, y, -0.057, 0.085, 0.014, 0.015, darkTeal).rotationZ = 35;
    }
}
for (const x of [-4.3, 4.3]) {
    box(stage, x, -5.57, -0.69, 1.35, 0.4, 1.1, darkTeal);
    box(stage, x, -5.79, -0.61, 1.5, 0.1, 1.2, brass);
}

rail(-5.5, 0, 8.65, Math.PI / 2, teal, 0.18);
rail(5.5, 0, 8.65, Math.PI / 2, teal, 0.18);
rail(0, 4.24, 11.15, 0, teal, 0.16);
rail(0, -4.24, 11.15, 0, teal, 0.2);
rail(-3.35, 3.24, 4.3, -0.16);
rail(3.35, 3.24, 4.3, 0.16);
rail(-3.35, 1.45, 3.54, 0.18, vermilion);
rail(3.35, 1.45, 3.54, -0.18, vermilion);

// Mounting blocks and engineering captions give the machine a manufactured scale.
for (const x of [-4.8, 4.8]) {
    box(stage, x, 2.98, -0.015, 0.46, 0.4, 0.18, shadow);
    disc(stage, x, 2.97, 0.13, 0.075, 0.11, brass);
}
label(stage, '01  /  GRAVITY FEED', -3.3, 3.78, -0.08, 3.1, '#48665f');
label(stage, '02  /  MOTOR SPLITTER', 3.3, 3.78, -0.08, 3.35, '#48665f');
label(stage, '03  /  COLLISION FIELD', 0, -1.59, -0.08, 3.05, '#48665f');

interface Motor {
    readonly body: PhysicsRigidBody<'2d'>;
    readonly joint: PhysicsJoint<'2d'>;
    readonly speed: number;
}

const motors: Motor[] = [];

function rotor(
    x: number,
    y: number,
    radius: number,
    speed: number,
    surface: Hilo3d.PBRMaterial
): void {
    disc(stage, x, y, -0.08, radius + 0.15, 0.09, paleBrass);
    disc(stage, x, y, -0.015, radius + 0.07, 0.06, porcelain);
    const anchor = physics.createRigidBody({ type: 'fixed', position: { x, y } });
    const body = physics.createRigidBody({
        type: 'dynamic',
        position: { x, y },
        gravityScale: 0,
        angularDamping: 0.04,
        continuousCollisionDetection: true
    });
    const visual = new Hilo3d.Node({ x, y }).addTo(stage);
    for (let index = 0; index < 3; index += 1) {
        const angle = (index * Math.PI) / 3;
        physics.createCollider(
            {
                shape: { type: 'cuboid', halfExtents: { x: radius, y: 0.085 } },
                localRotation: angle,
                density: 2.5,
                friction: 0.25,
                restitution: 0.52
            },
            body
        );
        box(visual, 0, 0, 0.2, radius * 2, 0.17, 0.3, surface).rotationZ = (angle * 180) / Math.PI;
    }
    for (let index = 0; index < 6; index += 1) {
        const angle = (index * Math.PI) / 3;
        disc(
            visual,
            Math.cos(angle) * (radius - 0.12),
            Math.sin(angle) * (radius - 0.12),
            0.37,
            0.062,
            0.045,
            paleBrass
        );
    }
    disc(visual, 0, 0, 0.38, radius * 0.32, 0.16, brass);
    disc(visual, 0, 0, 0.48, radius * 0.17, 0.08, darkTeal);
    box(visual, 0, 0, 0.535, radius * 0.21, 0.03, 0.02, paleBrass);
    const joint = physics
        .createJoint(
            { type: 'revolute', anchor1: { x: 0, y: 0 }, anchor2: { x: 0, y: 0 } },
            anchor,
            body
        )
        .configureMotor({ targetVelocity: speed, stiffness: 0, damping: 14 });
    bindNode2D(physics, body, visual);
    motors.push({ body, joint, speed });
}

rotor(0, 2.15, 1.03, 1.5, vermilion);
rotor(-3.25, 0.05, 0.75, -1.9, teal);
rotor(3.25, 0.05, 0.75, 1.9, teal);

// Three tapered routes stay open below the rotors, so dense marble traffic can drain freely.
rail(-4.59, -1.18, 1.44, -0.3, teal);
rail(4.59, -1.18, 1.44, 0.3, teal);
rail(-0.53, 0.53, 1.14, 0.5, brass, 0.12);
rail(0.53, 0.53, 1.14, -0.5, brass, 0.12);

for (let row = 0; row < 3; row += 1) {
    const count = row === 1 ? 6 : 7;
    for (let column = 0; column < count; column += 1) {
        const x = (column - (count - 1) / 2) * 1.44;
        const y = -0.89 - row * 0.83;
        if (row === 0 && Math.abs(x) > 2.6) continue;
        const body = physics.createRigidBody({ type: 'fixed', position: { x, y } });
        physics.createCollider(
            { shape: { type: 'ball', radius: 0.12 }, friction: 0.14, restitution: 0.67 },
            body
        );
        disc(stage, x, y, 0.06, 0.185, 0.2, paleBrass);
        sphere(stage, x, y, 0.24, 0.12, brass);
    }
}

interface Marble {
    readonly body: PhysicsRigidBody<'2d'>;
    readonly index: number;
    releasedAt: number;
    scoredAt: number | null;
    cycles: number;
}

interface ScoreLane {
    readonly indicator: Hilo3d.Mesh;
    readonly points: number;
    hits: number;
    litUntil: number;
}

const marbles: Marble[] = [];
const marblesByBody = new Map<number, Marble>();
const lanes: ScoreLane[] = [];
let passes = 0;
let totalScore = 0;
let recycles = 0;
let motorDirection = 1;
let launchCursor = 0;

for (let index = 0; index < 5; index += 1) {
    const x = (index - 2) * 2.12;
    const points = [10, 25, 50, 25, 10][index] ?? 10;
    box(stage, x, -3.59, -0.035, 1.93, 1.06, 0.16, index === 2 ? vermilion : teal);
    box(stage, x, -3.41, 0.055, 1.61, 0.045, 0.07, paleBrass);
    label(stage, String(points).padStart(2, '0'), x, -3.73, 0.08, 6, '#fff3d4');
    const indicator = disc(stage, x, -3.13, 0.15, 0.067, 0.07, paleBrass);
    const lane: ScoreLane = { indicator, points, hits: 0, litUntil: 0 };
    lanes.push(lane);
    const sensorBody = physics.createRigidBody({ type: 'fixed', position: { x, y: -3.61 } });
    const sensor = physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: 0.96, y: 0.16 } },
            sensor: true,
            collisionEvents: true
        },
        sensorBody
    );
    sensor.on('collisionstart', event => {
        const collision = event as PhysicsColliderEvent<'2d'>;
        const marble = marblesByBody.get(collision.other.parent?.handle ?? -1);
        if (marble?.scoredAt !== null) return;
        const now = physics.getDiagnostics().simulatedSteps * FIXED_STEP;
        marble.scoredAt = now;
        passes += 1;
        lane.hits += 1;
        totalScore += lane.points;
        lane.litUntil = now + 0.4;
    });
    if (index < 4) rail(x + 1.06, -3.62, 1.02, Math.PI / 2, brass, 0.11);
}

for (let index = 0; index < MARBLE_COUNT; index += 1) {
    const radius = 0.165 + (index % 3) * 0.016;
    // A seeded first frame fills the entire mechanism before the return loop takes over.
    const position = {
        x: -4.87 + (index % 10) * 1.08,
        y: 3.88 - Math.floor(index / 10) * 2.22
    };
    const body = physics.createRigidBody({
        type: 'dynamic',
        position,
        linearDamping: 0.012,
        angularDamping: 0.025,
        continuousCollisionDetection: true
    });
    physics.createCollider(
        {
            shape: { type: 'ball', radius },
            density: 1.5,
            friction: 0.15,
            restitution: 0.53,
            collisionEvents: true
        },
        body
    );
    const mesh = sphere(
        stage,
        position.x,
        position.y,
        0.41,
        radius,
        marbleMaterials[index % marbleMaterials.length] ?? marbleMaterials[0]
    );
    bindNode2D(physics, body, mesh);
    const marble: Marble = { body, index, releasedAt: 0, scoredAt: null, cycles: 0 };
    marbles.push(marble);
    marblesByBody.set(body.handle, marble);
}

function release(marble: Marble, now: number): void {
    marble.cycles += 1;
    const inlet = (marble.index * 7 + marble.cycles * 3) % 10;
    const x = -4.85 + inlet * 1.075;
    marble.body.setPose({ position: { x, y: 3.9 }, rotation: 0 });
    marble.body.setLinearVelocity({ x: x < 0 ? 0.45 : -0.45, y: -0.12 });
    marble.body.setAngularVelocity(x < 0 ? -0.8 : 0.8);
    marble.releasedAt = now;
    marble.scoredAt = null;
    recycles += 1;
}

action('marble-release', '释放六颗 · Release', () => {
    const now = physics.getDiagnostics().simulatedSteps * FIXED_STEP;
    for (let index = 0; index < 6; index += 1) {
        const marble = marbles[launchCursor % MARBLE_COUNT];
        if (marble) release(marble, now);
        launchCursor += 1;
    }
    setStatus('六颗弹珠已进入重力轨道 · Six marbles released');
});

action('marble-reverse', '电机反转 · Reverse', () => {
    motorDirection *= -1;
    for (const motor of motors) {
        motor.joint.configureMotor({
            targetVelocity: motor.speed * motorDirection,
            stiffness: 0,
            damping: 14
        });
        motor.body.wake();
    }
    document.body.dataset['motorDirection'] = String(motorDirection);
    setStatus(
        motorDirection === 1 ? '电机顺向运行 · Forward drive' : '电机反向运行 · Reverse drive'
    );
});

setMetric('marbles', 'LIVE MARBLES', String(MARBLE_COUNT));
setMetric('score', 'TOTAL SCORE', '00000');
setMetric('passes', 'SENSOR PASSES', '0');
setMetric('motors', 'MOTOR DRIVE', '3 × REVOLUTE');
setStatus('重力进料 → 电机分流 → 钉阵碰撞 → 传感计分 → 回收循环');
document.body.dataset['physicsScene'] = 'marble';
document.body.dataset['motorDirection'] = '1';
document.body.dataset['physicsMarbles'] = String(MARBLE_COUNT);

let lastMetricsStep = -1;
const machineTick: Hilo3d.Tickable = {
    tick(): void {
        const diagnostics = physics.getDiagnostics();
        const now = diagnostics.simulatedSteps * FIXED_STEP;
        if (!physics.paused && physics.timeScale > 0) {
            for (const marble of marbles) {
                const position = marble.body.pose.position;
                const scored = marble.scoredAt !== null && now - marble.scoredAt > 0.32;
                const escaped = position.y < -4.8 || Math.abs(position.x) > 6.2;
                // A bounded residence time releases any rare stable contact pocket.
                const stalled = now - marble.releasedAt > 16;
                if (scored || escaped || stalled) release(marble, now);
            }
        }
        for (const lane of lanes) {
            const lit = now < lane.litUntil;
            lane.indicator.scaleX = lit ? 0.114 : 0.067;
            lane.indicator.scaleZ = lit ? 0.114 : 0.067;
            lane.indicator.material = lit ? vermilion : paleBrass;
        }
        if (diagnostics.simulatedSteps - lastMetricsStep < 6) return;
        lastMetricsStep = diagnostics.simulatedSteps;
        setMetric('score', 'TOTAL SCORE', String(totalScore).padStart(5, '0'));
        setMetric('passes', 'SENSOR PASSES', String(passes));
        document.body.dataset['physicsPasses'] = String(passes);
        document.body.dataset['physicsScore'] = String(totalScore);
        document.body.dataset['physicsRecycles'] = String(recycles);
        document.body.dataset['physicsSteps'] = String(diagnostics.simulatedSteps);
        document.body.dataset['physicsLanes'] = lanes.map(lane => lane.hits).join(',');
        document.body.dataset['physicsRotor'] = (motors[0]?.body.pose.rotation ?? 0).toFixed(3);
    }
};
ticker.addTick(machineTick);
exhibit.start();
