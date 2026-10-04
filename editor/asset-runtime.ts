import * as H from '../src/Hilo3d';
import { assetURL, assetDecodedImageBytes, validateAsset, type ProjectAsset } from './assets';

/** Base-level RGBA image reservation; GPU mipmaps/geometry/backend overhead are additional. */
export const EDITOR_DECODED_IMAGE_BUDGET = 256 * 1024 * 1024;

type LoadedModel = Awaited<ReturnType<H.GLTFLoader['load']>>;
export interface TextureLease {
    readonly texture: H.Texture;
    readonly ready: Promise<void>;
    release(): void;
}
export interface ModelInstance {
    readonly root: H.Node;
    readonly meshes: readonly H.Mesh[];
    readonly originalMaterials: ReadonlyMap<H.Mesh, H.MaterialInstance | null>;
}
export interface ModelLease {
    readonly ready: Promise<ModelInstance>;
    release(): void;
}
interface TextureEntry {
    readonly asset: ProjectAsset;
    readonly texture: H.Texture;
    readonly ready: Promise<void>;
    readonly dispose: () => void;
    references: number;
}
interface ModelEntry {
    readonly asset: ProjectAsset;
    readonly controller: AbortController;
    ready: Promise<LoadedModel> | null;
    model: LoadedModel | null;
    references: number;
    released: boolean;
    releaseBudget: () => void;
}

function aborted(): DOMException {
    return new DOMException('Asset request was superseded or released.', 'AbortError');
}

function modelLoadError(name: string, cause: unknown): Error {
    const details: string[] = [];
    const visited = new Set<unknown>();
    let current = cause;
    for (let depth = 0; depth < 5 && current !== undefined && !visited.has(current); depth++) {
        visited.add(current);
        const text = (
            current instanceof Error
                ? current.message
                : typeof current === 'string'
                  ? current
                  : 'Unknown decoder failure'
        )
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 500);
        if (text && !details.includes(text) && !text.startsWith('Failed to load glTF blob:'))
            details.push(text);
        current = current instanceof Error ? current.cause : undefined;
    }
    return new Error(
        `Unable to load model "${name}": ${details.join(' → ').slice(0, 1500) || 'the GLB could not be decoded'}`,
        { cause }
    );
}

/** Abortable local transport. The validated project container supplies every external byte. */
class AssetTransport extends H.BasicLoader {
    constructor(private readonly signal: AbortSignal) {
        super();
    }
    override async loadRes(
        url: string,
        type?: string
    ): Promise<Awaited<ReturnType<H.BasicLoader['loadRes']>>> {
        if (!url.startsWith('blob:') && !url.startsWith('data:'))
            throw new Error('Project models cannot request external resources.');
        return this.request({
            url,
            type: type === 'json' ? 'json' : type === 'text' ? 'text' : 'buffer',
            signal: this.signal
        });
    }
}

function stopAnimations(root: H.Node): void {
    const animations = new Set<H.Animation>();
    root.traverse(node => {
        if (node.anim) animations.add(node.anim);
    });
    for (const animation of animations) animation.destroy();
}

/** Node.clone supplies independent skin/morph/animation state; retain imported rendering metadata. */
function copyNodeMetadata(source: H.Node, target: H.Node): void {
    target.visible = source.visible;
    if (source instanceof H.Mesh && target instanceof H.Mesh) {
        target.castShadows = source.castShadows;
        target.receiveShadows = source.receiveShadows;
        target.renderOrder = source.renderOrder;
        target.useInstanced = source.useInstanced;
    }
    if (source instanceof H.Light && target instanceof H.Light) {
        target.color.copy(source.color);
        target.amount = source.amount;
        target.enabled = source.enabled;
        target.range = source.range;
        target.lightLayerMask = source.lightLayerMask;
        target.constantAttenuation = source.constantAttenuation;
        target.linearAttenuation = source.linearAttenuation;
        target.quadraticAttenuation = source.quadraticAttenuation;
    }
    if (source instanceof H.DirectionalLight && target instanceof H.DirectionalLight)
        target.direction.copy(source.direction);
    if (source instanceof H.SpotLight && target instanceof H.SpotLight) {
        target.direction.copy(source.direction);
        target.outerCutoff = source.outerCutoff;
        target.cutoff = source.cutoff;
    }
    if (source instanceof H.PerspectiveCamera && target instanceof H.PerspectiveCamera) {
        target.fov = source.fov;
        target.near = source.near;
        target.far = source.far;
        target.aspect = source.aspect;
    }
    if (source instanceof H.OrthographicCamera && target instanceof H.OrthographicCamera) {
        target.left = source.left;
        target.right = source.right;
        target.top = source.top;
        target.bottom = source.bottom;
        target.near = source.near;
        target.far = source.far;
    }
    for (let index = 0; index < source.children.length; index++) {
        const child = source.children[index];
        const clone = target.children[index];
        if (child && clone) copyNodeMetadata(child, clone);
    }
}

/** Reference-counted decoded assets. Viewport instances own every GPU-facing lease explicitly. */
export class EditorAssetRuntime {
    private assets: Readonly<Record<string, ProjectAsset>> = {};
    private readonly textures = new Map<string, TextureEntry>();
    private readonly models = new Map<string, ModelEntry>();
    private destroyed = false;
    private readonly leases = new Set<() => void>();
    private readonly decodedCosts = new Map<string, { hash: string; bytes: number }>();
    private reservedImageBytes = 0;

    constructor(
        private readonly renderer: H.Renderer,
        private readonly imageBudget = EDITOR_DECODED_IMAGE_BUDGET
    ) {
        if (
            !Number.isSafeInteger(imageBudget) ||
            imageBudget < 1 ||
            imageBudget > EDITOR_DECODED_IMAGE_BUDGET
        )
            throw new RangeError('Decoded image budget must be positive and at most 256 MiB.');
    }

    get decodedImageBytes(): number {
        return this.reservedImageBytes;
    }

    /** Preflight the complete next scene before releasing or allocating any active resources. */
    assertSceneBudget(assetIds: readonly string[]): void {
        let total = 0;
        for (const id of new Set(assetIds)) {
            const asset = this.assets[id];
            if (asset) total += this.imageBytes(asset);
        }
        this.requireBudget(total);
    }

    private imageBytes(asset: ProjectAsset): number {
        let cached = this.decodedCosts.get(asset.id);
        if (cached?.hash !== asset.hash) {
            cached = { hash: asset.hash, bytes: assetDecodedImageBytes(asset) };
            this.decodedCosts.set(asset.id, cached);
        }
        return cached.bytes;
    }

    private requireBudget(bytes: number): void {
        if (bytes > this.imageBudget)
            throw new Error(
                `Active textures exceed the ${String(Math.round(this.imageBudget / 1024 / 1024))} MiB decoded image budget. Remove unused texture assignments or import smaller images. This limit counts base-level RGBA pixels; mipmaps and GPU overhead are additional.`
            );
    }

    private reserveImages(asset: ProjectAsset): () => void {
        const bytes = this.imageBytes(asset);
        this.requireBudget(this.reservedImageBytes + bytes);
        this.reservedImageBytes += bytes;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.reservedImageBytes -= bytes;
            }
        };
    }

    setAssets(assets: Readonly<Record<string, ProjectAsset>>): void {
        if (this.destroyed) throw new Error('Asset runtime has been destroyed.');
        const next: Record<string, ProjectAsset> = {};
        for (const [id, asset] of Object.entries(assets)) {
            const checked = validateAsset(asset);
            if (id !== checked.id)
                throw new Error(`Asset record key does not match ${checked.id}.`);
            next[id] = checked;
        }
        this.assets = next;
        for (const id of this.decodedCosts.keys()) if (!next[id]) this.decodedCosts.delete(id);
    }

    has(id: string, kind: ProjectAsset['kind']): boolean {
        return this.assets[id]?.kind === kind;
    }

    acquireTexture(id: string): TextureLease {
        const asset = this.requireAsset(id, 'texture');
        let entry = this.textures.get(id);
        if (!entry) {
            const releaseBudget = this.reserveImages(asset);
            let url: string;
            try {
                url = assetURL(asset);
            } catch (cause) {
                releaseBudget();
                throw cause;
            }
            const image = new Image();
            const texture = new H.Texture<H.TextureImageSource>({
                image: new Uint8Array([255, 255, 255, 255]),
                width: 1,
                height: 1,
                name: asset.name,
                flipY: false
            });
            let settled = false;
            let released = false;
            let rejectLoad: (cause: Error) => void = () => {
                /* Assigned synchronously by the promise executor. */
            };
            const revoke = (): void => {
                URL.revokeObjectURL(url);
                H.BasicLoader.deleteCache(url);
            };
            const ready = new Promise<void>((resolve, reject) => {
                rejectLoad = reject;
                image.onload = (): void => {
                    if (released) return;
                    settled = true;
                    texture.image = image;
                    texture.needUpdate = true;
                    image.onload = null;
                    image.onerror = null;
                    revoke();
                    resolve();
                };
                image.onerror = (): void => {
                    if (released) return;
                    settled = true;
                    image.onload = null;
                    image.onerror = null;
                    revoke();
                    releaseBudget();
                    reject(new Error(`Unable to decode texture ${asset.name}.`));
                };
                image.src = url;
            });
            // A release can abort before the caller attaches its aggregate readiness promise.
            void ready.catch(() => {
                /* Lease readiness retains the original rejection. */
            });
            entry = {
                asset,
                texture,
                ready,
                references: 0,
                dispose: () => {
                    if (released) return;
                    released = true;
                    if (!settled) rejectLoad(aborted());
                    image.onload = null;
                    image.onerror = null;
                    image.src = '';
                    revoke();
                    releaseBudget();
                    texture.destroy();
                    texture.image = null;
                }
            };
            this.textures.set(id, entry);
        }
        const leaseEntry = entry;
        leaseEntry.references++;
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            this.leases.delete(release);
            if (--leaseEntry.references === 0) {
                if (this.textures.get(id) === leaseEntry) this.textures.delete(id);
                leaseEntry.dispose();
            }
        };
        this.leases.add(release);
        return { texture: leaseEntry.texture, ready: leaseEntry.ready, release };
    }

    acquireModel(id: string): ModelLease {
        const asset = this.requireAsset(id, 'model');
        let entry = this.models.get(id);
        if (!entry) {
            const controller = new AbortController();
            entry = {
                asset,
                controller,
                ready: null,
                model: null,
                references: 0,
                released: false,
                releaseBudget: this.reserveImages(asset)
            };
            const loading = entry;
            this.models.set(id, loading);
            loading.ready = this.loadModel(loading);
            void loading.ready.catch(() => {
                /* Consumers observe errors through their lease. */
            });
        }
        const leaseEntry = entry;
        leaseEntry.references++;
        let released = false;
        let instance: ModelInstance | null = null;
        const loading = leaseEntry.ready;
        if (!loading) throw new Error('Model load was not initialized.');
        const ready = loading.then(model => {
            if (released || this.destroyed) throw aborted();
            const root = model.node.clone();
            copyNodeMetadata(model.node, root);
            root.anim?.pause();
            const meshes: H.Mesh[] = [];
            const originalMaterials = new Map<H.Mesh, H.MaterialInstance | null>();
            root.traverse(node => {
                node.anim?.pause();
                if (node instanceof H.Mesh) {
                    meshes.push(node);
                    originalMaterials.set(node, node.material);
                }
            });
            instance = { root, meshes, originalMaterials };
            return instance;
        });
        void ready.catch(() => {
            /* Consumers observe errors through their lease. */
        });
        const release = (): void => {
            if (released) return;
            released = true;
            this.leases.delete(release);
            if (instance) {
                stopAnimations(instance.root);
                instance.root.destroy(this.renderer);
                instance = null;
            }
            if (--leaseEntry.references === 0) this.releaseModelEntry(id, leaseEntry);
        };
        this.leases.add(release);
        return { ready, release };
    }

    private requireAsset(id: string, kind: ProjectAsset['kind']): ProjectAsset {
        if (this.destroyed) throw new Error('Asset runtime has been destroyed.');
        const asset = this.assets[id];
        if (asset?.kind !== kind) throw new Error(`Missing ${kind} asset: ${id}`);
        return asset;
    }

    private async loadModel(entry: ModelEntry): Promise<LoadedModel> {
        let url: string;
        try {
            url = assetURL(entry.asset);
        } catch (cause) {
            entry.releaseBudget();
            throw cause;
        }
        const urls = new Set([url]);
        let model: LoadedModel | null = null;
        try {
            const loader = new H.GLTFLoader(new AssetTransport(entry.controller.signal));
            model = await loader.load({
                src: url,
                isProgressive: true,
                ignoreTextureError: false,
                preHandlerImageURI: uri => {
                    urls.add(uri);
                    return uri;
                }
            });
            await model.ready;
            if (entry.released || this.destroyed) throw aborted();
            model.node.updateMatrixWorld(true);
            model.anim?.pause();
            entry.model = model;
            return model;
        } catch (cause) {
            if (model) this.destroyModel(model);
            entry.releaseBudget();
            throw entry.controller.signal.aborted
                ? aborted()
                : modelLoadError(entry.asset.name, cause);
        } finally {
            for (const uri of urls) {
                URL.revokeObjectURL(uri);
                H.BasicLoader.deleteCache(uri);
            }
        }
    }

    private destroyModel(model: LoadedModel): void {
        stopAnimations(model.node);
        if (model.anim && model.node.anim !== model.anim) model.anim.destroy();
        model.node.destroy(this.renderer);
        for (const texture of new Set(model.textures)) {
            texture.destroy();
            texture.image = null;
        }
    }

    private releaseModelEntry(id: string, entry: ModelEntry): void {
        if (entry.released) return;
        entry.released = true;
        entry.controller.abort();
        if (this.models.get(id) === entry) this.models.delete(id);
        if (entry.model) {
            this.destroyModel(entry.model);
            entry.model = null;
            entry.releaseBudget();
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const release of [...this.leases]) release();
        this.leases.clear();
        for (const entry of this.textures.values()) entry.dispose();
        this.textures.clear();
        for (const [id, entry] of this.models) this.releaseModelEntry(id, entry);
        this.models.clear();
        this.assets = {};
        this.decodedCosts.clear();
    }
}
