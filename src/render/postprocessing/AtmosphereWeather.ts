import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Color from '../../math/Color';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import Shader from '../../shader/Shader';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeSampler from '../compute/ComputeSampler';
import ComputeShader from '../compute/ComputeShader';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    ComputeRenderPass,
    FullscreenRenderPass,
    type ComputeRenderPassParameters,
    type FullscreenRenderPassParameters
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineTextureDescriptor
} from '../pipeline/ScriptableRenderGraph';

const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const ATMOSPHERE_FRAME_BYTES = 448;
const WORKGROUP_SIZE = 8;
const TRANSMITTANCE_WIDTH = 256;
const TRANSMITTANCE_HEIGHT = 64;
const MULTI_SCATTERING_SIZE = 32;
const SKY_VIEW_WIDTH = 192;
const SKY_VIEW_HEIGHT = 108;
const WEATHER_MAP_SIZE = 256;

/** Rendering budgets for the physical atmosphere and volumetric clouds. */
export type AtmosphereWeatherQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Optional diagnostic texture shown in place of the weather composition. */
export type AtmosphereWeatherDebugView =
    | 'none'
    | 'transmittance'
    | 'multi-scattering'
    | 'sky-view'
    | 'weather-map'
    | 'cloud-radiance'
    | 'cloud-transmittance'
    | 'cloud-shadow';

/**
 * Mutable state sampled by the weather renderer at frame-record time.
 *
 * Updating these values does not recreate pipelines. Call `invalidateHistory()` after a
 * discontinuous preset or time-of-day jump; continuous animation may update `timeSeconds` and
 * `sunDirection` every frame without resetting history.
 */
export class AtmosphereWeatherState {
    /** Normalized world-space direction from the scene toward the sun. */
    readonly sunDirection = new Vector3(0.32, 0.42, -0.85).normalize();
    /** Procedural weather animation time in seconds. */
    timeSeconds = 0;
    /** Fractional cloud coverage in [0, 1]. */
    cloudCoverage = 0.58;
    /** Cloud optical-density multiplier in [0, 4]. */
    cloudDensity = 1;
    /** Cumulonimbus/storm shaping in [0, 1]. */
    storminess = 0.35;
    /** Horizontal wind direction; Y is ignored. */
    readonly windDirection = new Vector3(0.82, 0, 0.57).normalize();
    /** Wind speed in world units per second. */
    windSpeed = 18;
    #historyRevision = 0;

    /** Monotonic discontinuity revision consumed by temporal cloud history. */
    get historyRevision(): number {
        return this.#historyRevision;
    }

    /** Reset cloud temporal history after a discontinuous authored state change. */
    invalidateHistory(): this {
        this.#historyRevision++;
        return this;
    }
}

/** Rayleigh, Mie, ozone, sun, and aerial-perspective configuration. */
export interface PhysicalAtmosphereOptions {
    /** Planet radius in world units. Defaults to 6,360,000. */
    readonly planetRadius?: number;
    /** Atmosphere height above the planet surface. Defaults to 100,000. */
    readonly atmosphereHeight?: number;
    /** World-space planet center. Defaults to `(0, -planetRadius, 0)`. */
    readonly planetCenter?: Readonly<Vector3>;
    /** Rayleigh density scale height. Defaults to 8,000. */
    readonly rayleighScaleHeight?: number;
    /** Mie density scale height. Defaults to 1,200. */
    readonly mieScaleHeight?: number;
    /** Mie phase anisotropy in [0, 0.95]. Defaults to 0.8. */
    readonly mieAnisotropy?: number;
    /** Ozone layer center altitude. Defaults to 25,000. */
    readonly ozoneCenterHeight?: number;
    /** Ozone triangular half-width. Defaults to 15,000. */
    readonly ozoneWidth?: number;
    /** Solar illuminance multiplier. Defaults to 20. */
    readonly sunIlluminance?: number;
    /** Linear sun tint. Defaults to warm white. */
    readonly sunColor?: Readonly<Color>;
    /** Angular sun-disc radius in degrees. Defaults to 0.27. */
    readonly sunAngularRadius?: number;
    /** Maximum aerial-perspective distance. Defaults to 160,000. */
    readonly aerialPerspectiveDistance?: number;
    /** Ground albedo used by the multi-scattering approximation. */
    readonly groundAlbedo?: Readonly<Color>;
}

/** Procedural weather map, cloud shell, ray-march, lighting, and temporal controls. */
export interface VolumetricCloudOptions {
    /** Cloud-base altitude above the planet surface. Defaults to 1,500. */
    readonly baseHeight?: number;
    /** Cloud-layer thickness. Defaults to 8,500. */
    readonly thickness?: number;
    /** Horizontal weather-map scale in world units. Defaults to 120,000. */
    readonly weatherScale?: number;
    /** Detail-noise scale in world units. Defaults to 7,000. */
    readonly detailScale?: number;
    /** Cloud-light forward-scattering anisotropy. Defaults to 0.72. */
    readonly anisotropy?: number;
    /** Silver-lining strength in [0, 4]. Defaults to 1.25. */
    readonly silverLining?: number;
    /** Ambient sky-light strength in [0, 4]. Defaults to 0.65. */
    readonly ambientStrength?: number;
    /** Temporal history contribution in [0, 0.98]. Defaults to 0.92. */
    readonly historyWeight?: number;
    /** Screen-space cloud-shadow coverage in world units. Defaults to 80,000. */
    readonly shadowDistance?: number;
}

/** Complete physical atmosphere, cloud, and mutable weather-state configuration. */
export interface AtmosphereWeatherOptions {
    /** Named sampling and reconstruction budget. Defaults to high. */
    readonly quality?: AtmosphereWeatherQuality;
    /** Mutable sun, cloud, wind, and time state. */
    readonly state?: AtmosphereWeatherState;
    /** Physical atmosphere constants. */
    readonly atmosphere?: Readonly<PhysicalAtmosphereOptions>;
    /** Volumetric clouds, or false to render atmosphere only. */
    readonly clouds?: Readonly<VolumetricCloudOptions> | false;
    /** Replace normal composition with one intermediate diagnostic. */
    readonly debugView?: AtmosphereWeatherDebugView;
}

interface QualitySettings {
    readonly resolutionScale: number;
    readonly cloudSteps: number;
    readonly lightSteps: number;
    readonly shadowSteps: number;
}

const QUALITY_SETTINGS: Readonly<Record<AtmosphereWeatherQuality, QualitySettings>> = Object.freeze(
    {
        low: Object.freeze({
            resolutionScale: 0.25,
            cloudSteps: 28,
            lightSteps: 4,
            shadowSteps: 6
        }),
        medium: Object.freeze({
            resolutionScale: 0.375,
            cloudSteps: 40,
            lightSteps: 5,
            shadowSteps: 8
        }),
        high: Object.freeze({
            resolutionScale: 0.625,
            cloudSteps: 160,
            lightSteps: 4,
            shadowSteps: 10
        }),
        ultra: Object.freeze({
            resolutionScale: 0.75,
            cloudSteps: 224,
            lightSteps: 6,
            shadowSteps: 14
        })
    }
);

/** @internal Validated immutable atmosphere and cloud settings. */
export interface AtmosphereWeatherSettings {
    readonly quality: AtmosphereWeatherQuality;
    readonly state: AtmosphereWeatherState;
    readonly debugView: AtmosphereWeatherDebugView;
    readonly planetRadius: number;
    readonly atmosphereHeight: number;
    readonly planetCenter: Readonly<{ x: number; y: number; z: number }>;
    readonly rayleighScaleHeight: number;
    readonly mieScaleHeight: number;
    readonly mieAnisotropy: number;
    readonly ozoneCenterHeight: number;
    readonly ozoneWidth: number;
    readonly sunIlluminance: number;
    readonly sunColor: Readonly<{ r: number; g: number; b: number }>;
    readonly sunAngularRadius: number;
    readonly aerialPerspectiveDistance: number;
    readonly groundAlbedo: Readonly<{ r: number; g: number; b: number }>;
    readonly clouds: Readonly<{
        baseHeight: number;
        thickness: number;
        weatherScale: number;
        detailScale: number;
        anisotropy: number;
        silverLining: number;
        ambientStrength: number;
        historyWeight: number;
        shadowDistance: number;
        resolutionScale: number;
        cloudSteps: number;
        lightSteps: number;
        shadowSteps: number;
    }> | null;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function validateVector(value: unknown, label: string): asserts value is Vector3 {
    if (!(value instanceof Vector3)) throw new TypeError(`${label} must be a Vector3`);
    if (![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new RangeError(`${label} must contain finite components`);
    }
}

function colorSnapshot(
    value: Readonly<Color>,
    label: string
): Readonly<{ r: number; g: number; b: number }> {
    if (!(value instanceof Color)) throw new TypeError(`${label} must be a Color`);
    if (
        ![value.r, value.g, value.b].every(
            component => Number.isFinite(component) && component >= 0
        )
    ) {
        throw new RangeError(`${label} must contain finite non-negative channels`);
    }
    return Object.freeze({ r: value.r, g: value.g, b: value.b });
}

/** @internal Validate and freeze a complete atmosphere/weather configuration. */
export function snapshotAtmosphereWeatherOptions(
    options: Readonly<AtmosphereWeatherOptions>
): Readonly<AtmosphereWeatherSettings> {
    const quality = options.quality ?? 'high';
    if (!Object.prototype.hasOwnProperty.call(QUALITY_SETTINGS, quality)) {
        throw new TypeError(`Atmosphere weather quality has an unsupported value ${quality}`);
    }
    const debugView = options.debugView ?? 'none';
    if (
        ![
            'none',
            'transmittance',
            'multi-scattering',
            'sky-view',
            'weather-map',
            'cloud-radiance',
            'cloud-transmittance',
            'cloud-shadow'
        ].includes(debugView)
    ) {
        throw new TypeError(`Atmosphere weather debugView has an unsupported value ${debugView}`);
    }
    const state = options.state ?? new AtmosphereWeatherState();
    if (!(state instanceof AtmosphereWeatherState)) {
        throw new TypeError('Atmosphere weather state must be an AtmosphereWeatherState');
    }
    const atmosphere = options.atmosphere ?? {};
    const planetRadius = finiteRange(
        atmosphere.planetRadius ?? 6_360_000,
        1_000,
        100_000_000,
        'Physical atmosphere planetRadius'
    );
    const atmosphereHeight = finiteRange(
        atmosphere.atmosphereHeight ?? 100_000,
        1_000,
        planetRadius,
        'Physical atmosphere atmosphereHeight'
    );
    const center = atmosphere.planetCenter ?? new Vector3(0, -planetRadius, 0);
    validateVector(center, 'Physical atmosphere planetCenter');
    const qualitySettings = QUALITY_SETTINGS[quality];
    const cloudsInput = options.clouds === false ? null : (options.clouds ?? {});
    const baseHeight =
        cloudsInput === null
            ? 0
            : finiteRange(
                  cloudsInput.baseHeight ?? 1_500,
                  0,
                  atmosphereHeight * 0.8,
                  'Volumetric clouds baseHeight'
              );
    const thickness =
        cloudsInput === null
            ? 0
            : finiteRange(
                  cloudsInput.thickness ?? 8_500,
                  100,
                  atmosphereHeight - baseHeight,
                  'Volumetric clouds thickness'
              );
    return Object.freeze({
        quality,
        state,
        debugView,
        planetRadius,
        atmosphereHeight,
        planetCenter: Object.freeze({ x: center.x, y: center.y, z: center.z }),
        rayleighScaleHeight: finiteRange(
            atmosphere.rayleighScaleHeight ?? 8_000,
            100,
            atmosphereHeight,
            'Physical atmosphere rayleighScaleHeight'
        ),
        mieScaleHeight: finiteRange(
            atmosphere.mieScaleHeight ?? 1_200,
            50,
            atmosphereHeight,
            'Physical atmosphere mieScaleHeight'
        ),
        mieAnisotropy: finiteRange(
            atmosphere.mieAnisotropy ?? 0.8,
            0,
            0.95,
            'Physical atmosphere mieAnisotropy'
        ),
        ozoneCenterHeight: finiteRange(
            atmosphere.ozoneCenterHeight ?? 25_000,
            0,
            atmosphereHeight,
            'Physical atmosphere ozoneCenterHeight'
        ),
        ozoneWidth: finiteRange(
            atmosphere.ozoneWidth ?? 15_000,
            100,
            atmosphereHeight,
            'Physical atmosphere ozoneWidth'
        ),
        sunIlluminance: finiteRange(
            atmosphere.sunIlluminance ?? 20,
            0,
            1_000,
            'Physical atmosphere sunIlluminance'
        ),
        sunColor: colorSnapshot(
            atmosphere.sunColor ?? new Color(1, 0.955, 0.86, 1),
            'Physical atmosphere sunColor'
        ),
        sunAngularRadius:
            (finiteRange(
                atmosphere.sunAngularRadius ?? 0.27,
                0.01,
                5,
                'Physical atmosphere sunAngularRadius'
            ) *
                Math.PI) /
            180,
        aerialPerspectiveDistance: finiteRange(
            atmosphere.aerialPerspectiveDistance ?? 160_000,
            100,
            10_000_000,
            'Physical atmosphere aerialPerspectiveDistance'
        ),
        groundAlbedo: colorSnapshot(
            atmosphere.groundAlbedo ?? new Color(0.16, 0.18, 0.2, 1),
            'Physical atmosphere groundAlbedo'
        ),
        clouds:
            cloudsInput === null
                ? null
                : Object.freeze({
                      baseHeight,
                      thickness,
                      weatherScale: finiteRange(
                          cloudsInput.weatherScale ?? 120_000,
                          1_000,
                          5_000_000,
                          'Volumetric clouds weatherScale'
                      ),
                      detailScale: finiteRange(
                          cloudsInput.detailScale ?? 7_000,
                          100,
                          1_000_000,
                          'Volumetric clouds detailScale'
                      ),
                      anisotropy: finiteRange(
                          cloudsInput.anisotropy ?? 0.72,
                          -0.5,
                          0.95,
                          'Volumetric clouds anisotropy'
                      ),
                      silverLining: finiteRange(
                          cloudsInput.silverLining ?? 1.25,
                          0,
                          4,
                          'Volumetric clouds silverLining'
                      ),
                      ambientStrength: finiteRange(
                          cloudsInput.ambientStrength ?? 0.65,
                          0,
                          4,
                          'Volumetric clouds ambientStrength'
                      ),
                      historyWeight: finiteRange(
                          cloudsInput.historyWeight ?? 0.92,
                          0,
                          0.98,
                          'Volumetric clouds historyWeight'
                      ),
                      shadowDistance: finiteRange(
                          cloudsInput.shadowDistance ?? 80_000,
                          1_000,
                          2_000_000,
                          'Volumetric clouds shadowDistance'
                      ),
                      ...qualitySettings
                  })
    });
}

const ATMOSPHERE_FRAME_WGSL = `
struct AtmosphereFrame {
    inverseView: mat4x4<f32>,
    inverseProjection: mat4x4<f32>,
    previousViewProjection: mat4x4<f32>,
    cameraPlanet: vec4<f32>,
    planet: vec4<f32>,
    sun: vec4<f32>,
    sunColor: vec4<f32>,
    rayleigh: vec4<f32>,
    mie: vec4<f32>,
    ozone: vec4<f32>,
    ozoneLayer: vec4<f32>,
    cloudLayer: vec4<f32>,
    cloudWeather: vec4<f32>,
    cloudWind: vec4<f32>,
    output: vec4<u32>,
    quality: vec4<u32>,
    aerial: vec4<f32>,
    cloudLighting: vec4<f32>,
    ground: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> atmosphere: AtmosphereFrame;
const HILO_PI: f32 = 3.141592653589793;

fn raySphere(origin: vec3<f32>, direction: vec3<f32>, radius: f32) -> vec2<f32> {
    let relative = origin - atmosphere.planet.xyz;
    let b = dot(relative, direction);
    let c = dot(relative, relative) - radius * radius;
    let discriminant = b * b - c;
    if (discriminant < 0.0) { return vec2<f32>(1e20, -1e20); }
    let root = sqrt(discriminant);
    return vec2<f32>(-b - root, -b + root);
}
fn altitude(position: vec3<f32>) -> f32 {
    return max(length(position - atmosphere.planet.xyz) - atmosphere.cameraPlanet.w, 0.0);
}
fn ozoneDensity(height: f32) -> f32 {
    return max(0.0, 1.0 - abs(height - atmosphere.ozoneLayer.x) / atmosphere.ozoneLayer.y);
}
fn mediumExtinction(position: vec3<f32>) -> vec3<f32> {
    let height = altitude(position);
    let rayleighDensity = exp(-height / atmosphere.rayleigh.w);
    let mieDensity = exp(-height / atmosphere.mie.z);
    return atmosphere.rayleigh.rgb * rayleighDensity +
        vec3<f32>(atmosphere.mie.y * mieDensity) + atmosphere.ozone.rgb * ozoneDensity(height);
}
fn reconstructWorldRay(uv: vec2<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let view = atmosphere.inverseProjection * vec4<f32>(ndc, 1.0, 1.0);
    return normalize((atmosphere.inverseView * vec4<f32>(normalize(view.xyz / max(view.w, 0.0001)), 0.0)).xyz);
}
fn phaseRayleigh(cosine: f32) -> f32 {
    return 3.0 * (1.0 + cosine * cosine) / (16.0 * HILO_PI);
}
fn phaseMie(cosine: f32, g: f32) -> f32 {
    let g2 = g * g;
    return 3.0 * (1.0 - g2) * (1.0 + cosine * cosine) /
        max(8.0 * HILO_PI * (2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * cosine, 0.0001), 1.5), 0.0001);
}`;

const TRANSMITTANCE_PASS = computePass(
    new ComputeShader({
        label: 'Physical atmosphere transmittance LUT',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var transmittanceOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(transmittanceOutput);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let height = uv.y * atmosphere.planet.w;
    let mu = uv.x * 2.0 - 1.0;
    let origin = atmosphere.planet.xyz + vec3<f32>(0.0, atmosphere.cameraPlanet.w + height, 0.0);
    let direction = normalize(vec3<f32>(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0));
    let topRadius = atmosphere.cameraPlanet.w + atmosphere.planet.w;
    let interval = raySphere(origin, direction, topRadius);
    let distance = max(interval.y, 0.0);
    var opticalDepth = vec3<f32>(0.0);
    let stepLength = distance / 32.0;
    for (var step = 0u; step < 32u; step += 1u) {
        let t = (f32(step) + 0.5) * stepLength;
        opticalDepth += mediumExtinction(origin + direction * t) * stepLength;
    }
    textureStore(transmittanceOutput, vec2<i32>(id.xy), vec4<f32>(exp(-opticalDepth), 1.0));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'transmittanceOutput',
                group: 0,
                binding: 1,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const MULTI_SCATTERING_PASS = computePass(
    new ComputeShader({
        label: 'Physical atmosphere multi-scattering LUT',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(2) var multiScatteringOutput: texture_storage_2d<rgba16float, write>;
fn sampleTransmittance(height: f32, mu: f32) -> vec3<f32> {
    let size = vec2<i32>(textureDimensions(transmittanceLut));
    let uv = vec2<f32>(mu * 0.5 + 0.5, clamp(height / atmosphere.planet.w, 0.0, 1.0));
    let pixel = clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
    return textureLoad(transmittanceLut, pixel, 0).rgb;
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(multiScatteringOutput);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let height = uv.y * atmosphere.planet.w;
    let sunMu = uv.x * 2.0 - 1.0;
    var energy = vec3<f32>(0.0);
    for (var sampleIndex = 0u; sampleIndex < 16u; sampleIndex += 1u) {
        let cosine = (f32(sampleIndex) + 0.5) / 8.0 - 1.0;
        let transmittance = sampleTransmittance(height, cosine);
        let phase = phaseRayleigh(cosine * sunMu) + phaseMie(cosine * sunMu, atmosphere.mie.w);
        energy += (vec3<f32>(1.0) - transmittance) * phase;
    }
    energy *= atmosphere.sunColor.rgb * atmosphere.sun.w / 16.0;
    let groundBounce = atmosphere.ground.rgb * max(sunMu, 0.0) * 0.08;
    textureStore(
        multiScatteringOutput,
        vec2<i32>(id.xy),
        vec4<f32>(min(energy * 0.35 + groundBounce, vec3<f32>(65000.0)), 1.0)
    );
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'transmittanceLut',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'multiScatteringOutput',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const SKY_VIEW_PASS = computePass(
    new ComputeShader({
        label: 'Physical atmosphere sky-view LUT',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(2) var multiScatteringLut: texture_2d<f32>;
@group(0) @binding(3) var skyViewOutput: texture_storage_2d<rgba16float, write>;
fn sampleLut(source: texture_2d<f32>, uv: vec2<f32>) -> vec3<f32> {
    let size = vec2<i32>(textureDimensions(source));
    let coordinate = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) *
        vec2<f32>(size - vec2<i32>(1));
    let base = vec2<i32>(floor(coordinate));
    let next = min(base + vec2<i32>(1), size - vec2<i32>(1));
    let blend = fract(coordinate);
    let lower = mix(textureLoad(source, base, 0).rgb, textureLoad(source, vec2<i32>(next.x, base.y), 0).rgb, blend.x);
    let upper = mix(textureLoad(source, vec2<i32>(base.x, next.y), 0).rgb, textureLoad(source, next, 0).rgb, blend.x);
    return mix(lower, upper, blend.y);
}
fn sunTransmittance(position: vec3<f32>) -> vec3<f32> {
    let up = normalize(position - atmosphere.planet.xyz);
    return sampleLut(
        transmittanceLut,
        vec2<f32>(dot(up, atmosphere.sun.xyz) * 0.5 + 0.5, altitude(position) / atmosphere.planet.w)
    );
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(skyViewOutput);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let camera = atmosphere.cameraPlanet.xyz;
    let up = normalize(camera - atmosphere.planet.xyz);
    let sunHorizontal = normalize(atmosphere.sun.xyz - up * dot(atmosphere.sun.xyz, up) + vec3<f32>(0.00001));
    let side = normalize(cross(up, sunHorizontal));
    let zenithCosine = mix(-0.18, 1.0, uv.y);
    let azimuth = (uv.x * 2.0 - 1.0) * HILO_PI;
    let horizontal = sunHorizontal * cos(azimuth) + side * sin(azimuth);
    let direction = normalize(horizontal * sqrt(max(1.0 - zenithCosine * zenithCosine, 0.0)) + up * zenithCosine);
    let topRadius = atmosphere.cameraPlanet.w + atmosphere.planet.w;
    let atmosphereHit = raySphere(camera, direction, topRadius);
    let groundHit = raySphere(camera, direction, atmosphere.cameraPlanet.w);
    var distance = max(atmosphereHit.y, 0.0);
    if (groundHit.x > 0.0) { distance = min(distance, groundHit.x); }
    let stepLength = distance / 32.0;
    var transmittance = vec3<f32>(1.0);
    var radiance = vec3<f32>(0.0);
    let cosine = dot(direction, atmosphere.sun.xyz);
    let rayleighPhase = phaseRayleigh(cosine);
    let miePhase = phaseMie(cosine, atmosphere.mie.w);
    for (var step = 0u; step < 32u; step += 1u) {
        let position = camera + direction * ((f32(step) + 0.5) * stepLength);
        let height = altitude(position);
        let rayleighDensity = exp(-height / atmosphere.rayleigh.w);
        let mieDensity = exp(-height / atmosphere.mie.z);
        let extinction = mediumExtinction(position);
        let segmentTransmittance = exp(-extinction * stepLength);
        let source = atmosphere.sunColor.rgb * atmosphere.sun.w * sunTransmittance(position) *
            (atmosphere.rayleigh.rgb * rayleighDensity * rayleighPhase +
                vec3<f32>(atmosphere.mie.x * mieDensity * miePhase));
        let multiple = sampleLut(
            multiScatteringLut,
            vec2<f32>(dot(normalize(position - atmosphere.planet.xyz), atmosphere.sun.xyz) * 0.5 + 0.5, height / atmosphere.planet.w)
        );
        radiance += transmittance * (source + multiple * extinction) * stepLength;
        transmittance *= segmentTransmittance;
    }
    textureStore(skyViewOutput, vec2<i32>(id.xy), vec4<f32>(min(radiance, vec3<f32>(65000.0)), 1.0));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'transmittanceLut',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'multiScatteringLut',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'skyViewOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const WEATHER_MAP_PASS = computePass(
    new ComputeShader({
        label: 'Volumetric cloud procedural weather map',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var weatherOutput: texture_storage_2d<rgba16float, write>;
fn hash22(point: vec2<f32>) -> vec2<f32> {
    let q = vec2<f32>(dot(point, vec2<f32>(127.1, 311.7)), dot(point, vec2<f32>(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
}
fn valueNoise(point: vec2<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    let smoothLocal = local * local * (3.0 - 2.0 * local);
    let a = hash22(cell).x;
    let b = hash22(cell + vec2<f32>(1.0, 0.0)).x;
    let c = hash22(cell + vec2<f32>(0.0, 1.0)).x;
    let d = hash22(cell + vec2<f32>(1.0, 1.0)).x;
    return mix(mix(a, b, smoothLocal.x), mix(c, d, smoothLocal.x), smoothLocal.y);
}
fn fbm(point: vec2<f32>) -> f32 {
    var result = 0.0;
    var amplitude = 0.55;
    var p = point;
    for (var octave = 0u; octave < 5u; octave += 1u) {
        result += valueNoise(p) * amplitude;
        p = p * 2.03 + vec2<f32>(17.17, 9.31);
        amplitude *= 0.5;
    }
    return result;
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(weatherOutput);
    if (any(id.xy >= size)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let wind = atmosphere.cloudWind.xy * atmosphere.cloudWeather.w * atmosphere.cloudWind.z / atmosphere.cloudLayer.z;
    let warp = vec2<f32>(
        fbm(uv * 2.1 + wind * 0.07 + vec2<f32>(3.7, 17.1)),
        fbm(uv * 2.3 - wind * 0.05 + vec2<f32>(21.4, 5.8))
    ) - vec2<f32>(0.5);
    let warped = uv + warp * 0.14;
    let frontCoordinates = vec2<f32>(
        dot(warped, vec2<f32>(0.82, 0.57)),
        dot(warped, vec2<f32>(-0.57, 0.82))
    );
    let continental = fbm(warped * 2.45 + wind * 0.12);
    let fronts = fbm(frontCoordinates * vec2<f32>(5.4, 3.6) - wind * 0.24 + vec2<f32>(11.0, 3.0));
    let cells = fbm((warped + warp * 0.08) * 10.5 + wind * 0.44 + vec2<f32>(2.0, 19.0));
    let frontRidge = 1.0 - abs(fronts * 2.0 - 1.0);
    let stormCenter = vec2<f32>(0.53, 0.34) + wind * 0.035;
    let stormDelta = warped - stormCenter;
    let supercell = 1.0 - smoothstep(0.42, 1.0, length(stormDelta / vec2<f32>(0.16, 0.11)));
    let inflowDelta = warped - vec2<f32>(0.34, 0.43) - wind * 0.02;
    let inflowBand = (1.0 - smoothstep(0.58, 1.0, length(inflowDelta / vec2<f32>(0.3, 0.075)))) *
        smoothstep(0.22, 0.72, frontRidge);
    let proceduralCoverage = smoothstep(
        0.34,
        0.82,
        continental * 0.52 + fronts * 0.29 + cells * 0.19
    );
    let cellularEnvelope = supercell * (
        0.34 + smoothstep(0.26, 0.78, cells * 0.58 + frontRidge * 0.42) * 0.62
    );
    let coverage = clamp(
        max(proceduralCoverage * 0.22, max(cellularEnvelope * 0.88, inflowBand * 0.52)),
        0.0,
        1.0
    );
    let cloudType = clamp(
        max(frontRidge * 0.42 + cells * 0.3 + continental * 0.18, supercell * 0.96),
        0.0,
        1.0
    );
    let proceduralStorm = smoothstep(
        0.54,
        0.84,
        continental * 0.45 + frontRidge * 0.34 + cells * 0.21
    );
    let storm = max(proceduralStorm, cellularEnvelope * smoothstep(0.3, 0.78, cells)) *
        atmosphere.cloudWeather.z;
    let precipitation = smoothstep(0.45, 0.95, storm * coverage);
    textureStore(weatherOutput, vec2<i32>(id.xy), vec4<f32>(coverage, cloudType, storm, precipitation));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'weatherOutput',
                group: 0,
                binding: 1,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

function cloudShadowPass(shadowSteps: number): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: 'Volumetric cloud screen-space shadow',
            source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var weatherMap: texture_2d<f32>;
@group(0) @binding(3) var cloudShadowOutput: texture_storage_2d<rgba16float, write>;
fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, atmosphere.output.w != 0u);
}
fn viewDistance(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, atmosphere.output.w != 0u);
    let near = atmosphere.aerial.x;
    let far = atmosphere.aerial.y;
    return near * far / max(far - standard * (far - near), 0.0001);
}
fn sampleWeather(position: vec3<f32>) -> vec4<f32> {
    let wind = atmosphere.cloudWind.xy * atmosphere.cloudWeather.w * atmosphere.cloudWind.z;
    let uv = fract((position.xz + wind) / atmosphere.cloudLayer.z + vec2<f32>(0.5));
    let size = vec2<i32>(textureDimensions(weatherMap));
    let coordinate = uv * vec2<f32>(size - vec2<i32>(1));
    let base = vec2<i32>(floor(coordinate));
    let next = min(base + vec2<i32>(1), size - vec2<i32>(1));
    let blend = fract(coordinate);
    let lower = mix(
        textureLoad(weatherMap, base, 0),
        textureLoad(weatherMap, vec2<i32>(next.x, base.y), 0),
        blend.x
    );
    let upper = mix(
        textureLoad(weatherMap, vec2<i32>(base.x, next.y), 0),
        textureLoad(weatherMap, next, 0),
        blend.x
    );
    return mix(lower, upper, blend.y);
}
fn densityAt(position: vec3<f32>) -> f32 {
    let height = altitude(position);
    let weather = sampleWeather(position);
    let normalizedHeight = (height - atmosphere.cloudLayer.x) / atmosphere.cloudLayer.y -
        (weather.x - 0.5) * 0.2;
    if (normalizedHeight <= 0.0 || normalizedHeight >= 1.0) { return 0.0; }
    let coverage = atmosphere.cloudWeather.x;
    let shape = smoothstep(0.38, 0.78, weather.x * 0.72 + coverage * 0.58);
    let profile = smoothstep(0.0, 0.12, normalizedHeight) * (1.0 - smoothstep(0.65, 1.0, normalizedHeight));
    return shape * profile * atmosphere.cloudWeather.y * mix(0.65, 1.7, weather.z);
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(cloudShadowOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    if (depthIsEmpty(rawDepth)) {
        textureStore(cloudShadowOutput, vec2<i32>(id.xy), vec4<f32>(1.0));
        return;
    }
    let origin = atmosphere.cameraPlanet.xyz;
    let worldPosition = origin + reconstructWorldRay(uv) * viewDistance(rawDepth);
    let sunDirection = atmosphere.sun.xyz;
    let innerRadius = atmosphere.cameraPlanet.w + atmosphere.cloudLayer.x;
    let outerRadius = innerRadius + atmosphere.cloudLayer.y;
    let outerHit = raySphere(worldPosition, sunDirection, outerRadius);
    let distance = max(outerHit.y, 0.0);
    var opticalDepth = 0.0;
    let stepLength = distance / ${String(shadowSteps)}.0;
    for (var step = 0u; step < ${String(shadowSteps)}u; step += 1u) {
        opticalDepth += densityAt(worldPosition + sunDirection * ((f32(step) + 0.5) * stepLength)) * stepLength * 0.00018;
    }
    textureStore(cloudShadowOutput, vec2<i32>(id.xy), vec4<f32>(exp(-opticalDepth)));
}`,
            workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
            bindings: [
                { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                {
                    name: 'sceneDepth',
                    group: 0,
                    binding: 1,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                },
                {
                    name: 'weatherMap',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'cloudShadowOutput',
                    group: 0,
                    binding: 3,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                }
            ]
        })
    );
}

const AERIAL_COMPOSITE_PASS = computePass(
    new ComputeShader({
        label: 'Physical sky and aerial perspective composite',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(4) var multiScatteringLut: texture_2d<f32>;
@group(0) @binding(5) var skyViewLut: texture_2d<f32>;
@group(0) @binding(6) var atmosphereOutput: texture_storage_2d<rgba16float, write>;
fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, atmosphere.output.w != 0u);
}
fn viewDistance(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, atmosphere.output.w != 0u);
    let near = atmosphere.aerial.x;
    let far = atmosphere.aerial.y;
    return near * far / max(far - standard * (far - near), 0.0001);
}
fn sampleSky(direction: vec3<f32>) -> vec3<f32> {
    let up = normalize(atmosphere.cameraPlanet.xyz - atmosphere.planet.xyz);
    let sunHorizontal = normalize(atmosphere.sun.xyz - up * dot(atmosphere.sun.xyz, up) + vec3<f32>(0.00001));
    let side = normalize(cross(up, sunHorizontal));
    let horizontal = normalize(direction - up * dot(direction, up) + vec3<f32>(0.00001));
    let azimuth = atan2(dot(horizontal, side), dot(horizontal, sunHorizontal));
    let uv = vec2<f32>(azimuth / (2.0 * HILO_PI) + 0.5, (dot(direction, up) + 0.18) / 1.18);
    let size = vec2<i32>(textureDimensions(skyViewLut));
    let coordinate = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) *
        vec2<f32>(size - vec2<i32>(1));
    let base = vec2<i32>(floor(coordinate));
    let next = min(base + vec2<i32>(1), size - vec2<i32>(1));
    let blend = fract(coordinate);
    let lower = mix(textureLoad(skyViewLut, base, 0).rgb, textureLoad(skyViewLut, vec2<i32>(next.x, base.y), 0).rgb, blend.x);
    let upper = mix(textureLoad(skyViewLut, vec2<i32>(base.x, next.y), 0).rgb, textureLoad(skyViewLut, next, 0).rgb, blend.x);
    return mix(lower, upper, blend.y);
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(atmosphereOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let sceneSize = vec2<i32>(textureDimensions(sceneColor));
    let scenePixel = clamp(vec2<i32>(uv * vec2<f32>(sceneSize)), vec2<i32>(0), sceneSize - vec2<i32>(1));
    let depthSize = vec2<i32>(textureDimensions(sceneDepth));
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), depthSize - vec2<i32>(1));
    let scene = textureLoad(sceneColor, scenePixel, 0);
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    let direction = reconstructWorldRay(uv);
    var sky = sampleSky(direction);
    let sunAlignment = dot(direction, atmosphere.sun.xyz);
    let sunDisk = smoothstep(cos(atmosphere.ozoneLayer.z * 1.8), cos(atmosphere.ozoneLayer.z), sunAlignment);
    sky += atmosphere.sunColor.rgb * atmosphere.sun.w * sunDisk * 0.045;
    if (depthIsEmpty(rawDepth)) {
        textureStore(atmosphereOutput, vec2<i32>(id.xy), vec4<f32>(sky, 1.0));
        return;
    }
    let distance = min(viewDistance(rawDepth), atmosphere.ozoneLayer.w);
    let extinction = mediumExtinction(atmosphere.cameraPlanet.xyz);
    let transmittance = exp(-extinction * distance);
    let horizon = 1.0 - abs(dot(direction, normalize(atmosphere.cameraPlanet.xyz - atmosphere.planet.xyz)));
    let inScattering = sky * (vec3<f32>(1.0) - transmittance) * mix(0.38, 1.0, horizon);
    textureStore(atmosphereOutput, vec2<i32>(id.xy), vec4<f32>(scene.rgb * transmittance + inScattering, scene.a));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sceneColor',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'transmittanceLut',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'multiScatteringLut',
                group: 0,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'skyViewLut',
                group: 0,
                binding: 5,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'atmosphereOutput',
                group: 0,
                binding: 6,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

function cloudTracePass(cloudSteps: number, lightSteps: number): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: 'Volumetric cloud Perlin-Worley ray march',
            source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var transmittanceLut: texture_2d<f32>;
@group(0) @binding(2) var multiScatteringLut: texture_2d<f32>;
@group(0) @binding(3) var skyViewLut: texture_2d<f32>;
@group(0) @binding(4) var weatherMap: texture_2d<f32>;
@group(0) @binding(5) var sceneDepth: texture_depth_2d;
@group(0) @binding(6) var cloudColorOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var cloudDepthOutput: texture_storage_2d<r32float, write>;

fn cloudViewDistance(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, atmosphere.output.w != 0u);
    return atmosphere.aerial.x * atmosphere.aerial.y /
        max(atmosphere.aerial.y - standard * (atmosphere.aerial.y - atmosphere.aerial.x), 0.0001);
}
fn hash13(point: vec3<f32>) -> f32 {
    var p = fract(point * 0.1031);
    p += dot(p, p.yzx + vec3<f32>(33.33));
    return fract((p.x + p.y) * p.z);
}
fn valueNoise(point: vec3<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    let smoothLocal = local * local * (3.0 - 2.0 * local);
    var result = 0.0;
    for (var z = 0u; z < 2u; z += 1u) {
        for (var y = 0u; y < 2u; y += 1u) {
            for (var x = 0u; x < 2u; x += 1u) {
                let corner = vec3<f32>(f32(x), f32(y), f32(z));
                let weight = mix(vec3<f32>(1.0) - smoothLocal, smoothLocal, corner);
                result += hash13(cell + corner) * weight.x * weight.y * weight.z;
            }
        }
    }
    return result;
}
fn worley(point: vec3<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    var nearest = 10.0;
    for (var z = -1; z <= 1; z += 1) {
        for (var y = -1; y <= 1; y += 1) {
            for (var x = -1; x <= 1; x += 1) {
                let offset = vec3<f32>(f32(x), f32(y), f32(z));
                let feature = vec3<f32>(
                    hash13(cell + offset),
                    hash13(cell + offset + vec3<f32>(19.1, 7.7, 3.4)),
                    hash13(cell + offset + vec3<f32>(5.2, 31.8, 11.3))
                );
                nearest = min(nearest, length(offset + feature - local));
            }
        }
    }
    return clamp(nearest, 0.0, 1.0);
}
fn perlinWorley(point: vec3<f32>) -> f32 {
    let perlin = valueNoise(point) * 0.62 + valueNoise(point * 2.03 + 7.1) * 0.25 + valueNoise(point * 4.07 + 13.7) * 0.13;
    let cells = 1.0 - worley(point * 1.25);
    return clamp(perlin * 0.72 + cells * 0.28, 0.0, 1.0);
}
fn sampleWeather(position: vec3<f32>) -> vec4<f32> {
    let wind = atmosphere.cloudWind.xy * atmosphere.cloudWeather.w * atmosphere.cloudWind.z;
    let uv = fract((position.xz + wind) / atmosphere.cloudLayer.z + vec2<f32>(0.5));
    let size = vec2<i32>(textureDimensions(weatherMap));
    let coordinate = uv * vec2<f32>(size - vec2<i32>(1));
    let base = vec2<i32>(floor(coordinate));
    let next = min(base + vec2<i32>(1), size - vec2<i32>(1));
    let blend = fract(coordinate);
    let lower = mix(
        textureLoad(weatherMap, base, 0),
        textureLoad(weatherMap, vec2<i32>(next.x, base.y), 0),
        blend.x
    );
    let upper = mix(
        textureLoad(weatherMap, vec2<i32>(base.x, next.y), 0),
        textureLoad(weatherMap, next, 0),
        blend.x
    );
    return mix(lower, upper, blend.y);
}
fn sampleCloudLut(source: texture_2d<f32>, uv: vec2<f32>) -> vec3<f32> {
    let size = vec2<i32>(textureDimensions(source));
    let coordinate = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) *
        vec2<f32>(size - vec2<i32>(1));
    let base = vec2<i32>(floor(coordinate));
    let next = min(base + vec2<i32>(1), size - vec2<i32>(1));
    let blend = fract(coordinate);
    let lower = mix(textureLoad(source, base, 0).rgb, textureLoad(source, vec2<i32>(next.x, base.y), 0).rgb, blend.x);
    let upper = mix(textureLoad(source, vec2<i32>(base.x, next.y), 0).rgb, textureLoad(source, next, 0).rgb, blend.x);
    return mix(lower, upper, blend.y);
}
fn cloudSunTransmittance(position: vec3<f32>) -> vec3<f32> {
    let up = normalize(position - atmosphere.planet.xyz);
    return sampleCloudLut(
        transmittanceLut,
        vec2<f32>(
            dot(up, atmosphere.sun.xyz) * 0.5 + 0.5,
            clamp(altitude(position) / atmosphere.planet.w, 0.0, 1.0)
        )
    );
}
fn cloudMultipleScattering(position: vec3<f32>) -> vec3<f32> {
    let up = normalize(position - atmosphere.planet.xyz);
    return sampleCloudLut(
        multiScatteringLut,
        vec2<f32>(
            dot(up, atmosphere.sun.xyz) * 0.5 + 0.5,
            clamp(altitude(position) / atmosphere.planet.w, 0.0, 1.0)
        )
    );
}
fn cloudSkyAmbient(direction: vec3<f32>) -> vec3<f32> {
    let up = normalize(atmosphere.cameraPlanet.xyz - atmosphere.planet.xyz);
    let sunHorizontal = normalize(
        atmosphere.sun.xyz - up * dot(atmosphere.sun.xyz, up) + vec3<f32>(0.00001)
    );
    let side = normalize(cross(up, sunHorizontal));
    let horizontal = normalize(direction - up * dot(direction, up) + vec3<f32>(0.00001));
    let azimuth = atan2(dot(horizontal, side), dot(horizontal, sunHorizontal));
    let uv = vec2<f32>(
        azimuth / (2.0 * HILO_PI) + 0.5,
        (dot(direction, up) + 0.18) / 1.18
    );
    return sampleCloudLut(skyViewLut, uv);
}
fn cloudDensity(position: vec3<f32>) -> f32 {
    let height = altitude(position);
    let weather = sampleWeather(position);
    let wind = vec3<f32>(atmosphere.cloudWind.x, 0.055, atmosphere.cloudWind.y) *
        atmosphere.cloudWeather.w * atmosphere.cloudWind.z;
    let macroPoint = (position + wind) / (atmosphere.cloudLayer.w * 2.6);
    let domainWarp = vec3<f32>(
        valueNoise(macroPoint * 0.73 + vec3<f32>(3.2, 17.1, 8.4)),
        valueNoise(macroPoint * 0.61 + vec3<f32>(11.7, 2.5, 23.8)),
        valueNoise(macroPoint * 0.79 + vec3<f32>(19.4, 13.6, 4.1))
    ) - vec3<f32>(0.5);
    let noisePoint = (position + wind) / atmosphere.cloudLayer.w + domainWarp * 0.68;
    let heightWarp = (valueNoise(macroPoint + domainWarp * 0.35) - 0.5) * 0.12;
    let normalizedHeight = (height - atmosphere.cloudLayer.x) / atmosphere.cloudLayer.y -
        (weather.x - 0.5) * 0.13 + heightWarp;
    if (normalizedHeight <= 0.0 || normalizedHeight >= 1.0) { return 0.0; }
    let verticalShear = vec3<f32>(1.55, 0.18, -1.08) * normalizedHeight;
    let macroNoise = perlinWorley((noisePoint + verticalShear) * 0.82);
    let coverage = clamp(
        weather.x * (0.36 + atmosphere.cloudWeather.x * 0.62) + weather.z * 0.08,
        0.03,
        0.94
    );
    let coverageThreshold = 1.0 - coverage;
    let coverageNoise = macroNoise * 0.82 + weather.x * 0.18;
    let baseShape = smoothstep(
        coverageThreshold,
        min(coverageThreshold + 0.24, 1.0),
        coverageNoise
    );
    let towerField =
        valueNoise(vec3<f32>(macroPoint.x * 0.58, 19.7, macroPoint.z * 0.58)) * 0.62 +
        valueNoise(vec3<f32>(macroPoint.x * 1.17 + 8.3, 7.1, macroPoint.z * 1.17 + 14.9)) * 0.38;
    let towerPotential = smoothstep(
        0.28,
        0.78,
        towerField * 0.58 + weather.y * 0.25 + weather.z * 0.28
    );
    let towerDrive = clamp(
        towerPotential * 0.86 + weather.z * 0.22 + (macroNoise - 0.5) * 0.16,
        0.0,
        1.0
    );
    let cloudTop = clamp(
        mix(0.16, 0.92, towerDrive),
        0.14,
        0.96
    );
    let lowerProfile = smoothstep(0.055, mix(0.16, 0.24, weather.y), normalizedHeight);
    let upperProfile = 1.0 - smoothstep(max(cloudTop - 0.2, 0.14), cloudTop, normalizedHeight);
    let anvilProfile = weather.z * smoothstep(0.68, 0.9, towerPotential) *
        smoothstep(0.48, 0.66, normalizedHeight) *
        (1.0 - smoothstep(0.82, 0.98, normalizedHeight));
    let verticalProfile = clamp(max(lowerProfile * upperProfile, anvilProfile * 0.58), 0.0, 1.0);
    let detail =
        valueNoise(noisePoint * 3.8 + vec3<f32>(0.0, atmosphere.cloudWeather.w * 0.035, 0.0)) * 0.68 +
        valueNoise(noisePoint * 7.7 + vec3<f32>(13.1, atmosphere.cloudWeather.w * 0.061, 5.7)) * 0.32;
    let cloudCore = baseShape * verticalProfile;
    let edgeErosion = (1.0 - detail) * mix(0.38, 0.12, cloudCore) *
        mix(1.25, 0.68, verticalProfile);
    let carvedShape = smoothstep(0.055, 0.58, cloudCore - edgeErosion);
    return clamp(carvedShape, 0.0, 1.0) *
        atmosphere.cloudWeather.y * mix(0.72, 1.55, weather.z);
}
fn blueNoise(pixel: vec2<u32>, frameIndex: u32) -> f32 {
    let coordinate = vec2<f32>(pixel);
    let spatial = fract(52.9829189 * fract(dot(coordinate, vec2<f32>(0.06711056, 0.00583715))));
    return fract(spatial + f32(frameIndex & 63u) * 0.754877666);
}
fn cloudLightTransmittance(position: vec3<f32>) -> f32 {
    let height = altitude(position);
    let distance = max(
        atmosphere.cloudLayer.x + atmosphere.cloudLayer.y - height,
        0.0
    ) / max(atmosphere.sun.y, 0.08);
    let stepLength = distance / ${String(lightSteps)}.0;
    var opticalDepth = 0.0;
    for (var step = 0u; step < ${String(lightSteps)}u; step += 1u) {
        let samplePosition = position + atmosphere.sun.xyz * ((f32(step) + 0.5) * stepLength);
        opticalDepth += cloudDensity(samplePosition) * stepLength * 0.00022;
    }
    return exp(-opticalDepth);
}
fn hg(cosine: f32, g: f32) -> f32 {
    let g2 = g * g;
    return (1.0 - g2) / max(4.0 * HILO_PI * pow(max(1.0 + g2 - 2.0 * g * cosine, 0.0001), 1.5), 0.0001);
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(cloudColorOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let origin = atmosphere.cameraPlanet.xyz;
    let direction = reconstructWorldRay(uv);
    let innerRadius = atmosphere.cameraPlanet.w + atmosphere.cloudLayer.x;
    let outerRadius = innerRadius + atmosphere.cloudLayer.y;
    let innerHit = raySphere(origin, direction, innerRadius);
    let outerHit = raySphere(origin, direction, outerRadius);
    var start = max(outerHit.x, 0.0);
    var end = max(outerHit.y, 0.0);
    if (innerHit.y > 0.0) { start = max(start, innerHit.y); }
    let groundHit = raySphere(origin, direction, atmosphere.cameraPlanet.w);
    let blockedByPlanet = groundHit.x > 0.0 && groundHit.x < start;
    if (end <= start || blockedByPlanet) {
        textureStore(cloudColorOutput, vec2<i32>(id.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
        textureStore(cloudDepthOutput, vec2<i32>(id.xy), vec4<f32>(-1.0));
        return;
    }
    end = min(end, start + 52000.0);
    let marchDistance = end - start;
    let jitter = (blueNoise(id.xy, atmosphere.output.z) - 0.5) * 0.08;
    var transmittance = 1.0;
    var radiance = vec3<f32>(0.0);
    var representativeDepth = -1.0;
    var depthMoment = 0.0;
    var depthWeight = 0.0;
    let viewToSun = dot(direction, atmosphere.sun.xyz);
    let forwardPhase = hg(viewToSun, atmosphere.cloudLighting.x);
    let backwardPhase = hg(viewToSun, -0.25);
    for (var step = 0u; step < ${String(cloudSteps)}u; step += 1u) {
        let normalizedDistance = clamp(
            (f32(step) + 0.5 + jitter) / ${String(cloudSteps)}.0,
            0.0,
            1.0
        );
        let distance = start + normalizedDistance * marchDistance;
        let sampleLength = marchDistance / ${String(cloudSteps)}.0;
        let position = origin + direction * distance;
        let filterOffset = direction * sampleLength * 0.22;
        let density = (
            cloudDensity(position - filterOffset) + cloudDensity(position + filterOffset)
        ) * 0.5;
        if (density <= 0.001) { continue; }
        let extinction = density * 0.00018;
        let segmentTransmittance = exp(-extinction * sampleLength);
        let segmentOpacity = transmittance * (1.0 - segmentTransmittance);
        depthMoment += distance * segmentOpacity;
        depthWeight += segmentOpacity;
        let sunVisibility = mix(
            exp(-density * 3.1),
            cloudLightTransmittance(position),
            0.18
        );
        let weather = sampleWeather(position);
        let edgeLight = pow(max(viewToSun, 0.0), 8.0) * (1.0 - sunVisibility);
        let silver = 1.0 + atmosphere.aerial.w * edgeLight * 0.68;
        let phase = min(0.08 + mix(backwardPhase, forwardPhase, 0.8) * 1.55, 0.9);
        let sunLight = atmosphere.sunColor.rgb * atmosphere.sun.w *
            cloudSunTransmittance(position) * sunVisibility * phase;
        let up = normalize(position - atmosphere.planet.xyz);
        let normalizedHeight = clamp(
            (altitude(position) - atmosphere.cloudLayer.x) / atmosphere.cloudLayer.y,
            0.0,
            1.0
        );
        let skyAmbient = (
            cloudSkyAmbient(normalize(up + atmosphere.sun.xyz * 0.18)) * 0.038 +
            cloudMultipleScattering(position) * 0.13 +
            vec3<f32>(0.025, 0.052, 0.105)
        ) * atmosphere.cloudLighting.y * mix(1.0, 0.35, weather.z);
        let lightningPulse = pow(max(sin(atmosphere.cloudWeather.w * 3.7 + weather.x * 31.0), 0.0), 48.0) *
            weather.z * atmosphere.cloudWeather.z * 22.0;
        let powder = 1.0 - exp(-density * 4.2);
        let heightLighting = mix(0.12, 1.0, smoothstep(0.03, 0.78, normalizedHeight));
        let stormDarkening = mix(0.88, 0.12, clamp(density * weather.z * 1.4, 0.0, 1.0));
        let bouncedLight = vec3<f32>(0.065, 0.12, 0.24) * (1.0 - sunVisibility) *
            mix(0.42, 1.0, normalizedHeight);
        let source = (
            sunLight * silver * mix(0.54, 1.12, powder) * heightLighting * 0.42 +
            skyAmbient * mix(0.72, 0.24, density) +
            bouncedLight
        ) * stormDarkening +
            vec3<f32>(0.42, 0.55, 0.9) * lightningPulse;
        let integral = (1.0 - segmentTransmittance) / max(extinction, 0.000001);
        radiance += transmittance * source * density * integral * 0.00018;
        transmittance *= segmentTransmittance;
        if (transmittance < 0.012) { break; }
    }
    if (depthWeight > 0.001) { representativeDepth = depthMoment / depthWeight; }
    if (representativeDepth > 0.0) {
        let representativePosition = origin + direction * representativeDepth;
        let representativeHeight = clamp(
            (altitude(representativePosition) - atmosphere.cloudLayer.x) / atmosphere.cloudLayer.y,
            0.0,
            1.0
        );
        let cloudOpacity = 1.0 - transmittance;
        let heightTone = pow(smoothstep(0.04, 0.78, representativeHeight), 1.35);
        let bodyColor = mix(
            vec3<f32>(0.006, 0.018, 0.052),
            vec3<f32>(0.82, 0.9, 1.0),
            heightTone
        );
        let billowStructure = perlinWorley(
            representativePosition / (atmosphere.cloudLayer.w * 1.9) +
                vec3<f32>(0.0, atmosphere.cloudWeather.w * 0.009, 0.0)
        );
        let structuralLight = mix(0.42, 1.3, smoothstep(0.18, 0.82, billowStructure));
        let opticalShading = mix(1.2, 0.34, smoothstep(0.1, 0.94, cloudOpacity));
        let edgeOpacity = cloudOpacity * pow(max(1.0 - cloudOpacity, 0.0), 1.6) * 3.4;
        let sunFacing = pow(max(viewToSun * 0.5 + 0.5, 0.0), 5.0);
        let rimColor = vec3<f32>(1.0, 0.52, 0.2) * edgeOpacity * mix(0.2, 1.0, sunFacing) *
            atmosphere.aerial.w * 0.55;
        radiance = radiance * 0.03 +
            bodyColor * cloudOpacity * structuralLight * opticalShading * 0.97 + rimColor;
        let distanceFade = 1.0 - smoothstep(43000.0, 51500.0, representativeDepth);
        radiance *= distanceFade;
        transmittance = mix(1.0, transmittance, distanceFade);
    }
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(
        vec2<i32>(uv * vec2<f32>(depthSize)),
        vec2<i32>(0),
        vec2<i32>(depthSize) - vec2<i32>(1)
    );
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    let depthEmpty = select(rawDepth >= 0.999999, rawDepth <= 0.000001, atmosphere.output.w != 0u);
    if (!depthEmpty && cloudViewDistance(rawDepth) < representativeDepth) {
        radiance = vec3<f32>(0.0);
        transmittance = 1.0;
        representativeDepth = -1.0;
    }
    textureStore(cloudColorOutput, vec2<i32>(id.xy), vec4<f32>(min(radiance, vec3<f32>(65000.0)), transmittance));
    textureStore(cloudDepthOutput, vec2<i32>(id.xy), vec4<f32>(representativeDepth));
}`,
            workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
            bindings: [
                { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                {
                    name: 'transmittanceLut',
                    group: 0,
                    binding: 1,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'multiScatteringLut',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'skyViewLut',
                    group: 0,
                    binding: 3,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'weatherMap',
                    group: 0,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'sceneDepth',
                    group: 0,
                    binding: 5,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                },
                {
                    name: 'cloudColorOutput',
                    group: 0,
                    binding: 6,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                },
                {
                    name: 'cloudDepthOutput',
                    group: 0,
                    binding: 7,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'r32float'
                }
            ]
        })
    );
}

const CLOUD_HISTORY_INITIALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Volumetric cloud initialize temporal history',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var currentCloud: texture_2d<f32>;
@group(0) @binding(2) var currentDepth: texture_2d<f32>;
@group(0) @binding(3) var colorOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var depthOutput: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(colorOutput);
    if (any(id.xy >= size)) { return; }
    textureStore(colorOutput, vec2<i32>(id.xy), textureLoad(currentCloud, vec2<i32>(id.xy), 0));
    textureStore(depthOutput, vec2<i32>(id.xy), textureLoad(currentDepth, vec2<i32>(id.xy), 0));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'currentCloud',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'currentDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'colorOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 4,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

const CLOUD_HISTORY_RESOLVE_PASS = computePass(
    new ComputeShader({
        label: 'Volumetric cloud temporal reprojection',
        source: `${ATMOSPHERE_FRAME_WGSL}
@group(0) @binding(1) var currentCloud: texture_2d<f32>;
@group(0) @binding(2) var currentDepth: texture_2d<f32>;
@group(0) @binding(3) var historyCloud: texture_2d<f32>;
@group(0) @binding(4) var historyDepth: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;
@group(0) @binding(6) var colorOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var depthOutput: texture_storage_2d<r32float, write>;
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let size = vec2<i32>(textureDimensions(source));
    return clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
}
fn luminance(value: vec3<f32>) -> f32 { return dot(value, vec3<f32>(0.2126, 0.7152, 0.0722)); }
@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(colorOutput);
    if (any(id.xy >= size)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let currentSize = vec2<i32>(textureDimensions(currentCloud));
    let current = textureLoad(currentCloud, pixel, 0);
    let depth = textureLoad(currentDepth, pixel, 0).r;
    var previousUv = uv;
    if (depth > 0.0) {
        let worldPosition = atmosphere.cameraPlanet.xyz + reconstructWorldRay(uv) * depth;
        let previousClip = atmosphere.previousViewProjection * vec4<f32>(worldPosition, 1.0);
        previousUv = previousClip.xy / max(previousClip.w, 0.0001) * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    }
    var history = current;
    var weight = 0.0;
    if (all(previousUv > vec2<f32>(0.001)) && all(previousUv < vec2<f32>(0.999))) {
        history = textureSampleLevel(historyCloud, linearSampler, previousUv, 0.0);
        let oldDepth = textureLoad(historyDepth, pixelFor(historyDepth, previousUv), 0).r;
        let sameBackground = depth < 0.0 && oldDepth < 0.0;
        let depthError = abs(depth - oldDepth) / max(max(abs(depth), abs(oldDepth)), 1.0);
        let radianceDelta = abs(luminance(current.rgb) - luminance(history.rgb)) /
            max(max(luminance(current.rgb), luminance(history.rgb)), 0.05);
        let transmittanceDelta = abs(current.a - history.a);
        let reactive = clamp(max(radianceDelta * 0.08, transmittanceDelta * 0.32), 0.0, 1.0);
        let valid = sameBackground || (depth > 0.0 && oldDepth > 0.0 && depthError < 0.72);
        weight = select(0.0, atmosphere.aerial.z * (1.0 - reactive * 0.28), valid);
    }
    var minimumValue = current;
    var maximumValue = current;
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let neighbor = textureLoad(currentCloud, clamp(pixel + vec2<i32>(x, y), vec2<i32>(0), currentSize - vec2<i32>(1)), 0);
            minimumValue = min(minimumValue, neighbor);
            maximumValue = max(maximumValue, neighbor);
        }
    }
    let neighborhoodRange = maximumValue - minimumValue;
    let clampedHistory = clamp(
        history,
        minimumValue - neighborhoodRange * 0.35,
        maximumValue + neighborhoodRange * 0.35
    );
    let resolved = mix(current, clampedHistory, weight);
    textureStore(colorOutput, pixel, resolved);
    textureStore(depthOutput, pixel, vec4<f32>(depth));
}`,
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
        bindings: [
            { name: 'atmosphere', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'currentCloud',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'currentDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'historyCloud',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'historyDepth',
                group: 0,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            { name: 'linearSampler', group: 0, binding: 5, kind: 'sampler' },
            {
                name: 'colorOutput',
                group: 0,
                binding: 6,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 7,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

function compositePass(debugView: AtmosphereWeatherDebugView): FullscreenRenderPass {
    const body =
        debugView === 'cloud-radiance'
            ? 'color = vec4(cloud.rgb, 1.0);'
            : debugView === 'cloud-transmittance'
              ? 'color = vec4(vec3(1.0 - cloud.a), 1.0);'
              : 'color = vec4(cloud.rgb + scene.rgb * clamp(cloud.a, 0.0, 1.0), scene.a);';
    return new FullscreenRenderPass({
        name: 'Physical atmosphere and volumetric cloud HDR composite',
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_cloud;
layout(location=0) out vec4 color;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    vec4 cloud = texture(u_cloud, v_uv);
    ${body}
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

function diagnosticPass(view: AtmosphereWeatherDebugView): FullscreenRenderPass {
    const body =
        view === 'cloud-shadow'
            ? 'color = vec4(vec3(value.r), 1.0);'
            : view === 'transmittance'
              ? 'color = vec4(pow(max(value.rgb, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);'
              : 'color = vec4(value.rgb / (vec3(1.0) + value.rgb), 1.0);';
    return new FullscreenRenderPass({
        name: `Atmosphere weather ${view} diagnostic`,
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location=0) out vec4 color;
void main() {
    vec4 value = texture(u_source, v_uv);
    ${body}
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    readonly samplers: ComputeSampler[];
    readonly dispatch = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number, samplerCount = 0) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
        this.samplers = Array.from({ length: samplerCount }, () => CLOUD_TEMPORAL_SAMPLER);
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Atmosphere buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('Atmosphere texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(width: number, height: number): void {
        this.dispatch.x = Math.max(1, Math.ceil(width / WORKGROUP_SIZE));
        this.dispatch.y = Math.max(1, Math.ceil(height / WORKGROUP_SIZE));
        this.dispatch.z = 1;
    }
}

class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];
}

const CLOUD_TEMPORAL_SAMPLER = new ComputeSampler({
    label: 'Volumetric cloud temporal linear sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
});

/** @internal Resources generated before surface shading. */
export interface AtmosphereWeatherPrerequisites {
    readonly frame: RenderGraphBufferHandle;
    readonly transmittance: RenderGraphTextureHandle;
    readonly multiScattering: RenderGraphTextureHandle;
    readonly skyView: RenderGraphTextureHandle;
    readonly weatherMap: RenderGraphTextureHandle | null;
    readonly cloudShadow: RenderGraphTextureHandle | null;
    readonly historyValid: boolean;
}

/** @internal Inputs required to compose physical sky and clouds after opaque lighting. */
export interface AtmosphereWeatherCompositeResources {
    readonly sceneColor: RenderGraphTextureHandle;
    readonly sceneDepth: RenderGraphTextureHandle;
    readonly sceneScale: number;
    readonly prerequisites: Readonly<AtmosphereWeatherPrerequisites>;
}

/** @internal Renderer-local atmosphere LUT, cloud, shadow, and temporal controller. */
export class AtmosphereWeatherController {
    readonly #settings: Readonly<AtmosphereWeatherSettings>;
    readonly #frameBuffer: StorageBuffer;
    readonly #frameBytes = new ArrayBuffer(ATMOSPHERE_FRAME_BYTES);
    readonly #frameFloats = new Float32Array(this.#frameBytes);
    readonly #frameUInts = new Uint32Array(this.#frameBytes);
    readonly #frameView = new Uint8Array(this.#frameBytes);
    readonly #inverseView = new Matrix4();
    readonly #inverseProjection = new Matrix4();
    readonly #committedViewProjection = new Float32Array(16);
    readonly #pendingViewProjection = new Float32Array(16);
    readonly #transmittanceKey = Object.freeze({});
    readonly #multiScatteringKey = Object.freeze({});
    readonly #cloudColorKey = Object.freeze({});
    readonly #cloudDepthKey = Object.freeze({});
    readonly #transmittanceDescriptor: RenderPipelineHistoryTextureDescriptor;
    readonly #multiScatteringDescriptor: RenderPipelineHistoryTextureDescriptor;
    readonly #cloudColorDescriptor: RenderPipelineHistoryTextureDescriptor | null;
    readonly #cloudDepthDescriptor: RenderPipelineHistoryTextureDescriptor | null;
    readonly #atmosphereOutputDescriptor: RenderPipelineTextureDescriptor;
    readonly #cloudCurrentDescriptor: RenderPipelineTextureDescriptor | null;
    readonly #cloudDepthCurrentDescriptor: RenderPipelineTextureDescriptor | null;
    readonly #cloudShadowDescriptor: RenderPipelineTextureDescriptor | null;
    readonly #cloudTracePass: ComputeRenderPass | null;
    readonly #cloudShadowPass: ComputeRenderPass | null;
    readonly #compositePass: FullscreenRenderPass | null;
    readonly #diagnosticPass: FullscreenRenderPass | null;
    readonly #transmittancePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 1)
    );
    readonly #multiScatteringPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 3)
    );
    readonly #skyViewPool = new RenderPassParameterPool(() => new MutableComputeParameters(1, 3));
    readonly #weatherPool = new RenderPassParameterPool(() => new MutableComputeParameters(1, 1));
    readonly #shadowPool = new RenderPassParameterPool(() => new MutableComputeParameters(1, 3));
    readonly #aerialPool = new RenderPassParameterPool(() => new MutableComputeParameters(1, 6));
    readonly #cloudTracePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 7)
    );
    readonly #cloudInitializePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 4)
    );
    readonly #cloudResolvePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 6, 1)
    );
    readonly #fullscreenPool = new RenderPassParameterPool(() => new MutableFullscreenParameters());
    #destroyed = false;
    #pendingFrame = -1;
    #pendingCamera: Camera | null = null;
    #pendingCameraRevision = -1;
    #pendingStateRevision = -1;
    #committedCamera: Camera | null = null;
    #committedCameraRevision = -1;
    #committedStateRevision = -1;

    constructor(
        settings: Readonly<AtmosphereWeatherSettings>,
        context: RenderPipelineCreateContext,
        sceneScale: number
    ) {
        this.#settings = settings;
        this.#frameBuffer = context.createStorageBuffer({
            label: 'Physical atmosphere and weather frame',
            byteLength: ATMOSPHERE_FRAME_BYTES,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#transmittanceDescriptor = Object.freeze({
            label: 'Physical atmosphere transmittance LUT cache',
            format: 'rgba16float',
            extent: Object.freeze({ width: TRANSMITTANCE_WIDTH, height: TRANSMITTANCE_HEIGHT }),
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2 as const
        });
        this.#multiScatteringDescriptor = Object.freeze({
            label: 'Physical atmosphere multi-scattering LUT cache',
            format: 'rgba16float',
            extent: Object.freeze({
                width: MULTI_SCATTERING_SIZE,
                height: MULTI_SCATTERING_SIZE
            }),
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2 as const
        });
        this.#atmosphereOutputDescriptor = Object.freeze({
            format: 'rgba16float',
            extent: Object.freeze({ relativeTo: 'output', scale: sceneScale })
        });
        const clouds = settings.clouds;
        if (clouds === null) {
            this.#cloudColorDescriptor = null;
            this.#cloudDepthDescriptor = null;
            this.#cloudCurrentDescriptor = null;
            this.#cloudDepthCurrentDescriptor = null;
            this.#cloudShadowDescriptor = null;
            this.#cloudTracePass = null;
            this.#cloudShadowPass = null;
            this.#compositePass = null;
        } else {
            const cloudExtent = Object.freeze({
                relativeTo: 'output' as const,
                scale: sceneScale * clouds.resolutionScale,
                minWidth: 1,
                minHeight: 1
            });
            this.#cloudColorDescriptor = Object.freeze({
                label: 'Volumetric cloud radiance history',
                format: 'rgba16float',
                extent: cloudExtent,
                usage: Object.freeze(['sampled' as const, 'storage' as const]),
                bufferCount: 2 as const
            });
            this.#cloudDepthDescriptor = Object.freeze({
                label: 'Volumetric cloud representative-depth history',
                format: 'r32float',
                extent: cloudExtent,
                usage: Object.freeze(['sampled' as const, 'storage' as const]),
                bufferCount: 2 as const
            });
            this.#cloudCurrentDescriptor = Object.freeze({
                format: 'rgba16float',
                extent: cloudExtent
            });
            this.#cloudDepthCurrentDescriptor = Object.freeze({
                format: 'r32float',
                extent: cloudExtent
            });
            this.#cloudShadowDescriptor = Object.freeze({
                format: 'rgba16float',
                extent: Object.freeze({ relativeTo: 'output', scale: sceneScale })
            });
            this.#cloudTracePass = cloudTracePass(clouds.cloudSteps, clouds.lightSteps);
            this.#cloudShadowPass = cloudShadowPass(clouds.shadowSteps);
            this.#compositePass = compositePass(settings.debugView);
        }
        this.#diagnosticPass =
            settings.debugView === 'none' ||
            settings.debugView === 'cloud-radiance' ||
            settings.debugView === 'cloud-transmittance'
                ? null
                : diagnosticPass(settings.debugView);
    }

    recordPrerequisites(
        context: RenderPipelineContext,
        sceneDepth: RenderGraphTextureHandle,
        sceneScale: number,
        historyValid: boolean
    ): Readonly<AtmosphereWeatherPrerequisites> {
        if (this.#destroyed) throw new Error('Atmosphere weather controller is destroyed');
        const frameHistoryValid = this.packFrame(context, historyValid);
        context.writeStorageBuffer(this.#frameBuffer, 0, this.#frameView);
        const frame = context.graph.importStorageBuffer(this.#frameBuffer);
        const transmittanceHistory = context.graph.acquireHistoryTexture(
            this.#transmittanceKey,
            this.#transmittanceDescriptor
        );
        let transmittance: RenderGraphTextureHandle;
        if (transmittanceHistory.valid) {
            transmittance = transmittanceHistory.history();
        } else {
            transmittance = transmittanceHistory.current;
            const parameters = context.acquirePassParameters(this.#transmittancePool);
            parameters.setBuffer(0, frame);
            parameters.setTexture(0, transmittance);
            parameters.setDispatch(TRANSMITTANCE_WIDTH, TRANSMITTANCE_HEIGHT);
            context.graph.addPass(TRANSMITTANCE_PASS, parameters);
        }
        const multiHistory = context.graph.acquireHistoryTexture(
            this.#multiScatteringKey,
            this.#multiScatteringDescriptor
        );
        let multiScattering: RenderGraphTextureHandle;
        if (multiHistory.valid) {
            multiScattering = multiHistory.history();
        } else {
            multiScattering = multiHistory.current;
            const parameters = context.acquirePassParameters(this.#multiScatteringPool);
            parameters.setBuffer(0, frame);
            parameters.setTexture(0, transmittance);
            parameters.setTexture(1, multiScattering);
            parameters.textures.length = 2;
            parameters.setDispatch(MULTI_SCATTERING_SIZE, MULTI_SCATTERING_SIZE);
            context.graph.addPass(MULTI_SCATTERING_PASS, parameters);
        }
        const skyView = context.graph.createTexture('Physical atmosphere sky-view LUT', {
            format: 'rgba16float',
            extent: { width: SKY_VIEW_WIDTH, height: SKY_VIEW_HEIGHT }
        });
        const sky = context.acquirePassParameters(this.#skyViewPool);
        sky.setBuffer(0, frame);
        sky.setTexture(0, transmittance);
        sky.setTexture(1, multiScattering);
        sky.setTexture(2, skyView);
        sky.setDispatch(SKY_VIEW_WIDTH, SKY_VIEW_HEIGHT);
        context.graph.addPass(SKY_VIEW_PASS, sky);

        let weatherMap: RenderGraphTextureHandle | null = null;
        let cloudShadow: RenderGraphTextureHandle | null = null;
        if (this.#settings.clouds !== null && this.#cloudShadowPass !== null) {
            weatherMap = context.graph.createTexture('Volumetric cloud weather map', {
                format: 'rgba16float',
                extent: { width: WEATHER_MAP_SIZE, height: WEATHER_MAP_SIZE }
            });
            const weather = context.acquirePassParameters(this.#weatherPool);
            weather.setBuffer(0, frame);
            weather.setTexture(0, weatherMap);
            weather.setDispatch(WEATHER_MAP_SIZE, WEATHER_MAP_SIZE);
            context.graph.addPass(WEATHER_MAP_PASS, weather);
            cloudShadow = context.graph.createTexture(
                'Volumetric cloud screen-space shadow',
                this.requireCloudShadowDescriptor()
            );
            const shadow = context.acquirePassParameters(this.#shadowPool);
            shadow.setBuffer(0, frame);
            shadow.setTexture(0, sceneDepth);
            shadow.setTexture(1, weatherMap);
            shadow.setTexture(2, cloudShadow);
            const width = Math.max(1, Math.floor(context.output.width * sceneScale));
            const height = Math.max(1, Math.floor(context.output.height * sceneScale));
            shadow.setDispatch(width, height);
            context.graph.addPass(this.#cloudShadowPass, shadow);
        }
        this.#pendingFrame = context.frameIndex;
        this.#pendingCamera = context.camera;
        this.#pendingCameraRevision = getTransformHistoryRevision(context.camera);
        this.#pendingStateRevision = this.#settings.state.historyRevision;
        return Object.freeze({
            frame,
            transmittance,
            multiScattering,
            skyView,
            weatherMap,
            cloudShadow,
            historyValid: frameHistoryValid
        });
    }

    recordComposite(
        context: RenderPipelineContext,
        resources: Readonly<AtmosphereWeatherCompositeResources>
    ): RenderGraphTextureHandle {
        const { prerequisites } = resources;
        const atmosphereOutput = context.graph.createTexture(
            'Physical sky and aerial perspective HDR scene',
            this.#atmosphereOutputDescriptor
        );
        const width = Math.max(1, Math.floor(context.output.width * resources.sceneScale));
        const height = Math.max(1, Math.floor(context.output.height * resources.sceneScale));
        const aerial = context.acquirePassParameters(this.#aerialPool);
        aerial.setBuffer(0, prerequisites.frame);
        aerial.setTexture(0, resources.sceneColor);
        aerial.setTexture(1, resources.sceneDepth);
        aerial.setTexture(2, prerequisites.transmittance);
        aerial.setTexture(3, prerequisites.multiScattering);
        aerial.setTexture(4, prerequisites.skyView);
        aerial.setTexture(5, atmosphereOutput);
        aerial.setDispatch(width, height);
        context.graph.addPass(AERIAL_COMPOSITE_PASS, aerial);

        const clouds = this.#settings.clouds;
        if (
            clouds === null ||
            prerequisites.weatherMap === null ||
            this.#cloudTracePass === null ||
            this.#compositePass === null
        ) {
            return this.recordDiagnosticIfNeeded(context, atmosphereOutput, prerequisites);
        }
        const cloudWidth = Math.max(1, Math.floor(width * clouds.resolutionScale));
        const cloudHeight = Math.max(1, Math.floor(height * clouds.resolutionScale));
        const currentCloud = context.graph.createTexture(
            'Volumetric cloud current radiance and transmittance',
            this.requireCloudCurrentDescriptor()
        );
        const currentDepth = context.graph.createTexture(
            'Volumetric cloud current representative depth',
            this.requireCloudDepthCurrentDescriptor()
        );
        const trace = context.acquirePassParameters(this.#cloudTracePool);
        trace.setBuffer(0, prerequisites.frame);
        trace.setTexture(0, prerequisites.transmittance);
        trace.setTexture(1, prerequisites.multiScattering);
        trace.setTexture(2, prerequisites.skyView);
        trace.setTexture(3, prerequisites.weatherMap);
        trace.setTexture(4, resources.sceneDepth);
        trace.setTexture(5, currentCloud);
        trace.setTexture(6, currentDepth);
        trace.setDispatch(cloudWidth, cloudHeight);
        context.graph.addPass(this.#cloudTracePass, trace);

        if (!prerequisites.historyValid) {
            context.graph.invalidateHistoryTexture(this.#cloudColorKey);
            context.graph.invalidateHistoryTexture(this.#cloudDepthKey);
        }
        const colorHistory = context.graph.acquireHistoryTexture(
            this.#cloudColorKey,
            this.requireCloudColorDescriptor()
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            this.#cloudDepthKey,
            this.requireCloudDepthDescriptor()
        );
        if (
            colorHistory.valid &&
            depthHistory.valid &&
            prerequisites.historyValid &&
            colorHistory.generation === depthHistory.generation
        ) {
            const resolve = context.acquirePassParameters(this.#cloudResolvePool);
            resolve.setBuffer(0, prerequisites.frame);
            resolve.setTexture(0, currentCloud);
            resolve.setTexture(1, currentDepth);
            resolve.setTexture(2, colorHistory.history());
            resolve.setTexture(3, depthHistory.history());
            resolve.setTexture(4, colorHistory.current);
            resolve.setTexture(5, depthHistory.current);
            resolve.setDispatch(cloudWidth, cloudHeight);
            context.graph.addPass(CLOUD_HISTORY_RESOLVE_PASS, resolve);
        } else {
            const initialize = context.acquirePassParameters(this.#cloudInitializePool);
            initialize.setBuffer(0, prerequisites.frame);
            initialize.setTexture(0, currentCloud);
            initialize.setTexture(1, currentDepth);
            initialize.setTexture(2, colorHistory.current);
            initialize.setTexture(3, depthHistory.current);
            initialize.setDispatch(cloudWidth, cloudHeight);
            context.graph.addPass(CLOUD_HISTORY_INITIALIZE_PASS, initialize);
        }

        if (this.#diagnosticPass !== null) {
            return this.recordDiagnosticIfNeeded(context, atmosphereOutput, prerequisites, {
                cloud: colorHistory.current
            });
        }
        const composited = context.graph.createTexture(
            'Physical atmosphere and volumetric cloud HDR scene',
            this.#atmosphereOutputDescriptor
        );
        const composite = context.acquirePassParameters(this.#fullscreenPool);
        composite.inputTextures.length = 2;
        composite.inputTextures[0] = atmosphereOutput;
        composite.inputTextures[1] = colorHistory.current;
        composite.colorAttachments[0] = {
            texture: composited,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(this.#compositePass, composite);
        return composited;
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#committedCamera = this.#pendingCamera;
        this.#committedCameraRevision = this.#pendingCameraRevision;
        this.#committedStateRevision = this.#pendingStateRevision;
        this.#committedViewProjection.set(this.#pendingViewProjection);
        this.#pendingFrame = -1;
        this.#pendingCamera = null;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#pendingFrame = -1;
        this.#pendingCamera = null;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#frameBuffer.destroy();
    }

    private packFrame(context: RenderPipelineContext, historyValid: boolean): boolean {
        const camera = context.camera;
        const settings = this.#settings;
        const state = settings.state;
        validateVector(state.sunDirection, 'Atmosphere weather state sunDirection');
        validateVector(state.windDirection, 'Atmosphere weather state windDirection');
        const sunLength = Math.hypot(
            state.sunDirection.x,
            state.sunDirection.y,
            state.sunDirection.z
        );
        if (sunLength <= 1e-6) {
            throw new RangeError('Atmosphere weather sunDirection must be non-zero');
        }
        const windLength = Math.hypot(state.windDirection.x, state.windDirection.z);
        if (windLength <= 1e-6) {
            throw new RangeError('Atmosphere weather windDirection must have a horizontal axis');
        }
        const cameraRevision = getTransformHistoryRevision(camera);
        const continuous =
            historyValid &&
            this.#committedCamera === camera &&
            this.#committedCameraRevision === cameraRevision &&
            this.#committedStateRevision === state.historyRevision;
        this.#inverseView.invert(camera.viewMatrix);
        this.#inverseProjection.invert(camera.projectionMatrix);
        const previous = continuous
            ? this.#committedViewProjection
            : camera.jitteredViewProjectionMatrix.elements;
        this.writeMatrix(this.#inverseView, 0);
        this.writeMatrix(this.#inverseProjection, 16);
        for (let index = 0; index < 16; index += 1) {
            this.#frameFloats[32 + index] = previous[index] ?? 0;
            this.#pendingViewProjection[index] =
                camera.jitteredViewProjectionMatrix.elements[index] ?? 0;
        }
        const inverseView = this.#inverseView.elements;
        this.#frameFloats[48] = inverseView[12];
        this.#frameFloats[49] = inverseView[13];
        this.#frameFloats[50] = inverseView[14];
        this.#frameFloats[51] = settings.planetRadius;
        this.#frameFloats[52] = settings.planetCenter.x;
        this.#frameFloats[53] = settings.planetCenter.y;
        this.#frameFloats[54] = settings.planetCenter.z;
        this.#frameFloats[55] = settings.atmosphereHeight;
        this.#frameFloats[56] = state.sunDirection.x / sunLength;
        this.#frameFloats[57] = state.sunDirection.y / sunLength;
        this.#frameFloats[58] = state.sunDirection.z / sunLength;
        this.#frameFloats[59] = settings.sunIlluminance;
        this.#frameFloats[60] = settings.sunColor.r;
        this.#frameFloats[61] = settings.sunColor.g;
        this.#frameFloats[62] = settings.sunColor.b;
        this.#frameFloats[63] = 0;
        this.#frameFloats[64] = 5.802e-6;
        this.#frameFloats[65] = 13.558e-6;
        this.#frameFloats[66] = 33.1e-6;
        this.#frameFloats[67] = settings.rayleighScaleHeight;
        this.#frameFloats[68] = 3.996e-6;
        this.#frameFloats[69] = 4.44e-6;
        this.#frameFloats[70] = settings.mieScaleHeight;
        this.#frameFloats[71] = settings.mieAnisotropy;
        this.#frameFloats[72] = 0.65e-6;
        this.#frameFloats[73] = 1.881e-6;
        this.#frameFloats[74] = 0.085e-6;
        this.#frameFloats[75] = 0;
        this.#frameFloats[76] = settings.ozoneCenterHeight;
        this.#frameFloats[77] = settings.ozoneWidth;
        this.#frameFloats[78] = settings.sunAngularRadius;
        this.#frameFloats[79] = settings.aerialPerspectiveDistance;
        const clouds = settings.clouds;
        this.#frameFloats[80] = clouds?.baseHeight ?? 0;
        this.#frameFloats[81] = clouds?.thickness ?? 1;
        this.#frameFloats[82] = clouds?.weatherScale ?? 1;
        this.#frameFloats[83] = clouds?.detailScale ?? 1;
        this.#frameFloats[84] = finiteRange(state.cloudCoverage, 0, 1, 'Weather cloudCoverage');
        this.#frameFloats[85] = finiteRange(state.cloudDensity, 0, 4, 'Weather cloudDensity');
        this.#frameFloats[86] = finiteRange(state.storminess, 0, 1, 'Weather storminess');
        this.#frameFloats[87] = finiteRange(state.timeSeconds, -1e9, 1e9, 'Weather timeSeconds');
        this.#frameFloats[88] = state.windDirection.x / windLength;
        this.#frameFloats[89] = state.windDirection.z / windLength;
        this.#frameFloats[90] = finiteRange(state.windSpeed, 0, 10_000, 'Weather windSpeed');
        this.#frameFloats[91] = clouds?.shadowDistance ?? 1;
        this.#frameUInts[92] = context.output.width;
        this.#frameUInts[93] = context.output.height;
        this.#frameUInts[94] = context.frameIndex >>> 0;
        this.#frameUInts[95] = camera.depthMode === 'reversed' ? 1 : 0;
        this.#frameUInts[96] = clouds?.cloudSteps ?? 0;
        this.#frameUInts[97] = clouds?.lightSteps ?? 0;
        this.#frameUInts[98] = clouds?.shadowSteps ?? 0;
        this.#frameUInts[99] = 0;
        const near = 'near' in camera && typeof camera.near === 'number' ? camera.near : 0.1;
        const farCandidate = 'far' in camera ? camera.far : 100_000;
        const far =
            typeof farCandidate === 'number' && Number.isFinite(farCandidate)
                ? farCandidate
                : 10_000_000;
        this.#frameFloats[100] = near;
        this.#frameFloats[101] = far;
        this.#frameFloats[102] = clouds?.historyWeight ?? 0;
        this.#frameFloats[103] = clouds?.silverLining ?? 0;
        this.#frameFloats[104] = clouds?.anisotropy ?? 0;
        this.#frameFloats[105] = clouds?.ambientStrength ?? 0;
        this.#frameFloats[106] = 0;
        this.#frameFloats[107] = 0;
        this.#frameFloats[108] = settings.groundAlbedo.r;
        this.#frameFloats[109] = settings.groundAlbedo.g;
        this.#frameFloats[110] = settings.groundAlbedo.b;
        this.#frameFloats[111] = 0;
        return continuous;
    }

    private writeMatrix(matrix: Matrix4, offset: number): void {
        const elements = matrix.elements;
        for (let index = 0; index < 16; index += 1) {
            this.#frameFloats[offset + index] = elements[index] ?? 0;
        }
    }

    private recordDiagnosticIfNeeded(
        context: RenderPipelineContext,
        atmosphereOutput: RenderGraphTextureHandle,
        prerequisites: Readonly<AtmosphereWeatherPrerequisites>,
        cloudResources?: Readonly<{ cloud: RenderGraphTextureHandle }>
    ): RenderGraphTextureHandle {
        const pass = this.#diagnosticPass;
        if (pass === null) return atmosphereOutput;
        let source: RenderGraphTextureHandle;
        switch (this.#settings.debugView) {
            case 'transmittance':
                source = prerequisites.transmittance;
                break;
            case 'multi-scattering':
                source = prerequisites.multiScattering;
                break;
            case 'sky-view':
                source = prerequisites.skyView;
                break;
            case 'weather-map':
                if (prerequisites.weatherMap === null) return atmosphereOutput;
                source = prerequisites.weatherMap;
                break;
            case 'cloud-shadow':
                if (prerequisites.cloudShadow === null) return atmosphereOutput;
                source = prerequisites.cloudShadow;
                break;
            case 'cloud-radiance':
            case 'cloud-transmittance':
                if (cloudResources === undefined) return atmosphereOutput;
                source = cloudResources.cloud;
                break;
            case 'none':
                return atmosphereOutput;
        }
        const output = context.graph.createTexture(
            `Atmosphere weather ${this.#settings.debugView} diagnostic output`,
            this.#atmosphereOutputDescriptor
        );
        const parameters = context.acquirePassParameters(this.#fullscreenPool);
        parameters.inputTextures.length = 1;
        parameters.inputTextures[0] = source;
        parameters.colorAttachments[0] = {
            texture: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(pass, parameters);
        return output;
    }

    private requireCloudCurrentDescriptor(): RenderPipelineTextureDescriptor {
        if (this.#cloudCurrentDescriptor === null)
            throw new Error('Cloud color descriptor is unavailable');
        return this.#cloudCurrentDescriptor;
    }

    private requireCloudDepthCurrentDescriptor(): RenderPipelineTextureDescriptor {
        if (this.#cloudDepthCurrentDescriptor === null)
            throw new Error('Cloud depth descriptor is unavailable');
        return this.#cloudDepthCurrentDescriptor;
    }

    private requireCloudShadowDescriptor(): RenderPipelineTextureDescriptor {
        if (this.#cloudShadowDescriptor === null)
            throw new Error('Cloud shadow descriptor is unavailable');
        return this.#cloudShadowDescriptor;
    }

    private requireCloudColorDescriptor(): RenderPipelineHistoryTextureDescriptor {
        if (this.#cloudColorDescriptor === null)
            throw new Error('Cloud color history is unavailable');
        return this.#cloudColorDescriptor;
    }

    private requireCloudDepthDescriptor(): RenderPipelineHistoryTextureDescriptor {
        if (this.#cloudDepthDescriptor === null)
            throw new Error('Cloud depth history is unavailable');
        return this.#cloudDepthDescriptor;
    }
}

/** Required texture roles for physical atmosphere, clouds, history, and cloud shadows. */
export const ATMOSPHERE_WEATHER_REQUIRED_TEXTURE_FORMATS = Object.freeze([
    Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
    Object.freeze({ format: 'rgba16float' as const, use: 'storage' as const }),
    Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
    Object.freeze({ format: 'r32float' as const, use: 'sampled' as const }),
    Object.freeze({ format: 'r32float' as const, use: 'storage' as const })
]);
