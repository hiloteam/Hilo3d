import Mesh from '../../core/Mesh';
import Geometry, { type Bounds } from '../../geometry/Geometry';
import GeometryData from '../../geometry/GeometryData';
import Sphere from '../../math/Sphere';
import ShaderMaterial from '../../material/ShaderMaterial';
import type { MaterialBindingInfo } from '../../material/MaterialInstance';
import type { MaterialCompositing, MaterialCoverage } from '../../material/MaterialDefinition';
import type { Renderer } from '../../render/Renderer';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type {
    ParticleMeshRendererDefinition,
    ParticleSortMode,
    ParticleVector3
} from '../ParticleTypes';
import type { ParticleCPUState } from './ParticleCPUState';

const INSTANCE_FLOAT_STRIDE = 16;
const INSTANCE_BYTE_STRIDE = INSTANCE_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;

class ParticleMeshGeometry extends Geometry {
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

function attributeBinding(source: GeometryData): MaterialBindingInfo {
    return { get: () => source };
}

function coverage(renderer: ParticleMeshRendererDefinition): MaterialCoverage {
    return renderer.coverage === 'masked'
        ? { mode: 'mask', cutoff: renderer.alphaCutoff ?? 0.5 }
        : { mode: 'opaque' };
}

function compositing(renderer: ParticleMeshRendererDefinition): MaterialCompositing {
    if ((renderer.coverage ?? 'transparent') !== 'transparent') return { mode: 'opaque' };
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
    renderer: ParticleMeshRendererDefinition,
    simulationSpace: 'local' | 'world'
): string {
    const velocityOrientation = renderer.orientation === 'velocity';
    return `#version 300 es
precision highp float;
in vec3 a_meshPosition;
in vec3 a_meshNormal;
in vec2 a_meshUV;
in vec4 a_particlePositionSize;
in vec4 a_particleColor;
in float a_particleRotation;
in vec3 a_particleVelocity;
in vec3 a_particlePreviousPosition;
out vec2 v_particleUV;
out vec4 v_particleColor;
out vec3 v_particleNormal;

layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    mat4 u_previousViewMatrix;
    mat4 u_previousProjectionMatrix;
    mat4 u_previousViewProjectionMatrix;
};
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
    mat4 u_previousModelMatrix;
    mat3 u_normalWorldMatrix;
    vec4 u_objectIdColor;
    vec4 u_modelHistoryParams;
};

mat3 particleBasis(vec3 velocity, float rotation) {
    float sine = sin(rotation);
    float cosine = cos(rotation);
    mat3 spin = mat3(cosine, sine, 0.0, -sine, cosine, 0.0, 0.0, 0.0, 1.0);
    ${
        velocityOrientation
            ? `vec3 forward = length(velocity) > 0.000001 ? normalize(velocity) : vec3(0.0, 1.0, 0.0);
    vec3 reference = abs(forward.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(reference, forward));
    vec3 up = cross(forward, side);
    return mat3(side, forward, up) * spin;`
            : 'return spin;'
    }
}

void main(void) {
    mat3 basis = particleBasis(a_particleVelocity, a_particleRotation);
    vec3 localPosition = a_particlePositionSize.xyz + basis * a_meshPosition * a_particlePositionSize.w;
    vec4 worldPosition = ${simulationSpace === 'local' ? 'u_modelMatrix * vec4(localPosition, 1.0)' : 'vec4(localPosition, 1.0)'};
    gl_Position = u_viewProjectionMatrix * worldPosition;
    v_particleUV = a_meshUV;
    v_particleColor = a_particleColor;
    v_particleNormal = normalize(${simulationSpace === 'local' ? 'u_normalWorldMatrix * basis * a_meshNormal' : 'basis * a_meshNormal'});
}`;
}

function fragmentSource(renderer: ParticleMeshRendererDefinition, hasTexture: boolean): string {
    const textureDeclaration = hasTexture ? 'uniform sampler2D u_particleTexture;' : '';
    const textureSample = hasTexture
        ? 'vec4 texel = texture(u_particleTexture, v_particleUV);'
        : 'vec4 texel = vec4(1.0);';
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
    const cutoff = renderer.coverage === 'masked' ? (renderer.alphaCutoff ?? 0.5) : 0.00001;
    const premultiply =
        (renderer.coverage ?? 'transparent') === 'transparent' &&
        renderer.blend !== undefined &&
        renderer.blend !== 'alpha'
            ? 'color.rgb *= color.a;'
            : '';
    return `#version 300 es
precision highp float;
in vec2 v_particleUV;
in vec4 v_particleColor;
in vec3 v_particleNormal;
${textureDeclaration}
${lightBlock}
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    ${textureSample}
    vec4 color = texel * v_particleColor;
    if (color.a <= ${String(cutoff)}) discard;
    ${lighting}
    ${premultiply}
    fragmentColor = color;
}`;
}

function motionVertexSource(simulationSpace: 'local' | 'world'): string {
    return `#version 300 es
precision highp float;
in vec3 a_meshPosition;
in vec2 a_meshUV;
in vec4 a_particlePositionSize;
in vec4 a_particleColor;
in float a_particleRotation;
in vec3 a_particlePreviousPosition;
out vec4 v_currentClipPosition;
out vec4 v_previousClipPosition;
out float v_currentViewDepth;
out float v_previousViewDepth;
flat out float v_motionHistoryValid;
out vec2 v_motionUV;
out float v_motionAlpha;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix; mat4 u_projectionMatrix; mat4 u_viewProjectionMatrix;
    mat4 u_previousViewMatrix; mat4 u_previousProjectionMatrix; mat4 u_previousViewProjectionMatrix;
};
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix; mat4 u_previousModelMatrix; mat3 u_normalWorldMatrix;
    vec4 u_objectIdColor; vec4 u_modelHistoryParams;
};
void main(void) {
    float sine = sin(a_particleRotation); float cosine = cos(a_particleRotation);
    vec3 offset = mat3(cosine, sine, 0.0, -sine, cosine, 0.0, 0.0, 0.0, 1.0) * a_meshPosition * a_particlePositionSize.w;
    vec4 currentWorld = ${simulationSpace === 'local' ? 'u_modelMatrix * vec4(a_particlePositionSize.xyz + offset, 1.0)' : 'vec4(a_particlePositionSize.xyz + offset, 1.0)'};
    vec4 previousWorld = ${simulationSpace === 'local' ? 'u_previousModelMatrix * vec4(a_particlePreviousPosition + offset, 1.0)' : 'vec4(a_particlePreviousPosition + offset, 1.0)'};
    v_currentClipPosition = u_viewProjectionMatrix * currentWorld;
    v_previousClipPosition = u_previousViewProjectionMatrix * previousWorld;
    v_currentViewDepth = -(u_viewMatrix * currentWorld).z;
    v_previousViewDepth = -(u_previousViewMatrix * previousWorld).z;
    v_motionHistoryValid = u_modelHistoryParams.x;
    v_motionUV = a_meshUV;
    v_motionAlpha = a_particleColor.a;
    gl_Position = v_currentClipPosition;
}`;
}

function motionFragmentSource(
    renderer: ParticleMeshRendererDefinition,
    hasTexture: boolean
): string {
    return `#version 300 es
precision highp float;
in vec4 v_currentClipPosition;
in vec4 v_previousClipPosition;
in float v_currentViewDepth;
in float v_previousViewDepth;
flat in float v_motionHistoryValid;
in vec2 v_motionUV;
in float v_motionAlpha;
${hasTexture ? 'uniform sampler2D u_particleTexture;' : ''}
layout(location = 0) out vec4 fragmentColor;
#ifdef HILO_TEMPORAL_REACTIVE_MASK
layout(location = 1) out float hilo_ReactiveMask;
#endif
void main(void) {
    float coverageAlpha = v_motionAlpha * ${hasTexture ? 'texture(u_particleTexture, v_motionUV).a' : '1.0'};
    ${renderer.coverage === 'masked' ? `if (coverageAlpha <= ${String(renderer.alphaCutoff ?? 0.5)}) discard;` : ''}
    float currentLogDepth = log2(1.0 + max(v_currentViewDepth, 0.0));
    if (v_motionHistoryValid < 0.5 || v_currentClipPosition.w <= 0.000001 || v_previousClipPosition.w <= 0.000001) {
        fragmentColor = vec4(0.0, 0.0, -1.0, currentLogDepth);
    } else {
        vec2 currentUV = v_currentClipPosition.xy / v_currentClipPosition.w * 0.5 + 0.5;
        vec2 previousUV = v_previousClipPosition.xy / v_previousClipPosition.w * 0.5 + 0.5;
        fragmentColor = vec4(currentUV - previousUV, log2(1.0 + max(v_previousViewDepth, 0.0)), currentLogDepth);
    }
#ifdef HILO_TEMPORAL_REACTIVE_MASK
    hilo_ReactiveMask = 0.0;
#endif
}`;
}

function compareParticle(
    left: number,
    right: number,
    mode: ParticleSortMode,
    state: ParticleCPUState,
    cameraPosition: ParticleVector3
): number {
    const stableIds = state.u32('stable-id');
    let difference = 0;
    if (mode === 'distance') {
        const positions = state.f32('position');
        const leftOffset = left * 3;
        const rightOffset = right * 3;
        const leftDistance =
            ((positions[leftOffset] ?? 0) - cameraPosition[0]) ** 2 +
            ((positions[leftOffset + 1] ?? 0) - cameraPosition[1]) ** 2 +
            ((positions[leftOffset + 2] ?? 0) - cameraPosition[2]) ** 2;
        const rightDistance =
            ((positions[rightOffset] ?? 0) - cameraPosition[0]) ** 2 +
            ((positions[rightOffset + 1] ?? 0) - cameraPosition[1]) ** 2 +
            ((positions[rightOffset + 2] ?? 0) - cameraPosition[2]) ** 2;
        difference = rightDistance - leftDistance;
    } else if (mode !== 'none') {
        const ages = state.f32('age');
        difference =
            mode === 'youngest'
                ? (ages[left] ?? 0) - (ages[right] ?? 0)
                : (ages[right] ?? 0) - (ages[left] ?? 0);
    }
    return difference !== 0 ? difference : (stableIds[left] ?? 0) - (stableIds[right] ?? 0);
}

/** Internal CPU mesh-bucket instance writer. */
export class ParticleCPUMeshInstanceWriter {
    readonly mesh: Mesh;
    readonly #state: ParticleCPUState;
    readonly #renderer: ParticleMeshRendererDefinition;
    readonly #bucketIndex: number;
    readonly #instanceData: Float32Array;
    readonly #instanceSources: readonly GeometryData[];
    readonly #sortIndices: Uint32Array;
    readonly #geometry: ParticleMeshGeometry;
    readonly #dynamicBounds: Bounds;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        state: ParticleCPUState,
        renderer: ParticleMeshRendererDefinition,
        rendererIndex: number,
        bucketIndex: number
    ) {
        this.#state = state;
        this.#renderer = renderer;
        this.#bucketIndex = bucketIndex;
        this.#instanceData = new Float32Array(plan.definition.capacity * INSTANCE_FLOAT_STRIDE);
        this.#sortIndices = new Uint32Array(plan.definition.capacity);
        const bufferViewId = `particle-mesh-instance:${plan.layoutHash}:${String(rendererIndex)}:${String(bucketIndex)}`;
        const source = (size: 1 | 3 | 4, offset: number): GeometryData =>
            new GeometryData(this.#instanceData, size, {
                bufferViewId,
                stride: INSTANCE_BYTE_STRIDE,
                offset,
                stepMode: 'instance'
            });
        const positionSize = source(4, 0);
        const color = source(4, 16);
        const rotation = source(1, 32);
        const velocity = source(3, 36);
        const previousPosition = source(3, 48);
        this.#instanceSources = Object.freeze([
            positionSize,
            color,
            rotation,
            velocity,
            previousPosition
        ]);
        const asset = renderer.meshes[bucketIndex];
        if (!asset) throw new RangeError('Particle mesh bucket is unavailable');
        const sourceGeometry = asset.geometry;
        const geometry = new ParticleMeshGeometry(
            {
                mode: sourceGeometry.mode,
                isStatic: false,
                vertices: sourceGeometry.vertices,
                normals: sourceGeometry.normals,
                uvs:
                    sourceGeometry.uvs ??
                    new GeometryData(
                        new Float32Array((sourceGeometry.vertices?.count ?? 0) * 2),
                        2
                    ),
                indices: sourceGeometry.indices
            },
            plan.bounds
        );
        this.#geometry = geometry;
        this.#dynamicBounds = { ...plan.bounds };
        const texture = asset.texture ?? renderer.texture;
        const material = new ShaderMaterial({
            sourceRevision: `particle-cpu-mesh:${plan.layoutHash}:${String(rendererIndex)}:${String(bucketIndex)}`,
            vs: vertexSource(renderer, plan.definition.simulationSpace),
            fs: fragmentSource(renderer, texture !== null && texture !== undefined),
            coverage: coverage(renderer),
            compositing: compositing(renderer),
            temporalReactiveFactor: (renderer.coverage ?? 'transparent') === 'transparent' ? 1 : 0,
            cullMode: 'back',
            state: {
                cullMode: 'back',
                depthTest: renderer.depthTest ?? true,
                depthWrite:
                    renderer.depthWrite ?? (renderer.coverage ?? 'transparent') !== 'transparent'
            },
            attributes: {
                a_meshPosition: { get: mesh => mesh.geometry?.vertices },
                a_meshNormal: { get: mesh => mesh.geometry?.normals },
                a_meshUV: { get: mesh => mesh.geometry?.uvs },
                a_particlePositionSize: attributeBinding(positionSize),
                a_particleColor: attributeBinding(color),
                a_particleRotation: attributeBinding(rotation),
                a_particleVelocity: attributeBinding(velocity),
                a_particlePreviousPosition: attributeBinding(previousPosition)
            },
            ...(texture === null || texture === undefined
                ? {}
                : { uniforms: { u_particleTexture: { get: () => texture } } }),
            ...(renderer.motionVectors === true
                ? {
                      roles: [
                          {
                              role: 'motion-vector' as const,
                              vertexSource: motionVertexSource(plan.definition.simulationSpace),
                              fragmentSource: motionFragmentSource(
                                  renderer,
                                  texture !== null && texture !== undefined
                              ),
                              fragmentOutput: 'motion-vector' as const,
                              fallback: 'required' as const
                          }
                      ]
                  }
                : {})
        });
        this.mesh = new Mesh({
            name: `${plan.definition.name}:mesh:${String(rendererIndex)}:${String(bucketIndex)}`,
            geometry,
            material,
            frustumTest: true,
            pointerEnabled: false,
            castShadows: false,
            receiveShadows: renderer.lighting === 'lambert',
            renderOrder: renderer.renderOrder ?? 0,
            instanceCount: 1,
            visible: false,
            autoUpdateWorldMatrix: plan.definition.simulationSpace === 'local'
        });
    }

    sync(cameraPosition: ParticleVector3): void {
        const aliveCount = this.#state.aliveCount;
        const meshIndices = this.#state.u32('mesh-index');
        let count = 0;
        for (let index = 0; index < aliveCount; index += 1) {
            if ((meshIndices[index] ?? 0) % this.#renderer.meshes.length !== this.#bucketIndex) {
                continue;
            }
            this.#sortIndices[count++] = index;
        }
        const sort = this.#renderer.sort ?? 'none';
        if (sort !== 'none') {
            for (let left = 1; left < count; left += 1) {
                const value = this.#sortIndices[left] ?? 0;
                let right = left - 1;
                while (
                    right >= 0 &&
                    compareParticle(
                        this.#sortIndices[right] ?? 0,
                        value,
                        sort,
                        this.#state,
                        cameraPosition
                    ) > 0
                ) {
                    this.#sortIndices[right + 1] = this.#sortIndices[right] ?? 0;
                    right--;
                }
                this.#sortIndices[right + 1] = value;
            }
        }
        const positions = this.#state.f32('position');
        const previousPositions = this.#state.f32('previous-position');
        const sizes = this.#state.f32('size');
        const colors = this.#state.f32('color');
        const rotations = this.#state.f32('rotation');
        const velocities = this.#state.f32('velocity');
        for (let outputIndex = 0; outputIndex < count; outputIndex += 1) {
            const inputIndex = this.#sortIndices[outputIndex] ?? outputIndex;
            const input3 = inputIndex * 3;
            const input4 = inputIndex * 4;
            const output = outputIndex * INSTANCE_FLOAT_STRIDE;
            this.#instanceData[output] = positions[input3] ?? 0;
            this.#instanceData[output + 1] = positions[input3 + 1] ?? 0;
            this.#instanceData[output + 2] = positions[input3 + 2] ?? 0;
            this.#instanceData[output + 3] = sizes[inputIndex] ?? 1;
            this.#instanceData[output + 4] = colors[input4] ?? 1;
            this.#instanceData[output + 5] = colors[input4 + 1] ?? 1;
            this.#instanceData[output + 6] = colors[input4 + 2] ?? 1;
            this.#instanceData[output + 7] = colors[input4 + 3] ?? 1;
            this.#instanceData[output + 8] = rotations[inputIndex] ?? 0;
            this.#instanceData[output + 9] = velocities[input3] ?? 0;
            this.#instanceData[output + 10] = velocities[input3 + 1] ?? 0;
            this.#instanceData[output + 11] = velocities[input3 + 2] ?? 0;
            this.#instanceData[output + 12] = previousPositions[input3] ?? 0;
            this.#instanceData[output + 13] = previousPositions[input3 + 1] ?? 0;
            this.#instanceData[output + 14] = previousPositions[input3 + 2] ?? 0;
            this.#instanceData[output + 15] = 0;
        }
        for (const source of this.#instanceSources) source.isDirty = true;
        if (this.#state.computeBounds(this.#dynamicBounds) !== null) {
            this.#geometry.setParticleBounds(this.#dynamicBounds);
        }
        if (this.mesh.instanceCount !== Math.max(1, count)) {
            this.mesh.instanceCount = Math.max(1, count);
            if (this.mesh.geometry) this.mesh.geometry.isDirty = true;
        }
        this.mesh.visible = count > 0;
    }

    destroy(renderer: Renderer): void {
        this.mesh.destroy(renderer);
    }
}
