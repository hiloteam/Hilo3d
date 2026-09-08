import * as Hilo3d from '../../src/Hilo3d';
import { CsmToyTransition } from './csm-toy-transition';

function shaderChunk(name: string): string {
    const source = Hilo3d.Shader.shaders[name];
    if (!source) throw new Error(`Missing portable water shader chunk ${name}`);
    return source;
}

/** The renderer owns these blocks and shadow samplers, exactly as it does for built-in PBR. */
function createWaterDefinition(): Hilo3d.MaterialDefinition {
    const blocks = shaderChunk('chunk/uniformBlocks.glsl');
    const vertexSource = `#version 300 es
precision highp float;
precision highp int;
#define HILO_VERTEX_SHADER
${blocks}
in vec3 a_position;
in vec2 a_texcoord0;
out vec2 v_waterUV;
out vec3 v_waterWorldPosition;
out vec3 v_waterViewPosition;
void main() {
    vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
    v_waterUV = a_texcoord0;
    v_waterWorldPosition = worldPosition.xyz;
    v_waterViewPosition = (u_viewMatrix * worldPosition).xyz;
    gl_Position = u_viewProjectionMatrix * worldPosition;
}`;
    const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
${blocks}
layout(std140) uniform CsmToyWaterBlock {
    float u_waterTime;
    float u_waterSkyIntensity;
};
in vec2 v_waterUV;
in vec3 v_waterWorldPosition;
in vec3 v_waterViewPosition;
layout(location = 0) out vec4 fragmentColor;

#if defined(HILO_SHADOW_ATLAS) && (defined(HILO_DIRECTIONAL_LIGHTS_SMC) || defined(HILO_SPOT_LIGHTS_SMC))
uniform highp sampler2DShadow u_shadowAtlas;
#endif
// This engine chunk performs the single RenderTarget UV normalization at shadow-atlas lookup.
${shaderChunk('method/getShadow.glsl')}
${shaderChunk('method/getLightAttenuation.glsl')}

float softStroke(float distanceToStroke, float width) {
    float pixelWidth = clamp(fwidth(distanceToStroke), 0.0002, 0.15);
    return 1.0 - smoothstep(width, width + pixelWidth * 1.4, abs(distanceToStroke));
}

void main() {
    float time = u_waterTime;
    vec2 surface = v_waterWorldPosition.xz;
    float shoreDistance = min(v_waterUV.x, 1.0 - v_waterUV.x);
    float shore = 1.0 - smoothstep(0.018, 0.34, shoreDistance);
    float current = sin(surface.y * 0.39 + sin(surface.x * 0.75) - time * 0.12);
    vec3 deepColor = vec3(0.012, 0.235, 0.285);
    vec3 shallowColor = vec3(0.115, 0.49, 0.445);
    vec3 baseColor = mix(deepColor, shallowColor, shore * shore);
    baseColor *= 1.0 + current * 0.028;

    // Two low-amplitude analytic waves give the glossy resin a gentle moving normal.
    float phaseA = dot(surface, vec2(2.2, 1.45)) - time * 0.58;
    float phaseB = dot(surface, vec2(-1.1, 2.4)) + time * 0.36;
    vec2 slope = vec2(2.2, 1.45) * cos(phaseA) * 0.013
        + vec2(-1.1, 2.4) * cos(phaseB) * 0.008;
    vec3 worldNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 normal = normalize(mat3(u_viewMatrix) * worldNormal);
    vec3 viewDirection = normalize(-v_waterViewPosition);

    vec3 illumination = vec3(0.43, 0.5, 0.51) * u_waterSkyIntensity;
    vec3 directGlint = vec3(0.0);
    float sunlight = 1.0;
    #ifdef HILO_DIRECTIONAL_LIGHTS
    for (int lightIndex = 0; lightIndex < HILO_DIRECTIONAL_LIGHTS; lightIndex++) {
        vec3 lightDirection = normalize(-u_directionalLightsInfo[lightIndex]);
        float visibility = 1.0;
        #if defined(HILO_SHADOW_ATLAS) && defined(HILO_DIRECTIONAL_LIGHTS_SMC)
        if (lightIndex < HILO_DIRECTIONAL_LIGHTS_SMC) {
            float bias = max(u_directionalLightsShadowBias[lightIndex].y
                * (1.0 - dot(normal, lightDirection)),
                u_directionalLightsShadowBias[lightIndex].x);
            visibility = getDirectionalShadowAtlas(lightIndex, bias, v_waterViewPosition);
        }
        #endif
        vec3 lightColor = u_directionalLightsColor[lightIndex];
        illumination += max(dot(normal, lightDirection), 0.0) * lightColor * visibility * 0.23;
        vec3 halfwayDirection = normalize(viewDirection + lightDirection);
        float specular = pow(max(dot(normal, halfwayDirection), 0.0), 110.0);
        directGlint += lightColor * specular * visibility * 0.26;
        sunlight = min(sunlight, visibility);
    }
    #endif

    // Use the same view-space cone, falloff and atlas visibility as the built-in PBR materials.
    // The broad resin lobe catches warm lamps, while the sharper lobe follows the moving waves.
    #ifdef HILO_SPOT_LIGHTS
    for (int lightIndex = 0; lightIndex < HILO_SPOT_LIGHTS; lightIndex++) {
        vec3 distanceVector = u_spotLightsPos[lightIndex] - v_waterViewPosition;
        vec3 lightDirection = normalize(distanceVector);
        vec3 spotDirection = normalize(-u_spotLightsDir[lightIndex]);
        float theta = dot(lightDirection, spotDirection);
        float epsilon = max(
            u_spotLightsCutoffs[lightIndex].x - u_spotLightsCutoffs[lightIndex].y,
            1e-5
        );
        float cone = clamp((theta - u_spotLightsCutoffs[lightIndex].y) / epsilon, 0.0, 1.0);
        cone = cone * cone * (3.0 - 2.0 * cone);
        float attenuation = getLightAttenuation(
            distanceVector,
            u_spotLightsInfo[lightIndex],
            u_spotLightsRange[lightIndex]
        );
        float visibility = 1.0;
        #if defined(HILO_SHADOW_ATLAS) && defined(HILO_SPOT_LIGHTS_SMC)
        if (lightIndex < HILO_SPOT_LIGHTS_SMC) {
            float bias = max(u_spotLightsShadowBias[lightIndex].y
                * (1.0 - dot(normal, lightDirection)),
                u_spotLightsShadowBias[lightIndex].x);
            visibility = getShadowAtlas(
                HILO_MAX_DIRECTIONAL_LIGHTS * HILO_MAX_DIRECTIONAL_SHADOW_CASCADES + lightIndex,
                bias,
                v_waterViewPosition,
                u_spotLightSpaceMatrix[lightIndex]
            );
        }
        #endif
        vec3 radiance = u_spotLightsColor[lightIndex] * cone * attenuation * visibility;
        illumination += max(dot(normal, lightDirection), 0.0) * radiance * 0.32;
        vec3 halfwayDirection = normalize(viewDirection + lightDirection);
        float specularAngle = max(dot(normal, halfwayDirection), 0.0);
        directGlint += radiance * (pow(specularAngle, 42.0) * 0.25
            + pow(specularAngle, 128.0) * 0.65);
    }
    #endif

    // A soft, broad reflection suggests the studio softbox without a noisy environment texture.
    vec3 worldView = normalize(u_cameraPosition - v_waterWorldPosition);
    vec3 reflected = reflect(-worldView, worldNormal);
    float softbox = smoothstep(0.3, 0.68, reflected.y)
        * (0.5 + 0.5 * sin(reflected.x * 5.0 + reflected.z * 3.0));
    float fresnel = pow(1.0 - max(dot(worldNormal, worldView), 0.0), 4.0);
    vec3 color = baseColor * illumination;
    color += vec3(0.26, 0.54, 0.54) * softbox * (0.027 + fresnel * 0.13)
        * u_waterSkyIntensity;
    color += directGlint;

    // Sparse curved wavelets drift downstream, with soft ends instead of noisy white speckles.
    float along = v_waterUV.y * 89.0 - time * 0.18;
    float waveCell = floor(along / 5.3);
    float waveAlong = mod(along, 5.3) - 2.65;
    float waveAcross = (v_waterUV.x - 0.5) * 4.85 - sin(waveCell * 2.4) * 0.78;
    float strokeCurve = cos(waveAcross * 1.5) * 0.19;
    float stroke = softStroke(waveAlong - strokeCurve, 0.025);
    float strokeEnds = 1.0 - smoothstep(0.36, 0.91, abs(waveAcross));
    float ripple = stroke * strokeEnds * smoothstep(0.05, 0.2, shoreDistance);
    color += vec3(0.48, 0.79, 0.7) * ripple * 0.18 * (0.3 + sunlight * 0.7)
        * u_waterSkyIntensity;

    // The shore line is restrained, continuous and contained inside the authored river banks.
    float edgeCenter = 0.019 + sin(v_waterUV.y * 105.0 - time * 0.2) * 0.0035
        + sin(v_waterUV.y * 187.0 + time * 0.14) * 0.0017;
    float foam = softStroke(shoreDistance - edgeCenter, 0.0035);
    float foamRhythm = 0.7 + sin(v_waterUV.y * 63.0 + time * 0.13) * 0.3;
    vec3 foamColor = vec3(0.6, 0.78, 0.64) * illumination;
    color = mix(color, foamColor, foam * foamRhythm * 0.48);
    fragmentColor = vec4(color, 1.0);
}`;
    return new Hilo3d.MaterialDefinition({
        id: 'example:csm-toy-resin-water-v3',
        family: 'custom',
        domain: 'surface',
        shaderRevision: 'csm-toy-resin-water-v3',
        // A lit definition participates in the shared light count, CSM and spot-shadow variants.
        // Match the PBR fixtures' inverse-square attenuation and finite range fade. The legacy
        // falloff kept distant lights bright beyond their shadow cameras, exposing hard lit bands.
        staticFeatures: { LIGHT_MODEL: 1, USE_PHYSICS_LIGHT: 1 },
        passes: [
            {
                role: 'forward',
                shader: {
                    kind: 'glsl',
                    vertexSource,
                    fragmentSource,
                    sourceRevision: 'csm-toy-resin-water-v3'
                },
                fragmentOutput: 'color',
                state: Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
                fallback: 'required'
            }
        ]
    });
}

/** Independent water motion; pausing preserves its phase for repeatable shadow comparisons. */
export interface CsmToyWater {
    readonly material: Hilo3d.MaterialInstance;
    tick(dt: number): void;
    setMotion(enabled: boolean): void;
    /** Dim sky reflection and shore highlights while preserving actual lamp illumination. */
    setDusk(enabled: boolean): void;
}

/** Portable, opaque toy water with shared CSM/spot reception and no sampled color textures. */
export function createCsmToyWater(): CsmToyWater {
    Hilo3d.registerUniformBlockBinding('CsmToyWaterBlock');
    const block = Hilo3d.UniformBuffer.fromSchema(
        Hilo3d.createStd140Layout({ u_waterTime: 'float', u_waterSkyIntensity: 'float' }),
        { u_waterTime: 0, u_waterSkyIntensity: 1 }
    );
    const material = new Hilo3d.MaterialInstance(createWaterDefinition(), {
        name: 'Little Sunshine / moving resin river',
        uniformBlocks: { CsmToyWaterBlock: block }
    });
    let elapsed = 0;
    let enabled = true;
    const skyIntensity = new CsmToyTransition(1, 5000);
    return {
        material,
        tick(dt: number): void {
            block.set('u_waterSkyIntensity', skyIntensity.sample());
            if (!enabled) return;
            elapsed += Math.max(0, Math.min(dt, 50)) / 1000;
            block.set('u_waterTime', elapsed);
        },
        setMotion(value: boolean): void {
            enabled = value;
        },
        setDusk(value: boolean): void {
            skyIntensity.setTarget(value ? 0.12 : 1);
        }
    };
}
