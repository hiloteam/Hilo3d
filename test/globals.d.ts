import type * as Hilo3dModule from '../src/Hilo3d';
import type { TestEnvironment, utils as testUtils } from './setup';

declare global {
    const Hilo3d: typeof Hilo3dModule;
    const testEnv: TestEnvironment;
    const utils: typeof testUtils;

    interface Window {
        _IS_CI: boolean;
        _IS_WEB: boolean;
    }
}

export {};
