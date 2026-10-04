import { cloneScene, type SceneDocument } from './scene';
import { validateProject, type ProjectDocument } from './project';
import type { ProjectAsset } from './assets';

type Snapshot = Omit<ProjectDocument, 'assets' | 'revision' | 'updatedAt'> & {
    assetMetadata: Record<string, Omit<ProjectAsset, 'data'>>;
};
interface HistoryEntry {
    source: string;
    metadataBytes: number;
    hashes: string[];
}
interface PooledAsset {
    data: string;
    bytes: number;
    references: number;
}

/** Optional tighter limits; production maxima cannot be raised through these options. */
export interface ProjectHistoryOptions {
    maxEntries?: number;
    maxAssetBytes?: number;
    maxMetadataBytes?: number;
}

/** Logical retained bytes; metadata measures canonical UTF-8 JSON, not JavaScript heap overhead. */
export interface ProjectHistoryMemoryUsage {
    entries: number;
    assetBytes: number;
    metadataBytes: number;
    /** A single current snapshot is preserved even when it exceeds a tighter history limit. */
    overBudget: boolean;
}

const MAX_ENTRIES = 80;
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 32 * 1024 * 1024;

function limit(value: number | undefined, maximum: number, name: string): number {
    if (value === undefined) return maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error(`${name} must be a positive integer no greater than ${String(maximum)}`);
    return value;
}

/** Bounded immutable project history. Binary source bytes are interned once per retained hash. */
export class ProjectHistory {
    private readonly assets = new Map<string, PooledAsset>();
    private readonly entries: HistoryEntry[] = [];
    private readonly maxEntries: number;
    private readonly maxAssetBytes: number;
    private readonly maxMetadataBytes: number;
    private assetBytes = 0;
    private metadataBytes = 0;
    private index = 0;
    private revision: number;
    private updatedAt: string;

    constructor(project: ProjectDocument, options: ProjectHistoryOptions = {}) {
        this.maxEntries = limit(options.maxEntries, MAX_ENTRIES, 'maxEntries');
        this.maxAssetBytes = limit(options.maxAssetBytes, MAX_ASSET_BYTES, 'maxAssetBytes');
        this.maxMetadataBytes = limit(
            options.maxMetadataBytes,
            MAX_METADATA_BYTES,
            'maxMetadataBytes'
        );
        const valid = validateProject(project);
        this.revision = valid.revision;
        this.updatedAt = valid.updatedAt;
        this.retain(this.snapshot(valid), valid);
    }
    get canUndo(): boolean {
        return this.index > 0;
    }
    get canRedo(): boolean {
        return this.index < this.entries.length - 1;
    }
    get memoryUsage(): ProjectHistoryMemoryUsage {
        return {
            entries: this.entries.length,
            assetBytes: this.assetBytes,
            metadataBytes: this.metadataBytes,
            overBudget: this.exceedsBudget()
        };
    }
    get project(): ProjectDocument {
        const entry = this.entries[this.index];
        if (!entry) throw new Error('Project history is empty.');
        // Entries are serialized only after validateProject succeeds and are never exposed.
        const { assetMetadata, ...document } = JSON.parse(entry.source) as Snapshot;
        const assets: Record<string, ProjectAsset> = {};
        for (const [id, metadata] of Object.entries(assetMetadata)) {
            const pooled = this.assets.get(metadata.hash);
            if (!pooled) throw new Error(`History asset is missing: ${id}`);
            assets[id] = { ...metadata, data: pooled.data };
        }
        return { ...document, revision: this.revision, updatedAt: this.updatedAt, assets };
    }
    get scene(): SceneDocument {
        const project = this.project;
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Active project scene is missing.');
        return cloneScene(scene);
    }
    /** Save metadata never rewinds when authored changes are undone. */
    markSaved(revision: number, updatedAt: string): void {
        this.revision = revision;
        this.updatedAt = updatedAt;
    }
    commit(scene: SceneDocument): boolean {
        const project = this.project;
        project.scenes[project.activeSceneId] = cloneScene(scene);
        project.instances = Object.fromEntries(
            Object.entries(project.instances).filter(
                ([, instance]) =>
                    instance.sceneId !== project.activeSceneId || scene.nodes[instance.rootId]
            )
        );
        for (const clip of Object.values(project.clips))
            if (clip.sceneId === project.activeSceneId)
                clip.tracks = clip.tracks.filter(track => scene.nodes[track.nodeId]);
        return this.commitProject(project);
    }
    commitProject(project: ProjectDocument): boolean {
        const valid = validateProject(project);
        const next = this.snapshot(valid);
        if (next.source === this.entries[this.index]?.source) return false;
        // A new branch discards only redo snapshots, releasing their unique binary sources.
        for (const entry of this.entries.splice(this.index + 1)) this.release(entry);
        this.retain(next, valid);
        this.index = this.entries.length - 1;
        while (this.entries.length > 1 && this.exceedsBudget()) {
            const oldest = this.entries.shift();
            if (oldest) this.release(oldest);
            this.index -= 1;
        }
        return true;
    }
    undo(): SceneDocument {
        if (this.canUndo) this.index -= 1;
        return this.scene;
    }
    redo(): SceneDocument {
        if (this.canRedo) this.index += 1;
        return this.scene;
    }

    private exceedsBudget(): boolean {
        return (
            this.entries.length > this.maxEntries ||
            this.assetBytes > this.maxAssetBytes ||
            this.metadataBytes > this.maxMetadataBytes
        );
    }
    private retain(entry: HistoryEntry, project: ProjectDocument): void {
        const byHash = new Map(Object.values(project.assets).map(asset => [asset.hash, asset]));
        for (const hash of entry.hashes) {
            const asset = byHash.get(hash);
            if (!asset) throw new Error(`Snapshot asset is missing: ${hash}`);
            const existing = this.assets.get(hash);
            if (existing) {
                if (existing.data !== asset.data || existing.bytes !== asset.size)
                    throw new Error('Asset content hash collision in project history');
                existing.references += 1;
            } else {
                this.assets.set(hash, { data: asset.data, bytes: asset.size, references: 1 });
                this.assetBytes += asset.size;
            }
        }
        this.entries.push(entry);
        this.metadataBytes += entry.metadataBytes;
    }
    private release(entry: HistoryEntry): void {
        this.metadataBytes -= entry.metadataBytes;
        for (const hash of entry.hashes) {
            const asset = this.assets.get(hash);
            if (!asset) throw new Error(`Retained asset is missing: ${hash}`);
            asset.references -= 1;
            if (asset.references === 0) {
                this.assets.delete(hash);
                this.assetBytes -= asset.bytes;
            }
        }
    }
    private snapshot(project: ProjectDocument): HistoryEntry {
        const { assets, ...document } = project;
        Reflect.deleteProperty(document, 'revision');
        Reflect.deleteProperty(document, 'updatedAt');
        const assetMetadata: Record<string, Omit<ProjectAsset, 'data'>> = {};
        for (const [id, asset] of Object.entries(assets)) {
            const metadata = { ...asset };
            Reflect.deleteProperty(metadata, 'data');
            assetMetadata[id] = metadata;
        }
        const source = JSON.stringify({ ...document, assetMetadata });
        return {
            source,
            metadataBytes: new TextEncoder().encode(source).byteLength,
            hashes: [...new Set(Object.values(assets).map(asset => asset.hash))]
        };
    }
}
