import { icon } from './icons';
import {
    createPrefab,
    instantiatePrefab,
    prefabFromInstance,
    prefabOverrides,
    updatePrefabInstance,
    type PrefabInstance
} from './prefabs';
import type { ProjectDocument } from './project';

export interface PrefabPanelOptions {
    getProject: () => ProjectDocument;
    getSelected: () => string | null;
    onCommit: (project: ProjectDocument, message: string) => void;
    onSelect: (id: string | null) => void;
    onNotify: (message: string, error?: boolean) => void;
}
function escape(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        key => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[key] ?? key
    );
}
function unique(prefix: string, records: Record<string, unknown>): string {
    let count = 1;
    while (records[`${prefix}-${String(count)}`]) count++;
    return `${prefix}-${String(count)}`;
}
export class PrefabPanel {
    constructor(private readonly options: PrefabPanelOptions) {}
    render(host: HTMLElement, filter = ''): void {
        const project = this.options.getProject();
        host.innerHTML = `<div class="authoring-library-actions"><button data-prefab-action="create">${icon('plus')}Create from selection</button><span>Reusable objects with tracked overrides</span></div><div class="asset-grid">${
            Object.values(project.prefabs)
                .filter(prefab => prefab.name.toLowerCase().includes(filter.toLowerCase()))
                .map(
                    prefab =>
                        `<div class="authoring-asset"><button class="asset-card" data-prefab-add="${prefab.id}"><div class="asset-thumbnail">${icon('group')}</div><strong>${escape(prefab.name)}</strong><span>${String(Object.keys(prefab.nodes).length)} objects · click to instantiate</span></button><button class="asset-remove" data-prefab-delete="${prefab.id}" aria-label="Delete ${escape(prefab.name)} template">${icon('trash')}</button></div>`
                )
                .join('') ||
            '<p class="library-empty">Select an object or collection, then create your first prefab.</p>'
        }</div>`;
        host.onclick = event => {
            if (event.target instanceof Element)
                this.handle(event.target.closest<HTMLElement>('button'));
        };
    }
    renderInspector(host: HTMLElement): void {
        const project = this.options.getProject();
        const id = this.options.getSelected();
        if (!id) return;
        const instance = this.findInstance(project, id);
        const section = document.createElement('section');
        section.className = 'property-section prefab-section';
        section.innerHTML = instance
            ? `<h3>${icon('group')}Prefab instance<span>${escape(project.prefabs[instance.prefabId]?.name ?? instance.prefabId)}</span></h3><p class="property-hint">${String(prefabOverrides(project.scenes[project.activeSceneId] ?? this.scene(project), instance).length)} instance overrides</p><div class="property-button-row"><button data-prefab-action="apply">Apply to template</button><button data-prefab-action="revert">Revert overrides</button><button data-prefab-action="unpack">Unpack</button></div>`
            : `<h3>${icon('group')}Reusable object</h3><button class="property-wide-button" data-prefab-action="create">Create prefab from selection</button>`;
        section.addEventListener('click', event => {
            if (event.target instanceof Element)
                this.handle(event.target.closest<HTMLElement>('button'));
        });
        host.append(section);
    }
    create(): void {
        const project = this.options.getProject();
        const rootId = this.options.getSelected();
        if (!rootId) throw new Error('Select an object or collection first.');
        if (this.findInstance(project, rootId))
            throw new Error('Unpack this prefab instance before creating a new template from it.');
        const scene = this.scene(project);
        const name = scene.nodes[rootId]?.name;
        if (!name) throw new Error('Selected object is missing.');
        const prefabId = unique('prefab', project.prefabs);
        const prefab = createPrefab(scene, rootId, prefabId, name);
        const instanceId = unique('instance', project.instances);
        project.prefabs[prefabId] = prefab;
        project.instances[instanceId] = {
            id: instanceId,
            prefabId,
            sceneId: project.activeSceneId,
            rootId,
            nodeMap: Object.fromEntries(Object.keys(prefab.nodes).map(id => [id, id])),
            materialMap: Object.fromEntries(Object.keys(prefab.materials).map(id => [id, id])),
            baseline: structuredClone(prefab)
        };
        this.options.onCommit(project, 'Prefab created and selection linked');
    }
    private scene(project: ProjectDocument): ProjectDocument['scenes'][string] {
        const scene = project.scenes[project.activeSceneId];
        if (!scene) throw new Error('Active scene is missing.');
        return scene;
    }
    private findInstance(project: ProjectDocument, nodeId: string): PrefabInstance | undefined {
        return Object.values(project.instances).find(
            instance =>
                instance.sceneId === project.activeSceneId &&
                Object.values(instance.nodeMap).includes(nodeId)
        );
    }
    private handle(button: HTMLElement | null): void {
        if (!button) return;
        try {
            const action = button.dataset['prefabAction'];
            if (action === 'create') {
                this.create();
                return;
            }
            const project = this.options.getProject();
            const scene = this.scene(project);
            const add = button.dataset['prefabAdd'];
            if (add) {
                const prefab = project.prefabs[add];
                if (!prefab) return;
                const result = instantiatePrefab(
                    scene,
                    prefab,
                    project.activeSceneId,
                    unique('instance', project.instances)
                );
                const root = result.scene.nodes[result.instance.rootId];
                if (root)
                    root.transform.position.x = Math.min(10000, root.transform.position.x + 0.8);
                project.scenes[project.activeSceneId] = result.scene;
                project.instances[result.instance.id] = result.instance;
                this.options.onCommit(project, 'Prefab instantiated');
                this.options.onSelect(result.instance.rootId);
                return;
            }
            const remove = button.dataset['prefabDelete'];
            if (remove) {
                if (Object.values(project.instances).some(instance => instance.prefabId === remove))
                    throw new Error('Unpack all instances before deleting this template.');
                project.prefabs = Object.fromEntries(
                    Object.entries(project.prefabs).filter(([id]) => id !== remove)
                );
                this.options.onCommit(project, 'Prefab template deleted');
                return;
            }
            const selected = this.options.getSelected();
            const instance = selected ? this.findInstance(project, selected) : undefined;
            if (!instance) return;
            const prefab = project.prefabs[instance.prefabId];
            if (!prefab) return;
            if (action === 'unpack') {
                project.instances = Object.fromEntries(
                    Object.entries(project.instances).filter(([id]) => id !== instance.id)
                );
                this.options.onCommit(project, 'Instance unpacked; objects retained');
            } else if (action === 'revert') {
                const result = updatePrefabInstance(scene, prefab, instance, true);
                project.scenes[project.activeSceneId] = result.scene;
                project.instances[instance.id] = result.instance;
                this.options.onCommit(project, 'Prefab overrides reverted');
            } else if (action === 'apply') {
                const updated = prefabFromInstance(scene, instance);
                project.prefabs[updated.id] = updated;
                const warnings: string[] = [];
                for (const item of Object.values(project.instances)) {
                    if (item.prefabId !== updated.id) continue;
                    const target = project.scenes[item.sceneId];
                    if (!target) continue;
                    const result = updatePrefabInstance(target, updated, item);
                    project.scenes[item.sceneId] = result.scene;
                    project.instances[item.id] = result.instance;
                    warnings.push(...result.warnings);
                }
                for (const clip of Object.values(project.clips)) {
                    const target = project.scenes[clip.sceneId];
                    if (target)
                        clip.tracks = clip.tracks.filter(track =>
                            Object.hasOwn(target.nodes, track.nodeId)
                        );
                }
                this.options.onCommit(project, 'Template and linked instances updated');
                if (warnings.length) this.options.onNotify(warnings.join(' '));
            }
        } catch (error) {
            this.options.onNotify(error instanceof Error ? error.message : String(error), true);
        }
    }
}
