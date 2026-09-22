import {
    Geometry,
    GeometryData,
    MaterialAttributeSemantic,
    Mesh,
    Node,
    RENDER_NODE_EXTENSION,
    RenderPassParameterPool,
    SceneRenderPass,
    ShaderMaterial,
    UniformBuffer,
    createStd140Layout,
    registerUniformBlockBinding,
    type ForwardRenderFeatureContext,
    type RenderNodeExtension,
    type Renderer,
    type RendererContract,
    type RenderTarget,
    type RendererListHandle,
    type RenderGraphTextureHandle,
    type RendererViewport,
    type SceneRenderPassParameters,
    type Texture
} from 'hilo3d';
import type { Live2DDrawable, Live2DSource } from './Live2DSource.js';
import {
    live2DCompositing,
    live2DFragmentSource,
    live2DMaskFragmentSource,
    live2DMaskVertexSource,
    live2DVertexSource
} from './Live2DShaders.js';

const layout = createStd140Layout({
    u_multiplyColor: 'vec4',
    u_screenColor: 'vec4',
    u_drawParams: 'vec4',
    u_maskTransform: 'vec4'
});

interface DrawableResources {
    readonly source: Live2DDrawable;
    readonly mesh: Mesh;
    readonly geometry: Geometry;
    readonly vertices: GeometryData;
    readonly block: UniformBuffer;
    readonly parameters: Float32Array;
}

interface MaskParameters {
    rendererList: RendererListHandle;
    colorAttachments: [
        {
            texture: RenderGraphTextureHandle;
            loadOp: 'clear';
            storeOp: 'store';
            clearValue: { r: number; g: number; b: number; a: number };
        }
    ];
    viewport: RendererViewport;
}

interface MaskResources {
    readonly indices: readonly number[];
    readonly meshes: Mesh[];
    readonly pass: SceneRenderPass;
    readonly pool: RenderPassParameterPool<MaskParameters>;
    target: RenderTarget | null;
    readonly block: UniformBuffer;
}

/** Construction inputs. Cubism simulation and source textures remain application-owned by default. */
export interface Live2DNodeOptions {
    /** Live view of Cubism drawable data; call sync after updating the Cubism model. */
    readonly source: Live2DSource;
    /** Straight-alpha, sRGB artwork in model texture-index order. */
    readonly textures: readonly Texture<unknown>[];
    /** Square mask resolution in pixels. Defaults to 1024. */
    readonly maskSize?: number;
    /** Transfer texture ownership to this node. Defaults to false. */
    readonly ownsTextures?: boolean;
}

/**
 * Low-level Cubism drawable node. Forward discovers and renders its soft clipping masks automatically.
 *
 * The first renderer that prepares this node owns its GPU resources. Use separate nodes when
 * displaying one Cubism source in multiple renderers. Animation and Core lifetime stay with the host.
 */
export class Live2DNode extends Node {
    override readonly className: string = 'Live2DNode';
    #source: Live2DSource | null;
    readonly #textures: Texture<unknown>[];
    readonly #ownsTextures: boolean;
    readonly #maskSize: number;
    readonly #drawables: DrawableResources[] = [];
    readonly #masks: MaskResources[] = [];
    readonly #maskByKey = new Map<string, MaskResources>();
    #renderer: RendererContract | null = null;
    #destroyed = false;
    #masksRecorded = false;
    #opacity = 1;
    readonly #maskTransform = new Float32Array(4);

    /** Renderer lifecycle hook; portable mask passes are discovered automatically by Forward. */
    readonly [RENDER_NODE_EXTENSION]: RenderNodeExtension = {
        gpu: null,
        raster: {
            isVisible: () => this.#masks.length > 0 && !this.#destroyed,
            record: context => {
                this.recordMasks(context);
            }
        },
        prepareRenderer: renderer => {
            this.prepareRenderer(renderer);
        }
    };

    constructor(options: Readonly<Live2DNodeOptions>) {
        super();
        this.#source = options.source;
        this.#textures = [...options.textures];
        this.#ownsTextures = options.ownsTextures ?? false;
        this.#maskSize = options.maskSize ?? 1024;
        if (!Number.isSafeInteger(this.#maskSize) || this.#maskSize < 1) {
            throw new RangeError('Live2D maskSize must be a positive integer.');
        }
        registerUniformBlockBinding('Live2DDrawBlock');
        this.#source.sync();
        for (const drawable of this.#source.drawables) {
            if (!this.#textures[drawable.textureIndex]) {
                throw new RangeError(
                    `Live2D drawable ${drawable.id} references a missing texture.`
                );
            }
            if (drawable.masks.length > 0) this.acquireMask(drawable.masks);
        }
        for (const drawable of this.#source.drawables) this.createDrawable(drawable);
        for (const mask of this.#masks) {
            for (const index of mask.indices) {
                const drawable = this.#drawables[index];
                if (!drawable) throw new RangeError('Live2D mask source index is out of bounds.');
                // Core may retain empty ArtMesh placeholders (for example, the official Miku
                // sample). They contribute no coverage; retain the group's transparent clear.
                if (drawable.source.indices.length === 0) continue;
                const image = this.#textures[drawable.source.textureIndex];
                if (!image) throw new RangeError('Live2D mask source texture is missing.');
                const material = new ShaderMaterial({
                    vs: live2DMaskVertexSource,
                    fs: live2DMaskFragmentSource,
                    compositing: { mode: 'alpha-blend', premultiplied: true },
                    state: {
                        depthTest: false,
                        depthWrite: false,
                        cullMode: drawable.source.doubleSided ? 'none' : 'back'
                    },
                    attributes: {
                        a_position: MaterialAttributeSemantic.POSITION,
                        a_uv: MaterialAttributeSemantic.TEXCOORD_0
                    },
                    uniformBlocks: { Live2DDrawBlock: mask.block },
                    uniforms: { u_image: { get: () => image } }
                });
                const mesh = new Mesh({
                    name: `Live2D mask ${drawable.source.id}`,
                    geometry: drawable.geometry,
                    material,
                    visible: false,
                    frustumTest: false,
                    castShadows: false,
                    receiveShadows: false,
                    pointerEnabled: false
                });
                this.addChild(mesh);
                mask.meshes.push(mesh);
            }
        }
        this.sync();
    }

    /** Number of drawable meshes in this model. */
    get drawableCount(): number {
        return this.#drawables.length;
    }
    /** Number of distinct soft mask groups. */
    get maskCount(): number {
        return this.#masks.length;
    }
    /** Whether destroy has released this node's renderer-owned resources. */
    get isDestroyed(): boolean {
        return this.#destroyed;
    }
    /** Model-wide opacity, multiplied by every drawable opacity during sync. */
    get opacity(): number {
        return this.#opacity;
    }
    set opacity(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new RangeError('Live2D opacity must be between zero and one.');
        }
        this.#opacity = value;
    }

    /**
     * Allocate renderer-local mask resources before the first explicit `renderer.renderFrame()`.
     * Stage and ordinary renderer calls prepare the node automatically. Call this before opening
     * an explicit frame that will encounter a new node; allocation cannot begin inside a frame.
     * Repeated calls with the owning renderer reuse the existing resources.
     */
    prepare(renderer: RendererContract): void {
        this.prepareRenderer(renderer);
    }

    /** Refresh reusable geometry and material data after the host updates its Cubism model. */
    sync(): void {
        const modelSource = this.#source;
        if (this.#destroyed || !modelSource)
            throw new Error('Cannot sync a destroyed Live2D node.');
        modelSource.sync();
        const sourceOpacity = modelSource.modelOpacity ?? 1;
        if (!Number.isFinite(sourceOpacity) || sourceOpacity < -1e-6 || sourceOpacity > 1 + 1e-6) {
            throw new RangeError('Live2D model opacity must be in [0, 1].');
        }
        const opacity = Math.max(0, Math.min(1, sourceOpacity)) * this.#opacity;
        if (modelSource.drawables.length !== this.#drawables.length) {
            throw new Error('Live2D drawable topology changed; create a new node.');
        }
        this.updateMaskTransform();
        for (const item of this.#drawables) {
            const { source, vertices, mesh, block, parameters } = item;
            const positions = vertices.data;
            if (positions.length !== (source.positions.length / 2) * 3) {
                throw new Error('Live2D vertex topology changed; create a new node.');
            }
            let changed = false;
            for (let i = 0; i < source.positions.length / 2; i++) {
                const x = source.positions[i * 2] ?? 0;
                const y = source.positions[i * 2 + 1] ?? 0;
                if (positions[i * 3] !== x || positions[i * 3 + 1] !== y) changed = true;
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
            }
            if (changed) {
                vertices.isDirty = true;
                item.geometry.isDirty = true;
            }
            mesh.visible =
                source.indices.length > 0 && source.visible && source.opacity > 0 && opacity > 0;
            mesh.renderOrder = source.renderOrder;
            mesh.sortingLayer = this.sortingLayer;
            mesh.zIndex = this.zIndex;
            mesh.layer = this.layer;
            parameters[0] = source.opacity * opacity;
            parameters[1] = source.invertedMask ? 1 : 0;
            block.set('u_multiplyColor', source.multiplyColor);
            block.set('u_screenColor', source.screenColor);
            block.set('u_drawParams', parameters);
            block.set('u_maskTransform', this.#maskTransform);
        }
    }

    /** Record soft-mask producers before ordinary transparent scene meshes consume them. */
    recordMasks(context: ForwardRenderFeatureContext): void {
        if (this.#destroyed || !this.isVisibleTo(context.pipeline.camera.visibility)) return;
        if (this.#masksRecorded) return;
        this.#masksRecorded = true;
        for (const mask of this.#masks) {
            const target = mask.target;
            if (!target) throw new Error('Live2D node was not prepared by its renderer.');
            const attachment = context.pipeline.graph.importRenderTarget(target).color(0);
            const rendererList = context.pipeline.createOrderedRendererList({
                cullingResults: context.cullingResults,
                meshes: mask.meshes
            });
            const parameters = context.pipeline.acquirePassParameters(mask.pool);
            parameters.rendererList = rendererList;
            parameters.colorAttachments[0].texture = attachment;
            context.pipeline.graph.addPass(mask.pass, parameters);
        }
    }

    /** Release masks, meshes and optionally transferred textures before destroying the renderer. */
    override destroy(renderer?: Renderer, destroyTextures = false): this {
        if (this.#destroyed) return this;
        const owner = renderer ?? this.#renderer;
        if (renderer && this.#renderer && renderer !== this.#renderer) {
            throw new Error('Live2D node belongs to a different renderer.');
        }
        this.#destroyed = true;
        const errors: unknown[] = [];
        const release = (action: () => void): void => {
            try {
                action();
            } catch (error: unknown) {
                errors.push(error);
            }
        };
        const ownedMeshes = new Set(this.#drawables.map(drawable => drawable.mesh));
        for (const mask of this.#masks) {
            for (const mesh of mask.meshes) ownedMeshes.add(mesh);
            release(() => {
                mask.target?.destroy();
            });
            mask.target = null;
            mask.meshes.length = 0;
        }
        for (const child of [...this.children]) {
            if (child instanceof Mesh && ownedMeshes.has(child)) {
                if (owner)
                    release(() => {
                        owner.resourceManager.destroyMesh(child);
                    });
                child.geometry = null;
                child.material = null;
            } else {
                release(() => {
                    child.destroy(owner as Renderer | undefined, destroyTextures);
                });
            }
            release(() => {
                // Match Node's recursive cleanup even when a user override throws before super,
                // or a user attaches descendants beneath an addon-owned drawable Mesh.
                Node.prototype.destroy.call(child, owner as Renderer | undefined, destroyTextures);
            });
        }
        if (this.#ownsTextures || destroyTextures) {
            for (const texture of new Set(this.#textures))
                release(() => {
                    texture.destroy();
                });
        }
        this.#drawables.length = 0;
        this.#masks.length = 0;
        this.#maskByKey.clear();
        this.#textures.length = 0;
        this.#source = null;
        this.#renderer = null;
        this.off();
        this.removeFromParent();
        if (errors.length > 0) throw new AggregateError(errors, 'Live2D node cleanup failed.');
        return this;
    }

    private updateMaskTransform(): void {
        if (this.#masks.length === 0) return;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const { source } of this.#drawables) {
            for (let index = 0; index < source.positions.length; index += 2) {
                const x = source.positions[index] ?? 0;
                const y = source.positions[index + 1] ?? 0;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        if (!Number.isFinite(minX)) {
            minX = minY = -1;
            maxX = maxY = 1;
        }
        const width = Math.max(maxX - minX, 1e-4);
        const height = Math.max(maxY - minY, 1e-4);
        // A small border keeps filtering inside the clear mask pixels at mesh bounds.
        const scaleX = 1 / (width * 1.02);
        const scaleY = 1 / (height * 1.02);
        this.#maskTransform[0] = scaleX;
        this.#maskTransform[1] = scaleY;
        this.#maskTransform[2] = -(minX - width * 0.01) * scaleX;
        this.#maskTransform[3] = -(minY - height * 0.01) * scaleY;
        for (const mask of this.#masks) mask.block.set('u_maskTransform', this.#maskTransform);
    }

    private isVisibleTo(cameraMask: number): boolean {
        if (!this.visible) return false;
        let ancestor: Node | null = this.parent;
        while (ancestor) {
            if (!ancestor.visible) return false;
            ancestor = ancestor.parent;
        }
        return (this.layer & cameraMask) !== 0;
    }

    private prepareRenderer(renderer: RendererContract): void {
        if (this.#destroyed) throw new Error('Cannot render a destroyed Live2D node.');
        if (this.#renderer && this.#renderer !== renderer) {
            throw new Error('A Live2D node cannot share GPU resources across renderers.');
        }
        this.#renderer = renderer;
        this.#masksRecorded = false;
        for (const mask of this.#masks) {
            mask.target ??= renderer.createRenderTarget({
                label: `Live2D mask ${mask.indices.join(',')}`,
                width: this.#maskSize,
                height: this.#maskSize,
                depthStencilAttachment: false
            });
        }
    }

    private acquireMask(indices: readonly number[]): MaskResources {
        const key = [...indices].sort((a, b) => a - b).join(',');
        let mask = this.#maskByKey.get(key);
        if (!mask) {
            mask = {
                indices: [...indices],
                meshes: [],
                target: null,
                block: UniformBuffer.fromSchema(layout),
                pass: new SceneRenderPass(`Live2D mask ${key}`),
                pool: new RenderPassParameterPool<MaskParameters>(() => ({
                    rendererList: 0 as SceneRenderPassParameters['rendererList'],
                    colorAttachments: [
                        {
                            texture: 0 as RenderGraphTextureHandle,
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 0 }
                        }
                    ],
                    viewport: [0, 0, this.#maskSize, this.#maskSize]
                }))
            };
            this.#maskByKey.set(key, mask);
            this.#masks.push(mask);
        }
        return mask;
    }

    private createDrawable(source: Live2DDrawable): void {
        const image = this.#textures[source.textureIndex];
        if (!image) throw new RangeError('Live2D texture is missing.');
        const mask = source.masks.length > 0 ? this.acquireMask(source.masks) : null;
        const vertices = new GeometryData(new Float32Array((source.positions.length / 2) * 3), 3);
        const geometry = new Geometry({
            vertices,
            uvs: new GeometryData(source.uvs.slice(), 2),
            indices: new GeometryData(source.indices.slice(), 1)
        });
        const block = UniformBuffer.fromSchema(layout);
        const material = new ShaderMaterial({
            vs: live2DVertexSource,
            fs: live2DFragmentSource(mask !== null),
            compositing: live2DCompositing(source.blendMode),
            state: {
                depthTest: false,
                depthWrite: false,
                cullMode: source.doubleSided ? 'none' : 'back'
            },
            attributes: {
                a_position: MaterialAttributeSemantic.POSITION,
                a_uv: MaterialAttributeSemantic.TEXCOORD_0
            },
            uniformBlocks: { Live2DDrawBlock: block },
            uniforms: {
                u_image: { get: () => image },
                ...(mask
                    ? {
                          u_mask: {
                              get: () => {
                                  if (!mask.target || !this.#masksRecorded)
                                      throw new Error(
                                          'Live2D masks require a portable raster hook in the active render pipeline.'
                                      );
                                  return mask.target.getColorTexture();
                              }
                          }
                      }
                    : {})
            }
        });
        const mesh = new Mesh({
            name: source.id,
            geometry,
            material,
            frustumTest: false,
            castShadows: false,
            receiveShadows: false
        });
        this.addChild(mesh);
        this.#drawables.push({
            source,
            mesh,
            geometry,
            vertices,
            block,
            parameters: new Float32Array(4)
        });
    }
}
