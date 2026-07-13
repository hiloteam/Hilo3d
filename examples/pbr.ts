import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox, applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage } = await createExampleContext();

async function initialize(): Promise<void> {
    const [model, environment] = await Promise.all([
        new Hilo3d.GLTFLoader().load({ src: './models/BoomBox/BoomBox.gltf' }),
        loadEnvironmentMaps()
    ]);
    applyEnvironmentMaps(model.materials, environment);
    model.node.rotationY = 160;
    stage.addChild(model.node);
    addEnvironmentSkybox(stage, environment.specularEnvMap);
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize PBR example', error);
});
