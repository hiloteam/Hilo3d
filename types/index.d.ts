export = hilo3d;
export as namespace hilo3d;
declare namespace hilo3d {

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

namespace AnimationStates {
    /**
     * 状态类型
     */
    enum StateType {
        TRANSLATE = "Translation",
        POSITION = "Translation",
        TRANSLATION = "Translation",
        SCALE = "Scale",
        ROTATE = "Rotation",
        ROTATION = "Rotation",
        QUATERNION = "Quaternion",
        WEIGHTS = "Weights"
    }
}

/**
 * WebGL, WebGL extensions 枚举值
 * @example
 * Hilo3d.constants.LINEAR_MIPMAP_NEAREST
 */
namespace constants {
    const POSITION: string;
    const NORMAL: string;
    const DEPTH: string;
    const DISTANCE: string;
    const ACTIVE_ATTRIBUTES: GLenum;
    const ACTIVE_ATTRIBUTE_MAX_LENGTH: GLenum;
    const ACTIVE_TEXTURE: GLenum;
    const ACTIVE_UNIFORMS: GLenum;
    const ACTIVE_UNIFORM_MAX_LENGTH: GLenum;
    const ALIASED_LINE_WIDTH_RANGE: GLenum;
    const ALIASED_POINT_SIZE_RANGE: GLenum;
    const ALPHA: GLenum;
    const ALPHA_BITS: GLenum;
    const ALWAYS: GLenum;
    const ARRAY_BUFFER: GLenum;
    const ARRAY_BUFFER_BINDING: GLenum;
    const ATTACHED_SHADERS: GLenum;
    const BACK: GLenum;
    const BLEND: GLenum;
    const BLEND_COLOR: GLenum;
    const BLEND_DST_ALPHA: GLenum;
    const BLEND_DST_RGB: GLenum;
    const BLEND_EQUATION: GLenum;
    const BLEND_EQUATION_ALPHA: GLenum;
    const BLEND_EQUATION_RGB: GLenum;
    const BLEND_SRC_ALPHA: GLenum;
    const BLEND_SRC_RGB: GLenum;
    const BLUE_BITS: GLenum;
    const BOOL: GLenum;
    const BOOL_VEC2: GLenum;
    const BOOL_VEC3: GLenum;
    const BOOL_VEC4: GLenum;
    const BROWSER_DEFAULT_WEBGL: GLenum;
    const BUFFER_SIZE: GLenum;
    const BUFFER_USAGE: GLenum;
    const BYTE: GLenum;
    const CCW: GLenum;
    const CLAMP_TO_EDGE: GLenum;
    const COLOR_ATTACHMENT0: GLenum;
    const COLOR_BUFFER_BIT: GLenum;
    const COLOR_CLEAR_VALUE: GLenum;
    const COLOR_WRITEMASK: GLenum;
    const COMPILE_STATUS: GLenum;
    const COMPRESSED_TEXTURE_FORMATS: GLenum;
    const CONSTANT_ALPHA: GLenum;
    const CONSTANT_COLOR: GLenum;
    const CONTEXT_LOST_WEBGL: GLenum;
    const CULL_FACE: GLenum;
    const CULL_FACE_MODE: GLenum;
    const CURRENT_PROGRAM: GLenum;
    const CURRENT_VERTEX_ATTRIB: GLenum;
    const CW: GLenum;
    const DECR: GLenum;
    const DECR_WRAP: GLenum;
    const DELETE_STATUS: GLenum;
    const DEPTH_ATTACHMENT: GLenum;
    const DEPTH_BITS: GLenum;
    const DEPTH_BUFFER_BIT: GLenum;
    const DEPTH_CLEAR_VALUE: GLenum;
    const DEPTH_COMPONENT: GLenum;
    const DEPTH_COMPONENT16: GLenum;
    const DEPTH_FUNC: GLenum;
    const DEPTH_RANGE: GLenum;
    const DEPTH_STENCIL: GLenum;
    const DEPTH_STENCIL_ATTACHMENT: GLenum;
    const DEPTH_TEST: GLenum;
    const DEPTH_WRITEMASK: GLenum;
    const DITHER: GLenum;
    const DONT_CARE: GLenum;
    const DST_ALPHA: GLenum;
    const DST_COLOR: GLenum;
    const DYNAMIC_DRAW: GLenum;
    const ELEMENT_ARRAY_BUFFER: GLenum;
    const ELEMENT_ARRAY_BUFFER_BINDING: GLenum;
    const EQUAL: GLenum;
    const FASTEST: GLenum;
    const FLOAT: GLenum;
    const FLOAT_MAT2: GLenum;
    const FLOAT_MAT3: GLenum;
    const FLOAT_MAT4: GLenum;
    const FLOAT_VEC2: GLenum;
    const FLOAT_VEC3: GLenum;
    const FLOAT_VEC4: GLenum;
    const FRAGMENT_SHADER: GLenum;
    const FRAMEBUFFER: GLenum;
    const FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: GLenum;
    const FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: GLenum;
    const FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: GLenum;
    const FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: GLenum;
    const FRAMEBUFFER_BINDING: GLenum;
    const FRAMEBUFFER_COMPLETE: GLenum;
    const FRAMEBUFFER_INCOMPLETE_ATTACHMENT: GLenum;
    const FRAMEBUFFER_INCOMPLETE_DIMENSIONS: GLenum;
    const FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: GLenum;
    const FRAMEBUFFER_UNSUPPORTED: GLenum;
    const FRONT: GLenum;
    const FRONT_AND_BACK: GLenum;
    const FRONT_FACE: GLenum;
    const FUNC_ADD: GLenum;
    const FUNC_REVERSE_SUBTRACT: GLenum;
    const FUNC_SUBTRACT: GLenum;
    const GENERATE_MIPMAP_HINT: GLenum;
    const GEQUAL: GLenum;
    const GREATER: GLenum;
    const GREEN_BITS: GLenum;
    const HIGH_FLOAT: GLenum;
    const HIGH_INT: GLenum;
    const INCR: GLenum;
    const INCR_WRAP: GLenum;
    const INFO_LOG_LENGTH: GLenum;
    const INT: GLenum;
    const INT_VEC2: GLenum;
    const INT_VEC3: GLenum;
    const INT_VEC4: GLenum;
    const INVALID_ENUM: GLenum;
    const INVALID_FRAMEBUFFER_OPERATION: GLenum;
    const INVALID_OPERATION: GLenum;
    const INVALID_VALUE: GLenum;
    const INVERT: GLenum;
    const KEEP: GLenum;
    const LEQUAL: GLenum;
    const LESS: GLenum;
    const LINEAR: GLenum;
    const LINEAR_MIPMAP_LINEAR: GLenum;
    const LINEAR_MIPMAP_NEAREST: GLenum;
    const LINES: GLenum;
    const LINE_LOOP: GLenum;
    const LINE_STRIP: GLenum;
    const LINE_WIDTH: GLenum;
    const LINK_STATUS: GLenum;
    const LOW_FLOAT: GLenum;
    const LOW_INT: GLenum;
    const LUMINANCE: GLenum;
    const LUMINANCE_ALPHA: GLenum;
    const MAX_COMBINED_TEXTURE_IMAGE_UNITS: GLenum;
    const MAX_CUBE_MAP_TEXTURE_SIZE: GLenum;
    const MAX_FRAGMENT_UNIFORM_VECTORS: GLenum;
    const MAX_RENDERBUFFER_SIZE: GLenum;
    const MAX_TEXTURE_IMAGE_UNITS: GLenum;
    const MAX_TEXTURE_SIZE: GLenum;
    const MAX_VARYING_VECTORS: GLenum;
    const MAX_VERTEX_ATTRIBS: GLenum;
    const MAX_VERTEX_TEXTURE_IMAGE_UNITS: GLenum;
    const MAX_VERTEX_UNIFORM_VECTORS: GLenum;
    const MAX_VIEWPORT_DIMS: GLenum;
    const MEDIUM_FLOAT: GLenum;
    const MEDIUM_INT: GLenum;
    const MIRRORED_REPEAT: GLenum;
    const NEAREST: GLenum;
    const NEAREST_MIPMAP_LINEAR: GLenum;
    const NEAREST_MIPMAP_NEAREST: GLenum;
    const NEVER: GLenum;
    const NICEST: GLenum;
    const NONE: GLenum;
    const NOTEQUAL: GLenum;
    const NO_ERROR: GLenum;
    const NUM_COMPRESSED_TEXTURE_FORMATS: GLenum;
    const ONE: GLenum;
    const ONE_MINUS_CONSTANT_ALPHA: GLenum;
    const ONE_MINUS_CONSTANT_COLOR: GLenum;
    const ONE_MINUS_DST_ALPHA: GLenum;
    const ONE_MINUS_DST_COLOR: GLenum;
    const ONE_MINUS_SRC_ALPHA: GLenum;
    const ONE_MINUS_SRC_COLOR: GLenum;
    const OUT_OF_MEMORY: GLenum;
    const PACK_ALIGNMENT: GLenum;
    const POINTS: GLenum;
    const POLYGON_OFFSET_FACTOR: GLenum;
    const POLYGON_OFFSET_FILL: GLenum;
    const POLYGON_OFFSET_UNITS: GLenum;
    const RED_BITS: GLenum;
    const RENDERBUFFER: GLenum;
    const RENDERBUFFER_ALPHA_SIZE: GLenum;
    const RENDERBUFFER_BINDING: GLenum;
    const RENDERBUFFER_BLUE_SIZE: GLenum;
    const RENDERBUFFER_DEPTH_SIZE: GLenum;
    const RENDERBUFFER_GREEN_SIZE: GLenum;
    const RENDERBUFFER_HEIGHT: GLenum;
    const RENDERBUFFER_INTERNAL_FORMAT: GLenum;
    const RENDERBUFFER_RED_SIZE: GLenum;
    const RENDERBUFFER_STENCIL_SIZE: GLenum;
    const RENDERBUFFER_WIDTH: GLenum;
    const RENDERER: GLenum;
    const REPEAT: GLenum;
    const REPLACE: GLenum;
    const RGB: GLenum;
    const RGB5_A1: GLenum;
    const RGB565: GLenum;
    const RGBA: GLenum;
    const RGBA4: GLenum;
    const SAMPLER_2D: GLenum;
    const SAMPLER_CUBE: GLenum;
    const SAMPLES: GLenum;
    const SAMPLE_ALPHA_TO_COVERAGE: GLenum;
    const SAMPLE_BUFFERS: GLenum;
    const SAMPLE_COVERAGE: GLenum;
    const SAMPLE_COVERAGE_INVERT: GLenum;
    const SAMPLE_COVERAGE_VALUE: GLenum;
    const SCISSOR_BOX: GLenum;
    const SCISSOR_TEST: GLenum;
    const SHADER_COMPILER: GLenum;
    const SHADER_SOURCE_LENGTH: GLenum;
    const SHADER_TYPE: GLenum;
    const SHADING_LANGUAGE_VERSION: GLenum;
    const SHORT: GLenum;
    const SRC_ALPHA: GLenum;
    const SRC_ALPHA_SATURATE: GLenum;
    const SRC_COLOR: GLenum;
    const STATIC_DRAW: GLenum;
    const STENCIL_ATTACHMENT: GLenum;
    const STENCIL_BACK_FAIL: GLenum;
    const STENCIL_BACK_FUNC: GLenum;
    const STENCIL_BACK_PASS_DEPTH_FAIL: GLenum;
    const STENCIL_BACK_PASS_DEPTH_PASS: GLenum;
    const STENCIL_BACK_REF: GLenum;
    const STENCIL_BACK_VALUE_MASK: GLenum;
    const STENCIL_BACK_WRITEMASK: GLenum;
    const STENCIL_BITS: GLenum;
    const STENCIL_BUFFER_BIT: GLenum;
    const STENCIL_CLEAR_VALUE: GLenum;
    const STENCIL_FAIL: GLenum;
    const STENCIL_FUNC: GLenum;
    const STENCIL_INDEX: GLenum;
    const STENCIL_INDEX8: GLenum;
    const STENCIL_PASS_DEPTH_FAIL: GLenum;
    const STENCIL_PASS_DEPTH_PASS: GLenum;
    const STENCIL_REF: GLenum;
    const STENCIL_TEST: GLenum;
    const STENCIL_VALUE_MASK: GLenum;
    const STENCIL_WRITEMASK: GLenum;
    const STREAM_DRAW: GLenum;
    const SUBPIXEL_BITS: GLenum;
    const TEXTURE: GLenum;
    const TEXTURE0: GLenum;
    const TEXTURE1: GLenum;
    const TEXTURE2: GLenum;
    const TEXTURE3: GLenum;
    const TEXTURE4: GLenum;
    const TEXTURE5: GLenum;
    const TEXTURE6: GLenum;
    const TEXTURE7: GLenum;
    const TEXTURE8: GLenum;
    const TEXTURE9: GLenum;
    const TEXTURE10: GLenum;
    const TEXTURE11: GLenum;
    const TEXTURE12: GLenum;
    const TEXTURE13: GLenum;
    const TEXTURE14: GLenum;
    const TEXTURE15: GLenum;
    const TEXTURE16: GLenum;
    const TEXTURE17: GLenum;
    const TEXTURE18: GLenum;
    const TEXTURE19: GLenum;
    const TEXTURE20: GLenum;
    const TEXTURE21: GLenum;
    const TEXTURE22: GLenum;
    const TEXTURE23: GLenum;
    const TEXTURE24: GLenum;
    const TEXTURE25: GLenum;
    const TEXTURE26: GLenum;
    const TEXTURE27: GLenum;
    const TEXTURE28: GLenum;
    const TEXTURE29: GLenum;
    const TEXTURE30: GLenum;
    const TEXTURE31: GLenum;
    const TEXTURE_2D: GLenum;
    const TEXTURE_BINDING_2D: GLenum;
    const TEXTURE_BINDING_CUBE_MAP: GLenum;
    const TEXTURE_CUBE_MAP: GLenum;
    const TEXTURE_CUBE_MAP_NEGATIVE_X: GLenum;
    const TEXTURE_CUBE_MAP_NEGATIVE_Y: GLenum;
    const TEXTURE_CUBE_MAP_NEGATIVE_Z: GLenum;
    const TEXTURE_CUBE_MAP_POSITIVE_X: GLenum;
    const TEXTURE_CUBE_MAP_POSITIVE_Y: GLenum;
    const TEXTURE_CUBE_MAP_POSITIVE_Z: GLenum;
    const TEXTURE_MAG_FILTER: GLenum;
    const TEXTURE_MIN_FILTER: GLenum;
    const TEXTURE_WRAP_S: GLenum;
    const TEXTURE_WRAP_T: GLenum;
    const TRIANGLES: GLenum;
    const TRIANGLE_FAN: GLenum;
    const TRIANGLE_STRIP: GLenum;
    const UNPACK_ALIGNMENT: GLenum;
    const UNPACK_COLORSPACE_CONVERSION_WEBGL: GLenum;
    const UNPACK_FLIP_Y_WEBGL: GLenum;
    const UNPACK_PREMULTIPLY_ALPHA_WEBGL: GLenum;
    const UNSIGNED_BYTE: GLenum;
    const UNSIGNED_INT: GLenum;
    const UNSIGNED_SHORT: GLenum;
    const UNSIGNED_SHORT_4_4_4_4: GLenum;
    const UNSIGNED_SHORT_5_5_5_1: GLenum;
    const UNSIGNED_SHORT_5_6_5: GLenum;
    const VALIDATE_STATUS: GLenum;
    const VENDOR: GLenum;
    const VERSION: GLenum;
    const VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: GLenum;
    const VERTEX_ATTRIB_ARRAY_ENABLED: GLenum;
    const VERTEX_ATTRIB_ARRAY_NORMALIZED: GLenum;
    const VERTEX_ATTRIB_ARRAY_POINTER: GLenum;
    const VERTEX_ATTRIB_ARRAY_SIZE: GLenum;
    const VERTEX_ATTRIB_ARRAY_STRIDE: GLenum;
    const VERTEX_ATTRIB_ARRAY_TYPE: GLenum;
    const VERTEX_SHADER: GLenum;
    const VIEWPORT: GLenum;
    const ZERO: GLenum;
    const VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: GLenum;
    const UNMASKED_VENDOR_WEBGL: GLenum;
    const UNMASKED_RENDERER_WEBGL: GLenum;
    const MAX_TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
    const TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
    const COMPRESSED_RGB_S3TC_DXT1_EXT: GLenum;
    const COMPRESSED_RGBA_S3TC_DXT1_EXT: GLenum;
    const COMPRESSED_RGBA_S3TC_DXT3_EXT: GLenum;
    const COMPRESSED_RGBA_S3TC_DXT5_EXT: GLenum;
    const COMPRESSED_R11_EAC: GLenum;
    const COMPRESSED_SIGNED_R11_EAC: GLenum;
    const COMPRESSED_RG11_EAC: GLenum;
    const COMPRESSED_SIGNED_RG11_EAC: GLenum;
    const COMPRESSED_RGB8_ETC2: GLenum;
    const COMPRESSED_RGBA8_ETC2_EAC: GLenum;
    const COMPRESSED_SRGB8_ETC2: GLenum;
    const COMPRESSED_SRGB8_ALPHA8_ETC2_EAC: GLenum;
    const COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: GLenum;
    const COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2: GLenum;
    const COMPRESSED_RGB_PVRTC_4BPPV1_IMG: GLenum;
    const COMPRESSED_RGBA_PVRTC_4BPPV1_IMG: GLenum;
    const COMPRESSED_RGB_PVRTC_2BPPV1_IMG: GLenum;
    const COMPRESSED_RGBA_PVRTC_2BPPV1_IMG: GLenum;
    const COMPRESSED_RGB_ETC1_WEBGL: GLenum;
    const COMPRESSED_RGB_ATC_WEBGL: GLenum;
    const COMPRESSED_RGBA_ATC_EXPLICIT_ALPHA_WEBGL: GLenum;
    const COMPRESSED_RGBA_ATC_INTERPOLATED_ALPHA_WEBGL: GLenum;
    const UNSIGNED_INT_24_8_WEBGL: GLenum;
    const HALF_FLOAT_OES: GLenum;
    const RGBA32F_EXT: GLenum;
    const RGB32F_EXT: GLenum;
    const FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: GLenum;
    const UNSIGNED_NORMALIZED_EXT: GLenum;
    const MIN_EXT: GLenum;
    const MAX_EXT: GLenum;
    const SRGB_EXT: GLenum;
    const SRGB_ALPHA_EXT: GLenum;
    const SRGB8_ALPHA8_EXT: GLenum;
    const FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING_EXT: GLenum;
    const FRAGMENT_SHADER_DERIVATIVE_HINT_OES: GLenum;
    const COLOR_ATTACHMENT0_WEBGL: GLenum;
    const COLOR_ATTACHMENT1_WEBGL: GLenum;
    const COLOR_ATTACHMENT2_WEBGL: GLenum;
    const COLOR_ATTACHMENT3_WEBGL: GLenum;
    const COLOR_ATTACHMENT4_WEBGL: GLenum;
    const COLOR_ATTACHMENT5_WEBGL: GLenum;
    const COLOR_ATTACHMENT6_WEBGL: GLenum;
    const COLOR_ATTACHMENT7_WEBGL: GLenum;
    const COLOR_ATTACHMENT8_WEBGL: GLenum;
    const COLOR_ATTACHMENT9_WEBGL: GLenum;
    const COLOR_ATTACHMENT10_WEBGL: GLenum;
    const COLOR_ATTACHMENT11_WEBGL: GLenum;
    const COLOR_ATTACHMENT12_WEBGL: GLenum;
    const COLOR_ATTACHMENT13_WEBGL: GLenum;
    const COLOR_ATTACHMENT14_WEBGL: GLenum;
    const COLOR_ATTACHMENT15_WEBGL: GLenum;
    const DRAW_BUFFER0_WEBGL: GLenum;
    const DRAW_BUFFER1_WEBGL: GLenum;
    const DRAW_BUFFER2_WEBGL: GLenum;
    const DRAW_BUFFER3_WEBGL: GLenum;
    const DRAW_BUFFER4_WEBGL: GLenum;
    const DRAW_BUFFER5_WEBGL: GLenum;
    const DRAW_BUFFER6_WEBGL: GLenum;
    const DRAW_BUFFER7_WEBGL: GLenum;
    const DRAW_BUFFER8_WEBGL: GLenum;
    const DRAW_BUFFER9_WEBGL: GLenum;
    const DRAW_BUFFER10_WEBGL: GLenum;
    const DRAW_BUFFER11_WEBGL: GLenum;
    const DRAW_BUFFER12_WEBGL: GLenum;
    const DRAW_BUFFER13_WEBGL: GLenum;
    const DRAW_BUFFER14_WEBGL: GLenum;
    const DRAW_BUFFER15_WEBGL: GLenum;
    const MAX_COLOR_ATTACHMENTS_WEBGL: GLenum;
    const MAX_DRAW_BUFFERS_WEBGL: GLenum;
    const VERTEX_ARRAY_BINDING_OES: GLenum;
    const QUERY_COUNTER_BITS_EXT: GLenum;
    const CURRENT_QUERY_EXT: GLenum;
    const QUERY_RESULT_EXT: GLenum;
    const QUERY_RESULT_AVAILABLE_EXT: GLenum;
    const TIME_ELAPSED_EXT: GLenum;
    const TIMESTAMP_EXT: GLenum;
    const GPU_DISJOINT_EXT: GLenum;
}

/**
 * Class是提供类的创建的辅助工具。
 * @example
 * const Bird = Hilo3d.Class.create({
 *     Extends: Animal,
 *     Mixes: EventMixin,
 *     constructor: function(name){
 *         this.name = name;
 *     },
 *     fly: function(){
 *         console.log('I am flying');
 *     },
 *     Statics: {
 *         isBird: function(bird){
 *             return bird instanceof Bird;
 *         }
 *     }
 * });
 *
 * const swallow = new Bird('swallow');
 * swallow.fly();
 * Bird.isBird(swallow);
 */
namespace Class {
    /**
     * 混入属性或方法。
     * @param target - 混入目标对象。
     * @param source - 要混入的属性和方法来源。可支持多个来源参数。
     * @returns 混入目标对象。
     */
    function mix(target: any, ...source: any[]): any;
    /**
     * 根据参数指定的属性和方法创建类。
     * @param params - 要创建的类的相关属性和方法。
     * @param [params.Statics] - 指定类的静态属性或方法。
     * @param [params.Extends] - 指定要继承的父类。
     * @param [params.Mixes] - 指定要混入的成员集合对象
     * @param [params.constructor] - 构造函数
     * @param params.[value:string] - 其他创建类的成员属性或方法。
     */
    function create(params: {
        Statics?: any;
        Extends?: any;
        Mixes?: any;
        constructor?: (...params: any[]) => any;
        [value:string]: any;
    }): void;
}

/**
 * 事件对象
 * @property type - 事件类型
 * @property [detail = null] - 事件数据
 */
interface EventObject {
    /**
     * 事件类型
    */
    type: string;
    /**
     * 事件数据
    */
    detail?: any;
}

/**
 * @param [e] - 事件对象
 * @param e.type - 事件类型
 * @param e.detail - 事件数据
 * @param e.target - 事件触发对象
 * @param e.timeStamp - 时间戳
 */
type EventMixinCallback = (e?: {
    type: string;
    detail: any;
    target: any;
    timeStamp: Date;
}) => void;

/**
 * 包围盒信息
 */
type Bounds = {
    /**
     * 包围盒中心的X坐标
     */
    x: number;
    /**
     * 包围盒中心的Y坐标
     */
    y: number;
    /**
     * 包围盒中心的Z坐标
     */
    z: number;
    /**
     * 包围盒的宽度
     */
    width: number;
    /**
     * 包围盒的高度
     */
    height: number;
    /**
     * 包围盒的深度
     */
    depth: number;
    /**
     * X轴的最小值
     */
    xMin: number;
    /**
     * X轴的最大值
     */
    xMax: number;
    /**
     * Y轴的最小值
     */
    yMin: number;
    /**
     * Y轴的最大值
     */
    yMax: number;
    /**
     * Z轴的最小值
     */
    zMin: number;
    /**
     * Z轴的最大值
     */
    zMax: number;
};

/**
 * 碰撞信息
 */
type raycastInfo = {
    /**
     * 碰撞的 mesh
     */
    mesh: Mesh;
    /**
     * 碰撞得点
     */
    point: Vector3;
};

/**
 * Node traverse 回调
 * @param node
 */
type NodeTraverseCallback = (node: Node) => any;

/**
 * Node getChildByCallback 回调
 * @param node
 */
type NodeGetChildByCallback = (node: Node) => boolean;

/**
 * @property duration
 * @property [delay]
 * @property [ease]
 * @property [onStart]
 * @property [onComplete]
 * @property [onUpdate]
 */
interface TweenParams {
    duration: number;
    delay?: number | string;
    ease?: (...params: any[]) => any;
    onStart?: (...params: any[]) => any;
    onComplete?: (...params: any[]) => any;
    onUpdate?: (...params: any[]) => any;
}

/**
 * @property EaseIn
 * @property EaseOut
 * @property EaseInOut
 */
interface TweenEaseObject {
    EaseIn: (...params: any[]) => any;
    EaseOut: (...params: any[]) => any;
    EaseInOut: (...params: any[]) => any;
}

/**
 * @param attribute
 * @param index
 * @param offset
 */
type GeometryDataTraverseCallback = (attribute: number | Vector2 | Vector3 | Vector4, index: number, offset: number) => void;

/**
 * @param component
 * @param index
 * @param offset
 */
type GeometryDataTraverseByComponentCallback = (component: number, index: number, offset: number) => void;

/**
 * GLTFExtension Handler 接口
 */
interface IGLTFExtensionHandler {
    /**
     * 解析元素扩展
     * @param [extensionData] - 扩展数据
     * @param [parser] - parser
     * @param [element] - parse的元素，e.g. material, mesh, geometry
     * @param [options]
     * @returns [result] 一般需要返回原始元素或者替换的新的元素
     */
    parse?(extensionData?: any, parser?: GLTFParser, element?: any, options?: any): any;
    /**
     * 解析全局扩展，在资源加载后执行
     * @param [extensionData] - 扩展数据
     * @param [parser] - parser
     * @param [element] - parse的元素，这里为 null
     * @param [options]
     */
    parseOnLoad?(extensionData?: any, parser?: GLTFParser, element?: any, options?: any): void;
    /**
     * 解析全局扩展，在所有元素解析结束后执行
     * @param [extensionData] - 扩展数据
     * @param [parser] - parser
     * @param [element] - parse的元素，这里为加载后的model，{node, scene, meshes, json, cameras, lights, textures, materials}
     * @param [options]
     */
    parseOnEnd?(extensionData?: any, parser?: GLTFParser, element?: GLTFModel, options?: any): void;
    /**
     * 初始化全局扩展，在加载前执行，可进行添加需要加载的资源
     * @param [gltfLoader]
     * @param [parser]
     */
    init?(gltfLoader?: GLTFLoader, parser?: GLTFParser): void;
    /**
     * 获取扩展用到的贴图信息, parser.isLoadAllTextures 为 false 时生效
     * @example
     * getUsedTextureNameMap(extension, map) {
     *     if (extension.diffuseTexture) {
     *         map[extension.diffuseTexture.index] = true;
     *     }
     * }
     * @param [extensionData] - 扩展数据
     * @param [map] - used texture map
     */
    getUsedTextureNameMap?(extensionData?: any, map?: any): void;
}

/**
 * GLTFLoader 模型加载完返回的对象格式
 */
type GLTFModel = {
    /**
     * 原始数据
     */
    json: any;
    /**
     * 模型的根节点
     */
    node?: Node;
    /**
     * 模型的所有Mesh对象数组
     */
    meshes?: Mesh[];
    /**
     * 模型的动画对象数组，没有动画的话为null
     */
    anim?: Animation;
    /**
     * 模型中的所有Camera对象数组
     */
    cameras?: Camera[];
    /**
     * 模型中的所有Light对象数组
     */
    lights?: Light[];
    /**
     * 模型中的所有Texture对象数组
     */
    textures?: Texture[];
    /**
     * 模型中的所有Material对象数组
     */
    materials?: BasicMaterial[];
    /**
     * 模型中的所有Skeleton对象数组
     */
    skins?: Skeleton[];
};

/**
 * @property key
 * @property state - 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
 * @property data
 */
interface ILoadCacheFile {
    key: string;
    /**
     * 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
    */
    state: number;
    data: any;
}

/**
 * 语义
 */
namespace semantic {
    var state: WebGLState;
    var camera: Camera;
    var lightManager: LightManager;
    var fog: Fog;
    var gl: WebGLRenderingContext;
    /**
     * WebGLRenderer
     */
    var renderer: WebGLRenderer;
    /**
     * 初始化
     * @param _state
     * @param _camera
     * @param _lightManager
     * @param _fog
     */
    function init(_state: WebGLState, _camera: Camera, _lightManager: LightManager, _fog: Fog): void;
    /**
     * 设置相机
     * @param _camera
     */
    function setCamera(_camera: Camera): void;
    /**
     * @param value
     * @param textureIndex - programInfo.textureIndex
     */
    function handlerColorOrTexture(value: Texture | Color, textureIndex: number): Float32Array | number;
    /**
     * @param value
     * @param textureIndex - programInfo.textureIndex
     */
    function handlerTexture(value: Texture, textureIndex: number): number;
    /**
     * @param target
     * @param texture
     * @param textureIndex - programInfo.textureIndex
     */
    function handlerGLTexture(target: GLenum, texture: WebGLTexture, textureIndex: number): number;
    /**
     * @param texture
     * @returns uv
     */
    function handlerUV(texture: Texture): number;
    var POSITION: semanticObject;
    var NORMAL: semanticObject;
    var TANGENT: semanticObject;
    var TEXCOORD_0: semanticObject;
    var TEXCOORD_1: semanticObject;
    var UVMATRIX_0: semanticObject;
    var UVMATRIX_1: semanticObject;
    var CAMERAFAR: semanticObject;
    var CAMERANEAR: semanticObject;
    var CAMERATYPE: semanticObject;
    var COLOR_0: semanticObject;
    var SKININDICES: semanticObject;
    var SKINWEIGHTS: semanticObject;
    var RENDERERSIZE: semanticObject;
    var LOCAL: semanticObject;
    var MODEL: semanticObject;
    var VIEW: semanticObject;
    var PROJECTION: semanticObject;
    var VIEWPROJECTION: semanticObject;
    var MODELVIEW: semanticObject;
    var MODELVIEWPROJECTION: semanticObject;
    var MODELINVERSE: semanticObject;
    var VIEWINVERSE: semanticObject;
    var VIEWINVERSEINVERSETRANSPOSE: semanticObject;
    var PROJECTIONINVERSE: semanticObject;
    var MODELVIEWINVERSE: semanticObject;
    var MODELVIEWPROJECTIONINVERSE: semanticObject;
    var MODELINVERSETRANSPOSE: semanticObject;
    var MODELVIEWINVERSETRANSPOSE: semanticObject;
    /**
     * 还未实现，不要使用
     */
    var VIEWPORT: semanticObject;
    var JOINTMATRIX: semanticObject;
    var JOINTMATRIXTEXTURE: semanticObject;
    var JOINTMATRIXTEXTURESIZE: semanticObject;
    var NORMALMAPSCALE: semanticObject;
    var OCCLUSIONSTRENGTH: semanticObject;
    var SHININESS: semanticObject;
    var SPECULARENVMATRIX: semanticObject;
    var REFLECTIVITY: semanticObject;
    var REFRACTRATIO: semanticObject;
    var REFRACTIVITY: semanticObject;
    var AMBIENTLIGHTSCOLOR: semanticObject;
    var DIRECTIONALLIGHTSCOLOR: semanticObject;
    var DIRECTIONALLIGHTSINFO: semanticObject;
    var DIRECTIONALLIGHTSSHADOWMAP: semanticObject;
    var DIRECTIONALLIGHTSSHADOWMAPSIZE: semanticObject;
    var DIRECTIONALLIGHTSSHADOWBIAS: semanticObject;
    var DIRECTIONALLIGHTSPACEMATRIX: semanticObject;
    var POINTLIGHTSPOS: semanticObject;
    var POINTLIGHTSCOLOR: semanticObject;
    var POINTLIGHTSINFO: semanticObject;
    var POINTLIGHTSRANGE: semanticObject;
    var POINTLIGHTSSHADOWMAP: semanticObject;
    var POINTLIGHTSSHADOWBIAS: semanticObject;
    var POINTLIGHTSPACEMATRIX: semanticObject;
    var POINTLIGHTCAMERA: semanticObject;
    var SPOTLIGHTSPOS: semanticObject;
    var SPOTLIGHTSDIR: semanticObject;
    var SPOTLIGHTSCOLOR: semanticObject;
    var SPOTLIGHTSCUTOFFS: semanticObject;
    var SPOTLIGHTSINFO: semanticObject;
    var SPOTLIGHTSRANGE: semanticObject;
    var SPOTLIGHTSSHADOWMAP: semanticObject;
    var SPOTLIGHTSSHADOWMAPSIZE: semanticObject;
    var SPOTLIGHTSSHADOWBIAS: semanticObject;
    var SPOTLIGHTSPACEMATRIX: semanticObject;
    var AREALIGHTSCOLOR: semanticObject;
    var AREALIGHTSPOS: semanticObject;
    var AREALIGHTSWIDTH: semanticObject;
    var AREALIGHTSHEIGHT: semanticObject;
    var AREALIGHTSLTCTEXTURE1: semanticObject;
    var AREALIGHTSLTCTEXTURE2: semanticObject;
    var FOGCOLOR: semanticObject;
    var FOGINFO: semanticObject;
    var POSITIONDECODEMAT: semanticObject;
    var NORMALDECODEMAT: semanticObject;
    var UVDECODEMAT: semanticObject;
    var BASECOLOR: semanticObject;
    /**
     * EMISSION FACTOR
     */
    var EMISSIONFACTOR: any;
    var METALLIC: semanticObject;
    var ROUGHNESS: semanticObject;
    var DIFFUSEENVMAP: semanticObject;
    var DIFFUSEENVINTENSITY: semanticObject;
    var BRDFLUT: semanticObject;
    var SPECULARENVMAP: semanticObject;
}

/**
 * semantic 对象
 */
type semanticObject = {
    /**
     * 是否依赖 mesh
     */
    isDependMesh: boolean;
    /**
     * 是否不支持 instanced
     */
    notSupportInstanced: boolean;
    /**
     * 获取数据方法
     */
    get: (...params: any[]) => any;
};

/**
 * 含x, y, z属性的对象
 */
type XYZObject = {
    x: number;
    y: number;
    z: number;
};

namespace math {
    /**
     * 角度值转弧度值
     */
    var DEG2RAD: number;
    /**
     * 弧度值转角度值
     */
    var RAD2DEG: number;
    /**
     * 生成唯一ID
     * @param [prefix = ''] - ID前缀
     * @returns ID
     */
    function generateUUID(prefix?: string): string;
    /**
     * 截取
     * @param value - 值
     * @param min - 最小值
     * @param max - 最大值
     */
    function clamp(value: number, min: number, max: number): number;
    /**
     * 角度值转换成弧度值
     * @param deg - 角度值
     * @returns 弧度值
     */
    function degToRad(deg: number): number;
    /**
     * 弧度值转换成角度值
     * @param rad - 弧度值
     * @returns 角度值
     */
    function radToDeg(rad: number): number;
    /**
     * 是否是 2 的指数值
     * @param value
     */
    function isPowerOfTwo(value: number): boolean;
    /**
     * 最近的 2 的指数值
     * @param value
     */
    function nearestPowerOfTwo(value: number): number;
    /**
     * 下一个的 2 的指数值
     * @param value
     */
    function nextPowerOfTwo(value: number): number;
}

/**
 * @param mesh
 */
type RenderListTraverseCallback = (mesh: Mesh) => void;

/**
 * @param meshes
 */
type RenderListInstancedTraverseCallback = (meshes: Mesh[]) => void;

/**
 * 顶点对象
 */
type AttributeObject = {
    attribute: any;
    buffer: WebGLBuffer;
    geometryData: GeometryData;
    useInstanced: boolean;
};

/**
 * WebGL 能力
 */
namespace capabilities {
    /**
     * 最大纹理数量
     */
    var MAX_TEXTURE_INDEX: number;
    /**
     * 最高着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_PRECISION: string;
    /**
     * 最高顶点着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_VERTEX_PRECISION: string;
    /**
     * 最高片段着色器精度, 可以是以下值：highp, mediump, lowp
     */
    var MAX_FRAGMENT_PRECISION: string;
    /**
     * 顶点浮点数纹理
     */
    var VERTEX_TEXTURE_FLOAT: boolean;
    /**
     * 片段浮点数纹理
     */
    var FRAGMENT_TEXTURE_FLOAT: boolean;
    /**
     * MAX_TEXTURE_MAX_ANISOTROPY
     */
    var MAX_TEXTURE_MAX_ANISOTROPY: number;
    var MAX_RENDERBUFFER_SIZE: number;
    var MAX_COMBINED_TEXTURE_IMAGE_UNITS: number;
    var MAX_CUBE_MAP_TEXTURE_SIZE: number;
    var MAX_FRAGMENT_UNIFORM_VECTORS: number;
    var MAX_TEXTURE_IMAGE_UNITS: number;
    var MAX_TEXTURE_SIZE: number;
    var MAX_VARYING_VECTORS: number;
    var MAX_VERTEX_ATTRIBS: number;
    var MAX_VERTEX_TEXTURE_IMAGE_UNITS: number;
    var MAX_VERTEX_UNIFORM_VECTORS: number;
    /**
     * 初始化
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;
    /**
     * 获取 WebGL 能力
     * @param name
     */
    function get(name: string): number | string;
    /**
     * 获取最大支持精度
     * @param a
     * @param b
     */
    function getMaxPrecision(a: string, b: string): string;
}

type ANGLEInstancedArrays = any;

type OESVertexArrayObject = any;

type OESTextureFloat = any;

type WebGLLoseContext = any;

type EXTTextureFilterAnisotropic = any;

/**
 * WebGL 扩展管理，默认开启的扩展有：ANGLE_instanced_arrays, OES_vertex_array_object, OES_texture_float, WEBGL_lose_context, OES_element_index_uint, EXT_shader_texture_lod
 */
namespace extensions {
    /**
     * ANGLE_instanced_arrays扩展
     */
    var instanced: ANGLEInstancedArrays;
    /**
     * OES_vertex_array_object扩展
     */
    var vao: OESVertexArrayObject;
    /**
     * OES_texture_float扩展
     */
    var texFloat: OESTextureFloat;
    /**
     * WEBGL_lose_context扩展
     */
    var loseContext: WebGLLoseContext;
    /**
     * EXT_texture_filter_anisotropic
     */
    var textureFilterAnisotropic: EXTTextureFilterAnisotropic;
    /**
     * 初始化
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;
    /**
     * 重置扩展
     * @param gl
     */
    function reset(gl: WebGLRenderingContext): void;
    /**
     * 使用扩展
     * @param name - 扩展名称
     * @param [alias = name] - 别名，默认和 name 相同
     */
    function use(name: string, alias?: string): void;
    /**
     * 获取扩展，如果不支持返回 null，必须在 Renderer 初始化完后用
     * @param name - 扩展名称
     * @param [alias = name] - 别名，默认和 name 相同
     */
    function get(name: string, alias?: string): any | null;
    /**
     * 禁止扩展
     * @param name - 扩展名称
     */
    function disable(name: string): void;
    /**
     * 开启扩展
     * @param name - 扩展名称
     */
    function enable(name: string): void;
}

/**
 */
type glTypeInfo = {
    /**
     * 名字，e.g. FLOAT_VEC2
     */
    name: string;
    /**
     * 字节大小
     */
    byteSize: number;
    /**
     * uniform方法名字，e.g. uniform3f
     */
    uniformFuncName: string;
    /**
     * 类型，可以是 Scalar, Vector, Matrix
     */
    type: string;
    /**
     * 数量
     */
    size: number;
    /**
     * gl enum值
     */
    glValue: GLenum;
    /**
     * uniform单个值方法
     */
    uniform: (...params: any[]) => any;
    /**
     * uniform多个值方法
     */
    uniformArray: (...params: any[]) => any;
};

namespace glType {
    /**
     * init
     * @param gl
     */
    function init(gl: WebGLRenderingContext): void;
    /**
     * 获取信息
     * @param type
     */
    function get(type: GLenum): glTypeInfo;
}

/**
 * 打印所有 gl 资源
 * @returns gl资源数量字符串
 */
function logGLResource(): string;

/**
 * WebGL支持检测
 */
namespace WebGLSupport {
    /**
     * 是否支持 WebGL
     */
    function get(): boolean;
}

/**
 * 浏览器特性集合
 */
namespace browser {
    /**
     * 是否是iphone
     */
    const iphone: boolean;
    /**
     * 是否是ipad
     */
    const ipad: boolean;
    /**
     * 是否是ipod
     */
    const ipod: boolean;
    /**
     * 是否是ios
     */
    const ios: boolean;
    /**
     * 是否是android
     */
    const android: boolean;
    /**
     * 是否是webkit
     */
    const webkit: boolean;
    /**
     * 是否是chrome
     */
    const chrome: boolean;
    /**
     * 是否是safari
     */
    const safari: boolean;
    /**
     * 是否是firefox
     */
    const firefox: boolean;
    /**
     * 是否是ie
     */
    const ie: boolean;
    /**
     * 是否是opera
     */
    const opera: boolean;
    /**
     * 是否支持触碰事件。
     */
    const supportTouch: boolean;
    /**
     * 是否支持canvas元素。
     */
    const supportCanvas: boolean;
    /**
     * 是否支持本地存储localStorage。
     */
    const supportStorage: boolean;
    /**
     * 是否支持检测设备方向orientation。
     */
    const supportOrientation: boolean;
    /**
     * 是否支持检测加速度devicemotion。
     */
    const supportDeviceMotion: boolean;
    /**
     * 浏览器厂商CSS前缀的js值。比如：webkit。
     */
    const jsVendor: string;
    /**
     * 浏览器厂商CSS前缀的css值。比如：-webkit-。
     */
    const cssVendor: string;
    /**
     * 是否支持CSS Transform变换。
     */
    const supportTransform: boolean;
    /**
     * 是否支持CSS Transform 3D变换。
     */
    const supportTransform3D: boolean;
    /**
     * 鼠标或触碰开始事件。对应touchstart或mousedown。
     */
    const POINTER_START: string;
    /**
     * 鼠标或触碰移动事件。对应touchmove或mousemove。
     */
    const POINTER_MOVE: string;
    /**
     * 鼠标或触碰结束事件。对应touchend或mouseup。
     */
    const POINTER_END: string;
}

/**
 * 向 Web 控制台输出一条消息，可以通过设置等级过滤输出的消息。
 * @example
 * Hilo3d.log.level = Hilo3d.log.LEVEL_LOG | Hilo3d.log.LEVEL_ERROR;
 * Hilo3d.log.error("ERROR!");
 */
namespace log {
    /**
     * log级别
     */
    var level: number;
    /**
     * 不显示任何
     */
    const LEVEL_NONE = "0";
    /**
     * 显示 log
     */
    const LEVEL_LOG = "1";
    /**
     * 显示 warn
     */
    const LEVEL_WARN = "2";
    /**
     * 显示 error
     */
    const LEVEL_ERROR = "4";
    /**
     * log，等同 console.log
     * @example
     * Hilo3d.log.log('a', {a:1});
     * @param params
     * @returns this
     */
    function log(...params: any[]): typeof log;
    /**
     * warn，等同 console.warn
     * @example
     * Hilo3d.log.warn('a', {a:1});
     * @param params
     * @returns this
     */
    function warn(...params: any[]): typeof log;
    /**
     * error，等同 console.error
     * @example
     * Hilo3d.log.error('a', {a:1});
     * @param params
     * @returns this
     */
    function error(...params: any[]): typeof log;
    /**
     * logOnce 相同 id 只 log 一次
     * @example
     * Hilo3d.log.logOnce('uniqueId0', 'a', {a:1});
     * @param id
     * @param params
     * @returns this
     */
    function logOnce(id: string, ...params: any[]): typeof log;
    /**
     * warnOnce  相同 id 只 once 一次
     * @example
     * Hilo3d.log.warnOnce('uniqueId0', 'a', {a:1});
     * @param id
     * @param params
     * @returns this
     */
    function warnOnce(id: string, ...params: any[]): typeof log;
    /**
     * errorOnce 相同 id 只 error 一次
     * @example
     * Hilo3d.log.errorOnce('uniqueId0', 'a', {a:1});
     * @param id
     * @param params
     * @returns this
     */
    function errorOnce(id: string, ...params: any[]): typeof log;
}

namespace util {
    /**
     * @param basePath
     * @param path
     */
    function getRelativePath(basePath: string, path: string): string;
    /**
     * @param array
     * @param isUTF8
     */
    function convertUint8ArrayToString(array: Uint8Array | number[], isUTF8: boolean): string;
    /**
     * @param url
     */
    function getExtension(url: string): string;
    /**
     * @param obj
     * @param fn
     */
    function each(obj: any, fn: (...params: any[]) => any): void;
    /**
     * @param array
     * @param value
     * @param compareFn
     */
    function getIndexFromSortedArray(array: any[], value: any, compareFn: (...params: any[]) => any): number[];
    /**
     * @param array
     * @param item
     * @param compareFn
     */
    function insertToSortedArray(array: any[], item: any, compareFn: (...params: any[]) => any): void;
    /**
     * @param str
     * @param len
     * @param char
     */
    function padLeft(str: string, len: number, char: string): string;
    /**
     * @param array
     */
    function getTypedArrayGLType(array: TypedArray): GLenum;
    /**
     * @param type
     */
    function getTypedArrayClass(type: GLenum): any;
    /**
     * @param destArr
     * @param srcArr
     * @param destIdx
     * @param srcIdx
     * @param count
     */
    function copyArrayData(destArr: any[], srcArr: any[], destIdx: number, srcIdx: number, count: number): void;
    /**
     * @param d
     */
    function isStrOrNumber(d: any): boolean;
    /**
     * @param url
     */
    function isBlobUrl(url: string): boolean;
    /**
     * @param blobUrl
     */
    function revokeBlobUrl(blobUrl: string): void;
    /**
     * @param mimeType
     * @param data
     */
    function getBlobUrl(mimeType: string, data: ArrayBuffer | TypedArray): string;
    /**
     * @param obj
     */
    function isArrayLike(obj: any): boolean;
    /**
     * @param elem
     */
    function getElementRect(elem: Element): any;
    /**
     * @param data
     * @param fn
     */
    function serialRun(data: any, fn: (...params: any[]) => any): Promise<any>;
    /**
     * @param obj
     * @param name
     */
    function hasOwnProperty(obj: any, name: string): boolean;
}

/**
 * Ticker是一个定时器类。它可以按指定帧率重复运行，从而按计划执行代码。
 * @param [fps] - 指定定时器的运行帧率。默认60。
 */
class Ticker {
    constructor(fps?: number);
    /**
     * 启动定时器。
     * @param [userRAF = true] - 是否使用requestAnimationFrame，默认为true。
     */
    start(userRAF?: boolean): void;
    /**
     * 停止定时器。
     */
    stop(): void;
    /**
     * 暂停定时器。
     */
    pause(): void;
    /**
     * 恢复定时器。
     */
    resume(): void;
    /**
     * 获得测定的运行时帧率。
     */
    getMeasuredFPS(): number;
    /**
     * 添加定时器对象。定时器对象必须实现 tick 方法。
     * @param ticker - 对象
     */
    addTick(ticker: any): void;
    /**
     * 删除定时器对象。
     * @param tickObject - 要删除的定时器对象。
     */
    removeTick(tickObject: any): void;
    /**
     * 下次tick时回调
     * @param callback
     * @returns tickObject 定时器对象
     */
    nextTick(callback: (...params: any[]) => any): any;
    /**
     * 延迟指定的时间后调用回调, 类似setTimeout
     * @param callback
     * @param duration - 延迟的毫秒数
     * @returns tickObject 定时器对象
     */
    timeout(callback: (...params: any[]) => any, duration: number): any;
    /**
     * 指定的时间周期来调用函数, 类似setInterval
     * @param callback
     * @param duration - 时间周期，单位毫秒
     * @returns tickObject 定时器对象
     */
    interval(callback: (...params: any[]) => any, duration: number): any;
}

/**
 * Mesh 选择工具，可以获取画布中某个区域内的Mesh
 * @example
 * const picker = new Hilo3d.MeshPicker({
 *     renderer: stage.renderer
 * });
 * picker.getSelection(20, 20, 1, 1);
 * @param [params] - 创建对象的属性参数，可包含此类的所有属性。
 */
class MeshPicker {
    constructor(params?: any);
    isMeshPicker: boolean;
    className: string;
    /**
     * 是否开启debug，开启后会将mesh以不同的颜色绘制在左下角
     */
    debug: boolean;
    /**
     * WebGLRenderer 的实例
     */
    renderer: WebGLRenderer;
    /**
     * 获取指定区域内的Mesh，注意无法获取被遮挡的Mesh
     * @param x - 左上角的x坐标
     * @param y - 左上角的y坐标
     * @param [width = 1] - 区域的宽
     * @param [height = 1] - 区域的高
     * @returns 返回获取的Mesh数组
     */
    getSelection(x: number, y: number, width?: number, height?: number): Mesh[];
}

/**
 * 缓存类
 * @example
 * const cache = new Hilo3d.Cache();
 * cache.add('id1', {a:1});
 * cache.get('id1');
 * cache.remove('id1');
 */
class Cache {
    /**
     * 获取对象
     * @param id
     */
    get(id: string): any;
    /**
     * 获取对象
     * @param obj
     * @returns [description]
     */
    getObject(obj: any): any;
    /**
     * 增加对象
     * @param id
     * @param obj
     */
    add(id: string, obj: any): void;
    /**
     * 移除对象
     * @param id
     */
    remove(id: string): void;
    /**
     * 移除对象
     * @param obj
     */
    removeObject(obj: any): void;
    /**
     * 移除所有对象
     */
    removeAll(): void;
    /**
     * 遍历所有缓存
     * @param callback
     */
    each(callback: (...params: any[]) => any): void;
}

/**
 * 纹理
 * @example
 * var loader = new Hilo3d.BasicLoader();
 * loader.load({
 *     src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg',
 *     crossOrigin: true
 * }).then(img => {
 *     return new Hilo3d.Texture({
 *         image: img
 *     });
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Texture {
    constructor(params?: any);
    /**
     * 缓存
     */
    static readonly cache: any;
    /**
     * 重置
     * @param gl
     */
    static reset(gl: WebGLRenderingContext): void;
    isTexture: boolean;
    className: string;
    /**
     * 图片资源是否可以释放，可以的话，上传到GPU后将释放图片引用
     */
    isImageCanRelease: boolean;
    /**
     * 图片对象
     */
    image: HTMLImageElement;
    /**
     * mipmaps
     */
    mipmaps: HTMLImageElement[] | TypedArray[];
    /**
     * Texture Target
     */
    target: GLenum;
    /**
     * Texture Internal Format
     */
    internalFormat: GLenum;
    /**
     * 图片 Format
     */
    format: GLenum;
    /**
     * 类型
     */
    type: GLenum;
    width: number;
    height: number;
    readonly border: number;
    /**
     * magFilter
     */
    magFilter: GLenum;
    /**
     * minFilter
     */
    minFilter: GLenum;
    /**
     * wrapS
     */
    wrapS: GLenum;
    /**
     * wrapT
     */
    wrapT: GLenum;
    name: string;
    premultiplyAlpha: boolean;
    /**
     * 是否翻转Texture的Y轴
     */
    flipY: boolean;
    /**
     * 是否转换到图片默认的颜色空间
     */
    colorSpaceConversion: boolean;
    /**
     * 是否压缩
     */
    compressed: boolean;
    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;
    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestroy: boolean;
    /**
     * 是否每次都更新Texture
     */
    autoUpdate: boolean;
    /**
     * uv
     */
    uv: number;
    /**
     * anisotropic
     */
    anisotropic: number;
    /**
     * 获取原始图像宽度。
     */
    origWidth: number;
    /**
     * 获取原始图像高度。
     */
    origHeight: number;
    /**
     * 是否使用 mipmap
     */
    readonly useMipmap: boolean;
    /**
     * 是否使用 repeat
     */
    readonly useRepeat: boolean;
    /**
     * mipmapCount
     */
    readonly mipmapCount: number;
    /**
     * 是否是 2 的 n 次方
     * @param img
     */
    isImgPowerOfTwo(img: HTMLImageElement): boolean;
    /**
     * 获取支持的尺寸
     * @param img
     * @param [needPowerOfTwo = false]
     * @returns { width, height }
     */
    getSupportSize(img: HTMLImageElement, needPowerOfTwo?: boolean): any;
    /**
     * 更新图片大小成为 2 的 n 次方
     * @param img
     */
    resizeImgToPowerOfTwo(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement;
    /**
     * 更新图片大小
     * @param img
     * @param width
     * @param height
     */
    resizeImg(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement | HTMLImageElement;
    /**
     * 更新 Texture
     * @param state
     * @param glTexture
     * @returns this
     */
    updateTexture(state: WebGLState, glTexture: WebGLTexture): Texture;
    /**
     * 跟新局部贴图
     * @param xOffset
     * @param yOffset
     * @param image
     */
    updateSubTexture(xOffset: number, yOffset: number, image: HTMLImageElement | HTMLCanvasElement | ImageData): void;
    /**
     * 获取 GLTexture
     * @param state
     */
    getGLTexture(state: WebGLState): WebGLTexture;
    /**
     * 设置 GLTexture
     * @param texture
     * @param [needDestroy = false] - 是否销毁之前的 GLTexture
     * @returns this
     */
    setGLTexture(texture: WebGLTexture, needDestroy?: boolean): Texture;
    /**
     * 销毁当前Texture
     * @returns this
     */
    destroy(): Texture;
    /**
     * clone
     */
    clone(): Texture;
}

/**
 * 懒加载纹理
 * @example
 * var material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.LazyTexture({
 *         crossOrigin: true,
 *         src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg'
 *     });
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.crossOrigin = false] - 是否跨域
 * @param [params.placeHolder] - 占位图片，默认为1像素的透明图片
 * @param [params.autoLoad = true] - 是否自动加载
 * @param [params.src] - 图片地址
 * @param params.[value:string] - 其它属性
 */
class LazyTexture extends Texture {
    constructor(params?: {
        crossOrigin?: boolean;
        placeHolder?: HTMLImageElement;
        autoLoad?: boolean;
        src?: string;
        [value:string]: any;
    });
    isLazyTexture: boolean;
    className: string;
    /**
     * 图片是否跨域
     */
    crossOrigin: boolean;
    /**
     * 是否在设置src后立即加载图片
     */
    autoLoad: boolean;
    /**
     * 资源类型，用于加载时判断
     */
    resType: string;
    /**
     * 图片地址
     */
    src: string;
    /**
     * 加载图片
     * @param [throwError = false] - 是否 throw error
     * @returns 返回加载的Promise
     */
    load(throwError?: boolean): Promise<void>;
    /**
     * 图片对象
     */
    image: HTMLImageElement;
    /**
     * 是否需要更新Texture
     */
    needUpdate: boolean;
    /**
     * 是否需要销毁之前的Texture，Texture参数变更之后需要销毁
     */
    needDestroy: boolean;
}

/**
 * 数据纹理
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.data] - 数据
 */
class DataTexture extends Texture {
    constructor(params?: {
        data?: any[] | Float32Array;
    });
    isDataTexture: boolean;
    className: string;
    target: number;
    internalFormat: number;
    format: number;
    type: number;
    magFilter: number;
    minFilter: number;
    wrapS: number;
    wrapT: number;
    /**
     * 数据，改变数据的时候会自动更新Texture
     */
    data: Float32Array;
    width: number;
    height: number;
}

/**
 * 立方体纹理
 * @example
 * var loadQueue = new Hilo3d.LoadQueue([{
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB15OJpQFXXXXXgXVXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1gwNqQFXXXXcIXFXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1pyNcQFXXXXb7XVXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1FilNQFXXXXcKXXXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1gIpqQFXXXXcZXFXXXXXXXXXX-512-512.png'
 * }, {
 *     crossOrigin: 'anonymous',
 *     src: '//gw.alicdn.com/tfs/TB1RFXLQFXXXXXEXpXXXXXXXXXX-512-512.png'
 * }]).on('complete', function () {
 *     var result = loadQueue.getAllContent();
 *     var skyboxMap = new Hilo3d.CubeTexture({
 *         image: result
 *     });
 *     var skybox = new Hilo3d.Mesh({
 *         geometry: new Hilo3d.BoxGeometry(),
 *         material: new Hilo3d.BasicMaterial({
 *             lightType: 'NONE',
 *             diffuse: skyboxMap
 *         })
 *     });
 *     stage.addChild(skybox);
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.image] - 图片列表，共6张
 */
class CubeTexture extends Texture {
    constructor(params?: {
        image?: HTMLImageElement[];
    });
    isCubeTexture: boolean;
    className: string;
    target: number;
    internalFormat: number;
    format: number;
    magFilter: number;
    minFilter: number;
    wrapS: number;
    wrapT: number;
    /**
     * 右侧的图片
     */
    right: HTMLImageElement;
    /**
     * 左侧的图片
     */
    left: HTMLImageElement;
    /**
     * 顶部的图片
     */
    top: HTMLImageElement;
    /**
     * 底部的图片
     */
    bottom: HTMLImageElement;
    /**
     * 朝前的图片
     */
    front: HTMLImageElement;
    /**
     * 朝后的图片
     */
    back: HTMLImageElement;
    /**
     * 图片对象
     */
    image: HTMLImageElement;
    width: number;
    height: number;
}

/**
 * Shader类
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Shader {
    constructor(params?: any);
    isShader: boolean;
    className: string;
    /**
     * vs 顶点代码
     */
    vs: string;
    /**
     * vs 片段代码
     */
    fs: string;
    /**
     * 内部的所有shader块字符串，可以用来拼接glsl代码
     */
    static shaders: any;
    /**
     * 初始化
     * @param renderer
     */
    static init(renderer: WebGLRenderer): void;
    /**
     * Shader 缓存
     */
    static readonly cache: Cache;
    /**
     * Shader header缓存，一般不用管
     */
    static readonly headerCache: Cache;
    /**
     * 重置
     */
    static reset(): void;
    /**
     * 获取header缓存的key
     * @param mesh - mesh
     * @param material - 材质
     * @param lightManager - lightManager
     * @param fog - fog
     * @param useLogDepth - 是否使用对数深度
     */
    static getHeaderKey(mesh: Mesh, material: Material, lightManager: LightManager, fog: Fog, useLogDepth: boolean): string;
    /**
     * 获取header
     * @param mesh
     * @param material
     * @param lightManager
     * @param fog
     */
    static getHeader(mesh: Mesh, material: Material, lightManager: LightManager, fog: Fog): string;
    /**
     * 获取 shader
     * @param mesh
     * @param material
     * @param isUseInstance
     * @param lightManager
     * @param fog
     * @param useLogDepth
     */
    static getShader(mesh: Mesh, material: Material, isUseInstance: boolean, lightManager: LightManager, fog: Fog, useLogDepth: boolean): Shader;
    /**
     * 获取基础 shader
     * @param material
     * @param isUseInstance
     * @param lightManager
     * @param fog
     */
    static getBasicShader(material: Material, isUseInstance: boolean, lightManager: LightManager, fog: Fog): Shader;
    /**
     * 获取自定义shader
     * @param vs - 顶点代码
     * @param fs - 片段代码
     * @param [cacheKey] - 如果有，会以此值缓存 shader
     * @param [useHeaderCache = false] - 如果cacheKey和useHeaderCache同时存在，使用 cacheKey+useHeaderCache缓存 shader
     */
    static getCustomShader(vs: string, fs: string, cacheKey?: string, useHeaderCache?: string): Shader;
    /**
     * 是否始终使用
     */
    alwaysUse: boolean;
    /**
     * 没有被引用时销毁资源
     * @param renderer
     * @returns this
     */
    destroyIfNoRef(renderer: WebGLRenderer): Shader;
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): Shader;
}

/**
 * WebGL 状态管理，减少 api 调用
 * @param gl
 */
class WebGLState {
    constructor(gl: WebGLRenderingContext);
    className: string;
    isWebGLState: boolean;
    /**
     * 系统framebuffer
     */
    systemFramebuffer: null;
    /**
     * gl
     */
    gl: WebGLRenderingContext;
    /**
     * 重置状态
     */
    reset(): void;
    /**
     * enable
     * @param capability
     */
    enable(capability: GLenum): void;
    /**
     * disable
     * @param capability
     */
    disable(capability: GLenum): void;
    /**
     * bindFramebuffer
     * @param target
     * @param framebuffer
     */
    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer): void;
    /**
     * 绑定系统framebuffer
     */
    bindSystemFramebuffer(): void;
    /**
     * useProgram
     * @param program
     */
    useProgram(program: WebGLProgram): void;
    /**
     * depthFunc
     * @param func
     */
    depthFunc(func: GLenum): void;
    /**
     * depthMask
     * @param flag
     */
    depthMask(flag: GLenum): void;
    /**
     * clear
     * @param mask
     */
    clear(mask: number): void;
    /**
     * depthRange
     * @param zNear
     * @param zFar
     */
    depthRange(zNear: number, zFar: number): void;
    /**
     * stencilFunc
     * @param func
     * @param ref
     * @param mask
     */
    stencilFunc(func: GLenum, ref: number, mask: number): void;
    /**
     * stencilMask
     * @param mask
     */
    stencilMask(mask: number): void;
    /**
     * stencilOp
     * @param fail
     * @param zfail
     * @param zpass
     */
    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void;
    /**
     * colorMask
     * @param red
     * @param green
     * @param blue
     * @param alpha
     */
    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void;
    /**
     * cullFace
     * @param mode
     */
    cullFace(mode: GLenum): void;
    /**
     * frontFace
     * @param mode
     */
    frontFace(mode: GLenum): void;
    /**
     * blendFuncSeparate
     * @param srcRGB
     * @param dstRGB
     * @param srcAlpha
     * @param dstAlpha
     */
    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void;
    /**
     * blendEquationSeparate
     * @param modeRGB
     * @param modeAlpha
     */
    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void;
    /**
     * pixelStorei
     * @param pname
     * @param param
     */
    pixelStorei(pname: GLenum, param: GLenum): void;
    /**
     * viewport
     * @param x
     * @param y
     * @param width
     * @param height
     */
    viewport(x: number, y: number, width: number, height: number): void;
    /**
     * activeTexture
     * @param texture
     */
    activeTexture(texture: GLenum): void;
    /**
     * bindTexture
     * @param target
     * @param texture
     */
    bindTexture(target: GLenum, texture: WebGLTexture): void;
    /**
     * 获取当前激活的纹理对象
     */
    getActiveTextureUnit(): GLenum;
}

interface WebGLResourceManager extends EventMixin {
}

/**
 * WebGLResourceManager 资源管理器
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class WebGLResourceManager implements EventMixin {
    constructor(params?: any);
    /**
     * 类名
     */
    className: string;
    isWebGLResourceManager: boolean;
    /**
     * 是否有需要销毁的资源
     */
    hasNeedDestroyResource: boolean;
    /**
     * 没有引用时销毁资源
     * @param res
     * @returns this
     */
    destroyIfNoRef(res: any): WebGLResourceManager;
    /**
     * 获取 rootNode 用到的资源
     * @param [rootNode] - 根节点，不传返回空数组
     */
    getUsedResources(rootNode?: Node): object[];
    /**
     * 销毁没被 rootNode 使用的资源，通常传 stage。
     * @param [rootNode] - 根节点，不传代表所有资源都没被使用过。
     * @returns this
     */
    destroyUnsuedResource(rootNode?: Node): WebGLResourceManager;
    /**
     * 重置
     * @returns this
     */
    reset(): WebGLResourceManager;
}

interface WebGLRenderer extends EventMixin {
}

/**
 * WebGL渲染器
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class WebGLRenderer implements EventMixin {
    constructor(params?: any);
    className: string;
    isWebGLRenderer: boolean;
    /**
     * gl
     */
    gl: WebGLRenderingContext;
    /**
     * 宽
     */
    width: number;
    /**
     * 高
     */
    height: number;
    /**
     * 像素密度
     */
    pixelRatio: number;
    /**
     * dom元素
     */
    domElement: HTMLCanvasElement;
    /**
     * 是否使用instanced
     */
    useInstanced: boolean;
    /**
     * 是否使用VAO
     */
    useVao: boolean;
    /**
     * 是否开启透明背景
     */
    alpha: boolean;
    depth: boolean;
    stencil: boolean;
    /**
     * 是否开启抗锯齿
     */
    antialias: boolean;
    /**
     * Boolean that indicates that the page compositor will assume the drawing buffer contains colors with pre-multiplied alpha.
     */
    premultipliedAlpha: boolean;
    /**
     * If the value is true the buffers will not be cleared and will preserve their values until cleared or overwritten by the author.
     */
    preserveDrawingBuffer: boolean;
    /**
     * Boolean that indicates if a context will be created if the system performance is low.
     */
    failIfMajorPerformanceCaveat: boolean;
    /**
     * 游戏模式, UC浏览器专用
     */
    gameMode: boolean;
    /**
     * 是否使用framebuffer
     */
    useFramebuffer: boolean;
    /**
     * framebuffer配置
     */
    framebufferOption: any;
    /**
     * 是否使用对数深度
     */
    useLogDepth: boolean;
    /**
     * 顶点着色器精度, 可以是以下值：highp, mediump, lowp
     */
    vertexPrecision: string;
    /**
     * 片段着色器精度, 可以是以下值：highp, mediump, lowp
     */
    fragmentPrecision: string;
    /**
     * 雾
     */
    fog: Fog;
    /**
     * 偏移值
     */
    offsetX: number;
    /**
     * 偏移值
     */
    offsetY: number;
    /**
     * 是否初始化失败
     */
    isInitFailed: boolean;
    /**
     * 背景色
     */
    clearColor: Color;
    /**
     * 渲染信息
     */
    renderInfo: RenderInfo;
    /**
     * 渲染列表
     */
    renderList: RenderList;
    /**
     * 灯光管理器
     */
    lightManager: LightManager;
    /**
     * 资源管理器
     */
    resourceManager: WebGLResourceManager;
    /**
     * 改变大小
     * @param width - 宽
     * @param height - 高
     * @param [force = false] - 是否强制刷新
     */
    resize(width: number, height: number, force?: boolean): void;
    /**
     * 设置viewport偏移值
     * @param x - x
     * @param y - y
     */
    setOffset(x: number, y: number): void;
    /**
     * 设置viewport
     * @param [x = this.offsetX] - x
     * @param [y = this.offsetY] - y
     * @param [width = this.gl.drawingBufferWidth] - width
     * @param [height = this.gl.drawingBufferHeight] - height
     */
    viewport(x?: number, y?: number, width?: number, height?: number): void;
    /**
     * 是否初始化
     */
    readonly isInit: boolean;
    /**
     * 初始化回调
     * @returns this
     */
    onInit(): WebGLRenderer;
    /**
     * 初始化 context
     */
    initContext(): void;
    /**
     * state，初始化后生成。
     */
    state: WebGLState;
    /**
     * framebuffer，只在 useFramebuffer 为 true 时初始化后生成
     */
    framebuffer: Framebuffer;
    /**
     * 设置深度检测
     * @param material
     */
    setupDepthTest(material: Material): void;
    /**
     * 设置alphaToCoverage
     * @param material
     */
    setupSampleAlphaToCoverage(material: Material): void;
    /**
     * 设置背面剔除
     * @param material
     */
    setupCullFace(material: Material): void;
    /**
     * 设置混合
     * @param material
     */
    setupBlend(material: Material): void;
    /**
     * 设置模板
     * @param material
     */
    setupStencil(material: Material): void;
    /**
     * 设置通用的 uniform
     * @param program
     * @param mesh
     * @param [force = false] - 是否强制更新
     */
    setupUniforms(program: Program, mesh: Mesh, force?: boolean): void;
    /**
     * 设置vao
     * @param vao
     * @param program
     * @param mesh
     */
    setupVao(vao: VertexArrayObject, program: Program, mesh: Mesh): void;
    /**
     * 设置材质
     * @param program
     * @param mesh
     */
    setupMaterial(program: Program, mesh: Mesh): void;
    /**
     * 设置mesh
     * @param mesh
     * @param useInstanced
     * @returns res
     * @returns res.vao
     * @returns res.program
     * @returns res.geometry
     */
    setupMesh(mesh: Mesh, useInstanced: boolean): void;
    /**
     * 增加渲染信息
     * @param faceCount - 面数量
     * @param drawCount - 绘图数量
     */
    addRenderInfo(faceCount: number, drawCount: number): void;
    /**
     * 渲染
     * @param stage
     * @param camera
     * @param [fireEvent = false] - 是否发送事件
     */
    render(stage: Stage | Node, camera: Camera, fireEvent?: boolean): void;
    /**
     * 渲染场景
     */
    renderScene(): void;
    /**
     * 清除背景
     * @param [clearColor = this.clearColor]
     */
    clear(clearColor?: Color): void;
    /**
     * 清除深度
     */
    clearDepth(): void;
    /**
     * 清除模板
     */
    clearStencil(): void;
    /**
     * 将framebuffer渲染到屏幕
     * @param framebuffer
     */
    renderToScreen(framebuffer: Framebuffer): void;
    /**
     * 渲染一个mesh
     * @param mesh
     */
    renderMesh(mesh: Mesh): void;
    /**
     * 渲染一组 instanced mesh
     * @param meshes
     */
    renderInstancedMeshes(meshes: Mesh[]): void;
    /**
     * 渲染一组普通mesh
     * @param meshes
     */
    renderMultipleMeshes(meshes: Mesh[]): void;
    /**
     * 销毁 WebGL 资源
     */
    releaseGLResource(): void;
}

/**
 * VAO
 * @param gl
 * @param id - 缓存id
 * @param params
 */
class VertexArrayObject {
    constructor(gl: WebGLRenderingContext, id: string, params: any);
    /**
     * 缓存
     */
    static readonly cache: any;
    /**
     * 获取 vao
     * @param gl
     * @param id - 缓存id
     * @param params
     */
    static getVao(gl: WebGLRenderingContext, id: string, params: any): VertexArrayObject;
    /**
     * 重置所有vao
     * @param gl
     */
    static reset(gl: WebGLRenderingContext): void;
    /**
     * 绑定系统vao
     */
    static bindSystemVao(): void;
    className: string;
    isVertexArrayObject: boolean;
    /**
     * 是否使用 vao
     */
    useVao: boolean;
    /**
     * 是否使用 instanced
     */
    useInstanced: boolean;
    /**
     * 绘图方式
     */
    mode: GLenum;
    /**
     * 是否脏
     */
    isDirty: boolean;
    /**
     * bind
     */
    bind(): void;
    /**
     * unbind
     */
    unbind(): void;
    /**
     * draw
     */
    draw(): void;
    /**
     * 获取顶点数量
     * @returns 顶点数量
     */
    getVertexCount(): number;
    /**
     * drawInstance
     * @param [primcount = 1]
     */
    drawInstance(primcount?: number): void;
    /**
     * addIndexBuffer
     * @param data
     * @param usage - gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @returns Buffer
     */
    addIndexBuffer(data: GeometryData, usage: GLenum): Buffer;
    /**
     * addAttribute
     * @param geometryData
     * @param attribute
     * @param usage - gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @param onInit
     * @returns attributeObject
     */
    addAttribute(geometryData: GeometryData, attribute: any, usage: GLenum, onInit: (...params: any[]) => any): AttributeObject;
    /**
     * addInstancedAttribute
     * @param attribute
     * @param meshes
     * @param getData
     * @returns attributeObject
     */
    addInstancedAttribute(attribute: any, meshes: any[], getData: (...params: any[]) => any): AttributeObject;
    /**
     * 获取资源
     * @param [resources = []]
     */
    getResources(resources?: object[]): object[];
    /**
     * 没有被引用时销毁资源
     * @param renderer
     * @returns this
     */
    destroyIfNoRef(renderer: WebGLRenderer): VertexArrayObject;
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): VertexArrayObject;
}

/**
 * 渲染列表
 */
class RenderList {
    className: string;
    isRenderList: boolean;
    /**
     * 使用 instanced
     */
    useInstanced: boolean;
    /**
     * 不透明物体列表
     */
    opaqueList: any[];
    /**
     * 透明物体列表
     */
    transparentList: any[];
    /**
     * instanced物体字典
     */
    instancedDict: any;
    /**
     * 重置列表
     */
    reset(): void;
    /**
     * 遍历列表执行回调
     * @param callback - callback(mesh)
     * @param [instancedCallback = null] - instancedCallback(instancedMeshes)
     */
    traverse(callback: RenderListTraverseCallback, instancedCallback?: RenderListInstancedTraverseCallback): void;
    /**
     * 增加 mesh
     * @param mesh
     * @param camera
     */
    addMesh(mesh: Mesh, camera: Camera): void;
}

/**
 * 渲染信息
 */
class RenderInfo {
    className: string;
    isRenderInfo: boolean;
    /**
     * 增加面数
     * @param num
     */
    addFaceCount(num: number): void;
    /**
     * 增加绘图数
     * @param num
     */
    addDrawCount(num: number): void;
    /**
     * 重置信息
     */
    reset(): void;
    /**
     * 面数
     */
    readonly faceCount: number;
    /**
     * 绘图数
     */
    readonly drawCount: number;
}

/**
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param params.state - WebGL state
 */
class Program {
    constructor(params?: {
        state: WebGLState;
    });
    /**
     * 缓存
     */
    static readonly cache: any;
    /**
     * 重置缓存
     */
    static reset(): void;
    /**
     * 获取程序
     * @param shader
     * @param state
     * @param [ignoreError = false]
     */
    static getProgram(shader: Shader, state: WebGLState, ignoreError?: boolean): Program;
    /**
     * 获取空白程序
     * @param state
     */
    static getBlankProgram(state: WebGLState): Program;
    className: string;
    isProgram: boolean;
    /**
     * 片段代码
     */
    fragShader: string;
    /**
     * 顶点代码
     */
    vertexShader: string;
    /**
     * attribute 集合
     */
    attributes: any;
    /**
     * uniform 集合
     */
    uniforms: any;
    /**
     * program
     */
    program: WebGLProgram;
    /**
     * gl
     */
    gl: WebGLRenderingContext;
    /**
     * webglState
     */
    state: WebGLState;
    /**
     * 是否始终使用
     */
    alwaysUse: boolean;
    /**
     * id
     */
    id: string;
    /**
     * 生成 program
     */
    createProgram(): WebGLProgram;
    /**
     * 使用 program
     */
    useProgram(): void;
    /**
     * 生成 shader
     * @param shaderType
     * @param code
     */
    createShader(shaderType: number, code: string): WebGLShader;
    /**
     * 初始化 attribute 信息
     */
    initAttributes(): void;
    /**
     * 初始化 uniform 信息
     */
    initUniforms(): void;
    /**
     * 没有被引用时销毁资源
     * @param renderer
     * @returns this
     */
    destroyIfNoRef(renderer: WebGLRenderer): Program;
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): Program;
}

/**
 * 帧缓冲
 * @param renderer
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Framebuffer {
    constructor(renderer: WebGLRenderer, params?: any);
    /**
     * 缓存
     */
    static readonly cache: Cache;
    /**
     * 重置所有framebuffer
     * @param gl
     */
    static reset(gl: WebGLRenderingContext): void;
    /**
     * 销毁所有 Framebuffer
     * @param gl
     */
    static destroy(gl: WebGLRenderingContext): void;
    className: string;
    isFramebuffer: boolean;
    /**
     * bufferInternalFormat
     */
    bufferInternalFormat: GLenum;
    /**
     * texture target
     */
    target: GLenum;
    /**
     * texture format
     */
    format: GLenum;
    /**
     * texture internalFormat
     */
    internalFormat: GLenum;
    /**
     * texture type
     */
    type: GLenum;
    /**
     * texture minFilter
     */
    minFilter: GLenum;
    /**
     * texture magFilter
     */
    magFilter: GLenum;
    /**
     * texture data
     */
    data: TypedArray;
    /**
     * attachment
     */
    attachment: GLenum;
    /**
     * 是否需要renderbuffer
     */
    needRenderbuffer: boolean;
    /**
     * 是否使用VAO
     */
    useVao: boolean;
    /**
     * renderer
     */
    renderer: WebGLRenderer;
    /**
     * texture
     */
    texture: Texture;
    /**
     * renderbuffer
     */
    renderbuffer: WebGLRenderbuffer;
    /**
     * framebuffer
     */
    framebuffer: WebGLFramebuffer;
    /**
     * init
     */
    init(): void;
    /**
     * framebuffer 是否完成
     */
    isComplete(): boolean;
    /**
     * 绑定
     */
    bind(): void;
    /**
     * 解绑
     */
    unbind(): void;
    /**
     * 渲染当前纹理
     * @param [x = 0]
     * @param [y = 0]
     * @param [width = 1]
     * @param [height = 1]
     * @param [clearColor = null]
     */
    render(x?: number, y?: number, width?: number, height?: number, clearColor?: Color): void;
    /**
     * resize
     * @param width
     * @param height
     * @param [force = true]
     */
    resize(width: number, height: number, force?: boolean): void;
    /**
     * 读取区域像素
     * @param x
     * @param y
     * @param [width = 1]
     * @param [height = 1]
     */
    readPixels(x: number, y: number, width?: number, height?: number): TypedArray;
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): Framebuffer;
    /**
     * 只销毁 gl 资源
     * @returns this
     */
    destroyResource(): Framebuffer;
}

/**
 * 缓冲
 * @param gl
 * @param [target = ARRAY_BUFFER]
 * @param [data = null]
 * @param [usage = STATIC_DRAW]
 */
class Buffer {
    constructor(gl: WebGLRenderingContext, target?: GLenum, data?: TypedArray, usage?: GLenum);
    /**
     * 缓存
     */
    static readonly cache: any;
    /**
     * 重置缓存
     */
    static reset(): void;
    /**
     * 生成顶点缓冲
     * @param gl
     * @param geometryData
     * @param [usage = STATIC_DRAW]
     */
    static createVertexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage?: GLenum): Buffer;
    /**
     * 生成索引缓冲
     * @param gl
     * @param geometryData
     * @param [usage = STATIC_DRAW]
     */
    static createIndexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage?: GLenum): Buffer;
    className: string;
    isBuffer: boolean;
    /**
     * id
     */
    id: string;
    /**
     * target
     */
    target: GLenum;
    /**
     * usage
     */
    usage: GLenum;
    /**
     * buffer
     */
    buffer: WebGLBuffer;
    /**
     * 绑定
     * @returns this
     */
    bind(): Buffer;
    /**
     * 上传数据
     * @param data
     * @returns this
     */
    bufferData(data: TypedArray): Buffer;
    /**
     * 上传部分数据
     * @param byteOffset
     * @param data
     * @param [isBinding = false]
     * @returns this
     */
    bufferSubData(byteOffset: number, data: TypedArray, isBinding?: boolean): Buffer;
    /**
     * @param geometryData
     * @returns this
     */
    uploadGeometryData(geometryData: GeometryData): Buffer;
    /**
     * 没有被引用时销毁资源
     * @param renderer
     * @returns this
     */
    destroyIfNoRef(renderer: WebGLRenderer): Buffer;
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): Buffer;
}

/**
 * 四维向量
 * @param [x = 0] - X component
 * @param [y = 0] - Y component
 * @param [z = 0] - Z component
 * @param [w = 0] - W component
 */
class Vector4 {
    constructor(x?: number, y?: number, z?: number, w?: number);
    /**
     * 类名
     */
    className: string;
    isVector4: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * Copy the values from one vec4 to this
     * @param m - the source vector
     * @returns this
     */
    copy(m: Vector4): Vector4;
    /**
     * Creates a new vec4 initialized with values from this vector
     * @returns a new Vector4
     */
    clone(): Vector4;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     */
    fromArray(array: number[] | TypedArray, offset?: number): this;
    /**
     * Set the components of a vec4 to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): Vector4;
    /**
     * Adds two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector4, b?: Vector4): Vector4;
    /**
     * Subtracts vector b from vector a
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector4, b?: Vector4): Vector4;
    /**
     * Multiplies two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector4, b?: Vector4): Vector4;
    /**
     * Divides two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector4, b?: Vector4): Vector4;
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector4;
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector4;
    /**
     * Returns the minimum of two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector4, b?: Vector4): Vector4;
    /**
     * Returns the maximum of two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector4, b?: Vector4): Vector4;
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector4;
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector4;
    /**
     * Adds two vec4's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector4, b?: Vector4): Vector4;
    /**
     * Calculates the euclidian distance between two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector4, b?: Vector4): number;
    /**
     * Calculates the squared euclidian distance between two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector4, b?: Vector4): number;
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number;
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number;
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector4;
    /**
     * Returns the inverse of the components of a vec4
     * @param [a = this]
     * @returns this
     */
    inverse(a?: Vector4): Vector4;
    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector4;
    /**
     * Calculates the dot product of two vec4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector4, b?: Vector4): number;
    /**
     * Performs a linear interpolation between two vec4's
     * @param v
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector4, t: number): Vector4;
    /**
     * Generates a random vector with the given scale
     * @param [scale = 1] - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector4;
    /**
     * Transforms the vec4 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector4;
    /**
     * Transforms the vec4 with a quat
     * @param q - quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): Vector4;
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector4, b?: Vector4): boolean;
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector4, b?: Vector4): boolean;
    /**
     * X component
     */
    x: number;
    /**
     * Y component
     */
    y: number;
    /**
     * Z component
     */
    z: number;
    /**
     * W component
     */
    w: number;
    /**
     * Alias for {@link Vector4#subtract}
     */
    sub(): void;
    /**
     * Alias for {@link Vector4#multiply}
     */
    mul(): void;
    /**
     * Alias for {@link Vector4#divide}
     */
    div(): void;
    /**
     * Alias for {@link Vector4#distance}
     */
    dist(): void;
    /**
     * Alias for {@link Vector4#squaredDistance}
     */
    sqrDist(): void;
    /**
     * Alias for {@link Vector4#length}
     */
    len(): void;
    /**
     * Alias for {@link Vector4#squaredLength}
     */
    sqrLen(): void;
}

interface Vector3Notifier extends EventMixin {
}

/**
 * 三维向量, 数据改变会发送事件
 * @param [x = 0] - X component
 * @param [y = 0] - Y component
 * @param [z = 0] - Z component
 */
class Vector3Notifier extends Vector3 implements EventMixin {
    constructor(x?: number, y?: number, z?: number);
    /**
     * 类名  notify
     */
    className: string;
    isVector3Notifier: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * X component
     */
    x: number;
    /**
     * Y component
     */
    y: number;
    /**
     * Z component
     */
    z: number;
}

/**
 * 三维向量
 * @param [x = 0] - X component
 * @param [y = 0] - Y component
 * @param [z = 0] - Z component
 */
class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    /**
     * 类名
     */
    className: string;
    isVector3: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * Copy the values from one vec3 to this
     * @param m - the source vector
     * @returns this
     */
    copy(m: Vector3): Vector3;
    /**
     * Creates a new vec3 initialized with values from this vec3
     * @returns a new Vector3
     */
    clone(): Vector3;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number): Vector3;
    /**
     * Set the components of a vec3 to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @returns this
     */
    set(x: number, y: number, z: number): Vector3;
    /**
     * Adds two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector3, b?: Vector3): Vector3;
    /**
     * Subtracts vector b from vector a
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector3, b?: Vector3): Vector3;
    /**
     * Multiplies two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector3, b?: Vector3): Vector3;
    /**
     * Divides two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector3, b?: Vector3): Vector3;
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector3;
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector3;
    /**
     * Returns the minimum of two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector3, b?: Vector3): Vector3;
    /**
     * Returns the maximum of two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector3, b?: Vector3): Vector3;
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector3;
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector3;
    /**
     * Adds two vec3's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector3, b?: Vector3): Vector3;
    /**
     * Calculates the euclidian distance between two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector3, b?: Vector3): number;
    /**
     * Calculates the squared euclidian distance between two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector3, b?: Vector3): number;
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number;
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number;
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector3;
    /**
     * Returns the inverse of the components of a vec3
     * @param [a = this]
     * @returns this
     */
    inverse(a?: Vector3): Vector3;
    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector3;
    /**
     * Calculates the dot product of two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector3, b?: Vector3): number;
    /**
     * Computes the cross product of two vec3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns cross product of a and b
     */
    cross(a: Vector2, b?: Vector2): number;
    /**
     * Performs a linear interpolation between two vec3's
     * @param v
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector3, t: number): Vector3;
    /**
     * Performs a hermite interpolation with two control points
     * @param a
     * @param b
     * @param c
     * @param d
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    hermite(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3;
    /**
     * Performs a bezier interpolation with two control points
     * @param a
     * @param b
     * @param c
     * @param d
     * @param t - interpolation amount between the two inputs
     * @returns this
     */
    bezier(a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3;
    /**
     * Generates a random vector with the given scale
     * @param [scale = 1] - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector3;
    /**
     * Transforms the vec3 with a mat3
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): Vector3;
    /**
     * Transforms the vec3 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector3;
    /**
     * Transforms the vec3 direction with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformDirection(m: Matrix4): Vector3;
    /**
     * Transforms the vec3 with a quat
     * @param q - quaternion to transform with
     * @returns this
     */
    transformQuat(q: Quaternion): Vector3;
    /**
     * Rotate this 3D vector around the x-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateX(origin: Vector3, rotation: number): Vector3;
    /**
     * Rotate this 3D vector around the y-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateY(origin: Vector3, rotation: number): Vector3;
    /**
     * Rotate this 3D vector around the z-axis
     * @param origin - The origin of the rotation
     * @param rotation - The angle of rotation
     * @returns this
     */
    rotateZ(origin: Vector3, rotation: number): Vector3;
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector3, b?: Vector3): boolean;
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector3, b?: Vector3): boolean;
    /**
     * X component
     */
    x: number;
    /**
     * Y component
     */
    y: number;
    /**
     * Z component
     */
    z: number;
    /**
     * Alias for {@link Vector3#subtract}
     */
    sub(): void;
    /**
     * Alias for {@link Vector3#multiply}
     */
    mul(): void;
    /**
     * Alias for {@link Vector3#divide}
     */
    div(): void;
    /**
     * Alias for {@link Vector3#distance}
     */
    dist(): void;
    /**
     * Alias for {@link Vector3#squaredDistance}
     */
    sqrDist(): void;
    /**
     * Alias for {@link Vector3#length}
     */
    len(): void;
    /**
     * Alias for {@link Vector3#squaredLength}
     */
    sqrLen(): void;
}

/**
 * 二维向量
 * @param [x = 0] - X component
 * @param [y = 0] - Y component
 */
class Vector2 {
    constructor(x?: number, y?: number);
    /**
     * 类名
     */
    className: string;
    isVector2: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * Copy the values from one vec2 to this
     * @param m - the source vector
     * @returns this
     */
    copy(m: Vector2): Vector2;
    /**
     * Creates a new vec2 initialized with values from this vector
     * @returns a new Vector2
     */
    clone(): Vector2;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number): Vector2;
    /**
     * Set the components of a vec4 to the given values
     * @param x - X component
     * @param y - Y component
     * @returns this
     */
    set(x: number, y: number): Vector2;
    /**
     * Adds two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Vector2, b?: Vector2): Vector2;
    /**
     * Subtracts vector b from vector a
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Vector2, b?: Vector2): Vector2;
    /**
     * Multiplies two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的积
     * @returns this
     */
    multiply(a: Vector2, b?: Vector2): Vector2;
    /**
     * Divides two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的商
     * @returns this
     */
    divide(a: Vector2, b?: Vector2): Vector2;
    /**
     * Math.ceil the components of this
     * @returns this
     */
    ceil(): Vector2;
    /**
     * Math.floor the components of this
     * @returns this
     */
    floor(): Vector2;
    /**
     * Returns the minimum of two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    min(a: Vector2, b?: Vector2): Vector2;
    /**
     * Returns the maximum of two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    max(a: Vector2, b?: Vector2): Vector2;
    /**
     * Math.round the components of this
     * @returns this
     */
    round(): Vector2;
    /**
     * Scales this by a scalar number
     * @param scale - amount to scale the vector by
     * @returns this
     */
    scale(scale: number): Vector2;
    /**
     * Adds two vec2's after scaling the second vector by a scalar value
     * @param scale - the amount to scale the second vector by before adding
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns this
     */
    scaleAndAdd(scale: number, a: Vector2, b?: Vector2): Vector2;
    /**
     * Calculates the euclidian distance between two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns distance between a and b
     */
    distance(a: Vector2, b?: Vector2): number;
    /**
     * Calculates the squared euclidian distance between two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns squared distance between a and b
     */
    squaredDistance(a: Vector2, b?: Vector2): number;
    /**
     * Calculates the length of this
     * @returns length of this
     */
    length(): number;
    /**
     * Calculates the squared length of this
     * @returns squared length of this
     */
    squaredLength(): number;
    /**
     * Negates the components of this
     * @returns this
     */
    negate(): Vector2;
    /**
     * Returns the inverse of the components of a vec2
     * @param [a = this]
     * @returns this
     */
    inverse(a?: Vector2): Vector2;
    /**
     * Normalize this
     * @returns this
     */
    normalize(): Vector2;
    /**
     * Calculates the dot product of two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns product of a and b
     */
    dot(a: Vector2, b?: Vector2): number;
    /**
     * Computes the cross product of two vec2's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns cross product of a and b
     */
    cross(a: Vector2, b?: Vector2): number;
    /**
     * Performs a linear interpolation between two vec2's
     * @param v
     * @param t - interpolation amount between the two vectors
     * @returns this
     */
    lerp(v: Vector2, t: number): Vector2;
    /**
     * Generates a random vector with the given scale
     * @param [scale = 1] - Length of the resulting vector. If ommitted, a unit vector will be returned
     * @returns this
     */
    random(scale?: number): Vector2;
    /**
     * Transforms the vec2 with a mat3
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat3(m: Matrix3): Vector2;
    /**
     * Transforms the vec2 with a mat4
     * @param m - matrix to transform with
     * @returns this
     */
    transformMat4(m: Matrix4): Vector2;
    /**
     * Returns whether or not the vectors have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    exactEquals(a: Vector2, b?: Vector2): boolean;
    /**
     * Returns whether or not the vectors have approximately the same elements in the same position.
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的结果
     * @returns True if the vectors are equal, false otherwise.
     */
    equals(a: Vector2, b?: Vector2): boolean;
    /**
     * X component
     */
    x: number;
    /**
     * Y component
     */
    y: number;
    /**
     * Alias for {@link Vector2#subtract}
     */
    sub(): void;
    /**
     * Alias for {@link Vector2#multiply}
     */
    mul(): void;
    /**
     * Alias for {@link Vector2#divide}
     */
    div(): void;
    /**
     * Alias for {@link Vector2#distance}
     */
    dist(): void;
    /**
     * Alias for {@link Vector2#squaredDistance}
     */
    sqrDist(): void;
    /**
     * Alias for {@link Vector2#length}
     */
    len(): void;
    /**
     * Alias for {@link Vector2#squaredLength}
     */
    sqrLen(): void;
}

/**
 * SphericalHarmonics3
 */
class SphericalHarmonics3 {
    /**
     * 类名
     */
    className: string;
    isSphericalHarmonics3: boolean;
    /**
     * scale
     * @param scale
     * @returns this
     */
    scale(scale: number): SphericalHarmonics3;
    /**
     * fromArray
     * @param coefficients
     * @returns this
     */
    fromArray(coefficients: Number[][] | Number[]): SphericalHarmonics3;
    /**
     * scaleForRender
     * @returns this
     */
    scaleForRender(): SphericalHarmonics3;
    /**
     * toArray
     */
    toArray(): Float32Array;
    /**
     * 克隆
     */
    clone(): SphericalHarmonics3;
    /**
     * 复制
     * @param other
     * @returns this
     */
    copy(other: SphericalHarmonics3): SphericalHarmonics3;
}

/**
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Sphere {
    constructor(params?: any);
    /**
     * 类名
     */
    className: string;
    isSphere: boolean;
    /**
     * 半径
     */
    radius: number;
    /**
     * 克隆
     */
    clone(): Sphere;
    /**
     * 复制
     * @param sphere
     * @returns this
     */
    copy(sphere: Sphere): Sphere;
    /**
     * 从点生成
     * @param points
     * @returns this
     */
    fromPoints(points: any[]): Sphere;
    /**
     * 从点生成
     * @param geometryData
     * @returns this
     */
    fromGeometryData(geometryData: GeometryData): Sphere;
    /**
     * transformMat4
     * @param mat4
     * @returns this
     */
    transformMat4(mat4: Matrix4): Sphere;
}

/**
 * 射线
 * @example
 * var ray = new Hilo3d.Ray();
 * ray.fromCamera(camera, 10, 10, stage.width, stage.height);
 * @param [params]
 * @param [params.origin = new Vector3(0, 0, 0)] - 原点
 * @param [params.direction = new Vector3(0, 0, -1)] - 方向
 */
class Ray {
    constructor(params?: {
        origin?: Vector3;
        direction?: Vector3;
    });
    /**
     * 类名
     */
    className: string;
    /**
     * 是否是射线
     */
    isRay: boolean;
    /**
     * 原点
     */
    origin: Vector3;
    /**
     * 方向
     */
    direction: Vector3;
    /**
     * set
     * @param origin
     * @param direction
     * @returns this
     */
    set(origin: Vector3, direction: Vector3): Ray;
    /**
     * copy
     * @param other
     */
    copy(other: Vector3): Ray;
    /**
     * clone
     */
    clone(): Ray;
    /**
     * 从摄像机设置
     * @param camera
     * @param x - 屏幕x
     * @param y - 屏幕y
     * @param width - 屏幕宽
     * @param height - 屏幕高
     */
    fromCamera(camera: Camera, x: number, y: number, width: number, height: number): void;
    /**
     * Transforms the ray with a mat4
     * @param mat4
     */
    transformMat4(mat4: Matrix4): void;
    /**
     * 排序碰撞点
     * @param points
     * @param [pointName = '']
     */
    sortPoints(points: Vector3[] | raycastInfo[], pointName?: string): void;
    /**
     * squaredDistance
     * @param point
     */
    squaredDistance(point: Vector3): number;
    /**
     * distance
     * @param point
     */
    distance(point: Vector3): number;
    /**
     * intersectsSphere
     * @param center - [x, y, z]
     * @param radius
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsSphere(center: Number[], radius: number): Vector3;
    /**
     * intersectsPlane
     * @param normal - [x, y, z]
     * @param distance
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsPlane(normal: Number[], distance: number): Vector3;
    /**
     * intersectsTriangle
     * @param triangle - [[a.x, a.y, a.z], [b.x, b.y, b.z],[c.x, c.y, c.z]]
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangle(triangle: any[]): Vector3;
    /**
     * intersectsBox
     * @param aabb - [[min.x, min.y, min.z], [max.x, max.y, max.z]]
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsBox(aabb: any[]): Vector3;
    /**
     * intersectsTriangleCell
     * @param cell
     * @param positions
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangleCell(cell: any[], positions: any[]): Vector3;
}

interface Quaternion extends EventMixin {
}

/**
 * @param [x = 0] - X component
 * @param [y = 0] - Y component
 * @param [z = 0] - Z component
 * @param [w = 1] - W component
 */
class Quaternion implements EventMixin {
    constructor(x?: number, y?: number, z?: number, w?: number);
    /**
     * 类名
     */
    className: string;
    isQuaternion: boolean;
    /**
     * Copy the values from one quat to this
     * @param q
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    copy(q: Quaternion, dontFireEvent?: boolean): Quaternion;
    /**
     * Creates a new quat initialized with values from an existing quaternion
     * @returns a new quaternion
     */
    clone(): Quaternion;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Set the components of a quat to the given values
     * @param x - X component
     * @param y - Y component
     * @param z - Z component
     * @param w - W component
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    set(x: number, y: number, z: number, w: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Set this to the identity quaternion
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    identity(dontFireEvent?: boolean): Quaternion;
    /**
     * Sets a quaternion to represent the shortest rotation from one
     * vector to another.
     * @param a - the initial vector
     * @param b - the destination vector
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    rotationTo(a: Vector3, b: Vector3, dontFireEvent?: boolean): Quaternion;
    /**
     * Sets the specified quaternion with values corresponding to the given
     * axes. Each axis is a vec3 and is expected to be unit length and
     * perpendicular to all other specified axes.
     * @param view - the vector representing the viewing direction
     * @param right - the vector representing the local "right" direction
     * @param up - the vector representing the local "up" direction
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    setAxes(view: Vector3, right: Vector3, up: Vector3, dontFireEvent?: boolean): Quaternion;
    /**
     * Sets a quat from the given angle and rotation axis,
     * then returns it.
     * @param axis - the axis around which to rotate
     * @param rad - the angle in radians
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    setAxisAngle(axis: Vector3, rad: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Gets the rotation axis and angle for a given
     *  quaternion. If a quaternion is created with
     *  setAxisAngle, this method will return the same
     *  values as providied in the original parameter list
     *  OR functionally equivalent values.
     * Example: The quaternion formed by axis [0, 0, 1] and
     *  angle -90 is the same as the quaternion formed by
     *  [0, 0, 1] and 270. This method favors the latter.
     * @param out_axis - Vector receiving the axis of rotation
     * @returns Angle, in radians, of the rotation
     */
    getAxisAngle(out_axis: Vector3): number;
    /**
     * Adds two quat's
     * @param q
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    add(q: Quaternion, dontFireEvent?: boolean): Quaternion;
    /**
     * Multiplies two quat's
     * @param q
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    multiply(q: Quaternion, dontFireEvent?: boolean): Quaternion;
    /**
     * premultiply the quat
     * @param q
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    premultiply(q: Quaternion, dontFireEvent?: boolean): Quaternion;
    /**
     * Scales a quat by a scalar number
     * @param scale - the vector to scale
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    scale(scale: Vector3, dontFireEvent?: boolean): Quaternion;
    /**
     * Rotates a quaternion by the given angle about the X axis
     * @param rad - angle (in radians) to rotate
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    rotateX(rad: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Rotates a quaternion by the given angle about the Y axis
     * @param rad - angle (in radians) to rotate
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    rotateY(rad: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Rotates a quaternion by the given angle about the Z axis
     * @param rad - angle (in radians) to rotate
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    rotateZ(rad: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Calculates the W component of a quat from the X, Y, and Z components.
     * Assumes that quaternion is 1 unit in length.
     * Any existing W component will be ignored.
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    calculateW(dontFireEvent?: boolean): Quaternion;
    /**
     * Calculates the dot product of two quat's
     * @param q
     * @returns dot product of two quat's
     */
    dot(q: Quaternion): number;
    /**
     * Performs a linear interpolation between two quat's
     * @param q
     * @param t - interpolation amount between the two inputs
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    lerp(q: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Performs a spherical linear interpolation between two quat
     * @param q
     * @param t - interpolation amount between the two inputs
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    slerp(q: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Performs a spherical linear interpolation with two control points
     * @param qa
     * @param qb
     * @param qc
     * @param qd
     * @param t - interpolation amount
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    sqlerp(qa: Quaternion, qb: Quaternion, qc: Quaternion, qd: Quaternion, t: number, dontFireEvent?: boolean): Quaternion;
    /**
     * Calculates the inverse of a quat
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    invert(dontFireEvent?: boolean): Quaternion;
    /**
     * Calculates the conjugate of a quat
     * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    conjugate(dontFireEvent?: boolean): Quaternion;
    /**
     * Calculates the length of a quat
     * @returns length of this
     */
    length(): number;
    /**
     * Calculates the squared length of a quat
     * @returns squared length of this
     */
    squaredLength(): number;
    /**
     * Normalize this
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    normalize(dontFireEvent?: boolean): Quaternion;
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     * @param m - rotation matrix
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    fromMat3(m: Matrix3, dontFireEvent?: boolean): Quaternion;
    /**
     * Creates a quaternion from the given 3x3 rotation matrix.
     *
     * NOTE: The resultant quaternion is not normalized, so you should be sure
     * to renormalize the quaternion yourself where necessary.
     * @param m - rotation matrix
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    fromMat4(m: Matrix4, dontFireEvent?: boolean): Quaternion;
    /**
     * Returns whether or not the quaternions have exactly the same elements in the same position (when compared with ===)
     * @param q
     */
    exactEquals(q: Quaternion): boolean;
    /**
     * Returns whether or not the quaternions have approximately the same elements in the same position.
     * @param q
     */
    equals(q: Quaternion): boolean;
    /**
     * Creates a quaternion from the given euler.
     * @param euler
     * @param [dontFireEvent = false] - wether or not don`t fire change event.
     * @returns this
     */
    fromEuler(euler: Euler, dontFireEvent?: boolean): Quaternion;
    /**
     * X component
     */
    x: number;
    /**
     * Y component
     */
    y: number;
    /**
     * Z component
     */
    z: number;
    /**
     * W component
     */
    w: number;
    /**
     * Alias for {@link Quaternion#multiply}
     */
    mul(): void;
    /**
     * Alias for {@link Quaternion#length}
     */
    len(): void;
    /**
     * Alias for {@link Quaternion#squaredLength}
     */
    sqrLen(): void;
}

/**
 * 平面
 * @param [normal = new Vector3] - 法线
 * @param [distance = 0] - 距离
 */
class Plane {
    constructor(normal?: Vector3, distance?: number);
    /**
     * 类名
     */
    className: string;
    isPlane: boolean;
    /**
     * Copy the values from one plane to this
     * @param m - the source plane
     * @returns this
     */
    copy(m: Plane): Plane;
    /**
     * Creates a new plane initialized with values from this plane
     * @returns a new Plane
     */
    clone(): Plane;
    /**
     * [set description]
     * @param x - 法线 x
     * @param y - 法线 y
     * @param z - 法线 z
     * @param w - 距离
     * @returns this
     */
    set(x: number, y: number, z: number, w: number): Plane;
    /**
     * 归一化
     * @returns this
     */
    normalize(): Plane;
    /**
     * 与点的距离
     * @param point
     */
    distanceToPoint(point: Vector3): number;
    /**
     * 投影点
     * @param point
     */
    projectPoint(point: Vector3): Vector3;
}

/**
 * 4x4 矩阵, 数据改变会发送事件
 */
class Matrix4Notifier extends Matrix4 {
    /**
     * 类名
     */
    className: string;
    isMatrix4Notifier: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
}

/**
 * 4x4 矩阵
 */
class Matrix4 {
    /**
     * 类名
     */
    className: string;
    isMatrix4: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * Copy the values from one mat4 to this
     * @param m - the source matrix
     * @returns this
     */
    copy(m: Matrix4): Matrix4;
    /**
     * Creates a new mat4 initialized with values from this matrix
     * @returns a new Matrix4
     */
    clone(): Matrix4;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number): Matrix4;
    /**
     * Set the components of a mat3 to the given values
     * @param m00
     * @param m01
     * @param m02
     * @param m03
     * @param m10
     * @param m11
     * @param m12
     * @param m13
     * @param m20
     * @param m21
     * @param m22
     * @param m23
     * @param m30
     * @param m31
     * @param m32
     * @param m33
     * @returns this
     */
    set(m00: number, m01: number, m02: number, m03: number, m10: number, m11: number, m12: number, m13: number, m20: number, m21: number, m22: number, m23: number, m30: number, m31: number, m32: number, m33: number): Matrix4;
    /**
     * Set this to the identity matrix
     * @returns this
     */
    identity(): Matrix4;
    /**
     * Transpose the values of this
     * @returns this
     */
    transpose(): Matrix4;
    /**
     * invert a matrix
     * @param [m = this]
     * @returns this
     */
    invert(m?: Matrix4): Matrix4;
    /**
     * Calculates the adjugate of a mat4
     * @param [m = this]
     * @returns this
     */
    adjoint(m?: Matrix4): Matrix4;
    /**
     * Calculates the determinant of this
     * @returns this
     */
    determinant(): Matrix4;
    /**
     * Multiplies two matrix4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的乘积
     * @returns this
     */
    multiply(a: Matrix4, b?: Matrix4): Matrix4;
    /**
     * 左乘
     * @param m
     * @returns this
     */
    premultiply(m: Matrix4): Matrix4;
    /**
     * Translate this by the given vector
     * @param v - vector to translate by
     * @returns this
     */
    translate(v: Vector3): Matrix4;
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v - the vec3 to scale the matrix by
     * @returns this
     */
    scale(v: Vector3): Matrix4;
    /**
     * Rotates this by the given angle
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    rotate(rad: number, axis: Vector3): Matrix4;
    /**
     * Rotates this by the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateX(rad: number): Matrix4;
    /**
     * Rotates this by the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateY(rad: number): Matrix4;
    /**
     * Rotates this by the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotateZ(rad: number): Matrix4;
    /**
     * Creates a matrix from a vector translation
     * @param transition - Translation vector
     * @returns this
     */
    fromTranslation(transition: Vector3): Matrix4;
    /**
     * Creates a matrix from a vector scaling
     * @param v - Scaling vector
     * @returns this
     */
    fromScaling(v: Vector3): Matrix4;
    /**
     * Creates a matrix from a given angle around a given axis
     * @param rad - the angle to rotate the matrix by
     * @param axis - the axis to rotate around
     * @returns this
     */
    fromRotation(rad: number, axis: Vector3): Matrix4;
    /**
     * Creates a matrix from the given angle around the X axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromXRotation(rad: number): Matrix4;
    /**
     * Creates a matrix from the given angle around the Y axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromYRotation(rad: number): Matrix4;
    /**
     * Creates a matrix from the given angle around the Z axis
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromZRotation(rad: number): Matrix4;
    /**
     * Creates a matrix from a quaternion rotation and vector translation
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @returns this
     */
    fromRotationTranslation(q: Quaternion, v: Vector3): Matrix4;
    /**
     * Returns the translation vector component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslation,
     *  the returned vector will be the same as the translation vector
     *  originally supplied.
     * @param [out = new Vector3] - Vector to receive translation component
     * @returns out
     */
    getTranslation(out?: Vector3): Vector3;
    /**
     * Returns the scaling factor component of a transformation
     *  matrix. If a matrix is built with fromRotationTranslationScale
     *  with a normalized Quaternion paramter, the returned vector will be
     *  the same as the scaling vector
     *  originally supplied.
     * @param [out = new Vector3] - Vector to receive scaling factor component
     * @returns out
     */
    getScaling(out?: Vector3): Vector3;
    /**
     * Returns a quaternion representing the rotational component
     *  of a transformation matrix. If a matrix is built with
     *  fromRotationTranslation, the returned quaternion will be the
     *  same as the quaternion originally supplied.
     * @param out - Quaternion to receive the rotation component
     * @returns out
     */
    getRotation(out: Quaternion): Quaternion;
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @param s - Scaling vector
     * @returns this
     */
    fromRotationTranslationScale(q: Quaternion, v: Vector3, s: Vector3): Matrix4;
    /**
     * Creates a matrix from a quaternion rotation, vector translation and vector scale, rotating and scaling around the given origin
     * @param q - Rotation quaternion
     * @param v - Translation vector
     * @param s - Scaling vector
     * @param o - The origin vector around which to scale and rotate
     * @returns this
     */
    fromRotationTranslationScaleOrigin(q: Quaternion, v: Vector3, s: Vector3, o: Vector3): Matrix4;
    /**
     * Calculates a 4x4 matrix from the given quaternion
     * @param q - Quaternion to create matrix from
     * @returns this
     */
    fromQuat(q: Quaternion): Matrix4;
    /**
     * Generates a frustum matrix with the given bounds
     * @param left - Left bound of the frustum
     * @param right - Right bound of the frustum
     * @param bottom - Bottom bound of the frustum
     * @param top - Top bound of the frustum
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    frustum(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;
    /**
     * Generates a perspective projection matrix with the given bounds
     * @param fovy - Vertical field of view in radians
     * @param aspect - Aspect ratio. typically viewport width/height
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    perspective(fovy: number, aspect: number, near: number, far: number): Matrix4;
    /**
     * Generates a perspective projection matrix with the given field of view.
     * @param fov - Object containing the following values: upDegrees, downDegrees, leftDegrees, rightDegrees
     * @param Near - bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    perspectiveFromFieldOfView(fov: any, Near: number, far: number): Matrix4;
    /**
     * Generates a orthogonal projection matrix with the given bounds
     * @param left - Left bound of the frustum
     * @param right - Right bound of the frustum
     * @param bottom - Bottom bound of the frustum
     * @param top - Top bound of the frustum
     * @param near - Near bound of the frustum
     * @param far - Far bound of the frustum
     * @returns this
     */
    ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix4;
    /**
     * Generates a look-at matrix with the given eye position, focal point, and up axis
     * @param eye - Position of the viewer
     * @param center - Point the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    lookAt(eye: XYZObject, center: XYZObject, up: Vector3): Matrix4;
    /**
     * Generates a matrix that makes something look at something else.
     * @param eye - Position of the viewer
     * @param Point - the viewer is looking at
     * @param up - pointing up
     * @returns this
     */
    targetTo(eye: XYZObject, Point: XYZObject, up: Vector3): Matrix4;
    /**
     * Returns Frobenius norm of a mat4
     * @returns Frobenius norm
     */
    frob(): number;
    /**
     * Adds two mat4's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Matrix4, b?: Matrix4): Matrix4;
    /**
     * Subtracts matrix b from matrix a
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Matrix4, b?: Matrix4): Matrix4;
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param [b] - 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix4, b?: Matrix4): boolean;
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a
     * @param [b] - 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix4, b?: Matrix4): boolean;
    /**
     * compose
     * @param q - quaternion
     * @param v - position
     * @param s - scale
     * @param p - [pivot]
     * @returns this
     */
    compose(q: Quaternion, v: Vector3, s: Vector3, p: Vector3): Matrix4;
    /**
     * decompose
     * @param q - quaternion
     * @param v - position
     * @param s - scale
     * @param p - [pivot]
     * @returns this
     */
    decompose(q: Quaternion, v: Vector3, s: Vector3, p: Vector3): Matrix4;
    /**
     * Alias for {@link Matrix4#subtract}
     */
    sub(): void;
    /**
     * Alias for {@link Matrix4#multiply}
     */
    mul(): void;
}

/**
 * 3x3 矩阵
 */
class Matrix3 {
    /**
     * 类名
     */
    className: string;
    isMatrix3: boolean;
    /**
     * 数据
     */
    elements: Float32Array;
    /**
     * Copy the values from one mat3 to this
     * @param m - the source matrix
     * @returns this
     */
    copy(m: Matrix3): Matrix3;
    /**
     * Creates a new mat3 initialized with values from this matrix
     * @returns a new Matrix3
     */
    clone(): Matrix3;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number): Matrix3;
    /**
     * Set the components of a mat3 to the given values
     * @param m00
     * @param m01
     * @param m02
     * @param m10
     * @param m11
     * @param m12
     * @param m20
     * @param m21
     * @param m22
     * @returns this
     */
    set(m00: number, m01: number, m02: number, m10: number, m11: number, m12: number, m20: number, m21: number, m22: number): Matrix3;
    /**
     * Set this to the identity matrix
     * @returns this
     */
    identity(): Matrix3;
    /**
     * Transpose the values of this
     * @returns this
     */
    transpose(): Matrix3;
    /**
     * invert a matrix
     * @param [m = this]
     * @returns this
     */
    invert(m?: Matrix3): Matrix3;
    /**
     * Calculates the adjugate of a mat3
     * @param [m = this]
     * @returns this
     */
    adjoint(m?: Matrix3): Matrix3;
    /**
     * Calculates the determinant of this
     */
    determinant(): number;
    /**
     * Multiplies two matrix3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的乘积
     * @returns this
     */
    multiply(a: Matrix3, b?: Matrix3): Matrix3;
    /**
     * 左乘
     * @param m
     * @returns this
     */
    premultiply(m: Matrix3): Matrix3;
    /**
     * Translate this by the given vector
     * @param v - vector to translate by
     * @returns this
     */
    translate(v: Vector2): Matrix3;
    /**
     * Rotates this by the given angle
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    rotate(rad: number): Matrix3;
    /**
     * Scales the mat3 by the dimensions in the given vec2
     * @param v - the vec2 to scale the matrix by
     * @returns this
     */
    scale(v: Vector2): Matrix3;
    /**
     * Creates a matrix from a vector translation
     * @param v - Translation vector
     * @returns this
     */
    fromTranslation(v: Vector2): Matrix3;
    /**
     * Creates a matrix from a given angle
     * @param rad - the angle to rotate the matrix by
     * @returns this
     */
    fromRotation(rad: number): Matrix3;
    /**
     * Creates a matrix from a vector scaling
     * @param v - Scaling vector
     * @returns this
     */
    fromScaling(v: Vector2): Matrix3;
    /**
     * Calculates a 3x3 matrix from the given quaternion
     * @param q - Quaternion to create matrix from
     * @returns this
     */
    fromQuat(q: Quaternion): Matrix3;
    /**
     * Calculates a 3x3 normal matrix (transpose inverse) from the 4x4 matrix
     * @param m - Mat4 to derive the normal matrix from
     * @returns this
     */
    normalFromMat4(m: Matrix4): Matrix3;
    /**
     * Copies the upper-left 3x3 values into the given mat3.
     * @param m - the source 4x4 matrix
     * @returns this
     */
    fromMat4(m: Matrix4): Matrix3;
    /**
     * Returns Frobenius norm of this
     * @returns Frobenius norm
     */
    frob(): number;
    /**
     * Adds two mat3's
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的和
     * @returns this
     */
    add(a: Matrix3, b?: Matrix3): Matrix4;
    /**
     * Subtracts matrix b from matrix a
     * @param a
     * @param [b] - 如果不传，计算 this 和 a 的差
     * @returns this
     */
    subtract(a: Matrix3, b?: Matrix3): Matrix4;
    /**
     * Returns whether or not the matrices have exactly the same elements in the same position (when compared with ===)
     * @param a
     * @param [b] - 如果不传，比较 this 和 a 是否相等
     */
    exactEquals(a: Matrix3, b?: Matrix3): boolean;
    /**
     * Returns whether or not the matrices have approximately the same elements in the same position.
     * @param a
     * @param [b] - 如果不传，比较 this 和 a 是否近似相等
     */
    equals(a: Matrix3, b?: Matrix3): boolean;
    /**
     * fromRotationTranslationScale
     * @param r - rad angle
     * @param x
     * @param y
     * @param scaleX
     * @param scaleY
     */
    fromRotationTranslationScale(r: number, x: number, y: number, scaleX: number, scaleY: number): Matrix3;
    /**
     * Alias for {@link Matrix3#subtract}
     */
    sub(): void;
    /**
     * Alias for {@link Matrix3#multiply}
     */
    mul(): void;
}

/**
 * 平截头体
 */
class Frustum {
    /**
     * 类名
     */
    className: string;
    isFrustum: boolean;
    /**
     * Copy the values from one frustum to this
     * @param m - the source frustum
     * @returns this
     */
    copy(m: Frustum): Frustum;
    /**
     * Creates a new frustum initialized with values from this frustum
     * @returns a new Frustum
     */
    clone(): Frustum;
    /**
     * fromMatrix
     * @param mat
     * @returns this
     */
    fromMatrix(mat: Matrix4): Frustum;
    /**
     * 与球体相交
     * @param sphere
     * @returns 是否相交
     */
    intersectsSphere(sphere: Sphere): boolean;
}

interface EulerNotifier extends EventMixin {
}

/**
 * 欧拉角, 数据改变会发送事件
 * @param [x = 0] - 角度 X, 弧度制
 * @param [y = 0] - 角度 Y, 弧度制
 * @param [z = 0] - 角度 Z, 弧度制
 */
class EulerNotifier extends Euler implements EventMixin {
    constructor(x?: number, y?: number, z?: number);
    /**
     * 类名
     */
    className: string;
    isEulerNotifier: boolean;
    /**
     * 角度 X, 角度制
     */
    degX: number;
    /**
     * 角度 Y, 角度制
     */
    degY: number;
    /**
     * 角度 Z, 角度制
     */
    degZ: number;
    /**
     * 角度 X, 弧度制
     */
    x: number;
    /**
     * 角度 Y, 弧度制
     */
    y: number;
    /**
     * 角度 Z, 弧度制
     */
    z: number;
}

/**
 * @param [x = 0] - 角度 X, 弧度制
 * @param [y = 0] - 角度 Y, 弧度制
 * @param [z = 0] - 角度 Z, 弧度制
 */
class Euler {
    constructor(x?: number, y?: number, z?: number);
    /**
     * 类名
     */
    className: string;
    isEuler: boolean;
    /**
     * 旋转顺序，默认为 ZYX
     */
    order: string;
    /**
     * 克隆
     */
    clone(): Euler;
    /**
     * 复制
     * @param euler
     * @returns this
     */
    copy(euler: Euler): Euler;
    /**
     * Set the components of a euler to the given values
     * @param x - x 轴旋转角度, 弧度制
     * @param y - y 轴旋转角度, 弧度制
     * @param z - z 轴旋转角度, 弧度制
     * @returns this
     */
    set(x: number, y: number, z: number): Euler;
    /**
     * 设置角度
     * @param degX - x 轴旋转角度, 角度制
     * @param degY - y 轴旋转角度, 角度制
     * @param degZ - z 轴旋转角度, 角度制
     * @returns this
     */
    setDegree(degX: number, degY: number, degZ: number): Euler;
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     * @returns this
     */
    fromArray(array: number[] | TypedArray, offset?: number): Euler;
    /**
     * 转换到数组
     * @param [array = []] - 数组
     * @param [offset = 0] - 数组偏移值
     */
    toArray(array?: number[] | TypedArray, offset?: number): any[];
    /**
     * Creates a euler from the given 4x4 rotation matrix.
     * @param mat - rotation matrix
     * @param [order = this.order] - 旋转顺序，默认为当前Euler实例的order
     * @returns this
     */
    fromMat4(mat: Matrix4, order?: string): Euler;
    /**
     * Creates a euler from the given quat.
     * @param quat
     * @param [order = this.order] - 旋转顺序，默认为当前Euler实例的order
     * @returns this
     */
    fromQuat(quat: Quaternion, order?: string): Euler;
    /**
     * 角度 X, 角度制
     */
    degX: number;
    /**
     * 角度 Y, 角度制
     */
    degY: number;
    /**
     * 角度 Z, 角度制
     */
    degZ: number;
    /**
     * 角度 X, 弧度制
     */
    x: number;
    /**
     * 角度 Y, 弧度制
     */
    y: number;
    /**
     * 角度 Z, 弧度制
     */
    z: number;
}

/**
 * 颜色类
 * @param [r = 1]
 * @param [g = 1]
 * @param [b = 1]
 * @param [a = 1]
 */
class Color extends Vector4 {
    constructor(r?: number, g?: number, b?: number, a?: number);
    /**
     * 类名
     */
    className: string;
    isColor: boolean;
    /**
     * r
     */
    r: number;
    /**
     * g
     */
    g: number;
    /**
     * b
     */
    b: number;
    /**
     * a
     */
    a: number;
    /**
     * 转换到数组
     * @param [array = []] - 转换到的数组
     * @param [offset = 0] - 数组偏移值
     */
    toRGBArray(array?: any[], offset?: number): any[];
    /**
     * 从数组赋值
     * @param array - 数组
     * @param [offset = 0] - 数组偏移值
     */
    fromUintArray(array: any[], offset?: number): Color;
    /**
     * 从十六进制值赋值
     * @param hex - 颜色的十六进制值，可以以下形式："#ff9966", "ff9966", "#f96", "f96", 0xff9966
     */
    fromHEX(hex: string | number): Color;
    /**
     * 转16进制
     */
    toHEX(): string;
}

/**
 * Shader材质
 * @example
 * const material = new Hilo3d.ShaderMaterial({
 *     attributes:{
 *         a_pos: 'POSITION'
 *     },
 *     uniforms:{
 *         u_mat:'MODELVIEWPROJECTION',
 *         u_color_b:{
 *             get:function(mesh, material, programInfo){
 *                 return Math.random();
 *             }
 *         }
 *     },
 *     vs:`
 *         precision HILO_MAX_VERTEX_PRECISION float;
 *         attribute vec3 a_pos;
 *         uniform mat4 u_mat;
 *
 *         void main(void) {
 *             gl_Position = u_mat * vec4(a_pos, 1.0);
 *         }
 *     `,
 *     fs:`
 *         precision HILO_MAX_FRAGMENT_PRECISION float;
 *         uniform float u_color_b;
 *
 *         void main(void) {
 *             gl_FragColor = vec4(0.6, 0.8, u_color_b, 1);
 *         }
 *     `
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class ShaderMaterial extends Material {
    constructor(params?: any);
    isShaderMaterial: boolean;
    className: string;
    /**
     * vertex shader 代码
     */
    vs: string;
    /**
     * fragment shader 代码
     */
    fs: string;
    /**
     * 是否使用 header cache shader
     */
    useHeaderCache: boolean;
    /**
     * 获取定制的渲染参数
     */
    getCustomRenderOption: (...params: any[]) => any;
}

/**
 * PBR材质
 * @example
 * const material = new Hilo3d.PBRMaterial();
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.lightType = PBR] - 光照类型，只能为 PBR 或 NONE
 * @param [params.baseColor = new Color(1, 1, 1)] - 基础颜色
 * @param [params.baseColorMap] - 基础颜色贴图(sRGB空间)
 * @param [params.metallic = 1] - 金属度
 * @param [params.metallicMap] - 金属度贴图
 * @param [params.roughness = 1] - 粗糙度
 * @param [params.roughnessMap] - 粗糙度贴图
 * @param [params.occlusionMap] - 环境光遮蔽贴图
 * @param [params.occlusionStrength = 1] - 环境光遮蔽强度
 * @param [params.emission] - 放射光贴图(sRGB 空间)，或颜色
 * @param [params.diffuseEnvMap] - 漫反射辐照(Diffuse IBL)贴图
 * @param [params.diffuseEnvSphereHarmonics3] - 漫反射 SphericalHarmonics3
 * @param [params.diffuseEnvIntensity = 1] - 漫反射强度
 * @param [params.specularEnvMap] - 环境反射(Specular IBL)贴图
 * @param [params.brdfLUT] - BRDF贴图，跟环境反射贴图一起使用
 * @param [params.specularEnvIntensity = 1] - 环境反射(Specular IBL)贴图强度
 * @param params.[value:string] - 其它属性
 */
class PBRMaterial extends Material {
    constructor(params?: {
        lightType?: string;
        baseColor?: Color;
        baseColorMap?: Texture;
        metallic?: number;
        metallicMap?: Texture;
        roughness?: number;
        roughnessMap?: Texture;
        occlusionMap?: Texture;
        occlusionStrength?: number;
        emission?: Texture | Color;
        diffuseEnvMap?: Texture;
        diffuseEnvSphereHarmonics3?: SphericalHarmonics3;
        diffuseEnvIntensity?: number;
        specularEnvMap?: Texture;
        brdfLUT?: Texture;
        specularEnvIntensity?: number;
        [value:string]: any;
    });
    isPBRMaterial: boolean;
    className: string;
    /**
     * 光照类型，只能为 PBR 或 NONE
     */
    readonly lightType: string;
    /**
     * gammaCorrection
     */
    gammaCorrection: boolean;
    /**
     * 是否使用物理灯光
     */
    usePhysicsLight: boolean;
    /**
     * 基础颜色
     */
    baseColor: Color;
    /**
     * 基础颜色贴图(sRGB空间)
     */
    baseColorMap: Texture;
    /**
     * 金属度
     */
    metallic: number;
    /**
     * 金属度贴图
     */
    metallicMap: Texture;
    /**
     * 粗糙度
     */
    roughness: number;
    /**
     * 粗糙度贴图
     */
    roughnessMap: Texture;
    /**
     * 金属度及粗糙度贴图，金属度为B通道，粗糙度为G通道，可以指定R通道作为环境光遮蔽
     */
    metallicRoughnessMap: Texture;
    /**
     * 环境光遮蔽贴图
     */
    occlusionMap: Texture;
    /**
     * 环境光遮蔽强度
     */
    occlusionStrength: number;
    /**
     * 环境光遮蔽贴图(occlusionMap)包含在 metallicRoughnessMap 的R通道中
     */
    isOcclusionInMetallicRoughnessMap: boolean;
    /**
     * 漫反射辐照(Diffuse IBL)贴图
     */
    diffuseEnvMap: CubeTexture | Texture;
    /**
     * 漫反射 SphericalHarmonics3
     */
    diffuseEnvSphereHarmonics3: SphericalHarmonics3;
    /**
     * 漫反射环境强度
     */
    diffuseEnvIntensity: number;
    /**
     * BRDF贴图，跟环境反射贴图一起使用 [示例]{@link https://gw.alicdn.com/tfs/TB1EvwBRFXXXXbNXpXXXXXXXXXX-256-256.png}
     */
    brdfLUT: Texture;
    /**
     * 环境反射(Specular IBL)贴图强度
     */
    specularEnvIntensity: number;
    /**
     * 环境反射(Specular IBL)贴图
     */
    specularEnvMap: CubeTexture | Texture;
    /**
     * 环境反射是否包含 mipmaps
     */
    isSpecularEnvMapIncludeMipmaps: boolean;
    /**
     * 放射光贴图(sRGB 空间)
     */
    emission: Texture;
    /**
     * The emissive color of the material.
     */
    emissionFactor: Color;
    /**
     * 是否基于反射光泽度的 PBR，具体见 [KHR_materials_pbrSpecularGlossiness]{@link https://github.com/KhronosGroup/glTF/tree/master/extensions/Khronos/KHR_materials_pbrSpecularGlossiness}
     */
    isSpecularGlossiness: boolean;
    /**
     * 镜面反射率，针对 isSpecularGlossiness 渲染
     */
    specular: Color;
    /**
     * 光泽度，针对 isSpecularGlossiness 渲染，默认PBR无效
     */
    glossiness: number;
    /**
     * 镜面反射即光泽度贴图，RGB 通道为镜面反射率，A 通道为光泽度
     */
    specularGlossinessMap: Texture;
    /**
     * The clearcoat layer intensity.
     */
    clearcoatFactor: number;
    /**
     * The clearcoat layer intensity texture.
     */
    clearcoatMap: Texture;
    /**
     * The clearcoat layer roughness.
     */
    clearcoatRoughnessFactor: number;
    /**
     * The clearcoat layer roughness texture.
     */
    clearcoatRoughnessMap: Texture;
    /**
     * The clearcoat normal map texture.
     */
    clearcoatNormalMap: Texture;
}

/**
 * 材质基类，一般不直接使用
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Material {
    constructor(params?: any);
    isMaterial: boolean;
    className: string;
    /**
     * name
     */
    name: string;
    /**
     * shader cache id
     */
    shaderCacheId: string;
    /**
     * 光照类型
     */
    lightType: string;
    /**
     * 是否开启网格模式
     */
    wireframe: boolean;
    /**
     * front face winding orientation
     */
    frontFace: GLenum;
    /**
     * 是否开启深度测试
     */
    depthTest: boolean;
    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     */
    sampleAlphaToCoverage: boolean;
    /**
     * 是否开启depthMask
     */
    depthMask: boolean;
    /**
     * 深度测试Range
     */
    depthRange: any[];
    /**
     * 深度测试方法
     */
    depthFunc: GLenum;
    /**
     * 法线贴图
     */
    normalMap: Texture;
    /**
     * 视差贴图
     */
    parallaxMap: Texture;
    /**
     * 法线贴图scale
     */
    normalMapScale: number;
    /**
     * 是否忽略透明度
     */
    ignoreTranparent: boolean;
    /**
     * 是否开启 gamma 矫正
     */
    gammaCorrection: boolean;
    /**
     * 是否使用物理灯光
     */
    usePhysicsLight: boolean;
    /**
     * 是否环境贴图和环境光同时生效
     */
    isDiffuesEnvAndAmbientLightWorkTogether: boolean;
    /**
     * 用户数据
     */
    userData: any;
    /**
     * 渲染顺序数字小的先渲染（透明物体和不透明在不同的队列）
     */
    renderOrder: number;
    /**
     * 是否预乘 alpha
     */
    premultiplyAlpha: boolean;
    /**
     * gammaOutput
     */
    gammaOutput: boolean;
    /**
     * gamma值
     */
    gammaFactor: number;
    /**
     * 是否投射阴影
     */
    castShadows: boolean;
    /**
     * 是否接受阴影
     */
    receiveShadows: boolean;
    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix: Matrix3;
    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     */
    uvMatrix1: Matrix3;
    /**
     * 是否开启 CullFace
     */
    cullFace: boolean;
    /**
     * CullFace 类型
     */
    cullFaceType: GLenum;
    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     */
    side: GLenum;
    /**
     * 是否开启颜色混合
     */
    blend: boolean;
    /**
     * 颜色混合方式
     */
    blendEquation: GLenum;
    /**
     * 透明度混合方式
     */
    blendEquationAlpha: GLenum;
    /**
     * 颜色混合来源比例
     */
    blendSrc: GLenum;
    /**
     * 颜色混合目标比例
     */
    blendDst: GLenum;
    /**
     * 透明度混合来源比例
     */
    blendSrcAlpha: GLenum;
    /**
     * 透明度混合目标比例
     */
    blendDstAlpha: GLenum;
    /**
     * stencilTest
     */
    stencilTest: boolean;
    /**
     * stencilMask
     */
    stencilMask: number;
    /**
     * stencilFunc func
     */
    stencilFunc: GLenum;
    /**
     * stencilFunc ref
     */
    stencilFuncRef: number;
    /**
     * stencilFunc mask
     */
    stencilFuncMask: number;
    /**
     * stencilOp fail
     */
    stencilOpFail: GLenum;
    /**
     * stencilOp zfail
     */
    stencilOpZFail: GLenum;
    /**
     * stencilOp zpass
     */
    stencilOpZPass: GLenum;
    /**
     * 当前是否需要强制更新
     */
    isDirty: boolean;
    /**
     * 透明度 0~1
     */
    transparency: number;
    /**
     * 是否需要透明
     */
    transparent: boolean;
    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     */
    alphaCutoff: number;
    /**
     * 是否使用HDR
     */
    useHDR: boolean;
    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     */
    exposure: number;
    /**
     * 是否需要加基础 uniforms
     */
    needBasicUnifroms: boolean;
    /**
     * 是否需要加基础 attributes
     */
    needBasicAttributes: boolean;
    id: string;
    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    uniforms: any;
    /**
     * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
     */
    attributes: any;
    /**
     * 增加基础 attributes
     */
    addBasicAttributes(): void;
    /**
     * 增加基础 uniforms
     */
    addBasicUniforms(): void;
    /**
     * 增加贴图 uniforms
     * @param textureUniforms - textureName:semanticName 键值对
     */
    addTextureUniforms(textureUniforms: any): void;
    /**
     * 获取渲染选项值
     * @param [option = {}] - 渲染选项值
     * @returns 渲染选项值
     */
    getRenderOption(option?: any): any;
    /**
     * clone 当前Material
     * @returns 返回clone的Material
     */
    clone(): Material;
    /**
     * 销毁贴图
     * @returns this
     */
    destroyTextures(): Material;
    /**
     * 获取材质全部贴图
     */
    getTextures(): Texture[];
}

/**
 * 几何材质，支持 POSITION, NORMAL, DEPTH, DISTANCE 顶点类型
 * @example
 * const material = new Hilo3d.GeometryMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class GeometryMaterial extends BasicMaterial {
    constructor(params?: any);
    isGeometryMaterial: boolean;
    className: string;
    /**
     * 顶点类型 POSITION, NORMAL, DEPTH, DISTANCE
     */
    vertexType: string;
    /**
     * 是否直接存储
     */
    writeOriginData: boolean;
    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     */
    lightType: string;
}

/**
 * 基础材质，支持 NONE, PHONG, BLINN-PHONG, LAMBERT光照模型
 * @example
 * const material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.lightType = BLINN-PHONG] - 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
 * @param [params.diffuse = new Color(.5, .5, .5)] - 漫反射贴图，或颜色
 * @param [params.ambient] - 环境光贴图，或颜色
 * @param [params.specular = new Color(1, 1, 1)] - 镜面贴图，或颜色
 * @param [params.emission = new Color(0, 0, 0)] - 放射光贴图，或颜色
 * @param [params.specularEnvMap] - 环境贴图
 * @param [params.specularEnvMatrix] - 环境贴图变化矩阵，如旋转等
 * @param [params.reflectivity = 0] - 反射率
 * @param [params.refractRatio = 0] - 折射比率
 * @param [params.refractivity = 0] - 折射率
 * @param [params.shininess = 32] - 高光发光值
 * @param params.[value:string] - 其它属性
 */
class BasicMaterial extends Material {
    constructor(params?: {
        lightType?: string;
        diffuse?: Texture | Color;
        ambient?: Texture | Color;
        specular?: Texture | Color;
        emission?: Texture | Color;
        specularEnvMap?: Texture;
        specularEnvMatrix?: Matrix4;
        reflectivity?: number;
        refractRatio?: number;
        refractivity?: number;
        shininess?: number;
        [value:string]: any;
    });
    isBasicMaterial: boolean;
    className: string;
    /**
     * 光照类型，支持: NONE, PHONG, BLINN-PHONG, LAMBERT
     */
    lightType: string;
    /**
     * 漫反射贴图，或颜色
     */
    diffuse: Texture | Color;
    /**
     * 环境光贴图，或颜色
     */
    ambient: Texture | Color;
    /**
     * 镜面贴图，或颜色
     */
    specular: Texture | Color;
    /**
     * 放射光贴图，或颜色
     */
    emission: Texture | Color;
    /**
     * 环境贴图
     */
    specularEnvMap: CubeTexture | Texture;
    /**
     * 环境贴图变化矩阵，如旋转等
     */
    specularEnvMatrix: Matrix4;
    /**
     * 反射率
     */
    reflectivity: number;
    /**
     * 折射比率
     */
    refractRatio: number;
    /**
     * 折射率
     */
    refractivity: number;
    /**
     * 高光发光值
     */
    shininess: number;
}

/**
 * Texture加载类
 * @example
 * var loader = new Hilo3d.TextureLoader();
 * loader.load({
 *     crossOrigin: true,
 *     src: '//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
 * }).then(function (diffuse) {
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: diffuse
 *     });
 *     ...
 * });
 */
class TextureLoader extends BasicLoader {
    isTextureLoader: boolean;
    className: string;
}

/**
 * ShaderMaterial加载类
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
    constructor();
    isShaderMaterialLoader: boolean;
    className: string;
}

class Loader {
    constructor();
    isLoader: boolean;
    className: string;
    /**
     * 给Loader类添加扩展Loader
     * @param ext - 资源扩展，如gltf, png 等
     * @param LoaderClass - 用于加载的类，需要继承BasicLoader
     */
    static addLoader(ext: string, LoaderClass: any): void;
    /**
     * 获取对应类型的 loader
     * @param ext
     * @returns loader
     */
    static getLoader(ext: string): any;
    /**
     * url 预处理函数
     */
    preHandlerUrl: (...params: any[]) => any;
    /**
     * load
     * @param data
     */
    load(data: any | any[]): Promise<any>;
}

interface LoadQueue extends EventMixin {
}

/**
 * 队列加载器，用于批量加载
 * @example
 * var loadQueue = new Hilo3d.LoadQueue([{
 *     type: 'CubeTexture',
 *     images: [
 *         '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
 *     ]
 * }, {
 *     src: '//ossgw.alicdn.com/tmall-c3/tmx/0356679fd543809bba95dfaea32e1d45.gltf'
 * }]).on('complete', function () {
 *     var result = loadQueue.getAllContent();
 *     var box = new Hilo3d.Mesh({
 *         geometry: geometry,
 *         material: new Hilo3d.BasicMaterial({
 *             lightType: 'NONE',
 *             cullFaceType: Hilo3d.constants.FRONT,
 *             diffuse: result[0]
 *         })
 *     }).addTo(stage);
 *     box.setScale(20);
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: new Hilo3d.Color(0, 0, 0),
 *         skyboxMap: result[0],
 *         refractRatio: 1/1.5,
 *         refractivity: 0.8,
 *         reflectivity: 0.2
 *     });
 *     var model = result[1];
 *     model.node.setScale(0.001);
 *     model.meshes.forEach(function (m) {
 *         m.material = material;
 *     });
 *     stage.addChild(model.node);
 * }).start();
 * @param [source] - 需要加载的资源列表
 */
class LoadQueue implements EventMixin {
    constructor(source?: any[]);
    isLoadQueue: boolean;
    className: string;
    /**
     * 给LoadQueue类添加扩展Loader
     * @param ext - 资源扩展，如gltf, png 等
     * @param LoaderClass - 用于加载的类，需要继承BasicLoader
     */
    static addLoader(ext: string, LoaderClass: BasicLoader): void;
    /**
     * 最大并发连接数
     */
    maxConnections: number;
    /**
     * 添加需要加载的资源
     * @param source - 资源信息
     * @param source.src - 资源地址
     * @param [source.id] - 资源id
     * @param [source.type] - 资源类型，对应ext，不传的话自动根据src来获取
     * @param [source.size] - 资源大小，用于精确计算当前加载进度
     */
    add(source: {
        src: string;
        id?: string;
        type?: string;
        size?: number;
    }): void;
    /**
     * 获取指定id的资源
     * @param id - id
     * @returns 返回对应的资源信息
     */
    get(id: string): any;
    /**
     * 获取指定id加载完后的数据
     * @param id - id
     * @returns 加载完的结果
     */
    getContent(id: string): any;
    /**
     * 开始加载资源
     * @returns 返回this
     */
    start(): LoadQueue;
    /**
     * 获取当前已经加载完的资源数量
     */
    getLoaded(): number;
    /**
     * 获取需要加载的资源总数
     */
    getTotal(): number;
    /**
     * 获取加载的所有资源结果
     * @returns 加载的所有资源结果
     */
    getAllContent(): any[];
}

interface LoadCache extends EventMixin {
}

/**
 * 加载缓存类
 */
class LoadCache implements EventMixin {
    isLoadCache: boolean;
    className: string;
    /**
     * PENDING
     */
    static readonly PENDING: number;
    /**
     * PENDING
     */
    static readonly LOADED: number;
    /**
     * FAILED
     */
    static readonly FAILED: number;
    /**
     * enabled
     */
    enabled: boolean;
    /**
     * update
     * @param key
     * @param state - 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
     * @param data
     */
    update(key: string, state: number, data: any): void;
    /**
     * get
     * @param key
     */
    get(key: string): ILoadCacheFile;
    /**
     * 获取下载完成的资源，没下载完或下载失败返回 null
     * @param key
     */
    getLoaded(key: string): any;
    /**
     * remove
     * @param key
     */
    remove(key: string): void;
    /**
     * clear
     */
    clear(): void;
    /**
     * wait
     * @param file
     */
    wait(file: ILoadCacheFile): Promise<any>;
}

/**
 * KTX 加载器
 */
class KTXLoader {
    constructor();
    /**
     * astc
     */
    static readonly astc: string;
    /**
     * etc
     */
    static readonly etc: string;
    /**
     * etc1
     */
    static readonly etc1: string;
    /**
     * pvrtc
     */
    static readonly pvrtc: string;
    /**
     * s3tc
     */
    static readonly s3tc: string;
    isKTXLoader: boolean;
    /**
     * 类名
     */
    className: string;
    /**
     * load
     * @param params
     */
    load(params: any): void;
}

class HDRLoader {
    constructor();
    isHDRLoader: boolean;
    className: string;
    /**
     * load
     * @param params
     */
    load(params: any): Promise<Texture>;
}

/**
 * @param content
 * @param params
 */
class GLTFParser {
    constructor(content: ArrayBuffer | string, params: any);
    isGLTFParser: boolean;
    className: string;
    /**
     * 扩展接口
     */
    static extensionHandlers: any;
    /**
     * 注册扩展接口
     * @param extensionName - 接口名称
     * @param handler - 接口
     */
    static registerExtensionHandler(extensionName: string, handler: IGLTFExtensionHandler): void;
    /**
     * 取消注册扩展接口
     * @param extensionName - 接口名称
     */
    static unregisterExtensionHandler(extensionName: string): void;
}

/**
 * glTF模型加载类
 * @example
 * var loader = new Hilo3d.GLTFLoader();
 * loader.load({
 *     src: '//ossgw.alicdn.com/tmall-c3/tmx/a9bedc04da498b95c57057d6a5d29fe7.gltf'
 * }).then(function (model) {
 *     stage.addChild(model.node);
 * });
 */
class GLTFLoader extends BasicLoader {
    isGLTFLoader: boolean;
    className: string;
}

/**
 * CubeTexture加载类
 * @example
 * var loader = new Hilo3d.CubeTextureLoader();
 * loader.load({
 *     crossOrigin: true,
 *     images: [
 *         '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
 *         '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
 *     ]
 * }).then(function (skybox) {
 *     var material = new Hilo3d.BasicMaterial({
 *         diffuse: skybox
 *     });
 *     ...
 * });
 */
class CubeTextureLoader extends BasicLoader {
    isCubeTextureLoader: boolean;
    className: string;
}

interface BasicLoader extends EventMixin {
}

/**
 * 基础的资源加载类
 * @example
 * var loader = new Hilo3d.BasicLoader();
 * loader.load({
 *     src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg',
 *     crossOrigin: true
 * }).then(img => {
 *     return new Hilo3d.Texture({
 *         image: img
 *     });
 * }, err => {
 *     return new Hilo3d.Color(1, 0, 0);
 * }).then(diffuse => {
 *     return new Hilo3d.BasicMaterial({
 *         diffuse: diffuse
 *     });
 * });
 */
class BasicLoader implements EventMixin {
    constructor();
    isBasicLoader: boolean;
    className: string;
    /**
     * enalbeCache
     */
    static enalbeCache(): void;
    /**
     * disableCache
     */
    static disableCache(): void;
    /**
     * deleteCache
     * @param key
     */
    static deleteCache(key: string): void;
    /**
     * clearCache
     */
    static clearCache(): void;
    /**
     * cache
     */
    static readonly cache: LoadCache;
    /**
     * TYPE_IMAGE
     */
    static readonly TYPE_IMAGE: string;
    /**
     * TYPE_JSON
     */
    static readonly TYPE_JSON: string;
    /**
     * TYPE_BUFFER
     */
    static readonly TYPE_BUFFER: string;
    /**
     * TYPE_TEXT
     */
    static readonly TYPE_TEXT: string;
    /**
     * 加载资源，这里会自动调用 loadImg 或者 loadRes
     * @param data - 参数
     * @param data.src - 资源地址
     * @param [data.type] - 资源类型(img, json, buffer)，不提供将根据 data.src 来判断类型
     * @returns 返回加载完的资源对象
     */
    load(data: {
        src: string;
        type?: string;
    }): Promise<any>;
    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param url - 需要判断的链接
     * @returns 是否跨域
     */
    isCrossOrigin(url: string): boolean;
    /**
     * 加载图片
     * @param url - 图片地址
     * @param [crossOrigin = false] - 是否跨域
     * @returns 返回加载完的图片
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<HTMLImageElement>;
    /**
     * 使用XHR加载其他资源
     * @param url - 资源地址
     * @param [type = text] - 资源类型(json, buffer, text)
     * @returns 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    loadRes(url: string, type?: string): Promise<any>;
    /**
     * XHR资源请求
     * @param opt - 请求参数
     * @param opt.url - 资源地址
     * @param [opt.type = text] - 资源类型(json, buffer, text)
     * @param [opt.method = GET] - 请求类型(GET, POST ..)
     * @param [opt.headers] - 请求头参数
     * @param [opt.body] - POST请求发送的数据
     * @returns 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    request(opt: {
        url: string;
        type?: string;
        method?: string;
        headers?: any;
        body?: string;
    }): Promise<any>;
    /**
     * 增加一个事件监听。
     * @param type - 要监听的事件类型。
     * @param listener - 事件监听回调函数。
     * @param [once] - 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @returns 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): any;
    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param [type] - 要删除监听的事件类型。
     * @param [listener] - 要删除监听的回调函数。
     * @returns 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): any;
    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @param [type] - 要发送的事件类型或者一个事件对象。
     * @param [detail] - 要发送的事件的具体信息，即事件随带参数。
     * @returns 是否成功调度事件。
     */
    fire(type?: string | EventObject, detail?: any): boolean;
}

/**
 * 聚光灯
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.color = new Color(1, 1, 1)] - 光颜色
 * @param [params.amount = 1] - 光强度
 * @param [params.range = 0] - 光照范围, 0 时代表光照范围无限大。
 * @param [params.direction = new Vector3(0, 0, 1)] - 光方向
 * @param [params.cutoff = 12.5] - 切光角(角度)，落在这个角度之内的光亮度为1
 * @param [params.outerCutoff = 17.5] - 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
 * @param params.[value:string] - 其它属性
 */
class SpotLight extends Light {
    constructor(params?: {
        color?: Color;
        amount?: number;
        range?: number;
        direction?: Vector3;
        cutoff?: number;
        outerCutoff?: number;
        [value:string]: any;
    });
    isSpotLight: boolean;
    className: string;
    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     */
    cutoff: number;
    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    outerCutoff: number;
    /**
     * 光方向
     */
    direction: Vector3;
}

/**
 * 点光源
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.color = new Color(1, 1, 1)] - 光颜色
 * @param [params.amount = 1] - 光强度
 * @param [params.range = 0] - 光照范围, 0 时代表光照范围无限大。
 * @param params.[value:string] - 其它属性
 */
class PointLight extends Light {
    constructor(params?: {
        color?: Color;
        amount?: number;
        range?: number;
        [value:string]: any;
    });
    isPointLight: boolean;
    className: string;
}

/**
 * 光管理类
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class LightManager {
    constructor(params?: any);
    isLightManager: boolean;
    className: string;
    /**
     * 增加光
     * @param light - 光源
     * @returns this
     */
    addLight(light: Light): LightManager;
    /**
     * 获取方向光信息
     * @param camera - 摄像机
     */
    getDirectionalInfo(camera: Camera): any;
    /**
     * 获取聚光灯信息
     * @param camera - 摄像机
     */
    getSpotInfo(camera: Camera): any;
    /**
     * 获取点光源信息
     * @param camera - 摄像机
     */
    getPointInfo(camera: Camera): any;
    /**
     * 获取面光源信息
     * @param camera - 摄像机
     */
    getAreaInfo(camera: Camera): any;
    /**
     * 获取环境光信息
     */
    getAmbientInfo(): any;
    /**
     * 更新所有光源信息
     * @param camera - 摄像机
     */
    updateInfo(camera: Camera): void;
    /**
     * 获取光源信息
     */
    getInfo(): any;
    /**
     * 重置所有光源
     */
    reset(): void;
}

/**
 * 灯光基础类
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class Light extends Node {
    constructor(params?: any);
    /**
     * 光强度
     */
    amount: number;
    /**
     * 是否开启灯光
     */
    enabled: boolean;
    /**
     * 光常量衰减值, PointLight 和 SpotLight 时生效
     */
    constantAttenuation: number;
    /**
     * 光线性衰减值, PointLight 和 SpotLight 时生效
     */
    linearAttenuation: number;
    /**
     * 光二次衰减值, PointLight 和 SpotLight 时生效
     */
    quadraticAttenuation: number;
    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    range: number;
    /**
     * 阴影生成参数，默认不生成阴影
     * @property [debug = false] - 是否显示生成的阴影贴图
     * @property [width = render.width] - 阴影贴图的宽，默认为画布宽
     * @property [height = render.height] - 阴影贴图的高，默认为画布高
     * @property [maxBias = 0.05] - depth最大差值，实际的bias为max(maxBias * (1 - dot(normal, lightDir)), minBias)
     * @property [minBias = 0.005] - depth最小差值
     * @property [cameraInfo = null] - 阴影摄像机信息，没有会根据当前相机自动计算
     */
    shadow: {
        /**
         * 是否显示生成的阴影贴图
         */
        debug?: boolean;
        /**
         * 阴影贴图的宽，默认为画布宽
         * @defaultValue render.width
         */
        width?: number;
        /**
         * 阴影贴图的高，默认为画布高
         * @defaultValue render.height
         */
        height?: number;
        /**
         * depth最大差值，实际的bias为max(maxBias * (1 - dot(normal, lightDir)), minBias)
         * @defaultValue 0.05
         */
        maxBias?: number;
        /**
         * depth最小差值
         * @defaultValue 0.005
         */
        minBias?: number;
        /**
         * 阴影摄像机信息，没有会根据当前相机自动计算
         */
        cameraInfo?: any;
    };
    /**
     * 是否光照信息变化
     */
    isDirty: boolean;
    /**
     * 灯光颜色
     */
    color: Color;
    /**
     * 获取光范围信息, PointLight 和 SpotLight 时生效
     * @param out - 信息接受数组
     * @param offset - 偏移值
     */
    toInfoArray(out: any[], offset: number): void;
    /**
     * 生成阴影贴图，支持阴影的子类需要重写
     * @param renderer
     * @param camera
     */
    createShadowMap(renderer: WebGLRenderer, camera: Camera): void;
    className: string;
}

/**
 * 平行光
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.color = new Color(1, 1, 1)] - 光颜色
 * @param [params.amount = 1] - 光强度
 * @param [params.direction = new Vector3(0, 0, 1)] - 光方向
 * @param params.[value:string] - 其它属性
 */
class DirectionalLight extends Light {
    constructor(params?: {
        color?: Color;
        amount?: number;
        direction?: Vector3;
        [value:string]: any;
    });
    isDirectionalLight: boolean;
    className: string;
    /**
     * 光方向
     */
    direction: Vector3;
}

/**
 * 面光源
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class AreaLight extends Light {
    constructor(params?: any);
    /**
     * ltcTexture1
     */
    static ltcTexture1: DataTexture;
    /**
     * ltcTexture2
     */
    static ltcTexture2: DataTexture;
    /**
     * ltcTexture 是否加载完成
     */
    static ltcTextureReady: boolean;
    /**
     * ltcTexture 地址
     */
    static ltcTextureUrl: string;
    /**
     * 初始化 ltcTexture
     */
    static loadLtcTexture(): void;
    isAreaLight: boolean;
    className: string;
    /**
     * width
     */
    width: number;
    /**
     * height
     */
    height: number;
    /**
     * ltcTexture1
     */
    ltcTexture1: DataTexture;
    /**
     * ltcTexture1
     */
    ltcTexture2: DataTexture;
    /**
     * 是否开启灯光
     */
    enabled: boolean;
}

/**
 * 环境光
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.color = new Color(1, 1, 1)] - 光颜色
 * @param [params.amount = 1] - 光强度
 * @param params.[value:string] - 其它属性
 */
class AmbientLight extends Light {
    constructor(params?: {
        color?: Color;
        amount?: number;
        [value:string]: any;
    });
    readonly isAmbientLight: boolean;
    readonly className: string;
}

/**
 * 摄像机帮助类
 * @example
 * stage.addChild(new Hilo3d.CameraHelper());
 * @param [params] - 初始化参数
 */
class CameraHelper extends Mesh {
    constructor(params?: any);
    isCameraHelper: boolean;
    className: string;
    /**
     * 颜色
     */
    color: Color;
    geometry: Geometry;
    material: Material;
}

/**
 * 网格帮助类
 * @example
 * stage.addChild(new Hilo3d.AxisNetHelper({ size: 5 }));
 * @param [params] - 初始化参数
 */
class AxisNetHelper extends Mesh {
    constructor(params?: any);
    isAxisNetHelper: boolean;
    className: string;
    /**
     * 网格线数量的一半(类似圆的半径)
     */
    size: number;
    /**
     * 颜色
     */
    color: Color;
    geometry: Geometry;
    material: Material;
}

/**
 * 坐标轴帮助类
 * @example
 * stage.addChild(new Hilo3d.AxisHelper());
 * @param [params] - 初始化参数
 */
class AxisHelper extends Node {
    constructor(params?: any);
    isAxisHelper: boolean;
    className: string;
    /**
     * 坐标轴的长度，不可变更，需要变可以通过设置 scale
     */
    size: number;
}

/**
 * 球形几何体
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.radius = 1] - 半径
 * @param [params.heightSegments = 16] - 垂直分割面的数量
 * @param [params.widthSegments = 32] - 水平分割面的数量
 * @param params.[value:string] - 其它属性
 */
class SphereGeometry extends Geometry {
    constructor(params?: {
        radius?: number;
        heightSegments?: number;
        widthSegments?: number;
        [value:string]: any;
    });
    isSphereGeometry: boolean;
    className: string;
    /**
     * 半径
     */
    radius: number;
    /**
     * 垂直分割面的数量
     */
    heightSegments: number;
    /**
     * 水平分割面的数量
     */
    widthSegments: number;
    /**
     * 顶点数据
     */
    vertices: GeometryData;
    /**
     * uv 数据
     */
    uvs: GeometryData;
    /**
     * 顶点索引数据
     */
    indices: GeometryData;
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: GeometryData;
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: GeometryData;
}

/**
 * 平面几何体
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.width = 1] - 宽度
 * @param [params.height = 1] - 高度
 * @param [params.widthSegments = 1] - 水平分割面的数量
 * @param [params.heightSegments = 1] - 垂直分割面的数量
 * @param params.[value:string] - 其它属性
 */
class PlaneGeometry extends Geometry {
    constructor(params?: {
        width?: number;
        height?: number;
        widthSegments?: number;
        heightSegments?: number;
        [value:string]: any;
    });
    isPlaneGeometry: boolean;
    className: string;
    /**
     * 宽度
     */
    width: number;
    /**
     * 高度
     */
    height: number;
    /**
     * 水平分割面的数量
     */
    widthSegments: number;
    /**
     * 垂直分割面的数量
     */
    heightSegments: number;
    /**
     * 顶点数据
     */
    vertices: GeometryData;
    /**
     * uv 数据
     */
    uvs: GeometryData;
    /**
     * 顶点索引数据
     */
    indices: GeometryData;
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: GeometryData;
}

/**
 * Morph几何体
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class MorphGeometry extends Geometry {
    constructor(params?: any);
    isMorphGeometry: boolean;
    className: string;
    /**
     * morph animation weights
     */
    weights: number[];
    /**
     * like:
     * {
     *     vertices: [[], []],
     *     normals: [[], []],
     *     tangents: [[], []]
     * }
     */
    targets: any;
    /**
     * 是否是静态
     */
    isStatic: boolean;
}

/**
 * geometry vertex data
 * @param data - 数据
 * @param size - The number of components per vertex attribute.Must be 1, 2, 3, or 4.
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class GeometryData {
    constructor(data: TypedArray, size: number, params?: any);
    /**
     * 类名
     */
    readonly className: string;
    /**
     * isGeometryData
     */
    readonly isGeometryData: boolean;
    /**
     * The number of components per vertex attribute.Must be 1, 2, 3, or 4.
     */
    size: number;
    /**
     * Whether integer data values should be normalized when being casted to a float.
     */
    normalized: boolean;
    /**
     * The data type of each component in the array.
     */
    type: GLenum;
    isDirty: boolean;
    bufferViewId: string;
    /**
     * glBuffer
     */
    glBuffer: Buffer;
    /**
     * id
     */
    id: string;
    data: TypedArray;
    /**
     * The offset in bytes between the beginning of consecutive vertex attributes.
     */
    stride: number;
    /**
     * An offset in bytes of the first component in the vertex attribute array. Must be a multiple of type.
     */
    offset: number;
    readonly length: number;
    readonly realLength: number;
    /**
     * 获取数据大小，单位为字节
     * @returns 数据大小
     */
    getByteLength(): number;
    readonly count: number;
    /**
     * 更新部分数据
     * @param offset - 偏移index
     * @param data - 数据
     */
    setSubData(offset: number, data: TypedArray): void;
    /**
     * 清除 subData
     */
    clearSubData(): void;
    /**
     * clone
     */
    clone(): GeometryData;
    /**
     * copy
     * @param geometryData
     */
    copy(geometryData: GeometryData): void;
    /**
     * 获取偏移值
     * @param index
     */
    getOffset(index: number): number;
    /**
     * Get the value by index.
     * Please note that it will return the same reference for performance reasons. If you want to get a copy, use #getCopy instead.
     * @param index
     */
    get(index: number): number | Vector2 | Vector3 | Vector4;
    /**
     * Get the value by index.
     * It will return a copy of value.
     * @param index
     */
    getCopy(index: number): number | Vector2 | Vector3 | Vector4;
    /**
     * 设置值
     * @param index
     * @param value
     */
    set(index: number, value: number | Vector2 | Vector3 | Vector4): void;
    /**
     * 根据 offset 获取值
     * @param offset
     */
    getByOffset(offset: number): number | Vector2 | Vector3 | Vector4;
    /**
     * 根据 offset 设置值
     * @param offset
     * @param value
     */
    setByOffset(offset: number, value: number | Vector2 | Vector3 | Vector4): void;
    /**
     * 按 index 遍历
     * @param callback
     */
    traverse(callback: GeometryDataTraverseCallback): boolean;
    /**
     * 按 Component 遍历 Component
     * @param callback
     */
    traverseByComponent(callback: GeometryDataTraverseByComponentCallback): boolean;
}

/**
 * 几何体
 * @example
 * const geometry = new Hilo3d.Geometry();
 * geometry.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0.577, 0]);
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Geometry {
    constructor(params?: any);
    isGeometry: boolean;
    className: string;
    /**
     * 顶点数据
     */
    vertices: GeometryData;
    /**
     * uv 数据
     */
    uvs: GeometryData;
    /**
     * uv1 数据
     */
    uvs1: GeometryData;
    /**
     * color 数据
     */
    colors: GeometryData;
    /**
     * 顶点索引数据
     */
    indices: GeometryData;
    /**
     * 骨骼索引
     */
    skinIndices: GeometryData;
    /**
     * 骨骼权重数据
     */
    skinWeights: GeometryData;
    /**
     * 绘制模式
     */
    mode: number;
    /**
     * 是否是静态
     */
    isStatic: boolean;
    /**
     * 是否需要更新
     */
    isDirty: boolean;
    /**
     * 使用 aabb 碰撞检测
     */
    useAABBRaycast: boolean;
    /**
     * 用户数据
     */
    userData: any;
    /**
     * id
     */
    id: string;
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: GeometryData;
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents: GeometryData;
    /**
     * 切线向量数据，如果没有的话会自动生成
     */
    tangents1: GeometryData;
    /**
     * 将三角形模式转换为线框模式，即 Material 中的 wireframe
     */
    convertToLinesMode(): void;
    /**
     * 平移
     * @param [x = 0]
     * @param [y = 0]
     * @param [z = 0]
     * @returns this
     */
    translate(x?: number, y?: number, z?: number): Geometry;
    /**
     * 缩放
     * @param [x = 1]
     * @param [y = 1]
     * @param [z = 1]
     * @returns this
     */
    scale(x?: number, y?: number, z?: number): Geometry;
    /**
     * 旋转
     * @param [x = 0] - 旋转角度x
     * @param [y = 0] - 旋转角度y
     * @param [z = 0] - 旋转角度z
     * @returns this
     */
    rotate(x?: number, y?: number, z?: number): Geometry;
    /**
     * Transforms the geometry with a mat4.
     * @param mat4
     * @returns this
     */
    transformMat4(mat4: Matrix4): Geometry;
    /**
     * 合并两个 geometry
     * @param geometry
     * @param [matrix = null] - 合并的矩阵
     * @returns this
     */
    merge(geometry: Geometry, matrix?: Matrix4): Geometry;
    /**
     * 添加顶点
     * @param points - 顶点坐标，如 addPoints([x, y, z], [x, y, z])
     */
    addPoints(...points: number[][]): void;
    /**
     * 添加顶点索引
     * @param indices - 顶点索引，如 addIndices(0, 1, 2)
     */
    addIndices(...indices: number[]): void;
    /**
     * 添加一条线
     * @param p1 - 起点坐标，如 [x, y, z]
     * @param p2 - 终点坐标
     */
    addLine(p1: number[], p2: number[]): void;
    /**
     * 添加一个三角形 ABC
     * @param p1 - 点A，如 [x, y, z]
     * @param p2 - 点B
     * @param p3 - 点C
     */
    addFace(p1: number[], p2: number[], p3: number[]): void;
    /**
     * 添加一个矩形 ABCD
     * @param p1 - 点A，如 [x, y, z]
     * @param p2 - 点B
     * @param p3 - 点C
     * @param p4 - 点D
     */
    addRect(p1: number[], p2: number[], p3: number[], p4: number[]): void;
    /**
     * 设置顶点对应的uv坐标
     * @param start - 开始的顶点索引
     * @param uvs - uv坐标数据，如 [[0, 0], [1, 0]]
     */
    setVertexUV(start: number, uvs: number[][]): void;
    /**
     * 设置三角形ABC的uv
     * @param start - 开始的顶点索引
     * @param p1 - 点A的uv，如 [0, 0]
     * @param p2 - 点B的uv
     * @param p3 - 点C的uv
     */
    setFaceUV(start: number, p1: number[], p2: number[], p3: number[]): void;
    /**
     * 设置矩形ABCD的uv
     * @param start - 开始的顶点索引
     * @param p1 - 点A的uv，如 [0, 0]
     * @param p2 - 点B的uv
     * @param p3 - 点C的uv
     * @param p4 - 点D的uv
     */
    setRectUV(start: number, p1: number[], p2: number[], p3: number[], p4: number[]): void;
    /**
     * 获取指定matrix变化后的包围盒数据
     * @param [matrix = null] - matrix 需要变换的矩阵
     * @param [bounds = null] - 包围盒数据，传入的话会改变他
     * @returns 包围盒数据
     */
    getBounds(matrix?: Matrix4, bounds?: Bounds): Bounds;
    /**
     * 获取本地包围盒
     * @param [force = false] - 是否强制刷新
     */
    getLocalBounds(force?: boolean): Bounds;
    /**
     * 获取球面包围盒
     * @param matrix
     */
    getSphereBounds(matrix: Matrix4): Sphere;
    /**
     * 获取本地球面包围盒
     * @param [force = false] - 是否强制刷新
     */
    getLocalSphereBounds(force?: boolean): Sphere;
    /**
     * 将 Geometry 转换成无 indices
     * @param [verticesItemLen = 3] - 转换结果的顶点数据的位数(3 or 4)，如果为4会补1
     */
    convertToNoIndices(verticesItemLen?: number): void;
    /**
     * clone当前Geometry
     * @returns 返回clone的Geometry
     */
    clone(): Geometry;
    /**
     * 检测 aabb 碰撞
     * @param ray
     */
    _aabbRaycast(ray: Ray): Vector3[] | null;
    /**
     * _raycast，子类可覆盖实现
     * @param ray
     * @param side
     */
    _raycast(ray: Ray, side: GLenum): Vector3[] | null;
    /**
     * raycast
     * @param ray
     * @param side
     * @param [sort = true] - 是否按距离排序
     */
    raycast(ray: Ray, side: GLenum, sort?: boolean): Vector3[] | null;
    /**
     * 获取数据的内存大小，只处理顶点数据，单位为字节
     * @returns 内存占用大小
     */
    getSize(): number;
    /**
     * @returns this
     */
    destroy(): Geometry;
}

/**
 * 长方体几何体
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.width = 1] - box的宽度
 * @param [params.height = 1] - box的高度
 * @param [params.depth = 1] - box的深度
 * @param [params.widthSegments = 1] - 水平分割面的数量
 * @param [params.heightSegments = 1] - 垂直分割面的数量
 * @param [params.depthSegments = 1] - 深度分割面的数量
 * @param params.[value:string] - 其它属性
 */
class BoxGeometry extends Geometry {
    constructor(params?: {
        width?: number;
        height?: number;
        depth?: number;
        widthSegments?: number;
        heightSegments?: number;
        depthSegments?: number;
        [value:string]: any;
    });
    isBoxGeometry: boolean;
    className: string;
    /**
     * box的宽度
     */
    width: number;
    /**
     * box的高度
     */
    height: number;
    /**
     * box的深度
     */
    depth: number;
    /**
     * 水平分割面的数量
     */
    widthSegments: number;
    /**
     * 垂直分割面的数量
     */
    heightSegments: number;
    /**
     * 深度分割面的数量
     */
    depthSegments: number;
    /**
     * 设置朝前面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setFrontUV(uv: number[][]): void;
    /**
     * 设置右侧面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setRightUV(uv: number[][]): void;
    /**
     * 设置朝后面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setBackUV(uv: number[][]): void;
    /**
     * 设置左侧面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setLeftUV(uv: number[][]): void;
    /**
     * 设置顶部面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setTopUV(uv: number[][]): void;
    /**
     * 设置底部面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如 [[0, 1], [1, 1], [1, 0], [0, 0]]
     */
    setBottomUV(uv: number[][]): void;
    /**
     * 设置所有面的uv，不支持设置带有 widthSegments heightSegments depthSegments 的实例
     * @param uv - uv数据，如
     * [<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]],<br>
     *     [[0, 1], [1, 1], [1, 0], [0, 0]]<br>
     * ]
     */
    setAllRectUV(uv: number[][][]): void;
    /**
     * 顶点数据
     */
    vertices: GeometryData;
    /**
     * uv 数据
     */
    uvs: GeometryData;
    /**
     * 顶点索引数据
     */
    indices: GeometryData;
    /**
     * 法向量数据，如果没有的话会自动生成
     */
    normals: GeometryData;
}

/**
 * Tween类提供缓动功能。
 * @example
 * Hilo.Tween.to(node, {
 *     x:100,
 *     y:20
 * }, {
 *     duration:1000,
 *     delay:500,
 *     ease:Hilo3d.Tween.Ease.Quad.EaseIn,
 *     onComplete:function(){
 *         console.log('complete');
 *     }
 * });
 * @property target - 缓动目标。只读属性。
 * @property duration - 缓动总时长。单位毫秒。
 * @property delay - 缓动延迟时间。单位毫秒。
 * @property paused - 缓动是否暂停。默认为false。
 * @property loop - 缓动是否循环。默认为false。
 * @property reverse - 缓动是否反转播放。默认为false。
 * @property repeat - 缓动重复的次数。默认为0。
 * @property repeatDelay - 缓动重复的延迟时长。单位为毫秒。
 * @property ease - 缓动变化函数。默认为null。
 * @property time - 缓动已进行的时长。单位毫秒。只读属性。
 * @property onStart - 缓动开始回调函数。它接受1个参数：tween。默认值为null。
 * @property onUpdate - 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
 * @property onComplete - 缓动结束回调函数。它接受1个参数：tween。默认值为null。
 * @param target - 缓动对象。
 * @param fromProps - 对象缓动的起始属性集合。
 * @param toProps - 对象缓动的目标属性集合。
 * @param params - 缓动参数。可包含Tween类所有可写属性。
 */
class Tween {
    constructor(target: any, fromProps: any, toProps: any, params: TweenParams);
    /**
     * 启动缓动动画的播放。
     * @returns Tween变换本身。可用于链式调用。
     */
    start(): Tween;
    /**
     * 停止缓动动画的播放。
     * @returns Tween变换本身。可用于链式调用。
     */
    stop(): Tween;
    /**
     * 暂停缓动动画的播放。
     * @returns Tween变换本身。可用于链式调用。
     */
    pause(): Tween;
    /**
     * 恢复缓动动画的播放。
     * @returns Tween变换本身。可用于链式调用。
     */
    resume(): Tween;
    /**
     * 跳转Tween到指定的时间。
     * @param time - 指定要跳转的时间。取值范围为：0 - duraion。
     * @param pause - 是否暂停。
     * @returns Tween变换本身。可用于链式调用。
     */
    seek(time: number, pause: boolean): Tween;
    /**
     * 连接下一个Tween变换。其开始时间根据delay值不同而不同。当delay值为字符串且以'+'或'-'开始时，Tween的开始时间从当前变换结束点计算，否则以当前变换起始点计算。
     * @param tween - 要连接的Tween变换。
     * @returns 下一个Tween。可用于链式调用。
     */
    link(tween: Tween): Tween;
    /**
     * 更新所有Tween实例。
     * @returns Tween
     */
    static tick(): any;
    /**
     * @returns Tween
     */
    static add(): any;
    /**
     * @returns Tween
     */
    static remove(): any;
    /**
     * @returns Tween
     */
    static removeAll(): any;
    /**
     * 创建一个缓动动画，让目标对象从开始属性变换到目标属性。
     * @param target - 缓动目标对象或缓动目标数组。
     * @param fromProps - 缓动目标对象的开始属性。
     * @param toProps - 缓动目标对象的目标属性。
     * @param params - 缓动动画的参数。
     * @returns 一个Tween实例对象或Tween实例数组。
     */
    static fromTo(target: any | any[], fromProps: any, toProps: any, params: TweenParams): Tween | any[];
    /**
     * 创建一个缓动动画，让目标对象从当前属性变换到目标属性。
     * @param target - 缓动目标对象或缓动目标数组。
     * @param toProps - 缓动目标对象的目标属性。
     * @param params - 缓动动画的参数。
     * @returns 一个Tween实例对象或Tween实例数组。
     */
    static to(target: any | any[], toProps: any, params: TweenParams): Tween | any[];
    /**
     * 创建一个缓动动画，让目标对象从指定的起始属性变换到当前属性。
     * @param target - 缓动目标对象或缓动目标数组。
     * @param fromProps - 缓动目标对象的初始属性。
     * @param params - 缓动动画的参数。
     * @returns 一个Tween实例对象或Tween实例数组。
     */
    static from(target: any | any[], fromProps: any, params: TweenParams): Tween | any[];
    /**
     * Ease类包含为Tween类提供各种缓动功能的函数。
     * @property Back
     * @property Bounce
     * @property Circ
     * @property Cubic
     * @property Elastic
     * @property Expo
     * @property Linear
     * @property Quad
     * @property Quart
     * @property Quint
     * @property Sine
     */
    static Ease: {
        Back: TweenEaseObject;
        Bounce: TweenEaseObject;
        Circ: TweenEaseObject;
        Cubic: TweenEaseObject;
        Elastic: TweenEaseObject;
        Expo: TweenEaseObject;
        Linear: TweenEaseObject;
        Quad: TweenEaseObject;
        Quart: TweenEaseObject;
        Quint: TweenEaseObject;
        Sine: TweenEaseObject;
    };
    /**
     * 缓动目标。只读属性。
    */
    target: any;
    /**
     * 缓动总时长。单位毫秒。
    */
    duration: number;
    /**
     * 缓动延迟时间。单位毫秒。
    */
    delay: number;
    /**
     * 缓动是否暂停。默认为false。
    */
    paused: boolean;
    /**
     * 缓动是否循环。默认为false。
    */
    loop: boolean;
    /**
     * 缓动是否反转播放。默认为false。
    */
    reverse: boolean;
    /**
     * 缓动重复的次数。默认为0。
    */
    repeat: number;
    /**
     * 缓动重复的延迟时长。单位为毫秒。
    */
    repeatDelay: number;
    /**
     * 缓动变化函数。默认为null。
    */
    ease: (...params: any[]) => any;
    /**
     * 缓动已进行的时长。单位毫秒。只读属性。
    */
    time: number;
    /**
     * 缓动开始回调函数。它接受1个参数：tween。默认值为null。
    */
    onStart: (...params: any[]) => any;
    /**
     * 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
    */
    onUpdate: (...params: any[]) => any;
    /**
     * 缓动结束回调函数。它接受1个参数：tween。默认值为null。
    */
    onComplete: (...params: any[]) => any;
}

/**
 * 舞台类
 * @example
 * const stage = new Hilo3d.Stage({
 *     container:document.body,
 *     width:innerWidth,
 *     height:innerHeight
 * });
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性，所有属性会透传给 Renderer。
 * @param [params.container] - stage的容器, 如果有，会把canvas加进container里。
 * @param [params.canvas] - stage的canvas，不传会自动创建。
 * @param [params.camera] - stage的摄像机。
 * @param [params.width = innerWidth] - stage的宽，默认网页宽度
 * @param [params.height = innerHeight] - stage的高，默认网页高度
 * @param [params.pixelRatio = 根据设备自动判断] - 像素密度。
 * @param [params.clearColor = new Color(1, 1, 1, 1)] - 背景色。
 * @param [params.useFramebuffer = false] - 是否使用Framebuffer，有后处理需求时需要。
 * @param [params.framebufferOption = {}] - framebufferOption Framebuffer的配置，useFramebuffer为true时生效。
 * @param [params.useLogDepth = false] - 是否使用对数深度，处理深度冲突。
 * @param [params.alpha = false] - 是否背景透明。
 * @param [params.depth = true] - 是否需要深度缓冲区。
 * @param [params.stencil = false] - 是否需要模版缓冲区。
 * @param [params.antialias = true] - 是否抗锯齿。
 * @param [params.premultipliedAlpha = true] - 是否需要 premultipliedAlpha。
 * @param [params.preserveDrawingBuffer = false] - 是否需要 preserveDrawingBuffer。
 * @param [params.failIfMajorPerformanceCaveat = false] - 是否需要 failIfMajorPerformanceCaveat。
 * @param [params.gameMode = false] - 是否开启游戏模式，UC 浏览器专用
 * @param params.[value:string] - 其它属性
 */
class Stage extends Node {
    constructor(params?: {
        container?: HTMLElement;
        canvas?: HTMLCanvasElement;
        camera?: Camera;
        width?: number;
        height?: number;
        pixelRatio?: number;
        clearColor?: Color;
        useFramebuffer?: boolean;
        framebufferOption?: any;
        useLogDepth?: boolean;
        alpha?: boolean;
        depth?: boolean;
        stencil?: boolean;
        antialias?: boolean;
        premultipliedAlpha?: boolean;
        preserveDrawingBuffer?: boolean;
        failIfMajorPerformanceCaveat?: boolean;
        gameMode?: boolean;
        [value:string]: any;
    });
    /**
     * 渲染器
     */
    renderer: WebGLRenderer;
    /**
     * 摄像机
     */
    camera: Camera;
    /**
     * 像素密度
     */
    pixelRatio: number;
    /**
     * 偏移值
     */
    offsetX: number;
    /**
     * 偏移值
     */
    offsetY: number;
    /**
     * canvas
     */
    canvas: HTMLCanvasElement;
    /**
     * 缩放舞台
     * @param width - 舞台宽
     * @param height - 舞台高
     * @param [pixelRatio = this.pixelRatio] - 像素密度
     * @param [force = false] - 是否强制刷新
     * @returns 舞台本身。链式调用支持。
     */
    resize(width: number, height: number, pixelRatio?: number, force?: boolean): Stage;
    /**
     * 设置舞台偏移值
     * @param x - x
     * @param y - y
     * @returns 舞台本身。链式调用支持。
     */
    setOffset(x: number, y: number): Stage;
    /**
     * 改viewport
     * @param x - x
     * @param y - y
     * @param width - width
     * @param height - height
     * @returns 舞台本身。链式调用支持。
     */
    viewport(x: number, y: number, width: number, height: number): Stage;
    /**
     * 渲染一帧
     * @param dt - 间隔时间
     * @returns 舞台本身。链式调用支持。
     */
    tick(dt: number): Stage;
    /**
     * 开启/关闭舞台的DOM事件响应。要让舞台上的可视对象响应用户交互，必须先使用此方法开启舞台的相应事件的响应。
     * @param type - 要开启/关闭的事件名称或数组。
     * @param enabled - 指定开启还是关闭。如果不传此参数，则默认为开启。
     * @returns 舞台本身。链式调用支持。
     */
    enableDOMEvent(type: string | any[], enabled: boolean): Stage;
    /**
     * 更新 DOM viewport
     * @returns DOM viewport, {left, top, right, bottom}
     */
    updateDomViewport(): any;
    /**
     * 获取指定点的 mesh
     * @param x
     * @param y
     * @param [eventMode = false]
     */
    getMeshResultAtPoint(x: number, y: number, eventMode?: boolean): Mesh | null;
    /**
     * 释放 WebGL 资源
     * @returns this
     */
    releaseGLResource(): Stage;
    className: string;
}

/**
 * 蒙皮Mesh
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.geometry] - 几何体
 * @param [params.material] - 材质
 * @param [params.skeleton] - 骨骼
 * @param params.[value:string] - 其它属性
 */
class SkinedMesh extends Mesh {
    constructor(params?: {
        geometry?: Geometry;
        material?: Material;
        skeleton?: Skeleton;
        [value:string]: any;
    });
    isSkinedMesh: boolean;
    className: string;
    /**
     * 是否支持 Instanced
     */
    useInstanced: boolean;
    /**
     * 骨骼矩阵DataTexture
     */
    jointMatTexture: DataTexture;
    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;
    /**
     * 骨架
     */
    skeleton: Skeleton;
    /**
     * 获取每个骨骼对应的矩阵数组
     * @returns 返回矩阵数组
     */
    getJointMat(): Float32Array;
    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param skeleton - 新骨架
     */
    resetJointNamesByNodeName(skeleton: Skeleton): void;
    /**
     * 用新骨骼重置skinIndices
     * @param skeleton
     */
    resetSkinIndices(skeleton: Skeleton): void;
    /**
     * 根据当前骨骼数来生成骨骼矩阵的 jointMatTexture
     */
    initJointMatTexture(): DataTexture;
    /**
     * 将 getJointMat 获取的骨骼矩阵数组更新到 jointMatTexture 中
     */
    updateJointMatTexture(): void;
}

/**
 * 骨架
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class Skeleton {
    constructor(params?: any);
    isSkeleton: boolean;
    className: string;
    /**
     * 用户数据
     */
    userData: any;
    /**
     * id
     */
    id: string;
    jointNodeList: Node[];
    jointNames: String[];
    inverseBindMatrices: Matrix4[];
    /**
     * 关节数量
     */
    readonly jointCount: number;
    /**
     * 设置根节点
     */
    rootNode: Node;
    /**
     * 用新骨骼的 node name 重设 jointNames
     * @param skeleton - 新骨架
     */
    resetJointNamesByNodeName(skeleton: Skeleton): void;
    /**
     * clone
     * @param [rootNode]
     */
    clone(rootNode?: Node): Skeleton;
    /**
     * copy
     * @param skeleton
     * @param [rootNode]
     * @returns this
     */
    copy(skeleton: Skeleton, rootNode?: Node): Skeleton;
}

interface Node extends EventMixin {
}

/**
 * 节点，3D场景中的元素，是大部分类的基类
 * @example
 * const node = new Hilo3d.Node({
 *     name:'test',
 *     x:100,
 *     rotationX:30,
 *     onUpdate(){
 *         this.rotationY ++;
 *     }
 * });
 * node.scaleX = 0.3;
 * stage.addChild(node);
 * @param [params] - 初始化参数，所有params都会复制到实例上
 */
class Node implements EventMixin {
    constructor(params?: any);
    /**
     * traverse callback 返回值，执行后不暂停 traverse
     */
    static TRAVERSE_STOP_NONE: any;
    /**
     * traverse callback 返回值，执行后暂停子元素 traverse
     */
    static TRAVERSE_STOP_CHILDREN: any;
    /**
     * traverse callback 返回值，执行后暂停所有 traverse
     */
    static TRAVERSE_STOP_ALL: any;
    isNode: boolean;
    className: string;
    /**
     * Node 的名字，可以通过 getChildByName 查找
     */
    name: string;
    /**
     * 动画
     */
    anim: Animation;
    /**
     * animation 查找 id
     */
    animationId: string;
    /**
     * 骨骼名称
     */
    jointName: string;
    /**
     * 是否自动更新世界矩阵
     */
    autoUpdateWorldMatrix: boolean;
    /**
     * 是否自动更新子元素世界矩阵
     */
    autoUpdateChildWorldMatrix: boolean;
    /**
     * 父节点
     */
    parent: Node;
    /**
     * 每次更新的时候是否调用子节点的 onUpdate 方法
     */
    needCallChildUpdate: boolean;
    /**
     * 节点是否显示
     */
    visible: boolean;
    /**
     * 可视对象是否接受交互事件。默认为接受交互事件，即true。
     */
    pointerEnabled: boolean;
    /**
     * 子元素是否接受交互事件。
     */
    pointerChildren: boolean;
    /**
     * 是否用鼠标指针
     */
    useHandCursor: boolean;
    /**
     * 用户数据
     */
    userData: any;
    id: string;
    /**
     * 元素的up向量
     */
    up: Vector3;
    /**
     * 元素直接点数组
     */
    children: Node[];
    /**
     * 元素的世界矩阵
     */
    worldMatrix: Matrix4;
    /**
     * @param [isChild = false] - 是否子节点，子节点不会处理动画及骨骼Mesh，即如果有动画将共享
     * @returns 返回clone的Node
     */
    clone(isChild?: boolean): Node;
    /**
     * 设置节点的动画，这个需要是模型的根节点
     * @param anim - 动画实例
     * @returns this
     */
    setAnim(anim: Animation): Node;
    /**
     * 重置子孙元素中 SkinedMesh 的根节点为当前元素
     */
    resetSkinedMeshRootNode(): void;
    /**
     * 将所以子孙元素放到一个对象中，对象key为元素的name，value为该元素
     * @returns 返回获取的对象
     */
    getChildrenNameMap(): any;
    /**
     * 添加一个子元素
     * @param child - 需要添加的子元素
     * @returns this
     */
    addChild(child: Node): Node;
    /**
     * 移除指定的子元素
     * @param child - 需要移除的元素
     * @returns this
     */
    removeChild(child: Node): Node;
    /**
     * 将当前元素添加到某个父元素的子元素中
     * @param parent - 需要添加到的父元素
     * @returns this
     */
    addTo(parent: Node): Node;
    /**
     * 将当前元素从其父元素中移除
     * @returns this
     */
    removeFromParent(): Node;
    /**
     * 更新本地矩阵
     * @returns this
     */
    updateMatrix(): Node;
    /**
     * 更新四元数
     * @returns this
     */
    updateQuaternion(): Node;
    /**
     * 更新transform属性
     * @returns this
     */
    updateTransform(): Node;
    /**
     * 更新世界矩阵
     * @param [force = true] - 是否强制更新
     * @returns this
     */
    updateMatrixWorld(force?: boolean): Node;
    /**
     * 获取当前元素相对于指定元素的矩阵
     * @param [ancestor] - 相对于的元素，需要是当前元素的祖先元素，不传表示获取世界矩阵
     * @returns 返回获取的矩阵
     */
    getConcatenatedMatrix(ancestor?: Node): Matrix4;
    /**
     * 遍历当前元素的子孙元素
     * @param callback - 每个元素都会调用这个函数处理
     * @param [onlyChild = false] - 是否只遍历子元素
     * @returns this
     */
    traverse(callback: NodeTraverseCallback, onlyChild?: boolean): Node;
    /**
     * 遍历当前元素的子孙元素(广度优先)
     * @param callback - 每个元素都会调用这个函数处理
     * @param [onlyChild = false] - 是否只遍历子元素
     * @returns this
     */
    traverseBFS(callback: NodeTraverseCallback, onlyChild?: boolean): Node;
    /**
     * 根据函数来获取一个子孙元素(广度优先)
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildByFnBFS(fn: NodeGetChildByCallback): Node | null;
    /**
     * 根据 name path 来获取子孙元素
     * @param path - 名字数组, e.g., getChildByNamePath(['a', 'b', 'c'])
     * @returns 返回获取到的子孙元素
     */
    getChildByNamePath(path: String[]): Node | null;
    /**
     * 遍历调用子孙元素onUpdate方法
     * @param dt
     * @returns this
     */
    traverseUpdate(dt: number): Node;
    /**
     * 根据函数来获取一个子孙元素
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildByFn(fn: NodeGetChildByCallback): Node | null;
    /**
     * 根据函数来获取匹配的所有子孙元素
     * @param fn - 判读函数
     * @returns 返回获取到的子孙元素
     */
    getChildrenByFn(fn: NodeGetChildByCallback): Node[];
    /**
     * 获取指定name的首个子孙元素
     * @param name - 元素name
     * @returns 获取的元素
     */
    getChildByName(name: string): Node | null;
    /**
     * 获取指定name的所有子孙元素
     * @param name - 元素name
     * @returns 获取的元素数组
     */
    getChildrenByName(name: string): Node[];
    /**
     * 获取指定id的子孙元素
     * @param id - 元素id
     * @returns 获取的元素
     */
    getChildById(id: string): Node | null;
    /**
     * 获取指定类名的所有子孙元素
     * @param className - 类名
     * @returns 获取的元素数组
     */
    getChildrenByClassName(className: string): Node[];
    /**
     * 获取指定基类名的所有子孙元素
     * @param className - 类名
     * @returns 获取的元素数组
     */
    getChildrenByBaseClassName(className: string): Node[];
    /**
     * 设置元素的缩放比例
     * @param x - X缩放比例
     * @param y - Y缩放比例
     * @param z - Z缩放比例
     * @returns this
     */
    setScale(x: number, y: number, z: number): Node;
    /**
     * 设置元素的位置
     * @param x - X方向位置
     * @param y - Y方向位置
     * @param z - Z方向位置
     * @returns this
     */
    setPosition(x: number, y: number, z: number): Node;
    /**
     * 设置元素的旋转
     * @param x - X轴旋转角度, 角度制
     * @param y - Y轴旋转角度, 角度制
     * @param z - Z轴旋转角度, 角度制
     * @returns this
     */
    setRotation(x: number, y: number, z: number): Node;
    /**
     * 设置中心点
     * @param x - 中心点x
     * @param y - 中心点y
     * @param z - 中心点z
     * @returns this
     */
    setPivot(x: number, y: number, z: number): Node;
    /**
     * 改变元素的朝向
     * @param node - 需要朝向的元素，或者坐标
     * @returns this
     */
    lookAt(node: Node | any | Vector3): Node;
    /**
     * raycast
     * @param ray
     * @param [sort = false] - 是否按距离排序
     * @param [eventMode = false] - 是否事件模式
     */
    raycast(ray: Ray, sort?: boolean, eventMode?: boolean): raycastInfo[] | null;
    /**
     * 元素的矩阵
     */
    readonly matrix: Matrix4Notifier;
    /**
     * 位置
     */
    readonly position: Vector3Notifier;
    /**
     * x轴坐标
     */
    x: number;
    /**
     * y轴坐标
     */
    y: number;
    /**
     * z轴坐标
     */
    z: number;
    /**
     * 缩放
     */
    readonly scale: Vector3Notifier;
    /**
     * 缩放比例x
     */
    scaleX: number;
    /**
     * 缩放比例y
     */
    scaleY: number;
    /**
     * 缩放比例z
     */
    scaleZ: number;
    /**
     * 中心点
     */
    readonly pivot: Vector3Notifier;
    /**
     * 中心点x
     */
    pivotX: number;
    /**
     * 中心点y
     */
    pivotY: number;
    /**
     * 中心点z
     */
    pivotZ: number;
    /**
     * 欧拉角
     */
    readonly rotation: EulerNotifier;
    /**
     * 旋转角度 x, 角度制
     */
    rotationX: number;
    /**
     * 旋转角度 y, 角度制
     */
    rotationY: number;
    /**
     * 旋转角度 z, 角度制
     */
    rotationZ: number;
    /**
     * 四元数角度
     */
    quaternion: Quaternion;
    /**
     * 获取元素的包围盒信息
     * @param [parent] - 元素相对于哪个祖先元素的包围盒，不传表示世界
     * @param [currentMatrix] - 当前计算的矩阵
     * @param [bounds] - 当前计算的包围盒信息
     * @returns 返回计算的包围盒信息
     */
    getBounds(parent?: Node, currentMatrix?: Matrix4, bounds?: Bounds): Bounds;
    /**
     * 销毁 Node 资源
     * @param [renderer] - stage时可以不传
     * @param [destroyTextures = false] - 是否销毁材质的贴图，默认不销毁
     * @returns this
     */
    destroy(renderer?: WebGLRenderer, destroyTextures?: boolean): Node;
}

/**
 * Mesh
 * @example
 * const mesh = new Hilo3d.Mesh({
 *     geometry: new Hilo3d.BoxGeometry(),
 *     material: new Hilo3d.BasicMaterial({
 *         diffuse: new Hilo3d.Color(0.8, 0, 0)
 *     }),
 *     x:100,
 *     rotationX:30
 * });
 * stage.addChild(mesh);
 * @param [params] - 初始化参数，所有params都会复制到实例上
 * @param [params.geometry] - 几何体
 * @param [params.material] - 材质
 * @param params.[value:string] - 其它属性
 */
class Mesh extends Node {
    constructor(params?: {
        geometry?: Geometry;
        material?: Material;
        [value:string]: any;
    });
    isMesh: boolean;
    className: string;
    geometry: Geometry;
    material: Material;
    /**
     * 是否使用 Instanced
     */
    useInstanced: boolean;
    /**
     * 是否开启视锥体裁剪
     */
    frustumTest: boolean;
    /**
     * 获取渲染选项值
     * @param [option = {}] - 渲染选项值
     * @returns 渲染选项值
     */
    getRenderOption(option?: any): any;
    /**
     * 是否被销毁
     */
    readonly isDestroyed: boolean;
}

/**
 * 雾
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class Fog {
    constructor(params?: any);
    isFog: boolean;
    className: string;
    /**
     * 雾模式, 可选 LINEAR, EXP, EXP2
     */
    mode: string;
    /**
     * 雾影响起始值, 只在 mode 为 LINEAR 时生效
     */
    start: number;
    /**
     * 雾影响终点值, 只在 mode 为 LINEAR 时生效
     */
    end: number;
    /**
     * 雾密度, 只在 mode 为 EXP, EXP2 时生效
     */
    density: number;
    /**
     * id
     */
    id: string;
    /**
     * 雾颜色
     */
    color: Color;
    /**
     * 获取雾信息
     * @returns res
     */
    getInfo(): any[];
}

/**
 * EventMixin是一个包含事件相关功能的mixin。可以通过 Object.assign(target, EventMixin) 来为target增加事件功能。
 */
class EventMixin {
    /**
     * 增加一个事件监听。
     * @param type - 要监听的事件类型。
     * @param listener - 事件监听回调函数。
     * @param [once] - 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @returns 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): any;
    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param [type] - 要删除监听的事件类型。
     * @param [listener] - 要删除监听的回调函数。
     * @returns 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): any;
    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @param [type] - 要发送的事件类型或者一个事件对象。
     * @param [detail] - 要发送的事件的具体信息，即事件随带参数。
     * @returns 是否成功调度事件。
     */
    fire(type?: string | EventObject, detail?: any): boolean;
}

/**
 * 透视投影摄像机
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.fov = 50] - 相机视野大小，角度制
 * @param [params.near = 0.1] - 相机视锥体近平面z
 * @param [params.far = null] - 相机视锥体远平面z，null 时为无限远
 * @param [params.aspect = 1] - 宽高比
 * @param params.[value:string] - 其它属性
 */
class PerspectiveCamera extends Camera {
    constructor(params?: {
        fov?: number;
        near?: number;
        far?: number;
        aspect?: number;
        [value:string]: any;
    });
    isPerspectiveCamera: boolean;
    className: string;
    /**
     * 相机视锥体近平面z
     */
    near: number;
    /**
     * 相机视锥体远平面z，null 时为无限远
     */
    far: number;
    /**
     * 相机视野大小，角度制
     */
    fov: number;
    /**
     * 宽高比
     */
    aspect: number;
}

/**
 * 正交投影摄像机
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 * @param [params.left = 1]
 * @param [params.right = 1]
 * @param [params.top = 1]
 * @param [params.bottom = 1]
 * @param [params.near = 0.1]
 * @param [params.far = 1]
 * @param params.[value:string] - 其它属性
 */
class OrthographicCamera extends Camera {
    constructor(params?: {
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
        near?: number;
        far?: number;
        [value:string]: any;
    });
    isOrthographicCamera: boolean;
    className: string;
    left: number;
    right: number;
    bottom: number;
    top: number;
    near: number;
    far: number;
}

/**
 * 摄像机
 * @param [params] - 创建对象的属性参数。可包含此类的所有属性。
 */
class Camera extends Node {
    constructor(params?: any);
    isCamera: boolean;
    className: string;
    /**
     * 相对于摄像头的矩阵
     */
    viewMatrix: Matrix4;
    /**
     * 投影矩阵
     */
    projectionMatrix: Matrix4;
    /**
     * View 联结投影矩阵
     */
    viewProjectionMatrix: Matrix4;
    /**
     * 更新viewMatrix
     * @returns this
     */
    updateViewMatrix(): Camera;
    /**
     * 更新投影矩阵，子类必须重载这个方法
     */
    updateProjectionMatrix(): void;
    /**
     * 获取几何体，子类必须重写
     * @param forceUpdate - 是否强制更新
     */
    getGeometry(forceUpdate: boolean): Geometry;
    /**
     * 更新viewProjectionMatrix
     * @returns this
     */
    updateViewProjectionMatrix(): Camera;
    /**
     * 获取元素相对于当前Camera的矩阵
     * @param node - 目标元素
     * @param [out] - 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     * @returns 返回获取的矩阵
     */
    getModelViewMatrix(node: Node, out?: Matrix4): Matrix4;
    /**
     * 获取元素的投影矩阵
     * @param node - 目标元素
     * @param [out] - 传递将在这个矩阵上做计算，不传将创建一个新的 Matrix4
     * @returns 返回获取的矩阵
     */
    getModelProjectionMatrix(node: Node, out?: Matrix4): Matrix4;
    /**
     * 获取世界坐标系(三维)中一个点在画布(二维)上的位置
     * @param vector - 点坐标
     * @param [width] - 画布宽，不传的话返回-1~1
     * @param [height] - 画布高，不传的话返回-1~1
     * @returns 返回获取的坐标位置，如 { x: 0, y: 0 }
     */
    projectVector(vector: Vector3, width?: number, height?: number): Vector3;
    /**
     * 屏幕坐标转换世界坐标系
     * @param vector - 点坐标
     * @param [width] - 画布宽，传的话vector会认为是屏幕坐标
     * @param [height] - 画布高，传的话vector会认为是屏幕坐标
     * @returns 返回世界坐标系(三维)中一个点
     */
    unprojectVector(vector: Vector3, width?: number, height?: number): Vector3;
    /**
     * point是否摄像机可见
     * @param point
     */
    isPointVisible(point: Vector3): boolean;
    /**
     * mesh 是否摄像机可见
     * @param mesh
     */
    isMeshVisible(mesh: Mesh): boolean;
    /**
     * 更新 frustum
     * @param matrix
     * @returns this
     */
    updateFrustum(matrix: Matrix4): Camera;
}

/**
 * 元素动画状态序列处理
 * @param [parmas] - 创建对象的属性参数。可包含此类的所有属性。
 */
class AnimationStates {
    constructor(parmas?: any);
    /**
     * 根据名字获取状态类型
     * @param name - 名字，忽略大小写，如 translate => StateType.TRANSLATE
     * @returns 返回获取的状态名
     */
    static getType(name: string): AnimationStates.StateType;
    /**
     * 注册属性处理器
     * @param name - 属性名
     * @param handler - 属性处理方法
     */
    static registerStateHandler(name: string, handler: (...params: any[]) => any): void;
    isAnimationStates: boolean;
    className: string;
    /**
     * 对应的node名字(动画是根据名字关联的)
     */
    nodeName: string;
    /**
     * 状态类型
     */
    type: AnimationStates.StateType;
    /**
     * 插值算法
     */
    interpolationType: string;
    id: string;
    /**
     * 时间序列
     */
    keyTime: number[];
    /**
     * 对应时间上的状态，数组长度应该跟keyTime一致，即每一帧上的状态信息
     */
    states: any[][];
    /**
     * 查找指定时间在 keyTime 数组中的位置
     * @param time - 指定的时间
     * @returns 返回找到的位置，如: [low, high]
     */
    findIndexByTime(time: number): number[];
    /**
     * 获取指定时间上对应的状态，这里会进行插值计算
     * @param time - 指定的时间
     * @returns 返回插值后的状态数据
     */
    getState(time: number): number[];
    /**
     * 更新指定元素的位置
     * @param node - 需要更新的元素
     * @param value - 位置信息，[x, y, z]
     */
    updateNodeTranslation(node: Node, value: number[]): void;
    /**
     * 更新指定元素的缩放
     * @param node - 需要更新的元素
     * @param value - 缩放信息，[scaleX, scaleY, scaleZ]
     */
    updateNodeScale(node: Node, value: number[]): void;
    /**
     * 更新指定元素的旋转(四元数)
     * @param node - 需要更新的元素
     * @param value - 四元数的旋转信息，[x, y, z, w]
     */
    updateNodeQuaternion(node: Node, value: number[]): void;
    /**
     * 更新指定元素的状态
     * @param time - 时间，从keyTime中查找到状态然后更新
     * @param node - 需要更新的元素
     */
    updateNodeState(time: number, node: Node): void;
    /**
     * clone
     * @returns 返回clone的实例
     */
    clone(): AnimationStates;
}

interface Animation extends EventMixin {
}

/**
 * 动画类
 * @param [parmas] - 创建对象的属性参数。可包含此类的所有属性。
 */
class Animation implements EventMixin {
    constructor(parmas?: any);
    /**
     * tick
     * @param dt - 一帧时间
     */
    static tick(dt: number): void;
    isAnimation: boolean;
    className: string;
    /**
     * 动画是否暂停
     */
    paused: boolean;
    /**
     * 动画当前播放次数
     */
    currentLoopCount: number;
    /**
     * 动画需要播放的次数，默认值为 Infinity 表示永远循环
     */
    loop: number;
    /**
     * 动画当前时间
     */
    currentTime: number;
    /**
     * 动画播放速度
     */
    timeScale: number;
    /**
     * 动画开始时间
     */
    startTime: number;
    /**
     * 动画结束时间，初始化后会根据 AnimationStates 来自动获取，也可以通过 play 来改变
     */
    endTime: number;
    /**
     * 动画整体的最小时间，初始化后会根据 AnimationStates 来自动获取
     */
    clipStartTime: number;
    /**
     * 动画整体的最大时间，初始化后会根据 AnimationStates 来自动获取
     */
    clipEndTime: number;
    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     */
    rootNode: Node;
    /**
     * 动画状态列表
     */
    animStatesList: AnimationStates[];
    /**
     * AnimationId集合
     */
    validAnimationIds: any;
    id: string;
    /**
     * 动画剪辑列表，{ name: { start: 0, end: 1} }，play的时候可以通过name来播放某段剪辑
     */
    clips: any;
    /**
     * 添加动画剪辑
     * @param name - 剪辑名字
     * @param start - 动画开始时间
     * @param end - 动画结束时间
     * @param animStatesList - 动画帧列表
     */
    addClip(name: string, start: number, end: number, animStatesList: AnimationStates[]): void;
    /**
     * 移除动画剪辑
     * @param name - 需要移除的剪辑名字
     */
    removeClip(name: string): void;
    /**
     * 获取动画列表的时间信息
     * @param animStatesList - 动画列表
     * @returns result {startTime, endTime} 时间信息
     */
    getAnimStatesListTimeInfo(animStatesList: AnimationStates[]): any;
    /**
     * 初始化 node name map
     */
    _initNodeNameMap(): void;
    /**
     * tick
     * @param dt
     */
    tick(dt: number): void;
    /**
     * 更新动画状态
     * @returns this
     */
    updateAnimStates(): Animation;
    /**
     * 播放动画(剪辑)
     * @param [startOrClipName = 0] - 动画开始时间，或者动画剪辑名字
     * @param [end = this.clipEndTime] - 动画结束时间，如果是剪辑的话不需要传
     */
    play(startOrClipName?: number | string, end?: number): void;
    /**
     * 停止动画，这个会将动画从Ticker中移除，需要重新调用play才能再次播放
     */
    stop(): void;
    /**
     * 暂停动画，这个不会将动画从Ticker中移除
     */
    pause(): void;
    /**
     * 恢复动画播放，只能针对 pause 暂停后恢复
     */
    resume(): void;
    /**
     * clone动画
     * @param rootNode - 目标动画根节点
     * @returns clone的动画对象
     */
    clone(rootNode: Node): Animation;
}



}
