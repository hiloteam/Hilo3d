import { Shader } from 'hilo3d';

const registeredSource: unknown = Shader.shaders['method/portableCoordinates.glsl'];

if (typeof registeredSource !== 'string') {
    throw new Error('Hilo3D portable coordinate shader helpers are unavailable.');
}

const portableCoordinatesSource = registeredSource;
export default portableCoordinatesSource;
