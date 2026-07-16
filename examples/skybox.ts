import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox } from './js/environment';
import { createExampleContext } from './js/init';

const { stage, orbitControls } = createExampleContext();
orbitControls.isLockZ = true;

async function initialize(): Promise<void> {
    const [skyboxMap, model] = await Promise.all([
        new Hilo3d.CubeTextureLoader().load({
            images: [
                '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
            ]
        }),
        new Hilo3d.GLTFLoader().load({ src: './models/Tmall/Tmall.gltf' })
    ]);

    addEnvironmentSkybox(stage, skyboxMap);
    const material = new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0, 0, 0),
        specularEnvMap: skyboxMap,
        refractRatio: 1 / 1.5,
        refractivity: 0.8,
        reflectivity: 0.2
    });
    model.node.setScale(0.001);
    for (const mesh of model.meshes) mesh.material = material;
    stage.addChild(model.node);
    model.node.onUpdate = () => {
        material.specularEnvMatrix ??= new Hilo3d.Matrix4();
        material.specularEnvMatrix.copy(stage.worldMatrix).invert();
    };
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize skybox example', error);
});
