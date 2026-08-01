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
    type StageBackend,
    type StageBackendParameters,
    type StageCommonParameters,
    type StageParameters,
    type StagePointerEvent
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

export { default as Camera, type CameraDepthMode, type CameraParameters } from './camera/Camera';
export { default as Camera2D, type Camera2DParameters, DEFAULT_2D_LAYER } from './camera/Camera2D';
export {
    default as OrthographicCamera,
    type OrthographicCameraParameters
} from './camera/OrthographicCamera';
export {
    default as PerspectiveCamera,
    type PerspectiveCameraParameters
} from './camera/PerspectiveCamera';
export { default as OrbitControls, type OrbitControlsOptions } from './controls/OrbitControls';

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

export {
    default as Sprite,
    type SpriteFrameUpdateOptions,
    type SpriteFramesUpdateOptions,
    type SpriteParameters
} from './2d/Sprite';
export { default as SpriteFrame, type SpriteFrameParameters } from './2d/SpriteFrame';
export { default as SpriteMaterial, type SpriteMaterialParameters } from './2d/SpriteMaterial';
export {
    default as SlicedSprite,
    type SlicedSpriteInsets,
    type SlicedSpriteParameters
} from './2d/SlicedSprite';
export { default as Text2D, type Text2DParameters, type Text2DStyle } from './2d/Text2D';
export {
    default as UiButton,
    type UiButtonFrames,
    type UiButtonParameters,
    type UiButtonState
} from './2d/UiButton';

export { default as RenderInfo } from './render/RenderInfo';
export type {
    StorageBuffer,
    StorageBufferDescriptor,
    StorageBufferRange,
    StorageBufferReadback,
    StorageBufferRecoveryPolicy,
    StorageBufferUsage
} from './render/StorageBuffer';
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
} from './render/RenderTarget';
export {
    default as ComputeKernel,
    type ComputeKernelDescriptor,
    type ComputePipelineConstant
} from './render/compute/ComputeKernel';
export {
    default as ComputeSampler,
    type ComputeSamplerAddressMode,
    type ComputeSamplerDescriptor,
    type ComputeSamplerFilterMode
} from './render/compute/ComputeSampler';
export {
    default as ComputeShader,
    type ComputeShaderBinding,
    type ComputeShaderDescriptor,
    type ComputeStorageBufferAccess,
    type ComputeStorageTextureFormat,
    type ComputeStorageTextureViewDimension,
    type ComputeTextureSampleType,
    type ComputeTextureViewDimension,
    type NormalizedComputeWorkgroupSize,
    type ShaderReadBinding,
    type ShaderTextureSampleType,
    type ShaderTextureViewDimension
} from './render/compute/ComputeShader';
export {
    default as StorageGraphicsShader,
    type StorageGraphicsShaderDescriptor
} from './render/compute/StorageGraphicsShader';
export {
    createStorageLayout,
    StorageLayout,
    type StorageArrayDefinition,
    type StorageFieldLayout,
    type StorageMatrixType,
    type StoragePrimitiveType,
    type StoragePrimitiveValue,
    type StorageScalarType,
    type StorageSchema,
    type StorageStructDefinition,
    type StorageType,
    type StorageValue,
    type StorageValues,
    type StorageVectorType,
    type StorageWriteResult
} from './render/storage/StorageLayout';
export {
    default as UniformBuffer,
    type UniformBufferDirtyRange,
    type UniformBufferRange
} from './render/UniformBuffer';
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
} from './render/ubo/Std140Layout';
export {
    BUILTIN_UNIFORM_BLOCK_BINDING_COUNT,
    getUniformBlockBinding,
    registerUniformBlockBinding,
    UNIFORM_BLOCK_BINDINGS
} from './render/ubo/UniformBlockBindings';
export {
    default as Renderer,
    type RendererAdapterPowerPreference,
    type RendererAutoOptions,
    type RendererBackend,
    type RendererCommonOptions,
    type RendererContract,
    type RendererContextPowerPreference,
    type RendererCreateOptions,
    type RendererExplicitOptions,
    type RendererFeatureName,
    type RendererFrame,
    type RendererFrameCallback,
    type RendererOptions,
    type RendererOptionsMap,
    type RendererRenderingProfile,
    type RendererResourceDiagnostics,
    type RendererResourceManager,
    type RendererScene,
    type RendererSupportOptions,
    type RendererViewport,
    type RendererWebGL2Options,
    type RendererWebGPUOptions,
    type TextureCompressionFormat
} from './render/Renderer';
export type { RenderGraphFramePlan } from './render/RenderGraphFramePlan';
export * from './render/pipeline';
export type {
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
    TypedArrayConstructor
} from './render/types';

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
    type TextureUVChannel
} from './texture/Texture';

export {
    default as Shader,
    type ShaderParameters,
    type ShaderPrecisionProvider,
    type ShaderRenderer
} from './shader/Shader';
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
    type DirectionalLightParameters,
    type DirectionalLightShadowOptions
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
