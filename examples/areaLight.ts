import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer, directionLight, ambientLight } = await createExampleContext();

const box = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(1, 1, 1)
    }),
    rotationY: 30,
    rotationX: 30
})
    .addTo(stage)
    .setScale(10);
box.onUpdate = () => {
    box.rotationY += 1;
};

new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(1, 1, 1),
        side: Hilo3d.constants.FRONT_AND_BACK
    }),
    rotationX: 90
})
    .addTo(stage)
    .setScale(2000, 2000, 1);

let num = 6;
while (num--) {
    const startAngle = (num * Math.PI * 2) / 6;
    const areaLight = new Hilo3d.AreaLight({
        color: new Hilo3d.Color(Math.random(), Math.random(), Math.random()),
        x: 5,
        y: 5,
        z: 0,
        amount: 10,
        rotationX: 90,
        width: 5 + Math.random() * 2,
        height: 5
    }).addTo(stage);
    areaLight.onUpdate = () => {
        const time = Date.now() / 2000 + startAngle;
        const radius = 12;
        const x = radius * Math.cos(time);
        const z = radius * Math.sin(time);
        const y = (5 + 5 * Math.sin(time * 5)) * 0.5 + areaLight.height * 0.5;
        areaLight.setPosition(x, y, z);
        areaLight.lookAt(box);
    };

    const areaLightMesh = new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry(),
        material: new Hilo3d.BasicMaterial({
            diffuse: areaLight.color,
            lightType: 'NONE',
            side: Hilo3d.constants.FRONT_AND_BACK
        })
    });
    areaLightMesh.scaleX = areaLight.width;
    areaLightMesh.scaleY = areaLight.height;
    areaLight.addChild(areaLightMesh);
}

camera.fov = 45;
camera.near = 1;
camera.far = 1000;
camera.setPosition(0, 20, 35);
camera.lookAt(box);
renderer.clearColor.set(1, 1, 1, 1);

directionLight.amount = 0;
ambientLight.amount = 0;
