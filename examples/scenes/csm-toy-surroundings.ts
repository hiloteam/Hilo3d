import * as Hilo3d from '../../src/Hilo3d';

function shaderChunk(name: string): string {
    const source = Hilo3d.Shader.shaders[name];
    if (!source) throw new Error(`Missing portable seaside shader chunk ${name}`);
    return source;
}

const seasideBlock = `layout(std140) uniform CsmToySeasideBlock {
    float u_seasideTime;
    float u_seasideDusk;
    float u_weatherCover;
    float u_lightningFlash;
};`;

function createOceanDefinition(): Hilo3d.MaterialDefinition {
    const blocks = shaderChunk('chunk/uniformBlocks.glsl');
    const vertexSource = `#version 300 es
precision highp float;
precision highp int;
#define HILO_VERTEX_SHADER
${blocks}
in vec3 a_position;
out vec3 v_oceanWorldPosition;
out vec3 v_oceanViewPosition;
void main() {
    vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
    v_oceanWorldPosition = worldPosition.xyz;
    v_oceanViewPosition = (u_viewMatrix * worldPosition).xyz;
    gl_Position = u_viewProjectionMatrix * worldPosition;
}`;
    const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
${blocks}
${seasideBlock}
in vec3 v_oceanWorldPosition;
in vec3 v_oceanViewPosition;
layout(location = 0) out vec4 fragmentColor;
#if defined(HILO_SHADOW_ATLAS) && (defined(HILO_DIRECTIONAL_LIGHTS_SMC) || defined(HILO_SPOT_LIGHTS_SMC) || defined(HILO_POINT_LIGHTS_SMC))
uniform highp sampler2DShadow u_shadowAtlas;
#endif
// Shared atlas lookup owns the single RenderTarget UV normalization for both backends.
${shaderChunk('method/getShadow.glsl')}

float roundedTrayDistance(vec2 surface) {
    vec2 q = abs(surface - vec2(0.0, -10.0)) - vec2(22.0, 43.0);
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 2.0;
}

float oceanStroke(float distanceToStroke, float width) {
    float pixelWidth = max(fwidth(distanceToStroke), 0.012);
    return 1.0 - smoothstep(width, width + pixelWidth, abs(distanceToStroke));
}

void main() {
    vec2 surface = v_oceanWorldPosition.xz;
    float time = u_seasideTime;
    float dusk = u_seasideDusk;
    float shoreDistance = max(roundedTrayDistance(surface), 0.0);
    float shallow = exp(-shoreDistance * 0.055);
    float patches = sin(surface.x * 0.065 + sin(surface.y * 0.048) * 1.8 + time * 0.028)
        + sin(surface.y * 0.085 + surface.x * 0.023 - time * 0.045);
    float celPatch = smoothstep(-0.5, -0.3, patches) * 0.55
        + smoothstep(0.85, 1.05, patches) * 0.45;
    vec3 dayColor = mix(vec3(0.035, 0.28, 0.46), vec3(0.08, 0.46, 0.49), shallow);
    dayColor += vec3(0.017, 0.047, 0.048) * celPatch;
    vec3 duskColor = mix(vec3(0.009, 0.037, 0.095), vec3(0.018, 0.105, 0.15), shallow);
    duskColor += vec3(0.003, 0.012, 0.021) * celPatch;
    vec3 baseColor = mix(dayColor, duskColor, dusk);

    vec2 slope = vec2(0.19, 0.13) * cos(dot(surface, vec2(0.19, 0.13)) - time * 0.28) * 0.045
        + vec2(-0.11, 0.23) * cos(dot(surface, vec2(-0.11, 0.23)) + time * 0.19) * 0.028;
    vec3 worldNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 normal = normalize(mat3(u_viewMatrix) * worldNormal);
    vec3 viewDirection = normalize(-v_oceanViewPosition);
    vec3 illumination = mix(vec3(0.48, 0.57, 0.62), vec3(0.42, 0.49, 0.64), dusk);
    vec3 glint = vec3(0.0);
    float sunlight = 1.0;
    #ifdef HILO_DIRECTIONAL_LIGHTS
    for (int lightIndex = 0; lightIndex < HILO_DIRECTIONAL_LIGHTS; lightIndex++) {
        vec3 lightDirection = normalize(-u_directionalLightsInfo[lightIndex]);
        float visibility = 1.0;
        #if defined(HILO_SHADOW_ATLAS) && defined(HILO_DIRECTIONAL_LIGHTS_SMC)
        if (lightIndex < HILO_DIRECTIONAL_LIGHTS_SMC) {
            float bias = max(u_directionalLightsShadowBias[lightIndex].y
                * (1.0 - dot(normal, lightDirection)), u_directionalLightsShadowBias[lightIndex].x);
            visibility = getDirectionalShadowAtlas(lightIndex, bias, v_oceanViewPosition);
        }
        #endif
        vec3 lightColor = u_directionalLightsColor[lightIndex];
        illumination += max(dot(normal, lightDirection), 0.0) * lightColor * visibility * 0.23;
        vec3 halfwayDirection = normalize(viewDirection + lightDirection);
        float specular = pow(max(dot(normal, halfwayDirection), 0.0), 160.0);
        glint += lightColor * specular * visibility * 0.075;
        sunlight = min(sunlight, visibility);
    }
    #endif

    // Broad enamel-like color shapes and a few soft strokes keep the sea quiet around the toys.
    vec3 color = baseColor * illumination + glint;
    vec2 waveGrid = surface / vec2(18.0, 25.0) + vec2(0.0, -time * 0.008);
    float row = floor(waveGrid.y);
    waveGrid.x += sin(row * 2.7) * 0.3;
    vec2 cell = fract(waveGrid) - 0.5;
    float curvedStroke = cell.y - cos(cell.x * 7.0) * 0.052;
    float stroke = oceanStroke(curvedStroke, 0.0018);
    float strokeEnds = 1.0 - smoothstep(0.14, 0.29, abs(cell.x));
    float distanceFade = 1.0 - smoothstep(100.0, 280.0, length(v_oceanViewPosition));
    float wavelets = stroke * strokeEnds * distanceFade;
    vec3 foamColor = mix(vec3(0.4, 0.76, 0.79), vec3(0.075, 0.21, 0.31), dusk);
    color += foamColor * wavelets * 0.2 * (0.3 + sunlight * 0.7);

    // Rounded rings hug the actual tray footprint instead of repeating noisy white foam.
    float shoreWobble = sin(surface.x * 0.32 + surface.y * 0.21 - time * 0.23) * 0.16;
    float contactFoam = oceanStroke(shoreDistance - 0.7 - shoreWobble, 0.16);
    float outerFoam = oceanStroke(shoreDistance - 3.2 - shoreWobble * 1.4, 0.075);
    float foamRhythm = 0.6 + 0.4 * sin(surface.x * 0.17 - surface.y * 0.11 + 1.1);
    float shoreFoam = contactFoam * 0.55 + outerFoam * foamRhythm * 0.23;
    color = mix(color, foamColor * (0.4 + sunlight * 0.6), shoreFoam);

    float horizon = smoothstep(140.0, 480.0, length(v_oceanViewPosition));
    vec3 horizonColor = mix(vec3(0.54, 0.77, 0.85), vec3(0.34, 0.175, 0.095), dusk);
    color = mix(color, horizonColor, horizon * 0.98);
    color = mix(color, color * vec3(0.62, 0.73, 0.85), u_weatherCover * 0.55);
    color += vec3(0.28, 0.38, 0.55) * u_lightningFlash;
    fragmentColor = vec4(color, 1.0);
}`;
    return new Hilo3d.MaterialDefinition({
        id: 'example:csm-toy-cartoon-ocean-v1',
        family: 'custom',
        domain: 'surface',
        shaderRevision: 'csm-toy-cartoon-ocean-v1',
        staticFeatures: { LIGHT_MODEL: 1 },
        passes: [
            {
                role: 'forward',
                shader: {
                    kind: 'glsl',
                    vertexSource,
                    fragmentSource,
                    sourceRevision: 'csm-toy-cartoon-ocean-v1'
                },
                fragmentOutput: 'color',
                state: Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
                fallback: 'required'
            }
        ]
    });
}

function createSkyDefinition(): Hilo3d.MaterialDefinition {
    const blocks = shaderChunk('chunk/uniformBlocks.glsl');
    const vertexSource = `#version 300 es
precision highp float;
precision highp int;
#define HILO_VERTEX_SHADER
${blocks}
in vec3 a_position;
out vec3 v_skyDirection;
void main() {
    v_skyDirection = a_position;
    vec3 worldPosition = u_cameraPosition + a_position * 400.0;
    gl_Position = u_viewProjectionMatrix * vec4(worldPosition, 1.0);
    gl_Position.z = mix(0.999999, -0.999999, u_reversedDepth) * gl_Position.w;
}`;
    const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
${seasideBlock}
in vec3 v_skyDirection;
layout(location = 0) out vec4 fragmentColor;

float cloudBand(float longitude, float elevation, float height, float repeats, float offset) {
    float along = longitude / 6.2831853 * repeats + offset + u_seasideTime * 0.0018;
    float local = fract(along) - 0.5;
    float y = elevation - height;
    float cloud = length(vec2(local / 0.245, y / 0.016));
    cloud = min(cloud, length(vec2((local + 0.105) / 0.095, (y - 0.017) / 0.029)));
    cloud = min(cloud, length(vec2(local / 0.12, (y - 0.027) / 0.041)));
    cloud = min(cloud, length(vec2((local - 0.115) / 0.09, (y - 0.014) / 0.027)));
    float edge = max(fwidth(cloud), 0.035);
    return 1.0 - smoothstep(1.0 - edge, 1.0 + edge, cloud);
}

void main() {
    vec3 direction = normalize(v_skyDirection);
    float dusk = u_seasideDusk;
    float elevation = direction.y;
    float skyHeight = pow(smoothstep(-0.02, 0.65, elevation), 0.72);
    vec3 dayHorizon = vec3(0.54, 0.77, 0.85);
    vec3 dayZenith = vec3(0.12, 0.39, 0.68);
    // Compress the warm horizon belt into the visible low-angle view; blue arrives above it.
    vec3 duskHorizon = vec3(0.34, 0.175, 0.095);
    vec3 duskBelt = vec3(0.21, 0.11, 0.17);
    vec3 duskBlue = vec3(0.036, 0.061, 0.15);
    vec3 duskSky = mix(duskHorizon, duskBelt, smoothstep(0.0, 0.085, elevation));
    duskSky = mix(duskSky, duskBlue, smoothstep(0.055, 0.27, elevation));
    duskSky = mix(duskSky, vec3(0.016, 0.026, 0.085), smoothstep(0.25, 0.8, elevation));
    vec3 color = mix(mix(dayHorizon, dayZenith, skyHeight), duskSky, dusk);
    vec3 sunDirection = normalize(mix(vec3(0.7, 0.75, 0.45), vec3(0.7, 0.12, -0.7), dusk));
    float sunDistance = length(direction - sunDirection);
    float aureole = exp(-sunDistance * sunDistance * mix(10.0, 13.0, dusk));
    color += mix(vec3(0.15, 0.11, 0.035), vec3(0.34, 0.11, 0.025), dusk) * aureole;
    float sun = 1.0 - smoothstep(0.042, 0.046, sunDistance);
    color = mix(color, mix(vec3(1.0, 0.93, 0.64), vec3(1.2, 0.65, 0.2), dusk), sun);

    float longitude = atan(direction.z, direction.x);
    float clouds = cloudBand(longitude, elevation, 0.07, 6.0, 0.69) * 0.94;
    clouds = max(clouds, cloudBand(longitude, elevation, 0.19, 5.0, 0.08) * 0.88);
    clouds = max(clouds, cloudBand(longitude, elevation, 0.34, 4.0, 0.35) * 0.78);
    float cloudShading = smoothstep(0.055, 0.4, elevation);
    vec3 dayCloud = mix(vec3(0.76, 0.87, 0.9), vec3(0.98, 0.98, 0.93), cloudShading);
    vec3 duskCloud = mix(vec3(0.27, 0.145, 0.16), vec3(0.12, 0.115, 0.22), cloudShading);
    duskCloud += vec3(0.29, 0.15, 0.05) * aureole;
    color = mix(color, mix(dayCloud, duskCloud, dusk), clouds);
    vec3 overcast = mix(vec3(0.22, 0.29, 0.38), vec3(0.03, 0.047, 0.092), dusk);
    color = mix(color, overcast, u_weatherCover * 0.72);
    color = mix(color, vec3(0.72, 0.83, 1.0), u_lightningFlash * 0.72);
    fragmentColor = vec4(color, 1.0);
}`;
    return new Hilo3d.MaterialDefinition({
        id: 'example:csm-toy-cartoon-sky-v1',
        family: 'custom',
        domain: 'unlit',
        shaderRevision: 'csm-toy-cartoon-sky-v1',
        staticFeatures: { LIGHT_MODEL: 0 },
        compositing: { mode: 'alpha-blend', premultiplied: false },
        passes: [
            {
                role: 'forward',
                shader: {
                    kind: 'glsl',
                    vertexSource,
                    fragmentSource,
                    sourceRevision: 'csm-toy-cartoon-sky-v1'
                },
                fragmentOutput: 'color',
                state: {
                    ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
                    cullMode: 'front',
                    depthWrite: false
                },
                fallback: 'required'
            }
        ]
    });
}

/** Camera-independent sea and sky use the same paused clock and lighting palette. */
export interface CsmToySurroundings {
    setDusk(enabled: boolean): void;
    setWeather(type: 'clear' | 'rain' | 'snow' | 'storm'): void;
    setLightning(value: number): void;
    tick(dt: number): void;
    setMotion(enabled: boolean): void;
}

/** A portable, texture-free cartoon seascape rendered through the ordinary shared scene path. */
export function createCsmToySurroundings(parent: Hilo3d.Node): CsmToySurroundings {
    Hilo3d.registerUniformBlockBinding('CsmToySeasideBlock');
    const block = Hilo3d.UniformBuffer.fromSchema(
        Hilo3d.createStd140Layout({
            u_seasideTime: 'float',
            u_seasideDusk: 'float',
            u_weatherCover: 'float',
            u_lightningFlash: 'float'
        }),
        { u_seasideTime: 0, u_seasideDusk: 0, u_weatherCover: 0, u_lightningFlash: 0 }
    );
    const oceanMaterial = new Hilo3d.MaterialInstance(createOceanDefinition(), {
        name: 'Little Sunshine / painted cartoon sea',
        uniformBlocks: { CsmToySeasideBlock: block }
    });
    new Hilo3d.Mesh({
        name: 'Cartoon ocean',
        geometry: new Hilo3d.PlaneGeometry({ width: 1600, height: 1600 }),
        material: oceanMaterial,
        rotationX: -90,
        y: -4.05,
        castShadows: false,
        receiveShadows: true
    }).addTo(parent);
    const skyMaterial = new Hilo3d.MaterialInstance(createSkyDefinition(), {
        name: 'Little Sunshine / storybook sky',
        uniformBlocks: { CsmToySeasideBlock: block }
    });
    new Hilo3d.Mesh({
        name: 'Storybook sky',
        geometry: new Hilo3d.SphereGeometry({ radius: 1, heightSegments: 20, widthSegments: 40 }),
        material: skyMaterial,
        frustumTest: false,
        renderOrder: -1000,
        castShadows: false,
        receiveShadows: false
    }).addTo(parent);
    let elapsed = 0;
    let motionEnabled = true;
    return {
        setWeather(type: 'clear' | 'rain' | 'snow' | 'storm'): void {
            block.set(
                'u_weatherCover',
                type === 'clear' ? 0 : type === 'snow' ? 0.46 : type === 'rain' ? 0.72 : 1
            );
        },
        setLightning(value: number): void {
            block.set('u_lightningFlash', value);
        },
        setDusk(enabled: boolean): void {
            block.set('u_seasideDusk', enabled ? 1 : 0);
        },
        tick(dt: number): void {
            if (!motionEnabled) return;
            elapsed += Math.max(0, Math.min(dt, 50)) / 1000;
            block.set('u_seasideTime', elapsed);
        },
        setMotion(enabled: boolean): void {
            motionEnabled = enabled;
        }
    };
}
