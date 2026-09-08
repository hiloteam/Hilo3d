import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem,
    type PhysicsPose3D,
    type PhysicsRigidBody,
    type PhysicsVector3
} from '@hilo/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createPhysicsExhibit } from './showcase';

const physicsSystem = createRapier3DPhysicsSystem({
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimeStep: 1 / 120,
    maxSubSteps: 8,
    solverIterations: 16
});
const exhibit = await createPhysicsExhibit({
    system: physicsSystem,
    chapter: '03',
    title: 'Kinetic engine',
    subtitle: '动力机械 · 旋转、往复与共振，来自同一条能量传递链。',
    accent: '#64b9ab',
    camera: [9, 7, 15],
    target: [0.15, 2.4, 0],
    mobileDistanceScale: 1
});
const { stage, ticker, material, box, cylinder, sphere, label, action, setMetric, setStatus } =
    exhibit;
const physics = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
document.body.dataset['physicsScene'] = 'joints';

const ivory = material(0xe9e4d5, 0.39, 0.16);
const porcelain = material(0xf8f3e7, 0.27, 0.1);
const teal = material(0x205c59, 0.3, 0.38);
const deepTeal = material(0x142e31, 0.38, 0.3);
const brass = material(0xd4a65b, 0.25, 0.8);
const brightBrass = material(0xf0cc84, 0.23, 0.7);
const steel = material(0xadc4bf, 0.22, 0.83);
const machine = new Hilo3d.Node().addTo(stage);
const origin: PhysicsVector3 = { x: 0, y: 0, z: 0 };
const axis: PhysicsVector3 = { x: 0, y: 0, z: 1 };
const fixed = physics.createRigidBody({ type: 'fixed' });
const resetBodies: { readonly body: PhysicsRigidBody<'3d'>; readonly pose: PhysicsPose3D }[] = [];

/** Smooth machined ring: one mesh, with a rounded cross-section. */
function ringGeometry(radius: number, tube: number): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 80;
    const sides = 10;
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * Math.PI * 2;
        for (let side = 0; side <= sides; side += 1) {
            const cross = (side / sides) * Math.PI * 2;
            const radial = radius + tube * Math.cos(cross);
            positions.push(
                radial * Math.cos(angle),
                radial * Math.sin(angle),
                tube * Math.sin(cross)
            );
            normals.push(
                Math.cos(cross) * Math.cos(angle),
                Math.cos(cross) * Math.sin(angle),
                Math.sin(cross)
            );
            if (segment < segments && side < sides) {
                const first = segment * (sides + 1) + side;
                const next = first + sides + 1;
                indices.push(first, next, first + 1, next, next + 1, first + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function ring(
    parent: Hilo3d.Node,
    x: number,
    y: number,
    z: number,
    radius: number,
    tube: number,
    surface: Hilo3d.PBRMaterial
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        x,
        y,
        z,
        geometry: ringGeometry(radius, tube),
        material: surface,
        castShadows: true,
        receiveShadows: true
    }).addTo(parent);
}

function axle(
    parent: Hilo3d.Node,
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
    surface: Hilo3d.PBRMaterial
): Hilo3d.Mesh {
    const mesh = cylinder(parent, x, y, z, radius, length, surface);
    mesh.rotationX = 90;
    return mesh;
}

function pin(parent: Hilo3d.Node, x: number, y: number, z: number, radius = 0.15): void {
    axle(parent, x, y, z, radius, 0.12, brass);
    axle(parent, x, y, z + 0.075, radius * 0.63, 0.04, steel);
    box(parent, x, y, z + 0.098, radius * 0.7, 0.022, 0.009, deepTeal).rotationZ = 35;
}

function bodyNode(
    x: number,
    y: number,
    z: number,
    halfX: number,
    halfY: number,
    mass: number
): { readonly body: PhysicsRigidBody<'3d'>; readonly node: Hilo3d.Node } {
    const body = physics.createRigidBody({
        type: 'dynamic',
        position: { x, y, z },
        linearDamping: 0.04,
        angularDamping: 0.04,
        additionalSolverIterations: 8,
        canSleep: false
    });
    physics.createCollider(
        {
            shape: { type: 'cuboid', halfExtents: { x: halfX, y: halfY, z: 0.12 } },
            mass,
            // Jointed parts overlap at their bearings; the constraints supply their mechanical contacts.
            collisionGroups: { memberships: 1, filter: 0 }
        },
        body
    );
    const node = new Hilo3d.Node({ x, y, z }).addTo(stage);
    bindNode3D(physics, body, node);
    resetBodies.push({ body, pose: body.pose });
    return { body, node };
}

function hinge(
    first: PhysicsRigidBody<'3d'>,
    second: PhysicsRigidBody<'3d'>,
    anchor1: PhysicsVector3,
    anchor2: PhysicsVector3
): void {
    physics.createJoint(
        { type: 'revolute', anchor1, anchor2, axis, contactsEnabled: false },
        first,
        second
    );
}

// A stepped porcelain plinth and continuous chassis visibly ground every bearing.
box(machine, 0.1, 0.16, 0, 10.1, 0.3, 4.1, deepTeal);
box(machine, 0.1, 0.35, 0, 9.85, 0.18, 3.9, brass);
box(machine, 0.1, 0.53, 0, 9.7, 0.23, 3.78, ivory);
box(machine, 0.1, 0.675, 0, 9.35, 0.06, 3.45, deepTeal);
for (const x of [-4.15, 4.35])
    for (const z of [-1.38, 1.38]) cylinder(machine, x, 0.76, z, 0.11, 0.08, brass);
box(machine, -2.55, 0.88, -0.15, 2.4, 0.32, 1.75, teal);
box(machine, -2.55, 1.55, -0.5, 0.72, 1.2, 0.8, teal);
box(machine, -2.55, 2.25, -0.5, 1.12, 0.24, 0.95, ivory);
axle(machine, -2.55, 2.45, -0.43, 0.43, 0.9, teal);
axle(machine, -2.55, 2.45, -0.1, 0.26, 1.1, steel);

const wheelX = -2.55;
const wheelY = 2.45;
const crankRadius = 0.82;
const rodLength = 3.1;
const sliderStart = wheelX + crankRadius + rodLength;
const planeZ = 0.62;

// Stationary chapter-ring with minute marks surrounds the open flywheel.
ring(machine, wheelX, wheelY, -0.28, 1.72, 0.065, teal);
for (let index = 0; index < 36; index += 1) {
    const angle = (index / 36) * Math.PI * 2;
    const major = index % 3 === 0;
    box(
        machine,
        wheelX + Math.cos(angle) * 1.72,
        wheelY + Math.sin(angle) * 1.72,
        -0.18,
        major ? 0.13 : 0.065,
        0.025,
        0.028,
        major ? brightBrass : steel
    ).rotationZ = (angle * 180) / Math.PI;
}
const wheel = bodyNode(wheelX, wheelY, 0, 1.45, 1.45, 7);
const motor = physics.createJoint(
    {
        type: 'revolute',
        anchor1: { x: wheelX, y: wheelY, z: 0 },
        anchor2: origin,
        axis,
        contactsEnabled: false
    },
    fixed,
    wheel.body
);
let motorDirection = -1;
let motorRunning = true;
const motorSpeed = 1.55;
function updateMotor(): void {
    motor.configureMotor({
        targetVelocity: motorRunning ? motorDirection * motorSpeed : 0,
        stiffness: 0,
        damping: 80
    });
    document.body.dataset['motorDirection'] = String(motorDirection);
    document.body.dataset['motorRunning'] = String(motorRunning);
}
updateMotor();
ring(wheel.node, 0, 0, 0.04, 1.46, 0.14, brass);
ring(wheel.node, 0, 0, 0.21, 1.45, 0.043, brightBrass);
ring(wheel.node, 0, 0, -0.13, 1.45, 0.043, brightBrass);
for (let index = 0; index < 6; index += 1) {
    const angle = (index * Math.PI) / 3;
    const spoke = new Hilo3d.Node({ rotationZ: (angle * 180) / Math.PI }).addTo(wheel.node);
    box(spoke, 0.83, 0, 0.02, 1.2, 0.19, 0.16, brass);
    box(spoke, 0.88, 0, 0.115, 0.72, 0.075, 0.024, ivory);
    pin(wheel.node, Math.cos(angle) * 1.46, Math.sin(angle) * 1.46, 0.2, 0.075);
}
axle(wheel.node, 0, 0, 0.05, 0.32, 0.48, teal);
axle(wheel.node, 0, 0, 0.33, 0.21, 0.18, brass);
box(wheel.node, crankRadius / 2, 0, 0.44, crankRadius, 0.25, 0.18, teal);
pin(wheel.node, 0, 0, 0.56, 0.2);
pin(wheel.node, crankRadius, 0, planeZ, 0.18);

// Closed crank-slider mechanism: real revolute joints at both rod ends and a prismatic guide.
const rod = bodyNode(
    wheelX + crankRadius + rodLength / 2,
    wheelY,
    planeZ,
    rodLength / 2,
    0.12,
    1.5
);
box(rod.node, 0, 0.095, 0, rodLength, 0.1, 0.14, ivory);
box(rod.node, 0, -0.095, 0, rodLength, 0.1, 0.14, ivory);
box(rod.node, 0, 0, 0, rodLength * 0.62, 0.07, 0.1, teal);
for (const x of [-rodLength / 2, rodLength / 2]) pin(rod.node, x, 0, 0.06, 0.185);
hinge(wheel.body, rod.body, { x: crankRadius, y: 0, z: planeZ }, { x: -rodLength / 2, y: 0, z: 0 });
const slider = bodyNode(sliderStart, wheelY, planeZ, 0.29, 0.31, 2.1);
box(slider.node, 0, 0, 0, 0.56, 0.55, 0.52, teal);
box(slider.node, 0, 0, 0.28, 0.42, 0.39, 0.055, porcelain);
pin(slider.node, 0, 0, 0.35, 0.15);
box(slider.node, 0, 0, -0.73, 0.14, 0.14, 1.46, steel);
sphere(slider.node, 0, 0, -1.47, 0.12, brass);
hinge(rod.body, slider.body, { x: rodLength / 2, y: 0, z: 0 }, origin);
physics.createJoint(
    {
        type: 'prismatic',
        anchor1: { x: 0, y: wheelY, z: planeZ },
        anchor2: origin,
        axis: { x: 1, y: 0, z: 0 },
        limits: [-0.5, 1.48],
        contactsEnabled: false
    },
    fixed,
    slider.body
);

// Polished guide rails, bearing blocks, a displacement ruler, and a visible return spring.
for (const x of [-0.75, 3.95]) {
    box(machine, x, 1.5, planeZ, 0.46, 1.6, 1.1, teal);
    box(machine, x, 2.17, planeZ, 0.66, 0.2, 1.32, brass);
    box(machine, x, 2.45, planeZ, 0.28, 0.55, 0.85, ivory);
    pin(machine, x, 1.23, 1.2, 0.11);
}
for (const y of [2.11, 2.79]) cylinder(machine, 1.6, y, planeZ, 0.055, 4.95, steel).rotationZ = 90;
box(machine, 1.52, 1.95, 1.28, 4.8, 0.055, 0.28, teal);
for (let index = 0; index <= 24; index += 1)
    box(
        machine,
        -0.75 + index * 0.19,
        1.986,
        1.29,
        0.018,
        0.014,
        index % 4 === 0 ? 0.22 : 0.11,
        brightBrass
    );
const returnAnchor: PhysicsVector3 = { x: 3.95, y: wheelY, z: planeZ };
const returnRestLength = 3.4;
physics.createJoint(
    {
        type: 'spring',
        anchor1: returnAnchor,
        anchor2: origin,
        restLength: returnRestLength,
        stiffness: 24,
        damping: 1.8
    },
    fixed,
    slider.body
);

// The back gantry carries a double pendulum, coupled to the slider by a second physical spring.
const pendulumX = 2.72;
const pendulumTop = 4.85;
const pendulumZ = -0.85;
for (const x of [1.48, 4.03]) {
    box(machine, x, 0.87, -1.08, 0.72, 0.3, 0.83, brass);
    box(machine, x, 2.89, -1.33, 0.22, 4.0, 0.26, teal);
    box(machine, x, 2.89, -1.16, 0.065, 3.66, 0.024, brass);
    box(machine, x, 4.92, -1.33, 0.4, 0.25, 0.43, ivory);
}
box(machine, 2.75, 5.06, -1.33, 2.95, 0.18, 0.45, ivory);
box(machine, 2.75, 5.19, -1.33, 2.99, 0.08, 0.48, brass);
axle(machine, pendulumX, pendulumTop, -1.12, 0.16, 0.7, steel);
pin(machine, pendulumX, pendulumTop, pendulumZ + 0.09, 0.19);
const linkLength = 1.08;
const upper = bodyNode(
    pendulumX,
    pendulumTop - linkLength / 2,
    pendulumZ,
    0.11,
    linkLength / 2,
    0.85
);
const lower = bodyNode(
    pendulumX,
    pendulumTop - linkLength * 1.5,
    pendulumZ,
    0.14,
    linkLength / 2,
    1.6
);
for (const link of [upper, lower]) {
    box(link.node, 0, 0, 0, 0.18, linkLength, 0.13, ivory);
    box(link.node, 0, 0, 0.085, 0.055, linkLength * 0.63, 0.035, brass);
    pin(link.node, 0, linkLength / 2, 0.11, 0.16);
    pin(link.node, 0, -linkLength / 2, 0.11, 0.16);
}
axle(lower.node, 0, -linkLength / 2, 0.03, 0.29, 0.28, brass);
axle(lower.node, 0, -linkLength / 2, 0.19, 0.2, 0.07, teal);
hinge(
    fixed,
    upper.body,
    { x: pendulumX, y: pendulumTop, z: pendulumZ },
    { x: 0, y: linkLength / 2, z: 0 }
);
hinge(
    upper.body,
    lower.body,
    { x: 0, y: -linkLength / 2, z: 0 },
    { x: 0, y: linkLength / 2, z: 0 }
);
physics.createJoint(
    {
        type: 'spring',
        anchor1: { x: 0, y: 0, z: pendulumZ - planeZ },
        anchor2: { x: 0, y: -linkLength / 2, z: 0 },
        restLength: 1.45,
        stiffness: 15,
        damping: 0.8
    },
    slider.body,
    lower.body
);

/** Unit-length spring along X; one reusable mesh stretches between the actual joint anchors. */
function springGeometry(turns: number): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = turns * 16;
    const sides = 8;
    for (let segment = 0; segment <= segments; segment += 1) {
        const t = segment / segments;
        const angle = t * turns * Math.PI * 2;
        const radius = 0.135 * Math.min(1, t * 24, (1 - t) * 24);
        for (let side = 0; side <= sides; side += 1) {
            const cross = (side / sides) * Math.PI * 2;
            const radial = radius + 0.018 * Math.cos(cross);
            positions.push(
                t + 0.007 * Math.sin(cross),
                radial * Math.cos(angle),
                radial * Math.sin(angle)
            );
            normals.push(
                Math.sin(cross),
                Math.cos(cross) * Math.cos(angle),
                Math.cos(cross) * Math.sin(angle)
            );
            if (segment < segments && side < sides) {
                const first = segment * (sides + 1) + side;
                const next = first + sides + 1;
                indices.push(first, next, first + 1, next, next + 1, first + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}
const returnSpring = new Hilo3d.Mesh({
    geometry: springGeometry(16),
    material: brightBrass,
    castShadows: true
}).addTo(stage);
const couplingSpring = new Hilo3d.Mesh({
    geometry: springGeometry(12),
    material: steel,
    castShadows: true
}).addTo(stage);
const xAxis = new Hilo3d.Vector3(1, 0, 0);
const direction = new Hilo3d.Vector3();
const bobAnchor = new Hilo3d.Vector3();
const sliderAnchor = new Hilo3d.Vector3();
function placeSpring(mesh: Hilo3d.Mesh, start: PhysicsVector3, end: PhysicsVector3): void {
    direction.set(end.x - start.x, end.y - start.y, end.z - start.z);
    const length = direction.length();
    mesh.position.set(start.x, start.y, start.z);
    mesh.scaleX = Math.max(0.01, length);
    if (length > 0.001) mesh.quaternion.rotationTo(xAxis, direction.normalize());
}

await stage.systems.install({
    descriptor: {
        id: 'example/kinetic-engine/spring-visuals',
        version: '1.0.0',
        apiVersion: 1,
        requires: [physicsSystem.descriptor.id]
    },
    setup(): Hilo3d.StageSystemRuntime {
        return {
            beforeRender(): void {
                // Read this frame's interpolated poses after physics, before emitting draw commands.
                placeSpring(returnSpring, slider.node.position, returnAnchor);
                bobAnchor
                    .set(0, -linkLength / 2, 0)
                    .transformQuat(lower.node.quaternion)
                    .add(lower.node.position);
                sliderAnchor.set(slider.node.x, slider.node.y, pendulumZ);
                placeSpring(couplingSpring, sliderAnchor, bobAnchor);
            }
        };
    }
});

label(machine, '01  /  ROTARY DRIVE', -2.55, 0.99, 1.45, 2.15, '#e8d5ad');
label(machine, '02  /  LINEAR OUTPUT', 0.9, 0.99, 1.45, 2.05, '#e8d5ad');
label(machine, '03  /  COUPLED RESONANCE', 2.75, 5.48, -1.1, 2.6, '#aacac3');
label(machine, 'THE KINETIC WORKSHOP', 0.1, 0.37, 1.96, 4.0, '#24443e');

const motorButton = action('motor-toggle', '停止电机', (): void => {
    motorRunning = !motorRunning;
    motorButton.textContent = motorRunning ? '停止电机' : '启动电机';
    updateMotor();
    setStatus(
        motorRunning ? '电机驱动中 · 曲柄将旋转转化为往复运动' : '电机制动 · 弹簧与双摆继续交换能量'
    );
});
action('motor-reverse', '反转电机', (): void => {
    motorDirection *= -1;
    updateMotor();
    setStatus('驱动方向已反转 · 观察飞轮与滑块相位的变化');
});
let impulseCount = 0;
action('pendulum-impulse', '拨动双摆', (): void => {
    lower.body.applyImpulse({ x: -2.6, y: 0.45, z: 0 });
    impulseCount += 1;
    document.body.dataset['impulseCount'] = String(impulseCount);
    setStatus('脉冲已施加 · 双摆扰动通过弹簧反馈到连杆机构');
});
action('machine-reset', '重置机械', (): void => {
    for (const entry of resetBodies) {
        entry.body.setPose(entry.pose);
        entry.body.setLinearVelocity(origin);
        entry.body.setAngularVelocity(origin);
    }
    motorDirection = -1;
    motorRunning = true;
    motorButton.textContent = '停止电机';
    impulseCount = 0;
    document.body.dataset['impulseCount'] = '0';
    updateMotor();
    setStatus('机械已复位 · 飞轮、连杆、滑块与双摆重新同步');
});
let metricTime = 0;
ticker.addTick({
    tick(deltaTime: number): void {
        metricTime += deltaTime;
        if (metricTime < 120) return;
        metricTime = 0;
        const rpm = (wheel.body.angularVelocity.z * 60) / (Math.PI * 2);
        const sliderX = slider.body.pose.position.x;
        const springLength = returnAnchor.x - sliderX;
        const springEnergy = 0.5 * 24 * (springLength - returnRestLength) ** 2;
        const diagnostics = physics.getDiagnostics();
        setMetric('rpm', '电机转速', `${rpm.toFixed(1)} rpm`);
        setMetric(
            'stroke',
            '滑块位移',
            `${((sliderX - (wheelX - crankRadius + rodLength)) * 100).toFixed(0)} cm`
        );
        setMetric('spring', '弹簧势能', `${springEnergy.toFixed(2)} J`);
        setMetric('joints', '约束 / 求解', `${String(diagnostics.jointCount)} / 120 Hz`);
        document.body.dataset['motorRpm'] = rpm.toFixed(3);
        document.body.dataset['sliderPosition'] = sliderX.toFixed(4);
        document.body.dataset['jointCount'] = String(diagnostics.jointCount);
        document.body.dataset['physicsSteps'] = String(diagnostics.simulatedSteps);
    }
});
document.body.dataset['impulseCount'] = '0';
setStatus('电机驱动中 · 拨动双摆，让扰动沿弹簧传回整台机械');
exhibit.start();
