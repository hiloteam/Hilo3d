import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox, applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const { stage } = createExampleContext();

async function initialize(): Promise<void> {
    const [model, environment] = await Promise.all([
        new Hilo3d.GLTFLoader().load({ src: './models/polly/project_polly.glb' }),
        loadEnvironmentMaps()
    ]);
    applyEnvironmentMaps(model.materials, environment);
    model.node.rotationY = 160;
    stage.addChild(model.node);

    const modelCamera = model.cameras[1];
    if (modelCamera) stage.camera = modelCamera;
    addEnvironmentSkybox(stage, environment.specularEnvMap);
}

void initialize().catch((error: unknown) => {
    console.error('Failed to initialize Polly example', error);
});
