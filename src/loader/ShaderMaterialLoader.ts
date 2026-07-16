import BasicLoader from './BasicLoader';
import ShaderMaterial, { type ShaderMaterialParameters } from '../material/ShaderMaterial';

export type ShaderMaterialLoadRequest = Omit<ShaderMaterialParameters, 'fs' | 'vs'> & {
    fs: string;
    vs: string;
};

/** Loads vertex/fragment source files and creates a ShaderMaterial. */
class ShaderMaterialLoader {
    readonly isShaderMaterialLoader = true;
    readonly className = 'ShaderMaterialLoader';
    private readonly resourceLoader = new BasicLoader();

    async load(params: ShaderMaterialLoadRequest): Promise<ShaderMaterial> {
        const [fragmentSource, vertexSource] = await Promise.all([
            this.resourceLoader.loadRes(params.fs, BasicLoader.TYPE_TEXT),
            this.resourceLoader.loadRes(params.vs, BasicLoader.TYPE_TEXT)
        ]);
        if (typeof fragmentSource !== 'string' || typeof vertexSource !== 'string') {
            throw new TypeError('Shader source responses must be text.');
        }
        return new ShaderMaterial({
            ...params,
            fs: fragmentSource,
            vs: vertexSource
        });
    }
}

export default ShaderMaterialLoader;
