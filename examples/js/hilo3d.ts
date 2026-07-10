import * as Hilo3dModule from '../../src/Hilo3d';

const Hilo3d = { ...Hilo3dModule };

declare global {
    interface Window {
        Hilo3d: typeof Hilo3dModule & Record<string, unknown>;
        notInit?: boolean;
    }
}

window.Hilo3d = Hilo3d;

export default Hilo3d;
