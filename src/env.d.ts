declare const HILO3D_VERSION: string;

declare module 'glslify' {
    interface CompileOptions {
        basedir?: string;
    }

    interface Glslify {
        compile(source: string, options?: CompileOptions): string;
    }

    const glslify: Glslify;
    export default glslify;
}

interface Window {
    Hilo3dMath?: typeof import('./math/index');
}
