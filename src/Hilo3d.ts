/**
 * TypeScript-first public API for the Hilo3d WebGL 2 and WebGPU engine.
 *
 * @packageDocumentation
 */
import * as GLTFExtensions from './loader/GLTFExtensions';
import * as util from './utils/util';

export { GLTFExtensions, util };

export {
    type DispatchEvent,
    EventDispatcher,
    type EventListener,
    HiloEvent,
    type ListenerEntry,
    type ListenerMap
} from './core/EventDispatcher';
export { default as Fog, type FogMode, type FogParameters } from './core/Fog';
export { default as Mesh, type MeshParameters } from './core/Mesh';
export {
    default as Node,
    type NodeGetChildByCallback,
    type NodeParameters,
    type NodePointerEvent,
    type NodeRaycastInfo,
    type NodeTraverseCallback,
    type NodeTraverseResult
} from './core/Node';
export { default as Skeleton, type SkeletonParameters } from './core/Skeleton';
export { default as SkinnedMesh, type SkinnedMeshParameters } from './core/SkinnedMesh';
export {
    default as Stage,
    type StageBackendParameters,
    type StageCommonParameters,
    type StageParameters,
    type StagePointerEvent,
    type StageRenderer
} from './core/Stage';
export {
    type BackEaseObject,
    type ElasticEaseObject,
    default as Tween,
    type TweenCompleteCallback,
    type TweenEaseCollection,
    type TweenEaseFunction,
    type TweenEaseNoneObject,
    type TweenEaseObject,
    type TweenParameters,
    type TweenProperties,
    type TweenStartCallback,
    type TweenUpdateCallback
} from './core/Tween';
export { default as version } from './core/version';

export { default as Camera, type CameraParameters } from './camera/Camera';
export {
    default as OrthographicCamera,
    type OrthographicCameraParameters
} from './camera/OrthographicCamera';
export {
    default as PerspectiveCamera,
    type PerspectiveCameraParameters
} from './camera/PerspectiveCamera';

export {
    default as BoxGeometry,
    type BoxGeometryParameters,
    type UV
} from './geometry/BoxGeometry';
export {
    type Bounds,
    default as Geometry,
    type GeometryParameters,
    type Point2,
    type Point3
} from './geometry/Geometry';
export {
    default as GeometryData,
    type GeometryAttributeValue,
    type GeometryComponentSize,
    type GeometryDataComponentCallback,
    type GeometryDataParameters,
    type GeometryDataTraverseCallback,
    type SubDataUpdate
} from './geometry/GeometryData';
export {
    default as MorphGeometry,
    type MorphGeometryParameters,
    type MorphTargets
} from './geometry/MorphGeometry';
export { default as PlaneGeometry, type PlaneGeometryParameters } from './geometry/PlaneGeometry';
export {
    default as SphereGeometry,
    type SphereGeometryParameters
} from './geometry/SphereGeometry';

export { default as Buffer, type BufferData, type BufferRenderer } from './renderer/Buffer';
export { WebGLCapabilities, type NumericCapabilityName } from './renderer/capabilities';
export { WebGLExtensions } from './renderer/extensions';
export { default as glType } from './renderer/glType';
export {
    type AttributePointerParameters,
    default as Program,
    type ProgramAttribute,
    ProgramLinkError,
    type ProgramParameters,
    type ProgramRenderer,
    type ProgramUniform,
    type ProgramUniformBlock,
    ShaderCompilationError
} from './renderer/Program';
export { default as RenderInfo } from './renderer/RenderInfo';
export { default as RenderList } from './renderer/RenderList';
export type {
    RenderTarget,
    RenderTargetColor,
    RenderTargetColorAttachmentOptions,
    RenderTargetColorAttachmentReadback,
    RenderTargetColorFormat,
    RenderTargetCompareFunction,
    RenderTargetDepthStencilAttachmentOptions,
    RenderTargetDepthStencilFormat,
    RenderTargetLoadOp,
    RenderTargetParameters,
    RenderTargetReadColorAttachmentOptions,
    RenderTargetSampleCount,
    RenderTargetSelectionOptions,
    RenderTargetStoreOp
} from './renderer/RenderTarget';
export {
    default as UniformBuffer,
    type UniformBufferDirtyRange,
    type UniformBufferRange
} from './renderer/UniformBuffer';
export {
    createStd140Layout,
    Std140Layout,
    type Std140ArrayValue,
    type Std140FieldDefinition,
    type Std140FieldLayout,
    type Std140FieldValue,
    type Std140MatrixType,
    type Std140ScalarType,
    type Std140Schema,
    type Std140Type,
    type Std140Value,
    type Std140Values,
    type Std140VectorType
} from './renderer/ubo/Std140Layout';
export {
    BUILTIN_UNIFORM_BLOCK_BINDING_COUNT,
    getUniformBlockBinding,
    registerUniformBlockBinding,
    UNIFORM_BLOCK_BINDINGS
} from './renderer/ubo/UniformBlockBindings';
export {
    type AttributeObject,
    default as VertexArrayObject,
    type VertexArrayObjectParameters,
    type VaoRenderer
} from './renderer/VertexArrayObject';
export {
    type MeshSetup,
    default as WebGLRenderer,
    type WebGLRendererParameters,
    type WebGLRendererScene
} from './renderer/WebGLRenderer';
export { default as WebGLRenderTarget } from './renderer/WebGLRenderTarget';
export {
    default as WebGPURenderer,
    type WebGPUDeviceRecoveryState,
    type WebGPURendererParameters
} from './renderer/WebGPURenderer';
export {
    WEBGPU_BYTES_PER_ROW_ALIGNMENT,
    type WebGPUColorAttachmentOperations,
    type WebGPUColorAttachmentOptions,
    type WebGPUColorAttachmentReadback,
    type WebGPUColorRenderTargetFormat,
    type WebGPUDepthStencilAttachmentOperations,
    type WebGPUDepthStencilAttachmentOptions,
    type WebGPUDepthStencilRenderTargetFormat,
    type WebGPUReadColorAttachmentOptions,
    default as WebGPURenderTarget,
    type WebGPURenderPassOptions,
    type WebGPURenderTargetParameters
} from './renderer/webgpu/WebGPURenderTarget';
export {
    createWebGPUSamplerDescriptor,
    default as WebGPUTextureManager,
    resolveWebGPUCompareFunction,
    resolveWebGPUTextureFormat,
    type TextureComponentStorage,
    type WebGPUExternalTextureOptions,
    type WebGPUTextureFormatInfo,
    type WebGPUTextureDimension,
    type WebGPUTextureRequestOptions,
    type WebGPUTextureResource
} from './renderer/webgpu/WebGPUTextureManager';
export type {
    Renderer,
    RendererBackend,
    RendererResourceDiagnostics,
    RendererResourceManager,
    RendererScene,
    RendererViewport,
    TextureCompressionFormat
} from './renderer/Renderer';
export {
    getWebGPUUniformBlockBinding,
    registerWebGPUCustomUniformBlockBinding,
    WEBGPU_BIND_GROUP_COUNT,
    WEBGPU_BIND_GROUPS,
    type WebGPUResourceBinding,
    WEBGPU_UNIFORM_BLOCK_BINDINGS
} from './renderer/webgpu/WebGPUBindingLayout';
export {
    default as GraphicsResourceManager,
    type GraphicsResourceManagerParameters,
    type ManagedResource,
    type MeshResourceVariant
} from './renderer/GraphicsResourceManager';
export {
    type FourParameterMethod,
    type OneParameterMethod,
    type StateValue,
    type ThreeParameterMethod,
    type TwoParameterMethod,
    default as WebGLState
} from './renderer/WebGLState';
export type {
    GLContext,
    GLTypeInfo,
    Resource,
    ShaderDefineValue,
    ShaderOptions,
    ShaderPrecision,
    Size,
    TextureCubeFace,
    TexturePixelData,
    TextureSource,
    TextureSubImage,
    TypedArray,
    TypedArrayConstructor,
    VertexAttributeInfo
} from './renderer/types';

export {
    default as BasicLoader,
    type BasicLoadRequest,
    type BasicResource,
    type BasicResourceType,
    type ImageCrossOrigin,
    type JsonPrimitive,
    type JsonValue,
    type LoaderRequest,
    type NetworkResourceType,
    type ResourceRequestOptions
} from './loader/BasicLoader';
export {
    default as CubeTextureLoader,
    type CubeTextureLoadRequest
} from './loader/CubeTextureLoader';
export {
    default as GLTFLoader,
    type BasicLoaderResource,
    type GLTFLoadRequest,
    type GLTFResourceLoader
} from './loader/GLTFLoader';
export {
    default as GLTFParser,
    type GLTFExtensionHandler,
    type GLTFExtensionHandlerRegistry,
    type GLTFExtensionMethodName,
    type GLTFExtensionOptions,
    type GLTFParserParameters,
    type AccessorArray
} from './loader/GLTFParser';
export type * from './loader/GLTFTypes';
export { default as HDRLoader, type HDRLoadRequest } from './loader/HDRLoader';
export type { LoaderTextureOptions } from './loader/textureOptions';
export { default as parseRadianceHDR, type RadianceHDRImage } from './loader/RadianceHDRParser';
export {
    default as KTXLoader,
    type KTXLoadRequest,
    type KTXTextureOptions
} from './loader/KTXLoader';
export {
    default as LoadCache,
    type LoadCacheFile,
    LoadState,
    type LoadStateValue
} from './loader/LoadCache';
export { default as LoadQueue, type LoadQueueItem, type LoadQueueSource } from './loader/LoadQueue';
export {
    default as Loader,
    type ResourceLoader,
    type ResourceLoaderConstructor
} from './loader/Loader';
export {
    default as ShaderMaterialLoader,
    type ShaderMaterialLoadRequest
} from './loader/ShaderMaterialLoader';
export { default as TextureLoader, type TextureLoadRequest } from './loader/TextureLoader';

export {
    default as CubeTexture,
    type CubeTextureImage,
    type CubeTextureParameters
} from './texture/CubeTexture';
export { default as DataTexture, type DataTextureParameters } from './texture/DataTexture';
export { default as LazyTexture, type LazyTextureParameters } from './texture/LazyTexture';
export {
    default as Texture,
    type TextureBinding,
    type TextureImageSource,
    type TextureMipmap,
    type TextureParameters,
    type TextureUpdateSnapshot,
    type ResizableTextureImage,
    type TextureUVChannel,
    type TextureWebGLState
} from './texture/Texture';

export {
    default as Shader,
    type ShaderParameters,
    type ShaderPrecisionProvider,
    type ShaderRenderer
} from './shader/Shader';
export {
    NagaShaderTranslationError,
    NagaShaderTranslator,
    prepareGLSLForNaga,
    type GlslSamplerType,
    type GraphicsShaderStage,
    type PrepareGLSLForNagaOptions,
    type PreparedShaderPair,
    type PreparedShaderStage,
    type TranslatedShaderPair,
    type TranslatedShaderStage,
    type WebGPUFragmentOutput,
    type WebGPUSamplerBinding,
    type WebGPUUniformBlock,
    type WebGPUVertexInput
} from './shader/GlslToWgsl';

export {
    type BasicLightType,
    default as BasicMaterial,
    type BasicMaterialParameters
} from './material/BasicMaterial';
export {
    default as GeometryMaterial,
    type GeometryMaterialParameters,
    type GeometryVertexType
} from './material/GeometryMaterial';
export {
    type MaterialBinding,
    type MaterialBindingInfo,
    type MaterialBindingMap,
    type MaterialBeforeCompile,
    default as Material,
    type InstancedUniform,
    type MaterialParameters,
    type MaterialShaderSource,
    type MaterialTexture,
    type MaterialTextureValue,
    type ProgramBindingInfo
} from './material/Material';
export { default as PBRMaterial, type PBRMaterialParameters } from './material/PBRMaterial';
export {
    type SemanticMaterial,
    type SemanticMesh,
    type SemanticRenderer,
    default as semantic
} from './material/semantic';
export {
    type CustomRenderOptionProvider,
    default as ShaderMaterial,
    type ShaderMaterialParameters
} from './material/ShaderMaterial';

export { default as AmbientLight, type AmbientLightParameters } from './light/AmbientLight';
export { default as AreaLight, type AreaLightParameters } from './light/AreaLight';
export {
    default as DirectionalLight,
    type DirectionalLightParameters
} from './light/DirectionalLight';
export {
    default as Light,
    type LightParameters,
    type LightShadowOptions,
    type PointLightShadowOptions,
    type PointShadowCameraParameters,
    type ShadowCameraParameters,
    type ShadowCastingLightParameters
} from './light/Light';
export {
    type AreaLightInfo,
    type DirectionalLightInfo,
    type LightGroupName,
    type LightInfo,
    default as LightManager,
    type LightManagerParameters,
    type PointLightInfo,
    type SpotLightInfo
} from './light/LightManager';
export { default as PointLight, type PointLightParameters } from './light/PointLight';
export { default as SpotLight, type SpotLightParameters } from './light/SpotLight';

export { default as AxisHelper, type AxisHelperParameters } from './helper/AxisHelper';
export { default as AxisNetHelper, type AxisNetHelperParameters } from './helper/AxisNetHelper';
export { default as CameraHelper, type CameraHelperParameters } from './helper/CameraHelper';

export {
    default as Animation,
    type AnimationClip,
    type AnimationParameters,
    type AnimationTimeRange
} from './animation/Animation';
export {
    type AnimationInterpolationType,
    type InterpolatedValue,
    type InterpolationFunction,
    type AnimationStateHandler,
    type AnimationStateType,
    default as AnimationStates,
    type AnimationStatesParameters,
    type BuiltInAnimationStateType,
    STATE_TYPES
} from './animation/AnimationStates';

export { default as Cache } from './utils/Cache';
export { type BrowserFeatures, default as browser, detectBrowserFeatures } from './utils/browser';
export { LogLevel, type LogLevelValue, Logger, default as log } from './utils/log';
export { default as MeshPicker, type MeshPickerParameters } from './utils/MeshPicker';
export { type Tickable, default as Ticker } from './utils/Ticker';
export { default as WebGLSupport, detectWebGLSupport } from './utils/WebGLSupport';

export type { GeometryDataLike, MutableArrayLike } from './utils/util';
export type { MutableNumberArray } from './math/numberArray';

export {
    default as constants,
    engineConstants,
    webgl2Constants,
    webglConstants,
    webglExtensionConstants
} from './constants';
export * from './math/';
