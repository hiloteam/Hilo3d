import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import type Camera from '../camera/Camera';
import type Mesh from '../core/Mesh';
import type Geometry from '../geometry/Geometry';
import type Material from '../material/Material';
import type Program from './Program';
import UniformBuffer from './UniformBuffer';
import {
    BUILT_IN_UNIFORM_BLOCK_LAYOUTS,
    cameraBlockLayout,
    frameBlockLayout,
    geometryBlockLayout,
    lightBlockLayout,
    materialBlockLayout,
    modelBlockLayout,
    morphBlockLayout,
    paddedStd140Value,
    sceneBlockLayout,
    skinningBlockLayout
} from './ubo/BuiltInUniformBlocks';
import type { Std140Layout } from './ubo/Std140Layout';

interface RendererSize {
    width: number;
    height: number;
}

interface RevisionCachedBuffer {
    buffer: UniformBuffer;
    revision: number;
}

interface FrameCachedBuffer {
    buffer: UniformBuffer;
    frameIndex: number;
}

type OwnedBufferRegistration =
    | { readonly kind: 'material'; readonly owner: Material }
    | { readonly kind: 'model'; readonly owner: Mesh }
    | { readonly kind: 'geometry'; readonly owner: Geometry }
    | { readonly kind: 'skinning'; readonly owner: Mesh }
    | { readonly kind: 'morph'; readonly owner: Mesh };

const tempInverseProjection = new Matrix4();
const tempViewNormal = new Matrix3();

function numericCameraProperty(camera: Camera, name: string, fallback: number): number {
    const value: unknown = Reflect.get(camera, name);
    return typeof value === 'number' ? value : fallback;
}

function updateSemanticBlock(
    buffer: UniformBuffer,
    blockName: string,
    mesh: Mesh,
    material: Material
): void {
    const layout = BUILT_IN_UNIFORM_BLOCK_LAYOUTS[blockName];
    if (!layout) return;
    if (!(buffer.data instanceof ArrayBuffer)) {
        throw new TypeError(`${blockName} must use an ArrayBuffer-backed std140 buffer`);
    }
    new Uint8Array(buffer.data).fill(0);
    buffer.markDirty();
    for (const fieldName of Object.keys(layout.fields)) {
        if (fieldName.endsWith('Padding')) continue;
        if (!Object.hasOwn(material.uniforms, fieldName)) continue;
        const materialProperty =
            {
                u_diffuseColor: 'diffuse',
                u_specularColor: 'specular',
                u_ambientColor: 'ambient',
                u_emissionColor: 'emission'
            }[fieldName] ?? null;
        let value: unknown;
        if (materialProperty) {
            const candidate: unknown = Reflect.get(material, materialProperty);
            value =
                typeof candidate === 'object' &&
                candidate !== null &&
                Reflect.get(candidate, 'isColor') === true
                    ? Reflect.get(candidate, 'elements')
                    : null;
        } else if (fieldName === 'u_transparencyFactor') {
            const candidate: unknown = Reflect.get(material, 'transparency');
            value = typeof candidate === 'number' ? candidate : 1;
        } else {
            value = material.getUniformData(fieldName, mesh, {});
        }
        const padded = paddedStd140Value(layout, fieldName, value);
        if (padded !== null) buffer.set(fieldName, padded);
    }
}

/** Owns the canonical cross-backend uniform blocks and updates each at its natural frequency. */
class BuiltInUniformBlockManager {
    private readonly renderer: RendererSize;
    private readonly ownedBuffers = new Set<UniformBuffer>();
    private readonly frameBuffer: UniformBuffer;
    private readonly cameraBuffer: UniformBuffer;
    private readonly sceneBuffer: UniformBuffer;
    private readonly lightBuffer: UniformBuffer;
    private readonly materialBuffers = new WeakMap<Material, RevisionCachedBuffer>();
    private readonly modelBuffers = new WeakMap<Mesh, RevisionCachedBuffer>();
    private readonly geometryBuffers = new WeakMap<Geometry, RevisionCachedBuffer>();
    private readonly skinningBuffers = new WeakMap<Mesh, FrameCachedBuffer>();
    private readonly morphBuffers = new WeakMap<Mesh, FrameCachedBuffer>();
    private readonly bufferOwners = new WeakMap<UniformBuffer, OwnedBufferRegistration>();
    private camera: Camera | null = null;
    private frameIndex = 0;
    private readonly startTime = performance.now();
    private sceneRevision = -1;
    private lightRevision = -1;

    constructor(renderer: RendererSize) {
        this.renderer = renderer;
        this.frameBuffer = this.createBuffer(frameBlockLayout);
        this.cameraBuffer = this.createBuffer(cameraBlockLayout);
        this.sceneBuffer = this.createBuffer(sceneBlockLayout);
        this.lightBuffer = this.createBuffer(lightBlockLayout);
    }

    beginFrame(camera: Camera): void {
        this.frameIndex++;
        this.frameBuffer
            .set('u_rendererSize', [this.renderer.width, this.renderer.height])
            .set('u_time', (performance.now() - this.startTime) * 0.001)
            .set('u_frameIndex', this.frameIndex);
        this.beginPass(camera);
    }

    /** Start a camera/render pass without advancing animation-frame scoped buffers. */
    beginPass(camera: Camera): void {
        this.sceneRevision = -1;
        this.lightRevision = -1;
        this.updateCamera(camera);
    }

    private updateCamera(camera: Camera): void {
        this.camera = camera;
        this.cameraBuffer
            .set('u_viewMatrix', camera.viewMatrix.elements)
            .set('u_projectionMatrix', camera.projectionMatrix.elements)
            .set('u_viewProjectionMatrix', camera.viewProjectionMatrix.elements)
            .set('u_viewInverseMatrix', camera.worldMatrix.elements)
            .set(
                'u_projectionInverseMatrix',
                tempInverseProjection.invert(camera.projectionMatrix).elements
            )
            .set(
                'u_viewInverseNormalMatrix',
                tempViewNormal.normalFromMat4(camera.worldMatrix).elements
            )
            .set('u_cameraPositionNear', [
                camera.worldMatrix.elements[12],
                camera.worldMatrix.elements[13],
                camera.worldMatrix.elements[14],
                numericCameraProperty(camera, 'near', 0)
            ])
            .set('u_cameraParams', [
                numericCameraProperty(camera, 'far', 0),
                camera.isPerspectiveCamera ? 1 : 0,
                camera.isPerspectiveCamera
                    ? 2 / Math.log2(numericCameraProperty(camera, 'far', 1) + 1)
                    : 0,
                0
            ]);
    }

    bind(
        program: Program,
        mesh: Mesh,
        material: Material,
        _forceMaterialUpdate: boolean,
        activeCamera?: Camera | null
    ): Readonly<Record<string, UniformBuffer>> {
        const buffers = this.getUniformBlocks(
            Object.keys(program.uniformBlocks),
            mesh,
            material,
            activeCamera
        );
        for (const [blockName, buffer] of Object.entries(buffers)) {
            program.setUniformBlock(blockName, buffer);
        }
        return buffers;
    }

    /** Resolve logical parameter blocks without coupling the caller to a graphics API. */
    getUniformBlocks(
        blockNames: readonly string[],
        mesh: Mesh,
        material: Material,
        activeCamera?: Camera | null
    ): Readonly<Record<string, UniformBuffer>> {
        if (activeCamera && activeCamera !== this.camera) this.updateCamera(activeCamera);
        if (!this.camera) throw new Error('Uniform blocks cannot be resolved before beginFrame');
        const result: Record<string, UniformBuffer> = {};
        for (const blockName of blockNames) {
            const buffer =
                material.uniformBlocks[blockName] ??
                this.resolveBuiltInBuffer(blockName, mesh, material);
            if (!buffer) {
                throw new Error(`No UniformBuffer is configured for active block ${blockName}`);
            }
            result[blockName] = buffer;
        }
        return result;
    }

    destroy(gl?: WebGL2RenderingContext): void {
        for (const buffer of this.ownedBuffers) buffer.destroy(gl);
    }

    /**
     * Release every object-frequency block cached for an owner. Returns the number of logical
     * buffers removed; global frame/camera/scene/light blocks are intentionally retained.
     */
    releaseOwner(owner: object, gl?: WebGL2RenderingContext): number {
        const buffers = new Set<UniformBuffer>();
        const material = this.materialBuffers.get(owner as Material);
        const model = this.modelBuffers.get(owner as Mesh);
        const geometry = this.geometryBuffers.get(owner as Geometry);
        const skinning = this.skinningBuffers.get(owner as Mesh);
        const morph = this.morphBuffers.get(owner as Mesh);
        if (material) buffers.add(material.buffer);
        if (model) buffers.add(model.buffer);
        if (geometry) buffers.add(geometry.buffer);
        if (skinning) buffers.add(skinning.buffer);
        if (morph) buffers.add(morph.buffer);
        let released = 0;
        for (const buffer of buffers) {
            if (this.releaseBuffer(buffer, gl)) released++;
        }
        return released;
    }

    /** Release an object-frequency buffer by identity when a renderer resource loses its last ref. */
    releaseBuffer(buffer: UniformBuffer, gl?: WebGL2RenderingContext): boolean {
        const registration = this.bufferOwners.get(buffer);
        if (!registration) return false;
        switch (registration.kind) {
            case 'material':
                if (this.materialBuffers.get(registration.owner)?.buffer === buffer) {
                    this.materialBuffers.delete(registration.owner);
                }
                break;
            case 'model':
                if (this.modelBuffers.get(registration.owner)?.buffer === buffer) {
                    this.modelBuffers.delete(registration.owner);
                }
                break;
            case 'geometry':
                if (this.geometryBuffers.get(registration.owner)?.buffer === buffer) {
                    this.geometryBuffers.delete(registration.owner);
                }
                break;
            case 'skinning':
                if (this.skinningBuffers.get(registration.owner)?.buffer === buffer) {
                    this.skinningBuffers.delete(registration.owner);
                }
                break;
            case 'morph':
                if (this.morphBuffers.get(registration.owner)?.buffer === buffer) {
                    this.morphBuffers.delete(registration.owner);
                }
                break;
        }
        this.bufferOwners.delete(buffer);
        this.ownedBuffers.delete(buffer);
        buffer.destroy(gl);
        return true;
    }

    private getMaterialBuffer(mesh: Mesh, material: Material): UniformBuffer {
        let cached = this.materialBuffers.get(material);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(materialBlockLayout, {
                    kind: 'material',
                    owner: material
                }),
                revision: -1
            };
            this.materialBuffers.set(material, cached);
        }
        if (cached.revision !== material.revision) {
            updateSemanticBlock(cached.buffer, 'MaterialBlock', mesh, material);
            cached.revision = material.revision;
        }
        return cached.buffer;
    }

    private getModelBuffer(mesh: Mesh, material: Material): UniformBuffer {
        let cached = this.modelBuffers.get(mesh);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(modelBlockLayout, {
                    kind: 'model',
                    owner: mesh
                }),
                revision: -1
            };
            this.modelBuffers.set(mesh, cached);
        }
        if (cached.revision !== mesh.worldMatrixVersion) {
            updateSemanticBlock(cached.buffer, 'ModelBlock', mesh, material);
            cached.revision = mesh.worldMatrixVersion;
        }
        return cached.buffer;
    }

    private getGeometryBuffer(mesh: Mesh, material: Material): UniformBuffer {
        const geometry = mesh.geometry;
        if (!geometry) throw new Error(`Mesh ${mesh.id} has no Geometry for GeometryBlock`);
        let cached = this.geometryBuffers.get(geometry);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(geometryBlockLayout, {
                    kind: 'geometry',
                    owner: geometry
                }),
                revision: -1
            };
            this.geometryBuffers.set(geometry, cached);
        }
        if (cached.revision !== geometry.revision) {
            updateSemanticBlock(cached.buffer, 'GeometryBlock', mesh, material);
            cached.revision = geometry.revision;
        }
        return cached.buffer;
    }

    private getSkinningBuffer(mesh: Mesh, material: Material): UniformBuffer {
        let cached = this.skinningBuffers.get(mesh);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(skinningBlockLayout, {
                    kind: 'skinning',
                    owner: mesh
                }),
                frameIndex: -1
            };
            this.skinningBuffers.set(mesh, cached);
        }
        if (cached.frameIndex !== this.frameIndex) {
            updateSemanticBlock(cached.buffer, 'SkinningBlock', mesh, material);
            cached.frameIndex = this.frameIndex;
        }
        return cached.buffer;
    }

    private getMorphBuffer(mesh: Mesh, material: Material): UniformBuffer {
        let cached = this.morphBuffers.get(mesh);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(morphBlockLayout, {
                    kind: 'morph',
                    owner: mesh
                }),
                frameIndex: -1
            };
            this.morphBuffers.set(mesh, cached);
        }
        if (cached.frameIndex === this.frameIndex) return cached.buffer;
        const weights = material.getUniformData('u_morphWeights', mesh, {});
        const values =
            Array.isArray(weights) ||
            (ArrayBuffer.isView(weights) && !(weights instanceof DataView))
                ? Array.from(weights as ArrayLike<number>)
                : [];
        if (values.length > 8) {
            throw new RangeError('MorphBlock supports at most 8 morph weights');
        }
        const padded = new Float32Array(8);
        padded.set(values);
        cached.buffer.set('u_morphWeights0', padded.subarray(0, 4));
        cached.buffer.set('u_morphWeights1', padded.subarray(4, 8));
        cached.frameIndex = this.frameIndex;
        return cached.buffer;
    }

    private resolveBuiltInBuffer(
        blockName: string,
        mesh: Mesh,
        material: Material
    ): UniformBuffer | undefined {
        switch (blockName) {
            case 'FrameBlock':
                return this.frameBuffer;
            case 'CameraBlock':
                return this.cameraBuffer;
            case 'SceneBlock':
                if (this.sceneRevision !== this.frameIndex) {
                    updateSemanticBlock(this.sceneBuffer, blockName, mesh, material);
                    this.sceneRevision = this.frameIndex;
                }
                return this.sceneBuffer;
            case 'LightBlock':
                if (this.lightRevision !== this.frameIndex) {
                    updateSemanticBlock(this.lightBuffer, blockName, mesh, material);
                    this.lightRevision = this.frameIndex;
                }
                return this.lightBuffer;
            case 'MaterialBlock':
                return this.getMaterialBuffer(mesh, material);
            case 'ModelBlock':
                return this.getModelBuffer(mesh, material);
            case 'GeometryBlock':
                return this.getGeometryBuffer(mesh, material);
            case 'SkinningBlock':
                return this.getSkinningBuffer(mesh, material);
            case 'MorphBlock':
                return this.getMorphBuffer(mesh, material);
            default:
                return undefined;
        }
    }

    private createBuffer(layout: Std140Layout): UniformBuffer {
        const buffer = UniformBuffer.fromSchema(layout);
        this.ownedBuffers.add(buffer);
        return buffer;
    }

    private createOwnedBuffer(
        layout: Std140Layout,
        registration: OwnedBufferRegistration
    ): UniformBuffer {
        const buffer = this.createBuffer(layout);
        this.bufferOwners.set(buffer, registration);
        return buffer;
    }
}

export default BuiltInUniformBlockManager;
