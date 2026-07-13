import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, directionLight, ambientLight } = await createExampleContext();

camera.fov = 45;
camera.near = 1;
camera.far = 1000;
camera.position.set(0, 10, 40);

directionLight.enabled = false;
ambientLight.enabled = false;

const createWall = (): Hilo3d.Mesh => {
    const geometry = new Hilo3d.BoxGeometry({
        width: 30,
        height: 30,
        depth: 30
    });

    const material = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color().fromHEX('fff'),
        side: Hilo3d.constants.BACK,
        castShadows: false,
        receiveShadows: true
    });

    const mesh = new Hilo3d.Mesh({
        geometry,
        material,
        y: 10
    });

    return mesh;
};

let lightNum = 0;
const sphereGeometry = new Hilo3d.SphereGeometry();
const boxGeometry = new Hilo3d.BoxGeometry();
const boxMaterial = new Hilo3d.PBRMaterial({
    castShadows: true,
    receiveShadows: true,
    roughness: 0.5,
    metallic: 0
});
const createLight = (color: Hilo3d.Color): Hilo3d.PointLight => {
    lightNum += 1;
    const amount = 100 + 2 * Math.random();
    let time = lightNum * 666;

    const pointLight = new Hilo3d.PointLight({
        color,
        amount,
        range: 100,
        shadow: { minBias: 0.1 },
        rotationZ: 240
    });
    pointLight.onUpdate = deltaTime => {
        time += deltaTime * 0.001;
        pointLight.x = Math.sin(time * 0.6) * 9;
        pointLight.y = Math.sin(time * 0.7) * 9;
        pointLight.z = Math.sin(time * 0.8) * 9;
        pointLight.rotationX = time * 50;
        pointLight.rotationZ = time * 50;
    };

    // light mesh
    new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material: new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(color.r, color.g, color.b, color.a).scale(amount),
            lightType: 'NONE',
            castShadows: false,
            receiveShadows: false
        })
    })
        .setScale(0.3)
        .addTo(pointLight);

    // box mesh
    const orbitingMesh = new Hilo3d.Mesh({
        geometry: Math.random() > 0.4 ? boxGeometry : sphereGeometry,
        material: boxMaterial,
        y: Math.random() * 2 + 3,
        rotationX: Math.random() * 360,
        rotationY: Math.random() * 360,
        rotationZ: Math.random() * 360
    });
    orbitingMesh.onUpdate = () => {
        orbitingMesh.rotationX += 1;
        orbitingMesh.rotationY += 1;
    };
    orbitingMesh.addTo(pointLight).setScale(1);

    return pointLight;
};

const wall = createWall().addTo(stage);
createLight(new Hilo3d.Color().fromHEX('0000ff')).addTo(wall);
createLight(new Hilo3d.Color().fromHEX('ff0000')).addTo(wall);
createLight(new Hilo3d.Color().fromHEX('00ff00')).addTo(wall);
