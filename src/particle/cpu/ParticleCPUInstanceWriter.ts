import Mesh from '../../core/Mesh';
import Geometry, { type Bounds } from '../../geometry/Geometry';
import GeometryData from '../../geometry/GeometryData';
import Sphere from '../../math/Sphere';
import ShaderMaterial from '../../material/ShaderMaterial';
import type { MaterialBindingInfo } from '../../material/MaterialInstance';
import { TRIANGLES } from '../../constants/webgl';
import type { Renderer } from '../../render/Renderer';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type {
    ParticleSortMode,
    ParticleSpriteAlignment,
    ParticleSpriteRendererDefinition,
    ParticleModule,
    ParticleVector3
} from '../ParticleTypes';
import type { ParticleCPUState } from './ParticleCPUState';
import type { ParticleCPUWriterQuality } from './ParticleCPUWriter';

const INSTANCE_FLOAT_STRIDE = 16;
const INSTANCE_BYTE_STRIDE = INSTANCE_FLOAT_STRIDE * Float32Array.BYTES_PER_ELEMENT;
let nextParticleCPUInstanceBufferId = 1;

class ParticleSpriteGeometry extends Geometry {
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

function compositing(
    renderer: ParticleSpriteRendererDefinition
):
    | Readonly<{ mode: 'alpha-blend'; premultiplied: boolean }>
    | Readonly<{ mode: 'additive'; premultiplied: boolean }> {
    switch (renderer.blend ?? 'alpha') {
        case 'alpha':
            return { mode: 'alpha-blend', premultiplied: false };
        case 'premultiplied-alpha':
            return { mode: 'alpha-blend', premultiplied: true };
        case 'additive':
            return { mode: 'additive', premultiplied: true };
    }
}

function alignmentId(alignment: ParticleSpriteAlignment | undefined): number {
    switch (alignment ?? 'view') {
        case 'view':
            return 0;
        case 'world-up':
            return 1;
        case 'stretched':
            return 2;
        case 'velocity':
            return 3;
    }
}

function textureSheet(plan: Readonly<ParticleCompiledEmitterPlan>): readonly [number, number] {
    const module = plan.definition.modules.find(candidate => candidate.type === 'texture-sheet');
    return module?.type === 'texture-sheet' ? [module.rows, module.columns] : [1, 1];
}

function glslFloat(value: number): string {
    return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function createVertexSource(
    renderer: ParticleSpriteRendererDefinition,
    simulationSpace: 'local' | 'world',
    modules: readonly ParticleModule[],
    rows: number,
    columns: number
): string {
    const pivot = renderer.pivot ?? [0.5, 0.5];
    const stretchScale = renderer.stretchScale ?? 0;
    const cameraOffset = modules.find(module => module.type === 'camera-offset');
    const cameraFade = modules.find(module => module.type === 'camera-fade');
    const screenSpaceSize = modules.find(module => module.type === 'screen-space-size');
    const cameraOffsetSource =
        cameraOffset?.type === 'camera-offset'
            ? `viewPosition.z += ${glslFloat(cameraOffset.scale ?? 0)};`
            : '';
    const cameraFadeSource =
        cameraFade?.type === 'camera-fade'
            ? `particleColor.a *= smoothstep(${glslFloat(cameraFade.range?.[0] ?? 0)}, ${glslFloat(cameraFade.range?.[1] ?? 1)}, distance(worldPosition.xyz, u_cameraPositionNear.xyz));`
            : '';
    const screenSizeSource =
        screenSpaceSize?.type === 'screen-space-size'
            ? `float particleWorldToPixels = max(0.000001, u_viewport.w * abs(u_projectionMatrix[1][1]) / (2.0 * max(abs((u_projectionMatrix * viewPosition).w), 0.000001)));
    float particlePixelSize = clamp(particleSize * particleWorldToPixels * ${glslFloat(screenSpaceSize.scale ?? 1)}, ${glslFloat(screenSpaceSize.range?.[0] ?? 0)}, ${glslFloat(screenSpaceSize.range?.[1] ?? Number.MAX_SAFE_INTEGER)});
    particleSize = particlePixelSize / particleWorldToPixels;`
            : '';
    return `#version 300 es
precision highp float;
in vec2 a_particleCorner;
in vec2 a_particleUV;
in vec4 a_particlePositionSize;
in vec4 a_particleColor;
in vec2 a_particleRotationFrame;
in vec3 a_particleVelocity;
in vec3 a_particleNoiseOffset;
out vec2 v_particleUV;
out vec4 v_particleColor;

layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    mat4 u_previousViewMatrix;
    mat4 u_previousProjectionMatrix;
    mat4 u_previousViewProjectionMatrix;
    mat4 u_viewInverseMatrix;
    mat4 u_previousViewInverseMatrix;
    mat4 u_projectionInverseMatrix;
    mat3 u_viewInverseNormalMatrix;
    vec4 u_cameraPositionNear;
    vec4 u_cameraParams;
    vec4 u_renderOrigin;
    vec4 u_previousRenderOrigin;
    vec4 u_historyParams;
    vec4 u_viewport;
    mat4 u_nonJitteredProjectionMatrix;
    mat4 u_nonJitteredViewProjectionMatrix;
};

layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
};

void main(void) {
    vec3 position = a_particlePositionSize.xyz + a_particleNoiseOffset;
    vec4 worldPosition = ${simulationSpace === 'local' ? 'u_modelMatrix * vec4(position, 1.0)' : 'vec4(position, 1.0)'};
    vec4 viewPosition = u_viewMatrix * worldPosition;
    vec4 particleColor = a_particleColor;
    float particleSize = a_particlePositionSize.w;
    ${cameraOffsetSource}
    ${screenSizeSource}
    ${cameraFadeSource}
    vec2 corner = a_particleCorner + vec2(0.5) - vec2(${glslFloat(pivot[0])}, ${glslFloat(pivot[1])});
    float sine = sin(a_particleRotationFrame.x);
    float cosine = cos(a_particleRotationFrame.x);
    corner = mat2(cosine, sine, -sine, cosine) * corner;

    vec2 axis = vec2(0.0, 1.0);
    vec2 side = vec2(1.0, 0.0);
    if (${String(alignmentId(renderer.alignment))} == 1) {
        vec2 worldUp = (u_viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
        axis = length(worldUp) > 0.000001 ? normalize(worldUp) : axis;
        side = vec2(axis.y, -axis.x);
    } else if (${String(alignmentId(renderer.alignment))} >= 2) {
        vec2 viewVelocity = (u_viewMatrix * vec4(a_particleVelocity, 0.0)).xy;
        axis = length(viewVelocity) > 0.000001 ? normalize(viewVelocity) : axis;
        side = vec2(axis.y, -axis.x);
        if (${String(alignmentId(renderer.alignment))} == 2) {
            corner.y *= 1.0 + length(a_particleVelocity) * ${glslFloat(stretchScale)};
        }
    }
    vec2 billboardOffset = (side * corner.x + axis * corner.y) * particleSize;
    gl_Position = u_projectionMatrix * vec4(viewPosition.xyz + vec3(billboardOffset, 0.0), 1.0);

    float frameCount = ${String(rows * columns)}.0;
    float frame = mod(max(0.0, floor(a_particleRotationFrame.y)), frameCount);
    float column = mod(frame, ${String(columns)}.0);
    float row = floor(frame / ${String(columns)}.0);
    vec2 sheetSize = vec2(${String(columns)}.0, ${String(rows)}.0);
    v_particleUV = (a_particleUV + vec2(column, row)) / sheetSize;
    v_particleColor = particleColor;
}`;
}

function createFragmentSource(renderer: ParticleSpriteRendererDefinition): string {
    const textureDeclaration =
        renderer.texture === undefined || renderer.texture === null
            ? ''
            : 'uniform sampler2D u_particleTexture;';
    const textureSample =
        renderer.texture === undefined || renderer.texture === null
            ? 'vec4 texel = vec4(1.0);'
            : 'vec4 texel = texture(u_particleTexture, v_particleUV);';
    const premultiply =
        renderer.blend === 'premultiplied-alpha' || renderer.blend === 'additive'
            ? 'color.rgb *= color.a;'
            : '';
    return `#version 300 es
precision highp float;
in vec2 v_particleUV;
in vec4 v_particleColor;
${textureDeclaration}
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    ${textureSample}
    vec4 color = texel * v_particleColor;
    ${premultiply}
    if (color.a <= 0.00001) discard;
    fragmentColor = color;
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
    let difference: number;
    if (mode === 'distance') {
        const positions = state.f32('position');
        const leftOffset = left * 3;
        const rightOffset = right * 3;
        const leftX = (positions[leftOffset] ?? 0) - cameraPosition[0];
        const leftY = (positions[leftOffset + 1] ?? 0) - cameraPosition[1];
        const leftZ = (positions[leftOffset + 2] ?? 0) - cameraPosition[2];
        const rightX = (positions[rightOffset] ?? 0) - cameraPosition[0];
        const rightY = (positions[rightOffset + 1] ?? 0) - cameraPosition[1];
        const rightZ = (positions[rightOffset + 2] ?? 0) - cameraPosition[2];
        difference =
            rightX * rightX +
            rightY * rightY +
            rightZ * rightZ -
            (leftX * leftX + leftY * leftY + leftZ * leftZ);
    } else {
        const ages = state.f32('age');
        difference =
            mode === 'youngest'
                ? (ages[left] ?? 0) - (ages[right] ?? 0)
                : (ages[right] ?? 0) - (ages[left] ?? 0);
    }
    if (difference !== 0) return difference;
    return (stableIds[left] ?? 0) - (stableIds[right] ?? 0);
}

/** Internal CPU-SoA to one-instanced-draw renderer bridge. */
export class ParticleCPUInstanceWriter {
    readonly mesh: Mesh;
    readonly #state: ParticleCPUState;
    readonly #renderer: ParticleSpriteRendererDefinition;
    readonly #instanceData: Float32Array;
    readonly #instanceSources: readonly GeometryData[];
    readonly #sortIndices: Uint32Array;
    readonly #geometry: ParticleSpriteGeometry;
    readonly #dynamicBounds: Bounds;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        state: ParticleCPUState,
        renderer: ParticleSpriteRendererDefinition,
        rendererIndex: number
    ) {
        this.#state = state;
        this.#renderer = renderer;
        this.#instanceData = new Float32Array(plan.definition.capacity * INSTANCE_FLOAT_STRIDE);
        this.#sortIndices = new Uint32Array(plan.definition.capacity);
        const bufferViewId = `particle-instance:${String(nextParticleCPUInstanceBufferId++)}:${plan.layoutHash}:${String(rendererIndex)}`;
        const source = (size: 2 | 3 | 4, offset: number): GeometryData =>
            new GeometryData(this.#instanceData, size, {
                bufferViewId,
                stride: INSTANCE_BYTE_STRIDE,
                offset,
                stepMode: 'instance'
            });
        const positionSize = source(4, 0);
        const color = source(4, 16);
        const rotationFrame = source(2, 32);
        const velocity = source(3, 40);
        const noiseOffset = source(3, 52);
        this.#instanceSources = Object.freeze([
            positionSize,
            color,
            rotationFrame,
            velocity,
            noiseOffset
        ]);
        const geometry = new ParticleSpriteGeometry(
            {
                mode: TRIANGLES,
                isStatic: false,
                vertices: new GeometryData(
                    new Float32Array([
                        -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5
                    ]),
                    2
                ),
                uvs: new GeometryData(new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), 2)
            },
            plan.bounds
        );
        this.#geometry = geometry;
        this.#dynamicBounds = { ...plan.bounds };
        const [rows, columns] = textureSheet(plan);
        const material = new ShaderMaterial({
            sourceRevision: `particle-cpu-sprite:${plan.layoutHash}:${String(rendererIndex)}`,
            vs: createVertexSource(
                renderer,
                plan.definition.simulationSpace,
                plan.definition.modules,
                rows,
                columns
            ),
            fs: createFragmentSource(renderer),
            compositing: compositing(renderer),
            cullMode: 'none',
            state: {
                cullMode: 'none',
                depthTest: renderer.depthTest ?? true,
                depthWrite: renderer.depthWrite ?? false
            },
            attributes: {
                a_particleCorner: { get: mesh => mesh.geometry?.vertices },
                a_particleUV: { get: mesh => mesh.geometry?.uvs },
                a_particlePositionSize: attributeBinding(positionSize),
                a_particleColor: attributeBinding(color),
                a_particleRotationFrame: attributeBinding(rotationFrame),
                a_particleVelocity: attributeBinding(velocity),
                a_particleNoiseOffset: attributeBinding(noiseOffset)
            },
            ...(renderer.texture === undefined || renderer.texture === null
                ? {}
                : {
                      uniforms: {
                          u_particleTexture: { get: () => renderer.texture }
                      }
                  })
        });
        this.mesh = new Mesh({
            name: `${plan.definition.name}:sprite:${String(rendererIndex)}`,
            geometry,
            material,
            frustumTest: true,
            pointerEnabled: false,
            castShadows: false,
            receiveShadows: false,
            renderOrder: renderer.renderOrder ?? 0,
            instanceCount: 1,
            visible: false,
            autoUpdateWorldMatrix: plan.definition.simulationSpace === 'local'
        });
    }

    sync(cameraPosition: ParticleVector3, quality: Readonly<ParticleCPUWriterQuality>): void {
        const count = quality.enabled ? this.#state.aliveCount : 0;
        for (let index = 0; index < count; index += 1) this.#sortIndices[index] = index;
        const sort = this.#renderer.sort ?? 'none';
        if (quality.sorting && sort !== 'none') this.sort(count, sort, cameraPosition);
        const positions = this.#state.f32('position');
        const sizes = this.#state.f32('size');
        const colors = this.#state.f32('color');
        const rotations = this.#state.f32('rotation');
        const frames = this.#state.f32('sprite-frame');
        const velocities = this.#state.f32('velocity');
        const noiseOffsets = this.#state.has('noise-offset')
            ? this.#state.f32('noise-offset')
            : null;
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
            this.#instanceData[output + 9] = frames[inputIndex] ?? 0;
            this.#instanceData[output + 10] = velocities[input3] ?? 0;
            this.#instanceData[output + 11] = velocities[input3 + 1] ?? 0;
            this.#instanceData[output + 12] = velocities[input3 + 2] ?? 0;
            this.#instanceData[output + 13] = noiseOffsets?.[input3] ?? 0;
            this.#instanceData[output + 14] = noiseOffsets?.[input3 + 1] ?? 0;
            this.#instanceData[output + 15] = noiseOffsets?.[input3 + 2] ?? 0;
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

    private sort(count: number, mode: ParticleSortMode, cameraPosition: ParticleVector3): void {
        for (let root = Math.floor(count / 2) - 1; root >= 0; root -= 1) {
            this.siftDown(root, count, mode, cameraPosition);
        }
        for (let end = count - 1; end > 0; end -= 1) {
            const first = this.#sortIndices[0] ?? 0;
            this.#sortIndices[0] = this.#sortIndices[end] ?? 0;
            this.#sortIndices[end] = first;
            this.siftDown(0, end, mode, cameraPosition);
        }
    }

    private siftDown(
        root: number,
        count: number,
        mode: ParticleSortMode,
        cameraPosition: ParticleVector3
    ): void {
        while (root * 2 + 1 < count) {
            let child = root * 2 + 1;
            if (
                child + 1 < count &&
                compareParticle(
                    this.#sortIndices[child] ?? 0,
                    this.#sortIndices[child + 1] ?? 0,
                    mode,
                    this.#state,
                    cameraPosition
                ) < 0
            ) {
                child += 1;
            }
            if (
                compareParticle(
                    this.#sortIndices[root] ?? 0,
                    this.#sortIndices[child] ?? 0,
                    mode,
                    this.#state,
                    cameraPosition
                ) >= 0
            ) {
                return;
            }
            const value = this.#sortIndices[root] ?? 0;
            this.#sortIndices[root] = this.#sortIndices[child] ?? 0;
            this.#sortIndices[child] = value;
            root = child;
        }
    }
}
