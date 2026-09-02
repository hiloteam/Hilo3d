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
export {
    default as Engine,
    type EngineAutoParameters,
    type EngineFrameResult,
    type EngineOwnedRendererFields,
    type EngineOwnershipOptions,
    type EngineParameters,
    type EngineWebGL2Parameters,
    type EngineWebGPUParameters
} from './core/Engine';
export { default as RenderMesh, type MeshParameters as RenderMeshParameters } from './core/Mesh';
export { default as RendererSkeleton, type SkeletonParameters } from './core/Skeleton';
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

export {
    ComponentType,
    SparseSetComponentStore,
    defineComponent,
    defineDerivedComponent,
    type ComponentStore,
    type ComponentStoreFactory
} from './ecs/Component';
export { WorldCommandBuffer, type CommandEntity, type PendingEntity } from './ecs/CommandBuffer';
export type { Entity } from './ecs/Entity';
export { CachedQuery, type QueryDescription } from './ecs/Query';
export { WorldResource, defineWorldResource } from './ecs/Resource';
export {
    WORLD_SYSTEM_API_VERSION,
    WORLD_SYSTEM_PHASES,
    WorldSystemRegistry,
    type WorldSystem,
    type WorldSystemAccess,
    type WorldSystemDescriptor,
    type WorldSystemExecutionContext,
    type WorldSystemPhase,
    type WorldSystemRuntime,
    type WorldSystemSetupContext
} from './ecs/System';
export {
    default as World,
    type WorldDiagnostics,
    type WorldParameters,
    type WorldStructureListener
} from './ecs/World';
export {
    ScenePrefab,
    ScenePrefabRecord,
    type SceneInstance,
    type ScenePrefabAnimation,
    type ScenePrefabAnimationChannel,
    type ScenePrefabAttachment,
    type ScenePrefabSkin
} from './scene/ScenePrefab';
export { Name, type NameValue } from './scene/components/Identity';

export {
    Hierarchy,
    HierarchyStore,
    InterpolatedTransform,
    InterpolatedTransformStore,
    LocalTransform,
    TransformStore,
    WorldTransform,
    getHierarchyStore,
    getInterpolatedTransformStore,
    getTransformStore,
    type HierarchyValue,
    type HierarchyDiagnostics,
    type InterpolatedTransformValue,
    type LocalTransformValue,
    type TransformDiagnostics,
    type TransformQuaternion,
    type TransformVector3,
    type WorldTransformValue
} from './scene/components/Transform';
export {
    CameraOutput,
    MeshRenderer,
    OrthographicCamera,
    PerspectiveCamera,
    RenderExtensionComponent,
    RenderOrder,
    RenderVisibility,
    ChangedComponentStore,
    type CameraComponentValue,
    type CameraOutputValue,
    type MeshRendererValue,
    type OrthographicCameraValue,
    type PerspectiveCameraValue,
    type RenderExtensionValue,
    type RenderOrderValue,
    type RenderVisibilityValue
} from './scene/components/Rendering';
export {
    AmbientLight,
    AreaLight,
    DirectionalLight,
    PointLight,
    SpotLight,
    type AmbientLightValue,
    type AreaLightValue,
    type DirectionalLightValue,
    type LightColor,
    type LightComponentValue,
    type PointLightValue,
    type SpotLightValue
} from './scene/components/Lighting';
export {
    AnimationClip,
    Animator,
    AnimatorStore,
    MorphPose,
    SkeletonPose,
    Skin,
    type AnimationChannel,
    type AnimationInterpolation,
    type AnimationTargetProperty,
    type AnimatorValue,
    type MorphPoseValue,
    type SkeletonPoseValue,
    type SkinValue
} from './scene/components/Animation';
export {
    PointerCapture,
    PointerTarget,
    type PointerCaptureValue,
    type PointerPropagation,
    type PointerTargetValue
} from './scene/components/Interaction';
export {
    CanvasText,
    SpriteAnimation,
    SpriteRenderer,
    createSpriteRenderer,
    type CanvasTextValue,
    type NormalizedSpriteRendererValue,
    type SpriteAnimationValue,
    type SpriteRendererValue
} from './scene/components/TwoD';
export { createTransformSystem, TRANSFORM_SYSTEM_ID } from './scene/systems/TransformSystem';
export {
    createRenderExtractionSystem,
    RENDER_EXTRACTION_SYSTEM_ID,
    RENDER_WORLD
} from './scene/systems/RenderExtractionSystem';
export { createAnimationSystem } from './scene/systems/AnimationSystem';
export {
    createInteractionSystem,
    INTERACTION_RUNTIME,
    InteractionRuntime,
    type PointerEventDelivery,
    type PointerEventType,
    type PointerInput
} from './scene/systems/InteractionSystem';
export { createCanvasTextSystem, createSpriteAnimationSystem } from './scene/systems/TwoDSystems';
export { RenderWorld, type RenderWorldDiagnostics } from './render/world/RenderWorld';
export { RenderCameraStore } from './render/world/RenderCameraStore';
export { RenderLightStore } from './render/world/RenderLightStore';

export type { CameraDepthMode, default as RenderCamera } from './camera/Camera';
export type { default as RenderAmbientLight } from './light/AmbientLight';
export type { default as RenderAreaLight } from './light/AreaLight';
export type {
    default as RenderLight,
    LightShadowOptions,
    PointLightShadowOptions,
    PointShadowCameraParameters,
    ShadowCameraParameters,
    ShadowCastingLightParameters
} from './light/Light';
export type {
    default as RenderDirectionalLight,
    DirectionalLightShadowOptions
} from './light/DirectionalLight';
export type { default as RenderPointLight } from './light/PointLight';
export type {
    default as RenderSpotLight,
    SpotLightCookie,
    SpotLightIESProfile
} from './light/SpotLight';
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

export { default as SpriteFrame, type SpriteFrameParameters } from './2d/SpriteFrame';
export { default as SpriteMaterial, type SpriteMaterialParameters } from './2d/SpriteMaterial';

export { default as RenderInfo } from './render/RenderInfo';
export type { RenderColorEncoding } from './render/RenderColorEncoding';
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
    RenderTargetPresentationOptions,
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
    createStorageGraphicsShaderFromPortable,
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
    type BasicMaterialParameters,
    type MaterialColorOrTextureInput
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
    default as MaterialInstance,
    type InstancedUniform,
    type MaterialInstanceParameters,
    type MaterialTexture,
    type MaterialTextureValue,
    type ProgramBindingInfo
} from './material/MaterialInstance';
export {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    DEFAULT_MATERIAL_TEXTURE_CHANNELS,
    MaterialDefinition,
    type MaterialBlendComponent,
    type MaterialBlendFactor,
    type MaterialBlendOperation,
    type MaterialBlendState,
    type MaterialCompositing,
    type MaterialCompareFunction,
    type MaterialCoverage,
    type MaterialCullMode,
    type MaterialDefinitionParameters,
    type MaterialFamily,
    type MaterialFragmentOutput,
    type MaterialFrontFace,
    type MaterialPassDefinition,
    type MaterialPassFallback,
    type MaterialPassRole,
    type MaterialPipelineState,
    type MaterialRenderingProfile,
    type MaterialShaderModule,
    type MaterialStencilFaceState,
    type MaterialStencilOperation,
    type MaterialStencilState,
    type MaterialSurfaceDomain,
    type MaterialTextureChannel,
    type MaterialTextureEncoding,
    type MaterialTextureSlotBinding,
    type MaterialTextureSlotDefinition,
    type MaterialTextureSlotInput
} from './material/MaterialDefinition';
export {
    MaterialAttributeSemantic,
    MaterialTextureSemantic,
    MaterialUniformSemantic,
    type MaterialAttributeSemanticName,
    type MaterialSemanticName,
    type MaterialTextureSemanticName,
    type MaterialUniformSemanticName
} from './material/MaterialSemantics';
export {
    MATERIAL_TEXTURE_SLOT_COUNT,
    MaterialTextureSlot,
    type BuiltInMaterialTextureSlotName
} from './material/MaterialTextureSlots';
export {
    MaterialBlendPreset,
    MaterialCompiler,
    resolveMaterialPassDefinition,
    resolveMaterialPassState,
    type MaterialCompileRequest,
    type MaterialTargetSignature,
    type PreparedMaterialVariant
} from './material/MaterialCompiler';
export {
    type MutablePBRMaterialParameters,
    default as PBRMaterial,
    PBRMaterialBuilder,
    type PBRMaterialParameters,
    type PBRMaterialTextureInput
} from './material/PBRMaterial';
export {
    type SemanticMaterial,
    type SemanticMesh,
    type SemanticRenderer,
    default as semantic
} from './material/semantic';
export {
    default as ShaderMaterial,
    type ShaderMaterialParameters,
    type ShaderMaterialRoleSource,
    type ShaderMaterialTextureSlot
} from './material/ShaderMaterial';

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
export { TRIANGLES } from './constants/webgl';
export * from './math/';
