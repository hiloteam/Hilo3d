import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem
} from '@hilo/addon-physics/rapier3d';
import * as Hilo3d from '../../src/Hilo3d';
import { createPhysicsExhibit } from './showcase';
import {
    createMaterialExperiments,
    MATERIAL_EXPERIMENT_LAYOUT,
    MATERIAL_EXPERIMENT_PHYSICS,
    materialLanePosition,
    materialSlideDistance
} from './materialExperiments';

const physicsSystem = createRapier3DPhysicsSystem(MATERIAL_EXPERIMENT_PHYSICS);
const exhibit = await createPhysicsExhibit({
    system: physicsSystem,
    chapter: '02',
    title: 'Material atelier',
    subtitle: '材质实验室 · 在同样的条件下，看见弹性与摩擦的差异。',
    accent: '#e98454',
    camera: [12, 10, 15.2],
    target: [-0.8, 1.7, 0.3],
    mobileDistanceScale: 1.15
});
const { stage, ticker, material, box, sphere, cylinder, label } = exhibit;
const physics = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
const experiments = createMaterialExperiments(physics);
const { bounceStations, frictionLanes } = experiments;
const bounceIndicators: Hilo3d.Mesh[] = [];
const slideIndicators: Hilo3d.Mesh[] = [];
const { ballRadius, impactSurfaceY, releaseY, slopeDegrees, laneCenterY } =
    MATERIAL_EXPERIMENT_LAYOUT;
document.body.dataset['physicsScene'] = 'materials';

const porcelain = material(0xf3ebda, 0.42);
const inset = material(0xd8d0bd, 0.62);
const ink = material(0x203b3c, 0.32, 0.25);
const brass = material(0xc6a15e, 0.29, 0.72);
const rubber = material(0x304442, 0.85);
const railMetal = material(0x77958c, 0.32, 0.5);
const specimenColors = [0xe77c50, 0x43968a, 0xd5ad4b, 0xa96955] as const;
const specimenMaterials = specimenColors.map(color => material(color, 0.24, 0.12));
const markerMaterials = specimenColors.map(color => material(color, 0.43));

// A single ceramic workbench gives the two experiments their own, non-overlapping footprints.
box(stage, 0, -0.03, 0.65, 11.5, 0.34, 9.05, ink);
box(stage, 0, 0.17, 0.65, 11.35, 0.12, 8.9, porcelain);
box(stage, 0, 0.237, 0.65, 11.05, 0.025, 8.62, inset);
for (const x of [-4.85, 4.85]) {
    for (const z of [-2.8, 4.1]) {
        cylinder(stage, x, -0.31, z, 0.31, 0.24, rubber);
        cylinder(stage, x, -0.16, z, 0.24, 0.1, brass);
    }
}
box(stage, 0, 0.27, -0.44, 10.8, 0.04, 0.06, brass);
label(stage, '01 — RESTITUTION', -3.85, 0.26, -0.72, 2.2, '#244542').rotationX = -90;
label(stage, '02 — SURFACE FRICTION', -3.72, 0.26, 4.72, 2.75, '#244542').rotationX = -90;
label(stage, 'MATERIAL ATELIER / 02', 3.67, 0.08, 5.184, 2.75, '#e7dfcb');

for (const [index, station] of bounceStations.entries()) {
    const { coefficient, position, body } = station;
    const x = position.x;
    const z = position.z - 0.07;
    const specimen = specimenMaterials[index] ?? porcelain;
    const markerMaterial = markerMaterials[index] ?? brass;

    // Instrument housings, steel guide uprights, and engraved brass calibration marks.
    box(stage, x, 0.43, z, 2.18, 0.36, 2.12, porcelain);
    box(stage, x, 0.625, z, 1.94, 0.03, 1.9, ink);
    cylinder(stage, x, 0.685, z + 0.07, 0.72, 0.1, brass);
    cylinder(stage, x, 0.775, z + 0.07, 0.62, 0.09, rubber);
    for (const side of [-1, 1]) {
        cylinder(stage, x + side * 0.8, 2.75, z - 0.52, 0.065, 4.2, railMetal);
        cylinder(stage, x + side * 0.8, 0.71, z - 0.52, 0.16, 0.16, brass);
        cylinder(stage, x + side * 0.8, 4.85, z - 0.52, 0.11, 0.13, brass);
        cylinder(stage, x + side * 0.79, 0.658, z + 0.72, 0.06, 0.035, brass);
    }
    box(stage, x, 4.8, z - 0.52, 1.9, 0.22, 0.42, ink);
    box(stage, x, 4.78, z - 0.29, 1.3, 0.055, 0.025, markerMaterial);
    box(stage, x - 0.68, 2.73, z - 0.45, 0.15, 3.82, 0.11, ink);
    for (let tick = 0; tick <= 7; tick += 1) {
        box(
            stage,
            x - 0.65,
            1.1 + tick * 0.46,
            z - 0.362,
            tick % 2 ? 0.12 : 0.22,
            0.025,
            0.03,
            brass
        );
    }
    const indicator = box(stage, x - 0.48, releaseY, z - 0.35, 0.24, 0.085, 0.09, markerMaterial);
    label(
        stage,
        `0${String(index + 1)}  /  e ${coefficient.toFixed(2)}`,
        x,
        0.445,
        z + 1.069,
        1.8,
        '#294843'
    );
    label(
        stage,
        `e² = ${String(Math.round(coefficient * coefficient * 100))}%`,
        x,
        4.825,
        z - 0.3,
        1.42,
        '#eee5cc'
    );

    const ball = new Hilo3d.Node({ x: position.x, y: position.y, z: position.z }).addTo(stage);
    sphere(ball, 0, 0, 0, ballRadius, specimen);
    // The small inset makes even a stationary sample read as a machined specimen.
    sphere(ball, 0, 0.06, ballRadius * 0.9, 0.075, brass);
    bindNode3D(physics, body, ball);
    bounceIndicators.push(indicator);
}

for (const [index, sample] of frictionLanes.entries()) {
    const { coefficient, position, body } = sample;
    const z = position.z;
    const specimen = specimenMaterials[index] ?? porcelain;
    const markerMaterial = markerMaterials[index] ?? brass;
    const lane = new Hilo3d.Node({ y: laneCenterY, z, rotationZ: slopeDegrees }).addTo(stage);

    // Each ramp is one continuous bed. Edge guards and the soft stop belong to the same incline.
    box(lane, 0, 0, 0, 8.5, 0.17, 0.95, porcelain);
    box(lane, 0, 0.094, 0, 8.2, 0.018, 0.77, ink);
    for (const side of [-1, 1]) {
        box(lane, 0, 0.2, side * 0.46, 8.52, 0.2, 0.065, railMetal);
        box(lane, 0, 0.314, side * 0.46, 8.5, 0.025, 0.075, brass);
    }
    for (let tick = 0; tick <= 6; tick += 1) {
        box(lane, -3 + tick, 0.323, 0.46, 0.025, 0.018, 0.11, porcelain);
    }
    box(lane, 3.95, 0.285, 0, 0.19, 0.38, 0.79, rubber);
    box(lane, 4.08, 0.285, 0, 0.075, 0.44, 0.88, markerMaterial);
    const indicator = box(lane, -3.3, 0.36, 0.46, 0.15, 0.07, 0.11, markerMaterial);
    const highFoot = materialLanePosition(-3.8, -0.1, z);
    const lowFoot = materialLanePosition(3.8, -0.1, z);
    for (const foot of [highFoot, lowFoot]) {
        const height = Math.max(0.12, foot.y - 0.27);
        box(stage, foot.x, 0.27 + height / 2, z, 0.32, height, 0.69, ink);
        box(stage, foot.x, 0.29, z, 0.62, 0.08, 0.88, brass);
    }
    box(stage, -4.8, 0.74, z + 0.39, 0.96, 0.26, 0.05, porcelain);
    label(stage, `μ ${coefficient.toFixed(2)}`, -4.8, 0.74, z + 0.421, 0.84, '#294843');
    const sled = new Hilo3d.Node({
        x: position.x,
        y: position.y,
        z,
        rotationZ: slopeDegrees
    }).addTo(stage);
    box(sled, 0, -0.16, 0, 0.69, 0.18, 0.61, brass);
    box(sled, 0, 0.065, 0, 0.67, 0.27, 0.59, specimen);
    cylinder(sled, 0, 0.23, 0, 0.17, 0.11, brass);
    cylinder(sled, 0, 0.295, 0, 0.12, 0.025, ink);
    bindNode3D(physics, body, sled);
    slideIndicators.push(indicator);
}

let releaseStep = physics.getDiagnostics().simulatedSteps;
let releaseCount = 1;
let lastMetricStep = -1;

function replay(): void {
    experiments.reset();
    releaseStep = physics.getDiagnostics().simulatedSteps;
    releaseCount += 1;
    lastMetricStep = -1;
    updateReadouts();
}

function updateReadouts(): void {
    const steps = physics.getDiagnostics().simulatedSteps;
    const elapsed = (steps - releaseStep) * physics.fixedTimeStep;
    let contactCount = 0;
    let highRebound = 0;
    let longestSlide = 0;
    const heights: string[] = [];
    const distances: string[] = [];
    for (const [index, station] of bounceStations.entries()) {
        const height = Math.max(0, station.body.pose.position.y - impactSurfaceY - ballRadius);
        const indicator = bounceIndicators[index];
        if (indicator) indicator.y = station.body.pose.position.y;
        if (station.contacts === 1) station.reboundHeight = Math.max(station.reboundHeight, height);
        contactCount += station.contacts;
        highRebound = Math.max(highRebound, station.reboundHeight);
        heights.push(height.toFixed(3));
    }
    for (const [index, sample] of frictionLanes.entries()) {
        const distance = materialSlideDistance(sample);
        const indicator = slideIndicators[index];
        if (indicator) indicator.x = -3.3 + distance;
        longestSlide = Math.max(longestSlide, distance);
        distances.push(distance.toFixed(3));
    }
    document.body.dataset['physicsSteps'] = String(steps);
    document.body.dataset['physicsRelease'] = String(releaseCount);
    document.body.dataset['physicsContacts'] = String(contactCount);
    document.body.dataset['physicsHeights'] = heights.join(',');
    document.body.dataset['physicsSlides'] = distances.join(',');
    document.body.dataset['physicsElapsed'] = elapsed.toFixed(3);
    if (lastMetricStep >= 0 && steps - lastMetricStep < 12) return;
    lastMetricStep = steps;
    exhibit.setMetric('elapsed', '实验时间', `${elapsed.toFixed(1)} s`);
    exhibit.setMetric('rebound', '最高首次回弹', `${highRebound.toFixed(2)} m`);
    exhibit.setMetric('travel', '最大滑行距离', `${longestSlide.toFixed(2)} m`);
    exhibit.setMetric('contacts', '累计落球碰撞', String(contactCount).padStart(2, '0'));
    exhibit.setStatus(
        elapsed < 0.8
            ? '同高释放 · 四种弹性 / 四种摩擦'
            : elapsed < 4
              ? '回弹保存能量；低摩擦试样沿坡面滑行。'
              : 'μ ≥ tan 12° 的试样留在起点 · 点击「重新释放」比较'
    );
}

exhibit.action('replay', '重新释放', replay);
updateReadouts();
ticker.addTick({
    tick(): void {
        updateReadouts();
    }
});
exhibit.start();
