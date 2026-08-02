import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const {
    camera,
    stage,
    directionLight: defaultDirectionLight,
    ambientLight
} = await createExampleContext({
    camera: { far: 2, near: 0.1, z: 1 },
    stage: { rotationX: 30 }
});
camera.lookAt(new Hilo3d.Vector3());
defaultDirectionLight.amount = 0;
ambientLight.amount = 0.1;

const glTFLoader = new Hilo3d.GLTFLoader();
void glTFLoader
    .load({
        src: './models/Tmall/Tmall.gltf'
    })
    .then(function (model) {
        model.node.setScale(0.0005);
        model.node.y = 0.205;
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        console.error('Failed to load shadow model', error);
    });

new Hilo3d.Mesh({
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColorMap: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    }),
    castShadows: false
}).addTo(stage);

const box = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.9, 0.6, 0.3)
    }),
    x: 0.3,
    y: 0.2,
    z: 0.2
}).addTo(stage);
box.onUpdate = () => {
    box.rotationX += 1.5;
    box.rotationY += 1.5;
};

box.setScale(0.1);

const directionalLight = new Hilo3d.DirectionalLight({
    color: new Hilo3d.Color(1, 1, 1),
    direction: new Hilo3d.Vector3(-0.8, -1, 0),
    amount: 3,
    shadow: {
        cameraInfo: {
            left: -0.5,
            right: 0.5,
            near: -0.5,
            far: 0.5,
            top: -0.5,
            bottom: 0.5
        },
        debug: true
    }
});
directionalLight.onUpdate = () => {
    directionalLight.direction.rotateY(new Hilo3d.Vector3(), Math.PI / 180);
    directionalLight.isDirty = true;
};
stage.addChild(directionalLight);

const spotLight = new Hilo3d.SpotLight({
    y: 1,
    x: 0,
    cutoff: 8,
    outerCutoff: 9,
    range: 3,
    color: new Hilo3d.Color(1, 0, 0),
    direction: new Hilo3d.Vector3(0.2, -1, 0),
    amount: 5,
    shadow: {
        debug: true,
        minBias: 0.0001
    }
});
spotLight.onUpdate = () => {
    spotLight.direction.rotateY(new Hilo3d.Vector3(), (Math.PI / 180) * 0.5);
    spotLight.isDirty = true;
};
stage.addChild(spotLight);
