import BasicLoader from './BasicLoader';
import ShaderMaterial from '../material/ShaderMaterial';
import log from '../utils/log';

interface ShaderMaterialParams {
    fs: string;
    vs: string;
    [key: string]: any;
}

/**
 * ShaderMaterial加载类
 * @class
 * @extends {BasicLoader}
 * @example
 * var loader = new Hilo3d.ShaderMaterialLoader();
 * loader.load({
 *     fs: './test.frag',
 *     vs: './test.vert',
 *     attributes: {
 *         a_pos: {
 *             semantic: 'POSITION'
 *         },
 *         a_uv: {
 *             semantic: 'TEXCOORD_0'
 *         }
 *     },
 *     uniforms: {
 *         u_mat: {
 *             semantic:'MODELVIEWPROJECTION'
 *         },
 *         u_diffuse: {
 *             semantic: 'DIFFUSE'
 *         }
 *     },
 *     diffuse: new Hilo3d.LazyTexture({
 *         crossOrigin: true,
 *         src: '//img.alicdn.com/tfs/TB1va2xQVXXXXaFapXXXXXXXXXX-1024-710.jpg'
 *     })
 * }).then(material => {
 *     var geometry = new Hilo3d.PlaneGeometry();
 *     var plane = new Hilo3d.Mesh({
 *         material: material,
 *         geometry: geometry
 *     });
 *     stage.addChild(plane);
 * });
 */
class ShaderMaterialLoader extends BasicLoader {
    /**
     * @default true
     * @type {boolean}
     */
    isShaderMaterialLoader: boolean = true;

    /**
     * @default ShaderMaterialLoader
     * @type {string}
     */
    className: string = 'ShaderMaterialLoader';

    /**
     * 加载ShaderMaterial
     *
     * @memberOf ShaderMaterialLoader
     * @instance
     *
     * @param {object} params 加载参数，所有参数均会传递给 ShaderMaterial 的构造器
     * @param {string} params.fs fragment shader 文件的地址
     * @param {string} params.vs vertex shader 文件的地址
     * @return {Promise.<ShaderMaterial, Error>} 返回加载完的ShaderMaterial实例
     */
    load(params: ShaderMaterialParams): Promise<ShaderMaterial> {
        const list = [
            this.loadRes(params.fs),
            this.loadRes(params.vs)
        ];

        const args: any = Object.assign({}, params);
        return Promise.all(list).then((result: string[]) => {
            args.fs = result[0];
            args.vs = result[1];
            return new ShaderMaterial(args);
        }).catch((err: Error) => {
            log.warn(`ShaderMaterial Loader Failed for ${err}`);
            throw err;
        });
    }
}

export default ShaderMaterialLoader;
