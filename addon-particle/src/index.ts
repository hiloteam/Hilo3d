/**
 * Optional production particle systems for Hilo3D.
 *
 * @packageDocumentation
 */
export {
    compileParticleSystemDefinition,
    type ParticleAdvancedQualityPlan,
    type ParticleCompilationEnvironment
} from './ParticleCompiler.js';
export {
    compileParticleAuthoringGraph,
    createParticleAuthoringGraph,
    PARTICLE_AUTHORING_JSON_SCHEMA,
    PARTICLE_AUTHORING_SCHEMA,
    PARTICLE_AUTHORING_VERSION,
    type ParticleAuthoringCompileFailure,
    type ParticleAuthoringCompileOptions,
    type ParticleAuthoringCompileResult,
    type ParticleAuthoringCompileSuccess,
    type ParticleAuthoringDiagnostic,
    type ParticleAuthoringEdge,
    type ParticleAuthoringEmitterIR,
    type ParticleAuthoringGraph,
    type ParticleAuthoringIR,
    type ParticleAuthoringNode,
    type ParticleAuthoringNodeKind,
    type ParticleAuthoringPort
} from './ParticleAuthoring.js';
export {
    PARTICLE_PREVIEW_PROTOCOL_VERSION,
    ParticleAuthoringPreviewController,
    type ParticleAuthoringPreviewCommand,
    type ParticleAuthoringPreviewCompileRequest,
    type ParticleAuthoringPreviewControllerOptions,
    type ParticleAuthoringPreviewControlRequest,
    type ParticleAuthoringPreviewRequest,
    type ParticleAuthoringPreviewResponse,
    type ParticleAuthoringPreviewSeekRequest,
    type ParticleAuthoringPreviewState,
    type ParticleAuthoringPreviewStepRequest,
    type ParticleAuthoringPreviewSystemFactory
} from './ParticleAuthoringPreview.js';
export {
    PARTICLE_BAKE_VERSION,
    type ParticleBakedMeshEmitter,
    type ParticleBakeTimelineOptions,
    type ParticleFlipbook,
    type ParticleFlipbookFrameContext,
    type ParticleFlipbookOptions,
    type ParticleMeshCache,
    type ParticleMeshCacheOptions
} from './ParticleBaking.js';
export {
    deserializeParticleSystemDefinition,
    parseParticleSystemDefinitionJSON,
    PARTICLE_DEFINITION_SCHEMA,
    serializeParticleSystemDefinition,
    type ParticleDefinitionDeserializationOptions,
    type ParticleDefinitionJSONParameter,
    type ParticleDefinitionJSONRecord,
    type ParticleDefinitionJSONValue,
    type ParticleDefinitionResource,
    type ParticleDefinitionResourceKind,
    type ParticleDefinitionSerializationOptions,
    type ParticleDefinitionUpgrade,
    type ParticleSystemDefinitionJSON
} from './ParticleDefinitionSerialization.js';
export type {
    ParticleAttributeLayout,
    ParticleAttributeName,
    ParticleCompiledEmitterPlan,
    ParticleCompiledPlan,
    ParticleCurveLUT,
    ParticleGradientLUT
} from './ParticleCompiledPlan.js';
export {
    default as ParticleCurve,
    type ParticleCurveInterpolation,
    type ParticleCurveKeyframe,
    type ParticleCurveOptions,
    type ParticleCurveWrapMode
} from './ParticleCurve.js';
export { default as ParticleEmitterDefinition } from './ParticleEmitterDefinition.js';
export {
    ParticleEventChannel,
    type ParticleEventChannelParameters,
    type ParticleEventChannelPayload,
    type ParticleEventChannelSchema,
    type ParticleEventFieldType,
    type ParticleEventFieldValue
} from './ParticleEventChannel.js';
export {
    ParticleBudgetManager,
    type ParticleBudgetDecision,
    type ParticleBudgetProfile,
    type ParticleBudgetRequest
} from './ParticleBudget.js';
export { default as ParticleGradient, type ParticleGradientKey } from './ParticleGradient.js';
export {
    ParticleParameter,
    ParticleParameterSet,
    type ParticleParameterType,
    type ParticleParameterValue
} from './ParticleParameter.js';
export {
    PARTICLE_SIMULATION_CACHE_VERSION,
    type ParticleSimulationCache
} from './ParticleSimulationCache.js';
export {
    default as ParticleSystem,
    type ParticleSystemEmitCommand,
    type ParticleSystemParameters,
    type ParticleSystemSimulateOptions
} from './ParticleSystem.js';
export type { ParticleEventAggregate, ParticleEventRecord } from './cpu/ParticleCPUEventBuffer.js';
export { default as ParticleSystemDefinition } from './ParticleSystemDefinition.js';
export { ParticleSystemPool } from './ParticleSystemPool.js';
export {
    PARTICLE_STAGE_SERVICE,
    ParticleStageRuntime,
    createParticleStageSystem,
    type ParticleStageSystemOptions
} from './ParticleStageSystem.js';
export {
    analyzeParticleStatelessEligibility,
    particleStatelessBlockingDiagnostics,
    type ParticleStatelessModuleMetadata,
    type ParticleStatelessSupport
} from './ParticleStateless.js';
export { PARTICLE_DEFINITION_VERSION } from './ParticleTypes.js';
export type * from './ParticleTypes.js';
