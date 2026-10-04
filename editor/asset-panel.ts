import { importAsset, type ProjectAsset } from './assets';
import { AssetThumbnailCache, type AssetThumbnailLease } from './asset-thumbnails';
import { icon } from './icons';
import { validateProject, type ProjectDocument } from './project';
import type { SceneMaterial, SceneNode } from './scene';
import './project-panel.css';

export interface AssetReference {
    owner: string;
    objectId: string;
    property: string;
}

/** Reports authored dependencies in every scene, reusable prefab and instance merge baseline. */
export function assetReferences(project: ProjectDocument, assetId: string): AssetReference[] {
    const references: AssetReference[] = [];
    const inspect = (
        owner: string,
        nodes: Record<string, SceneNode>,
        materials: Record<string, SceneMaterial>
    ): void => {
        for (const [id, node] of Object.entries(nodes))
            if (node.asset === assetId) references.push({ owner, objectId: id, property: 'asset' });
        for (const [id, material] of Object.entries(materials)) {
            for (const slot of [
                'baseColorTexture',
                'normalTexture',
                'metallicRoughnessTexture',
                'emissiveTexture'
            ] as const)
                if (material[slot] === assetId)
                    references.push({ owner, objectId: id, property: slot });
        }
    };
    for (const [id, scene] of Object.entries(project.scenes))
        inspect(`scene ${id}`, scene.nodes, scene.materials);
    for (const [id, prefab] of Object.entries(project.prefabs))
        inspect(`prefab ${id}`, prefab.nodes, prefab.materials);
    for (const [id, instance] of Object.entries(project.instances))
        inspect(`instance ${id} baseline`, instance.baseline.nodes, instance.baseline.materials);
    return references;
}

/** Removing a referenced asset is rejected, preserving all cross-scene and prefab references. */
export function removeProjectAsset(project: ProjectDocument, id: string): ProjectDocument {
    if (!Object.hasOwn(project.assets, id))
        throw new Error('This asset is no longer in the project');
    const references = assetReferences(project, id);
    if (references.length > 0)
        throw new Error(
            `Asset is used by ${String(references.length)} references: ${references
                .slice(0, 3)
                .map(reference => `${reference.owner} / ${reference.objectId}`)
                .join(', ')}. Remove or replace these references first.`
        );
    const next = structuredClone(project);
    Reflect.deleteProperty(next.assets, id);
    return validateProject(next);
}

/** Apply a texture to the selected material or instantiate a model with a new semantic node ID. */
export function useProjectAsset(
    project: ProjectDocument,
    id: string,
    selected: string | null
): { project: ProjectDocument; nodeId: string } {
    const next = structuredClone(project);
    const asset = next.assets[id];
    const scene = next.scenes[next.activeSceneId];
    if (!asset || !scene) throw new Error('Asset or active scene is unavailable');
    const node = selected ? scene.nodes[selected] : undefined;
    let ancestor = node;
    while (ancestor) {
        if (ancestor.locked)
            throw new Error(
                'Unlock the selected object and its parent collection before applying assets'
            );
        ancestor = ancestor.parent ? scene.nodes[ancestor.parent] : undefined;
    }
    if (asset.kind === 'texture') {
        const material = node?.material ? scene.materials[node.material] : undefined;
        if (!selected || node?.type !== 'mesh' || !material)
            throw new Error('Select a mesh with a material before applying a texture');
        material.baseColorTexture = id;
        return { project: validateProject(next), nodeId: selected };
    }
    let counter = 1;
    const stem = `model-${id.slice(0, 40).replace(/-+$/u, '')}`;
    let nodeId = `${stem}-${String(counter).padStart(3, '0')}`;
    while (Object.hasOwn(scene.nodes, nodeId))
        nodeId = `${stem}-${String(++counter).padStart(3, '0')}`;
    scene.nodes[nodeId] = {
        name: asset.name.replace(/\.glb$/iu, ''),
        type: 'model',
        asset: id,
        parent: node?.type === 'group' && selected ? selected : null,
        visible: true,
        transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };
    return { project: validateProject(next), nodeId };
}

export interface AssetPanelOptions {
    getProject(): ProjectDocument;
    getSelected(): string | null;
    onCommit(project: ProjectDocument, label: string): void;
    onSelect(id: string | null): void;
    onNotify(message: string, error?: boolean): void;
}

function escape(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}

function bytesLabel(size: number): string {
    return size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Imported project assets, with owned previews and transactional multi-file import. */
export class AssetPanel {
    private host: HTMLElement | null = null;
    private filter = '';
    private importing = false;
    private destroyed = false;
    private readonly thumbnails = new AssetThumbnailCache();
    private previewObserver: IntersectionObserver | null = null;
    private readonly previewRequests = new Map<string, AbortController>();
    private readonly previewLeases = new Set<AssetThumbnailLease>();
    private previewGeneration = 0;

    constructor(private readonly options: AssetPanelOptions) {}

    render(host: HTMLElement, filter = ''): void {
        if (this.destroyed) return;
        if (this.host !== host) {
            this.detach();
            this.host = host;
            host.addEventListener('click', this.click);
            host.addEventListener('change', this.change);
            host.addEventListener('submit', this.saveSource);
            host.addEventListener('dragover', this.dragover);
            host.addEventListener('dragleave', this.dragleave);
            host.addEventListener('drop', this.drop);
        }
        this.filter = filter;
        const project = this.options.getProject();
        this.cancelPreviews();
        const assets = Object.values(project.assets).filter(asset =>
            `${asset.name} ${asset.kind} ${asset.source.fileName}`
                .toLowerCase()
                .includes(filter.toLowerCase())
        );
        host.innerHTML = `<div class="project-assets-toolbar"><span>${String(Object.keys(project.assets).length)} source assets <b>·</b> GLB / PNG / JPEG / WebP</span><button class="primary" data-asset-action="import" ${this.importing ? 'disabled' : ''}>${icon('import')}${this.importing ? 'Importing…' : 'Import assets'}</button><input class="project-asset-input" type="file" accept=".glb,.png,.jpg,.jpeg,.webp" multiple hidden aria-label="Import asset files" /></div><div class="project-assets-grid">${assets.map(asset => this.card(project, asset)).join('') || `<div class="project-assets-empty">${icon('import')}<strong>${filter ? 'No matching assets' : 'Bring your project to life'}</strong><span>${filter ? 'Try another name or file type.' : 'Drop models and textures here, or choose Import assets.'}</span><small>Files stay in this project and are included in project exports.</small></div>`}</div>`;
        const generation = this.previewGeneration;
        const projectId = project.id;
        this.previewObserver = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    const target = entry.target;
                    if (!(target instanceof HTMLElement)) continue;
                    const id = target.dataset['thumbnailAsset'];
                    if (!id) continue;
                    if (entry.isIntersecting)
                        this.requestThumbnail(target, id, projectId, generation);
                    else this.previewRequests.get(id)?.abort();
                }
            },
            { root: host.querySelector('.project-assets-grid'), rootMargin: '160px' }
        );
        for (const target of host.querySelectorAll<HTMLElement>('[data-thumbnail-asset]'))
            this.previewObserver.observe(target);
    }

    /** Imports the whole batch or none; a project switch during import cancels the transaction. */
    async importFiles(files: readonly File[]): Promise<void> {
        if (this.destroyed || files.length === 0) return;
        if (this.importing) throw new Error('An asset import is already in progress');
        if (files.length > 128) throw new Error('Import at most 128 assets at a time');
        const projectId = this.options.getProject().id;
        this.importing = true;
        this.rerender();
        try {
            const imported: ProjectAsset[] = [];
            for (const file of files) imported.push(await importAsset(file));
            if (this.isDestroyed()) return;
            const current = this.options.getProject();
            if (current.id !== projectId)
                throw new Error('Project changed during import; no assets were added');
            const next = structuredClone(current);
            let added = 0;
            for (const asset of imported) {
                const previous = next.assets[asset.id];
                if (previous && previous.hash !== asset.hash)
                    throw new Error(
                        `Asset ID collision for ${asset.name}; rename the source file and import again`
                    );
                if (!previous) {
                    next.assets[asset.id] = asset;
                    added += 1;
                }
            }
            if (added > 0)
                this.options.onCommit(validateProject(next), `Imported ${String(added)} assets`);
            this.options.onNotify(
                added > 0
                    ? `Imported ${String(added)} source assets into the project`
                    : 'These assets are already in the project'
            );
        } finally {
            this.importing = false;
            this.rerender();
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.detach();
        this.cancelPreviews();
        this.thumbnails.destroy();
        this.host = null;
    }

    private card(project: ProjectDocument, asset: ProjectAsset): string {
        const preview = icon(asset.kind === 'model' ? 'cube' : 'material');
        const references = assetReferences(project, asset.id);
        return `<article class="project-asset-card"><button class="project-asset-preview ${asset.kind}" data-asset-action="use" data-asset-id="${asset.id}" ${asset.kind === 'texture' ? `data-thumbnail-asset="${asset.id}"` : ''} aria-label="${asset.kind === 'model' ? 'Add model' : 'Apply texture'} ${escape(asset.name)}">${preview}<span>${asset.kind === 'model' ? 'GLB' : asset.mimeType.slice(6).toUpperCase()}</span></button><input class="project-asset-name" data-asset-name="${asset.id}" aria-label="Asset name ${escape(asset.name)}" value="${escape(asset.name)}" maxlength="120"/><div class="project-asset-meta"><span>${bytesLabel(asset.size)} · ${String(references.length)} uses</span><button data-asset-action="remove" data-asset-id="${asset.id}" aria-label="Remove asset ${escape(asset.name)}" title="${references.length ? 'Referenced assets must be detached before removal' : 'Remove unused asset'}">${icon('trash')}</button></div><span class="project-asset-source" title="${escape(asset.source.fileName)} · SHA-256 ${asset.hash}">${escape(asset.source.fileName)}</span><details class="asset-provenance"><summary>Source & license</summary><form data-asset-source="${asset.id}"><label>License<input name="license" aria-label="Asset license ${escape(asset.name)}" maxlength="120" value="${escape(asset.source.license ?? '')}"/></label><label>Attribution<input name="attribution" aria-label="Asset attribution ${escape(asset.name)}" maxlength="2000" value="${escape(asset.source.attribution ?? '')}"/></label><label>Source URL<input name="originURL" type="url" aria-label="Asset source URL ${escape(asset.name)}" maxlength="2048" value="${escape(asset.source.originURL ?? '')}"/></label><small>Included in project exports.</small><button type="submit">Save source info</button></form></details></article>`;
    }

    private cancelPreviews(): void {
        this.previewGeneration += 1;
        this.previewObserver?.disconnect();
        this.previewObserver = null;
        for (const request of this.previewRequests.values()) request.abort();
        this.previewRequests.clear();
        for (const lease of this.previewLeases) lease.release();
        this.previewLeases.clear();
    }
    private previewIsCurrent(target: HTMLElement, projectId: string, generation: number): boolean {
        return (
            !this.destroyed &&
            generation === this.previewGeneration &&
            target.isConnected &&
            !!this.host?.contains(target) &&
            this.options.getProject().id === projectId
        );
    }
    private requestThumbnail(
        target: HTMLElement,
        id: string,
        projectId: string,
        generation: number
    ): void {
        if (
            target.querySelector('img') ||
            this.previewRequests.has(id) ||
            !this.previewIsCurrent(target, projectId, generation)
        )
            return;
        const asset = this.options.getProject().assets[id];
        if (!asset) return;
        const request = new AbortController();
        this.previewRequests.set(id, request);
        void this.thumbnails
            .acquire(asset, request.signal)
            .then(lease => {
                if (
                    request.signal.aborted ||
                    !this.previewIsCurrent(target, projectId, generation)
                ) {
                    lease.release();
                    return;
                }
                this.previewLeases.add(lease);
                const image = document.createElement('img');
                image.alt = '';
                image.style.objectFit = 'contain';
                image.width = lease.width;
                image.height = lease.height;
                const finish = (): void => {
                    this.previewLeases.delete(lease);
                    lease.release();
                };
                image.onload = finish;
                image.onerror = () => {
                    finish();
                    if (this.previewIsCurrent(target, projectId, generation)) {
                        image.remove();
                        target.dataset['thumbnailError'] = 'true';
                    }
                };
                target.querySelector('.icon')?.remove();
                target.prepend(image);
                image.src = lease.url;
            })
            .catch((error: unknown) => {
                if (request.signal.aborted || !this.previewIsCurrent(target, projectId, generation))
                    return;
                target.dataset['thumbnailError'] = 'true';
                target.title = error instanceof Error ? error.message : String(error);
            })
            .finally(() => {
                if (this.previewRequests.get(id) === request) this.previewRequests.delete(id);
                if (
                    request.signal.aborted &&
                    target.dataset['thumbnailVisible'] === 'true' &&
                    this.previewIsCurrent(target, projectId, generation)
                )
                    this.requestThumbnail(target, id, projectId, generation);
            });
    }

    private isDestroyed(): boolean {
        return this.destroyed;
    }

    private rerender(): void {
        if (this.host?.querySelector('.project-assets-toolbar') && !this.destroyed)
            this.render(this.host, this.filter);
    }
    private detach(): void {
        this.host?.removeEventListener('click', this.click);
        this.host?.removeEventListener('change', this.change);
        this.host?.removeEventListener('submit', this.saveSource);
        this.host?.removeEventListener('dragover', this.dragover);
        this.host?.removeEventListener('dragleave', this.dragleave);
        this.host?.removeEventListener('drop', this.drop);
    }
    private report(error: unknown): void {
        this.options.onNotify(error instanceof Error ? error.message : String(error), true);
    }
    private readonly click = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLElement>('[data-asset-action]');
        if (!button) return;
        const action = button.dataset['assetAction'];
        const id = button.dataset['assetId'];
        try {
            if (action === 'import')
                this.host?.querySelector<HTMLInputElement>('.project-asset-input')?.click();
            else if (action === 'use' && id) {
                const result = useProjectAsset(
                    this.options.getProject(),
                    id,
                    this.options.getSelected()
                );
                this.options.onCommit(result.project, 'Asset applied');
                this.options.onSelect(result.nodeId);
                this.rerender();
            } else if (action === 'remove' && id) {
                this.options.onCommit(
                    removeProjectAsset(this.options.getProject(), id),
                    'Unused asset removed'
                );
                this.rerender();
            }
        } catch (error) {
            this.report(error);
        }
    };
    private readonly change = (event: Event): void => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.type === 'file') {
            const files = Array.from(input.files ?? []);
            input.value = '';
            void this.importFiles(files).catch((error: unknown) => {
                this.report(error);
            });
            return;
        }
        const id = input.dataset['assetName'];
        if (!id) return;
        try {
            const project = structuredClone(this.options.getProject());
            const asset = project.assets[id];
            if (!asset) throw new Error('Asset is no longer available');
            asset.name = input.value.trim();
            this.options.onCommit(validateProject(project), 'Asset renamed');
            this.rerender();
        } catch (error) {
            this.report(error);
            this.rerender();
        }
    };
    private readonly saveSource = (event: SubmitEvent): void => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.dataset['assetSource']) return;
        event.preventDefault();
        try {
            const project = structuredClone(this.options.getProject());
            const asset = project.assets[form.dataset['assetSource']];
            if (!asset) throw new Error('Asset is no longer available.');
            const fields = new FormData(form);
            for (const key of ['license', 'attribution', 'originURL'] as const) {
                const entry = fields.get(key);
                const value = typeof entry === 'string' ? entry.trim() : '';
                if (value) asset.source[key] = value;
                else Reflect.deleteProperty(asset.source, key);
            }
            this.options.onCommit(validateProject(project), 'Asset source metadata saved');
            this.rerender();
        } catch (error) {
            this.report(error);
        }
    };
    private readonly dragover = (event: DragEvent): void => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        this.host?.classList.add('project-assets-dropping');
    };
    private readonly dragleave = (): void => {
        this.host?.classList.remove('project-assets-dropping');
    };
    private readonly drop = (event: DragEvent): void => {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        this.host?.classList.remove('project-assets-dropping');
        void this.importFiles(Array.from(event.dataTransfer.files)).catch((error: unknown) => {
            this.report(error);
        });
    };
}
