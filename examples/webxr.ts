import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer, ticker } = await createExampleContext({ backend: 'webgl2' });

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function randomItem<Value>(values: readonly Value[]): Value {
    const value = values[Math.floor(Math.random() * values.length)];
    if (value === undefined) throw new Error('Cannot select from an empty collection.');
    return value;
}

const objects = new Hilo3d.Node();
stage.addChild(objects);
const materials = [
    new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.3, 0.6, 0.9),
        side: Hilo3d.constants.FRONT_AND_BACK
    }),
    new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.9, 0.45, 0.2),
        side: Hilo3d.constants.FRONT_AND_BACK
    })
];
const planeGeometry = new Hilo3d.PlaneGeometry();
const sphereGeometry = new Hilo3d.SphereGeometry({ radius: 0.3 });
const boxGeometry = new Hilo3d.BoxGeometry({ width: 0.3, height: 0.3, depth: 0.3 });
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const geometries = [planeGeometry, sphereGeometry, boxGeometry];

interface SelectedObject {
    started: boolean;
    mesh: Hilo3d.Node | null;
    meshPosition: Hilo3d.Vector3 | null;
    point: Hilo3d.Vector3 | null;
    distance: number;
}

const selected: SelectedObject = {
    started: false,
    mesh: null,
    meshPosition: null,
    point: null,
    distance: 0
};

for (let index = 0; index < 100; index++) {
    const mesh = new Hilo3d.Mesh({
        frustumTest: true,
        geometry: randomItem(geometries),
        material: randomItem(materials),
        x: random(-2, 2),
        y: random(-2, 2),
        z: random(-2, 2)
    });
    mesh.rotationX = Math.random() * 360;
    mesh.rotationY = Math.random() * 360;
    mesh.rotationZ = Math.random() * 360;
    mesh.setScale(random(0.2, 0.3));
    mesh.onUpdate = () => {
        if (mesh !== selected.mesh) {
            mesh.rotationX += 0.5;
            mesh.rotationY += 0.5;
            mesh.rotationZ += 0.5;
        }
    };
    objects.addChild(mesh);
}

const controllerLine = new Hilo3d.Mesh({
    geometry: new Hilo3d.Geometry({
        mode: Hilo3d.constants.LINES,
        vertices: new Hilo3d.GeometryData(new Float32Array([0, 0, 0, 0, 0, -10]), 3),
        colors: new Hilo3d.GeometryData(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1]), 4)
    }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        side: Hilo3d.constants.FRONT_AND_BACK
    })
});
const controller = new Hilo3d.Node();
controller.addChild(controllerLine);
stage.addChild(controller);

interface XRHit extends Hilo3d.NodeRaycastInfo {
    distance: number;
}

const ray = new Hilo3d.Ray();

function hitTest(): XRHit[] {
    ray.origin.set(0, 0, 0);
    ray.direction.set(0, 0, -1);
    controller.updateMatrixWorld();
    ray.transformMat4(controller.worldMatrix);
    const intersections = objects.raycast(ray) ?? [];
    const hits: XRHit[] = [];
    for (const intersection of intersections) {
        if (intersection instanceof Hilo3d.Vector3) continue;
        hits.push({
            ...intersection,
            distance: ray.distance(intersection.point)
        });
    }
    hits.sort((left, right) => left.distance - right.distance);
    if (!selected.started) controllerLine.setScale(1, 1, (hits[0]?.distance ?? 10) / 10);
    return hits;
}

let xrSession: XRSession | null = null;
let xrReferenceSpace: XRReferenceSpace | null = null;
let lastTimestamp = 0;

function updateController(frame: XRFrame): void {
    const referenceSpace = xrReferenceSpace;
    const inputSource = frame.session.inputSources[0];
    if (!referenceSpace || !inputSource) return;
    const targetRayPose = frame.getPose(inputSource.targetRaySpace, referenceSpace);
    if (!targetRayPose) return;

    controller.matrix.fromArray(targetRayPose.transform.matrix);
    controller.matrix.mul(stage.matrix.clone().invert(), controller.matrix);
    controller.updateMatrixWorld();

    const { mesh, meshPosition, point } = selected;
    if (selected.started && mesh && meshPosition && point) {
        const parent = mesh.parent;
        if (!parent) throw new Error('Selected XR object has no parent node.');
        const offset = new Hilo3d.Vector3(0, 0, -selected.distance)
            .transformMat4(controller.worldMatrix)
            .sub(point);
        const worldPosition = meshPosition.clone().add(offset);
        worldPosition.transformMat4(parent.worldMatrix.clone().invert());
        mesh.position.copy(worldPosition);
        controllerLine.setScale(1, 1, selected.distance / 10);
    } else {
        hitTest();
    }
}

function handleSelectStart(event: XRInputSourceEvent): void {
    updateController(event.frame);
    const hit = hitTest()[0];
    if (!hit) return;
    selected.started = true;
    selected.mesh = hit.mesh;
    selected.meshPosition = hit.mesh.worldMatrix.getTranslation();
    selected.point = hit.point;
    selected.distance = hit.distance;
}

function handleSelectEnd(): void {
    selected.started = false;
    selected.mesh = null;
    selected.meshPosition = null;
    selected.point = null;
}

function reportAsyncError(error: unknown): void {
    queueMicrotask(() => {
        throw error;
    });
}

function onWindowFrame(timestamp: DOMHighResTimeStamp): void {
    if (xrSession) return;
    stage.tick(timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    requestAnimationFrame(onWindowFrame);
}

function onXRFrame(timestamp: DOMHighResTimeStamp, frame: XRFrame): void {
    const session = xrSession;
    const referenceSpace = xrReferenceSpace;
    if (!session || !referenceSpace) return;

    const layer = session.renderState.baseLayer;
    if (!(layer instanceof XRWebGLLayer)) throw new Error('XR session has no WebGL base layer.');
    renderer.clearColor.set(0, 0, 0, 0);
    updateController(frame);
    renderer.gl.bindFramebuffer(renderer.gl.FRAMEBUFFER, layer.framebuffer);
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) {
        pose.views.forEach((view, index) => {
            const viewport = layer.getViewport(view);
            if (!viewport) throw new Error('XR view has no viewport.');
            renderer.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            camera.matrix.fromArray(view.transform.matrix);
            camera.projectionMatrix.fromArray(view.projectionMatrix);
            camera.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            if (index === 0) stage.tick(timestamp - lastTimestamp);
            else renderer.renderScene();
        });
    }
    lastTimestamp = timestamp;
    session.requestAnimationFrame(onXRFrame);
}

function handleSessionEnd(): void {
    xrSession = null;
    xrReferenceSpace = null;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 3);
    renderer.clearColor.set(0.3, 0.35, 0.35, 1);
    renderer.state.bindSystemFramebuffer();
    renderer.viewport();
    lastTimestamp = performance.now();
    requestAnimationFrame(onWindowFrame);
}

async function beginXRSession(): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR is not available in this browser.');
    const session = await xr.requestSession('immersive-ar');
    xrSession = session;
    session.addEventListener('end', handleSessionEnd, { once: true });
    session.addEventListener('selectstart', handleSelectStart);
    session.addEventListener('selectend', handleSelectEnd);
    xrReferenceSpace = await session.requestReferenceSpace('local');
    await renderer.gl.makeXRCompatible();
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, renderer.gl) });
    session.requestAnimationFrame(onXRFrame);
}

async function initializeXRButton(): Promise<void> {
    const xr = navigator.xr;
    const button = document.createElement('button');
    button.style.cssText = 'position:absolute;bottom:10px;left:50%;z-index:9999;';
    if (!xr || !(await xr.isSessionSupported('immersive-ar'))) {
        button.textContent = 'WebXR AR unavailable';
        button.disabled = true;
    } else {
        button.textContent = 'Enter AR';
        button.addEventListener('click', () => {
            beginXRSession().catch(reportAsyncError);
        });
    }
    document.body.append(button);
}

ticker.removeTick(stage);
renderer.initContext();
lastTimestamp = performance.now();
requestAnimationFrame(onWindowFrame);
initializeXRButton().catch(reportAsyncError);
