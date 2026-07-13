declare module 'virtual:hilo3d-draco-decoder' {
    import type { DecoderModule } from 'draco3d';

    interface DecoderModuleOptions {
        locateFile?(path: string, prefix: string): string;
    }

    export const decoderWasmUrl: string;

    function createDecoderModule(options?: DecoderModuleOptions): Promise<DecoderModule>;

    export default createDecoderModule;
}
