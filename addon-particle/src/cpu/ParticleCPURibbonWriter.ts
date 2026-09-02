import {
    Geometry,
    GeometryData,
    RenderMesh,
    ShaderMaterial,
    Sphere,
    TRIANGLES,
    type Bounds,
    type MaterialBindingInfo,
    type MaterialCompositing,
    type Renderer
} from 'hilo3d';
import portableCoordinatesSource from '../internal/portableCoordinates.js';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan.js';
import type { ParticleRibbonRendererDefinition, ParticleVector3 } from '../ParticleTypes.js';
import type { ParticleCPUState } from './ParticleCPUState.js';
import type { ParticleCPUWriterQuality } from './ParticleCPUWriter.js';

const SEGMENT_FLOAT_STRIDE = 16;
const SEGMENT_BYTE_STRIDE = SEGMENT_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
let nextParticleCPURibbonBufferId = 1;

class ParticleRibbonGeometry extends Geometry {
    readonly #particleBounds: Bounds;
    readonly #particleSphere = new Sphere();

    constructor(parameters: ConstructorParameters<typeof Geometry>[0], bounds: Readonly<Bounds>) {
        super(parameters);
        this.#particleBounds = { ...bounds };
    }

    override getLocalBounds(): Bounds {
        return this.#particleBounds;
    }

    override getLocalSphereBounds(): Sphere {
        const bounds = this.#particleBounds;
        this.#particleSphere.center.set(bounds.x, bounds.y, bounds.z);
        this.#particleSphere.radius = Math.hypot(bounds.width, bounds.height, bounds.depth) * 0.5;
        return this.#particleSphere;
    }

    setParticleBounds(bounds: Readonly<Bounds>): void {
        Object.assign(this.#particleBounds, bounds);
    }
}

function binding(source: GeometryData): MaterialBindingInfo {
    return { get: () => source };
}

function glslFloat(value: number): string {
    return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function compositing(renderer: ParticleRibbonRendererDefinition): MaterialCompositing {
    switch (renderer.blend ?? 'alpha') {
        case 'alpha':
            return { mode: 'alpha-blend', premultiplied: false };
        case 'premultiplied-alpha':
            return { mode: 'alpha-blend', premultiplied: true };
        case 'additive':
            return { mode: 'additive', premultiplied: true };
    }
}

function vertexSource(
    renderer: ParticleRibbonRendererDefinition,
    simulationSpace: 'local' | 'world'
): string {
    const worldUp = renderer.facing === 'world-up';
    const repeating = renderer.uvMode === 'repeat';
    return `#version 300 es
precision highp float;
in vec2 a_ribbonCorner;
in vec2 a_ribbonUV;
in vec4 a_ribbonStartWidth;
in vec4 a_ribbonEndWidth;
in vec4 a_ribbonStartColor;
in vec4 a_ribbonEndColor;
out vec2 v_particleUV;
out vec4 v_particleColor;
out vec3 v_particleNormal;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
};
void main(void) {
    vec4 startWorld = ${simulationSpace === 'local' ? 'u_modelMatrix * vec4(a_ribbonStartWidth.xyz, 1.0)' : 'vec4(a_ribbonStartWidth.xyz, 1.0)'};
    vec4 endWorld = ${simulationSpace === 'local' ? 'u_modelMatrix * vec4(a_ribbonEndWidth.xyz, 1.0)' : 'vec4(a_ribbonEndWidth.xyz, 1.0)'};
    vec4 startView = u_viewMatrix * startWorld;
    vec4 endView = u_viewMatrix * endWorld;
    float along = a_ribbonCorner.y;
    vec4 center = mix(startView, endView, along);
    float width = mix(a_ribbonStartWidth.w, a_ribbonEndWidth.w, along) * ${glslFloat(renderer.widthScale ?? 1)};
    vec3 segment = endView.xyz - startView.xyz;
    vec3 side = ${
        worldUp
            ? 'normalize((u_viewMatrix * vec4(normalize(cross(normalize(endWorld.xyz - startWorld.xyz), vec3(0.0, 1.0, 0.0))), 0.0)).xyz + vec3(0.000001, 0.0, 0.0))'
            : 'normalize(cross(normalize(segment + vec3(0.000001)), vec3(0.0, 0.0, 1.0)) + vec3(0.000001, 0.0, 0.0))'
    };
    vec3 viewPosition = center.xyz + side * a_ribbonCorner.x * width;
    gl_Position = u_projectionMatrix * vec4(viewPosition, 1.0);
    float segmentLength = length(endWorld.xyz - startWorld.xyz);
    v_particleUV = vec2(a_ribbonUV.x, ${repeating ? `a_ribbonUV.y * segmentLength * ${glslFloat(renderer.tilesPerUnit ?? 1)}` : 'a_ribbonUV.y'});
    v_particleColor = mix(a_ribbonStartColor, a_ribbonEndColor, along);
    v_particleNormal = normalize(cross(segment, side));
}`;
}

function fragmentSource(renderer: ParticleRibbonRendererDefinition): string {
    const textured = renderer.texture !== undefined && renderer.texture !== null;
    const lighting =
        renderer.lighting === 'lambert'
            ? `vec3 irradiance = u_ambientLightsColor;
    for (int index = 0; index < 8; index++) {
        vec3 direction = normalize(-u_directionalLightsInfo[index] + vec3(0.000001));
        irradiance += u_directionalLightsColor[index] * max(dot(normalize(v_particleNormal), direction), 0.0);
    }
    color.rgb *= irradiance;`
            : '';
    const lightBlock =
        renderer.lighting === 'lambert'
            ? `layout(std140) uniform LightBlock {
    vec3 u_ambientLightsColor;
    vec3 u_directionalLightsColor[8];
    vec3 u_directionalLightsInfo[8];
};`
            : '';
    const premultiply =
        renderer.blend === 'premultiplied-alpha' || renderer.blend === 'additive'
            ? 'color.rgb *= color.a;'
            : '';
    return `#version 300 es
precision highp float;
in vec2 v_particleUV;
in vec4 v_particleColor;
in vec3 v_particleNormal;
${textured ? 'uniform sampler2D u_particleTexture;' : ''}
${lightBlock}
${textured ? portableCoordinatesSource : ''}
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    vec4 color = ${textured ? 'texture(u_particleTexture, hiloTextureUV(v_particleUV))' : 'vec4(1.0)'} * v_particleColor;
    if (color.a <= 0.00001) discard;
    ${lighting}
    ${premultiply}
    fragmentColor = color;
}`;
}

function compareTopology(left: number, right: number, state: ParticleCPUState): number {
    const ribbonIds = state.u32('ribbon-id');
    const ribbonDifference = (ribbonIds[left] ?? 0) - (ribbonIds[right] ?? 0);
    if (ribbonDifference !== 0) return ribbonDifference;
    const stableIds = state.u32('stable-id');
    return (stableIds[left] ?? 0) - (stableIds[right] ?? 0);
}

/** Internal CPU ribbon/trail segment compactor and one-draw bridge. */
export class ParticleCPURibbonWriter {
    readonly mesh: RenderMesh;
    readonly #state: ParticleCPUState;
    readonly #segmentData: Float32Array;
    readonly #segmentSources: readonly GeometryData[];
    readonly #topologyIndices: Uint32Array;
    readonly #geometry: ParticleRibbonGeometry;
    readonly #dynamicBounds: Bounds;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        state: ParticleCPUState,
        renderer: ParticleRibbonRendererDefinition,
        rendererIndex: number
    ) {
        this.#state = state;
        this.#segmentData = new Float32Array(plan.definition.capacity * SEGMENT_FLOAT_STRIDE);
        this.#topologyIndices = new Uint32Array(plan.definition.capacity);
        const bufferViewId = `particle-ribbon-segment:${String(nextParticleCPURibbonBufferId++)}:${plan.layoutHash}:${String(rendererIndex)}`;
        const source = (offset: number): GeometryData =>
            new GeometryData(this.#segmentData, 4, {
                bufferViewId,
                stride: SEGMENT_BYTE_STRIDE,
                offset,
                stepMode: 'instance'
            });
        const startWidth = source(0);
        const endWidth = source(16);
        const startColor = source(32);
        const endColor = source(48);
        this.#segmentSources = Object.freeze([startWidth, endWidth, startColor, endColor]);
        const geometry = new ParticleRibbonGeometry(
            {
                mode: TRIANGLES,
                isStatic: false,
                vertices: new GeometryData(
                    new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]),
                    2
                ),
                uvs: new GeometryData(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2)
            },
            plan.bounds
        );
        this.#geometry = geometry;
        this.#dynamicBounds = { ...plan.bounds };
        const material = new ShaderMaterial({
            sourceRevision: `particle-cpu-ribbon:${plan.layoutHash}:${String(rendererIndex)}`,
            vs: vertexSource(renderer, plan.definition.simulationSpace),
            fs: fragmentSource(renderer),
            compositing: compositing(renderer),
            temporalReactiveFactor: 1,
            cullMode: 'none',
            state: {
                cullMode: 'none',
                depthTest: renderer.depthTest ?? true,
                depthWrite: renderer.depthWrite ?? false
            },
            attributes: {
                a_ribbonCorner: { get: mesh => mesh.geometry?.vertices },
                a_ribbonUV: { get: mesh => mesh.geometry?.uvs },
                a_ribbonStartWidth: binding(startWidth),
                a_ribbonEndWidth: binding(endWidth),
                a_ribbonStartColor: binding(startColor),
                a_ribbonEndColor: binding(endColor)
            },
            ...(renderer.texture === undefined || renderer.texture === null
                ? {}
                : {
                      uniforms: {
                          u_particleTexture: { get: () => renderer.texture }
                      }
                  })
        });
        this.mesh = new RenderMesh({
            name: `${plan.definition.name}:${renderer.type}:${String(rendererIndex)}`,
            geometry,
            material,
            frustumTest: true,
            castShadows: false,
            receiveShadows: renderer.lighting === 'lambert',
            renderOrder: renderer.renderOrder ?? 0,
            instanceCount: 1,
            visible: false
        });
    }

    sync(_cameraPosition: ParticleVector3, quality: Readonly<ParticleCPUWriterQuality>): void {
        const aliveCount = quality.enabled && quality.ribbons ? this.#state.aliveCount : 0;
        for (let index = 0; index < aliveCount; index += 1) this.#topologyIndices[index] = index;
        for (let root = Math.floor(aliveCount / 2) - 1; root >= 0; root -= 1) {
            this.siftDown(root, aliveCount);
        }
        for (let end = aliveCount - 1; end > 0; end -= 1) {
            const first = this.#topologyIndices[0] ?? 0;
            this.#topologyIndices[0] = this.#topologyIndices[end] ?? 0;
            this.#topologyIndices[end] = first;
            this.siftDown(0, end);
        }
        const positions = this.#state.f32('position');
        const sizes = this.#state.f32('size');
        const colors = this.#state.f32('color');
        const ribbonIds = this.#state.u32('ribbon-id');
        let segmentCount = 0;
        for (let order = 1; order < aliveCount; order += 1) {
            const start = this.#topologyIndices[order - 1] ?? 0;
            const end = this.#topologyIndices[order] ?? 0;
            if ((ribbonIds[start] ?? 0) !== (ribbonIds[end] ?? 0)) continue;
            const start3 = start * 3;
            const end3 = end * 3;
            const start4 = start * 4;
            const end4 = end * 4;
            const output = segmentCount * SEGMENT_FLOAT_STRIDE;
            this.#segmentData[output] = positions[start3] ?? 0;
            this.#segmentData[output + 1] = positions[start3 + 1] ?? 0;
            this.#segmentData[output + 2] = positions[start3 + 2] ?? 0;
            this.#segmentData[output + 3] = sizes[start] ?? 1;
            this.#segmentData[output + 4] = positions[end3] ?? 0;
            this.#segmentData[output + 5] = positions[end3 + 1] ?? 0;
            this.#segmentData[output + 6] = positions[end3 + 2] ?? 0;
            this.#segmentData[output + 7] = sizes[end] ?? 1;
            for (let component = 0; component < 4; component += 1) {
                this.#segmentData[output + 8 + component] = colors[start4 + component] ?? 1;
                this.#segmentData[output + 12 + component] = colors[end4 + component] ?? 1;
            }
            segmentCount++;
        }
        for (const source of this.#segmentSources) source.isDirty = true;
        if (this.#state.computeBounds(this.#dynamicBounds) !== null) {
            this.#geometry.setParticleBounds(this.#dynamicBounds);
        }
        if (this.mesh.instanceCount !== Math.max(1, segmentCount)) {
            this.mesh.instanceCount = Math.max(1, segmentCount);
            if (this.mesh.geometry) this.mesh.geometry.isDirty = true;
        }
        this.mesh.visible = segmentCount > 0;
    }

    destroy(renderer: Renderer): void {
        renderer.resourceManager.destroyMesh(this.mesh);
    }

    private siftDown(root: number, count: number): void {
        while (root * 2 + 1 < count) {
            let child = root * 2 + 1;
            if (
                child + 1 < count &&
                compareTopology(
                    this.#topologyIndices[child] ?? 0,
                    this.#topologyIndices[child + 1] ?? 0,
                    this.#state
                ) < 0
            ) {
                child++;
            }
            if (
                compareTopology(
                    this.#topologyIndices[root] ?? 0,
                    this.#topologyIndices[child] ?? 0,
                    this.#state
                ) >= 0
            ) {
                return;
            }
            const value = this.#topologyIndices[root] ?? 0;
            this.#topologyIndices[root] = this.#topologyIndices[child] ?? 0;
            this.#topologyIndices[child] = value;
            root = child;
        }
    }
}
