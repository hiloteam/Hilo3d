import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage } = createExampleContext();

function addLightMarker(light: Hilo3d.Light): void {
    if (!light.parent) return;
    light.parent.addChild(
        new Hilo3d.Mesh({
            geometry: new Hilo3d.SphereGeometry(),
            material: new Hilo3d.BasicMaterial({
                diffuse: light.color,
                lightType: 'NONE'
            }),
            scaleX: 0.05,
            scaleY: 0.05,
            scaleZ: 0.05
        })
    );
}

async function initialize(): Promise<void> {
    const [model, environment] = await Promise.all([
        new Hilo3d.GLTFLoader().load({ src: './models/light.gltf' }),
        loadEnvironmentMaps()
    ]);
    stage.addChild(model.node);
    addEnvironmentSkybox(stage, environment.specularEnvMap);

    for (const y of [-0.5, 0.5]) {
        stage.addChild(
            new Hilo3d.Mesh({
                y,
                scaleX: 2,
                scaleY: 0.1,
                scaleZ: 2,
                geometry: new Hilo3d.BoxGeometry(),
                material: new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(1, 1, 1, 1),
                    brdfLUT: environment.brdfLUT,
                    diffuseEnvMap: environment.diffuseEnvMap,
                    specularEnvMap: environment.specularEnvMap
                })
            })
        );
    }

    for (const className of ['PointLight', 'SpotLight', 'DirectionalLight']) {
        for (const node of model.node.getChildrenByClassName(className)) {
            if (node instanceof Hilo3d.Light) addLightMarker(node);
        }
    }
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize glTF light example', error);
});
