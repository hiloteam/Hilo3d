import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, directionLight, ambientLight } = createExampleContext({
    camera: { far: 3, near: 0.01, z: 1 },
    stage: { rotationX: 30 }
});
camera.lookAt(new Hilo3d.Vector3());
directionLight.amount = 0;
ambientLight.amount = 0.2;

const glTFLoader = new Hilo3d.GLTFLoader();
void glTFLoader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(function (model) {
        stage.addChild(model.node);
        model.node.setScale(0.002);
    })
    .catch((error: unknown) => {
        console.error('Failed to load spotlight model', error);
    });

new Hilo3d.Mesh({
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColorMap: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    })
}).addTo(stage);

const spotlight0 = new Hilo3d.SpotLight({
    x: 0,
    y: 1,
    z: 0,
    color: new Hilo3d.Color(1, 0, 0),
    direction: new Hilo3d.Vector3(0.4, -1, 0),
    cutoff: 5,
    outerCutoff: 7,
    range: 2,
    amount: 10,
    shadow: {
        maxBias: 0.01,
        minBias: 0.0001
    }
}).addTo(stage);
spotlight0.onUpdate = () => {
    spotlight0.direction.rotateY(new Hilo3d.Vector3(), -0.01);
    spotlight0.lightShadow?.updateLightCamera(camera);
};

new Hilo3d.SpotLight({
    x: -0,
    y: 1,
    z: 0,
    color: new Hilo3d.Color(0.3, 0.9, 0.6),
    direction: new Hilo3d.Vector3(0, -1, 0),
    cutoff: 24,
    outerCutoff: 26,
    range: 2,
    amount: 10,
    shadow: {
        maxBias: 0.03,
        minBias: 0.001
    }
}).addTo(stage);

const box = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.9, 0.3, 0.6),
        roughness: 1,
        metallic: 1
    }),
    x: 0.2,
    y: 0.3,
    z: 0.2
})
    .addTo(stage)
    .setScale(0.1);
box.onUpdate = () => {
    box.rotationX += 1;
    box.rotationY += 1;
};
