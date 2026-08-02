import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox, environmentMaterialDefaults } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage } = await createExampleContext();

async function initialize(): Promise<void> {
    const environment = await loadEnvironmentMaps();
    const model = await new Hilo3d.GLTFLoader().load({
        src: './models/BoomBox/BoomBox.gltf',
        pbrMaterialDefaults: environmentMaterialDefaults(environment)
    });
    model.node.rotationY = 160;
    stage.addChild(model.node);
    addEnvironmentSkybox(stage, environment.skyboxMap);
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize PBR example', error);
});
