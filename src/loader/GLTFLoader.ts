import BasicLoader from './BasicLoader';
import GLTFParser from './GLTFParser';
import Loader from './Loader';
import log from '../utils/log';
import Node from '../core/Node';
import Mesh from '../core/Mesh';
import Animation from '../animation/Animation';
import Camera from '../camera/Camera';
import Light from '../light/Light';
import Texture from '../texture/Texture';
import BasicMaterial from '../material/BasicMaterial';
import Skeleton from '../core/Skeleton';

/**
 * GLTFLoader 模型加载完返回的对象格式
 */
interface GLTFModel {
    json: any;
    node?: Node;
    meshes?: Mesh[];
    anim?: Animation | null;
    cameras?: Camera[];
    lights?: Light[];
    textures?: Texture[];
    materials?: BasicMaterial[];
    skins?: Skeleton[];
}

interface GLTFLoadParams {
    src: string;
    defaultScene?: number | string;
    isMultiAnim?: boolean;
    isProgressive?: boolean;
    isUnQuantizeInShader?: boolean;
    ignoreTextureError?: boolean;
    forceCreateNewBuffer?: boolean;
    preHandlerImageURI?: ((uri: string) => string) | null;
    preHandlerBufferURI?: ((uri: string) => string) | null;
    customMaterialCreator?: any;
    isLoadAllTextures?: boolean;
}

/**
 * glTF模型加载类
 * @class
 * @extends {BasicLoader}
 * @example
 * var loader = new Hilo3d.GLTFLoader();
 * loader.load({
 *     src: '//ossgw.alicdn.com/tmall-c3/tmx/a9bedc04da498b95c57057d6a5d29fe7.gltf'
 * }).then(function (model) {
 *     stage.addChild(model.node);
 * });
 */
class GLTFLoader extends BasicLoader {
    /**
     * @default true
     * @type {boolean}
     */
    isGLTFLoader: boolean = true;

    /**
     * @default GLTFLoader
     * @type {string}
     */
    className: string = 'GLTFLoader';

    /**
     * @constructs
     */
    constructor() {
        super();
    }

    /**
     * 加载glTF模型
     * @param {object} params 加载参数
     * @param {string} params.src glTF模型地址
     * @param {number|string} [params.defaultScene] 加载后要展示的场景，默认读模型里的
     * @param {boolean} [params.isMultiAnim=false] 模型是否多动画，如果是的话会返回 anims 对象保存多个动画对象
     * @param {boolean} [params.isProgressive=false] 是否渐进式加载，图片加载完前使用占位图片
     * @param {boolean} [params.isUnQuantizeInShader=true] 是否在shader中进行量化解压数据
     * @param {boolean} [params.ignoreTextureError=false] 是否忽略图片加载错误
     * @param {boolean} [params.forceCreateNewBuffer=false] 解析模型数据的时候是否强制创建新buffer，以防内存被引用导致无法释放
     * @param {function} [params.preHandlerImageURI=null] 图片URL预处理函数
     * @param {function} [params.preHandlerBufferURI=null] Buffer URL预处理函数
     * @param {function} [params.customMaterialCreator=null] 是否使用自定义的Material创建器
     * @param {function} [params.isLoadAllTextures=false] 是否加载所有的贴图，默认只加载用到的贴图
     * @async
     * @return {Promise<GLTFModel, Error>} 返回加载完的模型对象
     */
    load(params: GLTFLoadParams): Promise<GLTFModel> {
        return this.loadRes(params.src, 'buffer')
            .then((buffer: ArrayBuffer) => {
                let parser = new GLTFParser(buffer, params);
                return parser.parse(this);
            }).catch((err: Error) => {
                log.error('load gltf failed', err.message, err.stack);
                throw err;
            });
    }
}

Loader.addLoader('gltf', GLTFLoader);
Loader.addLoader('glb', GLTFLoader);

export default GLTFLoader;
export { GLTFModel, GLTFLoadParams };
