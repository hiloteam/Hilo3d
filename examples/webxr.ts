import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const XR_LAYER_OPTIONS = Object.freeze({
    alpha: true,
    antialias: false,
    depth: true,
    stencil: false
});

const { camera, stage, renderer, ticker } = await createExampleContext({
    backend: 'webgl2',
    stage: XR_LAYER_OPTIONS
});

interface WebGL2NativeExtension {
    readonly state: { bindSystemFramebuffer(): void };
    makeXRCompatible(): Promise<void>;
    createXRWebGLLayer(session: XRSession, init?: XRWebGLLayerInit): XRWebGLLayer;
    bindExternalFramebuffer(framebuffer: WebGLFramebuffer, width: number, height: number): void;
    renderScene(): void;
    viewport(x?: number, y?: number, width?: number, height?: number): void;
}

function requireWebGL2NativeExtension(): WebGL2NativeExtension {
    const extension = renderer.getExtension('webgl2-native') as WebGL2NativeExtension | null;
    if (!extension) throw new Error('The WebGL2 native extension is unavailable.');
    return extension;
}

const native = requireWebGL2NativeExtension();

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
let webGLContextLost = false;
let windowFrameRequested = false;
const ignoredSessionEnds = new WeakSet<XRSession>();

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
    windowFrameRequested = false;
    if (xrSession || webGLContextLost) return;
    stage.tick(timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    requestWindowFrame();
}

function requestWindowFrame(): void {
    if (windowFrameRequested || xrSession || webGLContextLost) return;
    windowFrameRequested = true;
    requestAnimationFrame(onWindowFrame);
}

function onXRFrame(timestamp: DOMHighResTimeStamp, frame: XRFrame): void {
    const session = xrSession;
    const referenceSpace = xrReferenceSpace;
    if (!session || !referenceSpace || webGLContextLost) return;

    const layer = session.renderState.baseLayer;
    if (!(layer instanceof XRWebGLLayer)) throw new Error('XR session has no WebGL base layer.');
    renderer.clearColor.set(0, 0, 0, 0);
    updateController(frame);
    native.bindExternalFramebuffer(
        layer.framebuffer,
        layer.framebufferWidth,
        layer.framebufferHeight
    );
    const pose = frame.getViewerPose(referenceSpace);
    if (pose) {
        pose.views.forEach((view, index) => {
            const viewport = layer.getViewport(view);
            if (!viewport) throw new Error('XR view has no viewport.');
            native.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            camera.matrix.fromArray(view.transform.matrix);
            camera.projectionMatrix.fromArray(view.projectionMatrix);
            camera.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            if (index === 0) stage.tick(timestamp - lastTimestamp);
            else native.renderScene();
        });
    }
    lastTimestamp = timestamp;
    session.requestAnimationFrame(onXRFrame);
}

function handleSessionEnd(event: Event): void {
    const endedSession = event.currentTarget as XRSession | null;
    if (endedSession !== null && ignoredSessionEnds.has(endedSession)) {
        ignoredSessionEnds.delete(endedSession);
        return;
    }
    xrSession = null;
    xrReferenceSpace = null;
    if (webGLContextLost) return;
    restoreWindowPresentation();
}

function restoreWindowPresentation(): void {
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 3);
    renderer.clearColor.set(0.3, 0.35, 0.35, 1);
    native.state.bindSystemFramebuffer();
    native.viewport();
    lastTimestamp = performance.now();
    requestWindowFrame();
}

function restoreWindowPresentationAfterXRFailure(): void {
    if (!webGLContextLost) restoreWindowPresentation();
}

function handleWebGLContextLost(): void {
    if (webGLContextLost) return;
    webGLContextLost = true;
    const session = xrSession;
    if (session) {
        session.end().catch((error: unknown) => {
            if (xrSession === session) {
                xrSession = null;
                xrReferenceSpace = null;
            }
            if (!webGLContextLost) restoreWindowPresentation();
            reportAsyncError(error);
        });
    }
}

function handleWebGLContextRestored(): void {
    webGLContextLost = false;
    if (xrSession === null) restoreWindowPresentation();
}

async function beginXRSession(): Promise<void> {
    if (webGLContextLost) throw new Error('WebGL2 context recovery is in progress.');
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR is not available in this browser.');
    const session = await xr.requestSession('immersive-ar');
    xrSession = session;
    session.addEventListener('end', handleSessionEnd, { once: true });
    session.addEventListener('selectstart', handleSelectStart);
    session.addEventListener('selectend', handleSelectEnd);
    try {
        xrReferenceSpace = await session.requestReferenceSpace('local');
        await native.makeXRCompatible();
        await session.updateRenderState({
            baseLayer: native.createXRWebGLLayer(session, XR_LAYER_OPTIONS)
        });
        session.requestAnimationFrame(onXRFrame);
    } catch (error) {
        ignoredSessionEnds.add(session);
        if (xrSession === session) {
            xrSession = null;
            xrReferenceSpace = null;
        }
        try {
            await session.end();
        } catch {
            // Preserve the initialization failure; the session may already be ending.
        }
        restoreWindowPresentationAfterXRFailure();
        throw error;
    }
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
renderer.on('webglContextLost', handleWebGLContextLost);
renderer.on('webglContextRestored', handleWebGLContextRestored);
lastTimestamp = performance.now();
requestWindowFrame();
initializeXRButton().catch(reportAsyncError);
