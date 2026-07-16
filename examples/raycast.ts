import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage } = await createExampleContext();
const queriedHitElement = document.querySelector<HTMLElement>('#hit');
if (!queriedHitElement) throw new Error('Raycast example requires #hit.');
const hitElement: HTMLElement = queriedHitElement;

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const sphereGeometry = new Hilo3d.SphereGeometry();
const planeGeometry = new Hilo3d.PlaneGeometry();
const texture = new Hilo3d.LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const material = new Hilo3d.BasicMaterial({ diffuse: texture });
const doubleSidedMaterial = new Hilo3d.BasicMaterial({
    side: Hilo3d.constants.FRONT_AND_BACK,
    diffuse: texture
});
const backSidedMaterial = new Hilo3d.BasicMaterial({
    side: Hilo3d.constants.BACK,
    diffuse: texture
});

function addRotatingMesh(
    geometry: Hilo3d.Geometry,
    meshMaterial: Hilo3d.Material,
    x: number,
    y: number,
    scale: number
): void {
    const mesh = new Hilo3d.Mesh({ geometry, material: meshMaterial, x, y });
    mesh.onUpdate = () => {
        mesh.rotationX += 0.5;
        mesh.rotationZ += 0.5;
    };
    mesh.setScale(scale).addTo(stage);
}

const boxMesh = new Hilo3d.Mesh({ geometry: boxGeometry, material, x: -0.8 });
boxMesh.onUpdate = () => {
    boxMesh.rotationX += 0.5;
    boxMesh.rotationY += 0.5;
};
boxMesh.setScale(0.4).addTo(stage);
addRotatingMesh(sphereGeometry, material, 0, 0, 0.3);
addRotatingMesh(planeGeometry, doubleSidedMaterial, 0.8, -0.5, 0.4);
addRotatingMesh(planeGeometry, material, 0.8, 0, 0.4);
addRotatingMesh(planeGeometry, backSidedMaterial, 0.8, 0.5, 0.4);

const ray = new Hilo3d.Ray();
const pointer = { x: 0, y: 0 };

function updateHitIndicator(): void {
    ray.fromCamera(camera, pointer.x, pointer.y, stage.width, stage.height);
    const firstHit = stage.raycast(ray, true)?.[0];
    const hitPoint = firstHit instanceof Hilo3d.Vector3 ? firstHit : firstHit?.point;
    const position = hitPoint ? camera.projectVector(hitPoint, stage.width, stage.height) : pointer;
    hitElement.style.transform = `translate3d(${String(position.x)}px, ${String(position.y)}px, 0)`;
    hitElement.style.opacity = hitPoint ? '1' : '0.1';
}

stage.canvas.addEventListener('pointermove', event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    updateHitIndicator();
});
