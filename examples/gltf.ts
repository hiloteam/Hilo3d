import { GLTFLoader } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';

const runtime = await createExampleRuntime();
const model = await new GLTFLoader().load({ src: './models/light.gltf' });
model.instantiate(runtime.world);
runtime.start();
