import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

const loader = new Hilo3d.GLTFLoader();
void loader
    .load({
        src: './models/Tmall/Tmall.gltf',
        pbrMaterialDefaults: { state: { wireframe: true } }
    })
    .then(model => {
        model.node.setScale(0.001);
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        console.error('Unable to load the local wireframe model.', error);
    });
