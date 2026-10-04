import { icon } from './icons';
import { createScript, validateScript } from './script-types';
import type { ProjectDocument } from './project';

export interface ScriptPanelOptions {
    getProject: () => ProjectDocument;
    getSelected: () => string | null;
    onCommit: (project: ProjectDocument, message: string) => void;
    onNotify: (message: string, error?: boolean) => void;
}
function escape(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        key => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[key] ?? key
    );
}
export class ScriptPanel {
    private readonly dialog = document.createElement('dialog');
    private editing: string | null = null;
    private library: HTMLElement | null = null;
    constructor(
        root: HTMLElement,
        private readonly options: ScriptPanelOptions
    ) {
        this.dialog.className = 'source-dialog script-dialog';
        this.dialog.setAttribute('aria-label', 'Script editor');
        this.dialog.innerHTML = `<div class="dialog-heading"><div>${icon('code')}<strong>Script asset</strong><span>JavaScript · isolated worker</span></div><button data-script-close aria-label="Close script editor">${icon('close')}</button></div><div class="script-details"><label>Name<input id="script-name" aria-label="Script name" maxlength="120"/></label><label><input id="script-enabled" type="checkbox" aria-label="Script enabled"/> Enabled in Play mode</label></div><div class="source-intro">Use start(ctx), update(ctx, dt), stop(ctx). ctx: position, rotation, scale, time, input, setPosition, translate, setRotation, rotate, setScale, log.</div><textarea spellcheck="false" id="script-source" aria-label="Script source"></textarea><div class="source-error" role="alert"></div><div class="dialog-footer"><span>Source stays inert until Play. Rotation: degrees. dt: seconds. No DOM, storage or network.</span><button data-script-bind>Save & attach to selection</button><button class="primary" data-script-save>Save script</button></div>`;
        this.dialog.addEventListener('click', this.click);
        this.dialog.addEventListener('keydown', event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                event.stopPropagation();
                this.save(false);
            }
        });
        root.append(this.dialog);
    }
    render(host: HTMLElement, filter = ''): void {
        this.library = host;
        const project = this.options.getProject();
        host.innerHTML = `<div class="authoring-library-actions"><button data-script-new>${icon('plus')}New script</button><span>Explicit Play · runtime changes never overwrite authored state</span></div><div class="asset-grid">${
            Object.values(project.scripts)
                .filter(script => script.name.toLowerCase().includes(filter.toLowerCase()))
                .map(
                    script =>
                        `<div class="authoring-asset"><button class="asset-card" data-script-edit="${script.id}"><div class="asset-thumbnail">${icon('code')}</div><strong>${escape(script.name)}</strong><span>${script.enabled ? 'Enabled' : 'Disabled'} · JavaScript</span></button><button class="asset-remove" data-script-delete="${script.id}" aria-label="Delete script ${escape(script.name)}">${icon('trash')}</button></div>`
                )
                .join('') ||
            '<p class="library-empty">Create a script, attach it to an object, and enter Play mode.</p>'
        }</div>`;
        host.addEventListener('click', this.click);
    }
    renderInspector(host: HTMLElement): void {
        const project = this.options.getProject();
        const selected = this.options.getSelected();
        const node = selected ? project.scenes[project.activeSceneId]?.nodes[selected] : undefined;
        if (!node) return;
        const section = document.createElement('section');
        section.className = 'property-section script-section';
        section.innerHTML = `<h3>${icon('code')}Scripts<span>${String(node.scripts?.length ?? 0)} attached</span></h3>${(node.scripts ?? []).map(id => `<div class="script-binding"><button data-script-edit="${id}">${escape(project.scripts[id]?.name ?? id)}</button><button data-script-detach="${id}" aria-label="Detach ${escape(project.scripts[id]?.name ?? id)}">${icon('close')}</button></div>`).join('')}<label class="property-field"><span>Attach</span><select aria-label="Attach script"><option value="">Choose script…</option>${Object.values(
            project.scripts
        )
            .filter(script => !node.scripts?.includes(script.id))
            .map(script => `<option value="${script.id}">${escape(script.name)}</option>`)
            .join('')}</select></label>`;
        section.addEventListener('click', this.click);
        section.querySelector('select')?.addEventListener('change', event => {
            if (event.target instanceof HTMLSelectElement && event.target.value)
                this.attach(event.target.value);
        });
        host.append(section);
    }
    destroy(): void {
        this.library?.removeEventListener('click', this.click);
        this.dialog.remove();
    }
    private query<T extends HTMLElement>(selector: string, type: new () => T): T {
        const result = this.dialog.querySelector(selector);
        if (!(result instanceof type)) throw new Error(`Missing script editor control ${selector}`);
        return result;
    }
    private open(id: string): void {
        const script = this.options.getProject().scripts[id];
        if (!script) return;
        this.editing = id;
        this.query('#script-name', HTMLInputElement).value = script.name;
        this.query('#script-enabled', HTMLInputElement).checked = script.enabled;
        this.query('#script-source', HTMLTextAreaElement).value = script.source;
        this.query('.source-error', HTMLDivElement).textContent = '';
        if (!this.dialog.open) this.dialog.showModal();
    }
    private save(attach: boolean): void {
        if (!this.editing) return;
        try {
            const project = this.options.getProject();
            const script = validateScript({
                id: this.editing,
                name: this.query('#script-name', HTMLInputElement).value.trim(),
                source: this.query('#script-source', HTMLTextAreaElement).value,
                enabled: this.query('#script-enabled', HTMLInputElement).checked
            });
            project.scripts[script.id] = script;
            if (attach) {
                const selected = this.options.getSelected();
                const node = selected
                    ? project.scenes[project.activeSceneId]?.nodes[selected]
                    : undefined;
                if (!node || !selected) throw new Error('Select an object to attach this script.');
                this.ensureEditable(project, selected);
                node.scripts = [...new Set([...(node.scripts ?? []), script.id])];
            }
            this.options.onCommit(project, attach ? 'Script saved and attached' : 'Script saved');
            this.dialog.close();
        } catch (error) {
            this.query('.source-error', HTMLDivElement).textContent =
                error instanceof Error ? error.message : String(error);
        }
    }
    private ensureEditable(project: ProjectDocument, selected: string): void {
        const scene = project.scenes[project.activeSceneId];
        let node = scene?.nodes[selected];
        if (!node) throw new Error('Selected object is missing.');
        while (node) {
            if (node.locked)
                throw new Error(
                    'Unlock the object and its parent collection before changing script bindings.'
                );
            node = node.parent ? scene?.nodes[node.parent] : undefined;
        }
    }
    private attach(id: string): void {
        try {
            const project = this.options.getProject();
            const selected = this.options.getSelected();
            const node = selected
                ? project.scenes[project.activeSceneId]?.nodes[selected]
                : undefined;
            if (!node || !selected || !project.scripts[id]) return;
            this.ensureEditable(project, selected);
            node.scripts = [...new Set([...(node.scripts ?? []), id])];
            this.options.onCommit(project, 'Script attached');
        } catch (error) {
            this.options.onNotify(error instanceof Error ? error.message : String(error), true);
        }
    }
    private readonly click = (event: Event): void => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLElement>('button');
        if (!button) return;
        try {
            if (button.hasAttribute('data-script-close')) {
                this.dialog.close();
                return;
            }
            if (button.hasAttribute('data-script-save')) {
                this.save(false);
                return;
            }
            if (button.hasAttribute('data-script-bind')) {
                this.save(true);
                return;
            }
            if (button.dataset['scriptEdit']) {
                this.open(button.dataset['scriptEdit']);
                return;
            }
            const project = this.options.getProject();
            if (button.hasAttribute('data-script-new')) {
                const id = `script-${crypto.randomUUID()}`;
                project.scripts[id] = createScript(id);
                this.options.onCommit(project, 'Script created');
                this.open(id);
            }
            const detached = button.dataset['scriptDetach'];
            if (detached) {
                this.ensureEditable(project, this.options.getSelected() ?? '');
                const node =
                    project.scenes[project.activeSceneId]?.nodes[this.options.getSelected() ?? ''];
                if (node) node.scripts = node.scripts?.filter(id => id !== detached) ?? [];
                this.options.onCommit(project, 'Script detached');
            }
            const removed = button.dataset['scriptDelete'];
            if (removed) {
                project.scripts = Object.fromEntries(
                    Object.entries(project.scripts).filter(([id]) => id !== removed)
                );
                const containers = [
                    ...Object.values(project.scenes),
                    ...Object.values(project.prefabs),
                    ...Object.values(project.instances).map(instance => instance.baseline)
                ];
                for (const container of containers)
                    for (const node of Object.values(container.nodes))
                        if (node.scripts) node.scripts = node.scripts.filter(id => id !== removed);
                this.options.onCommit(project, 'Script deleted and all bindings removed');
            }
        } catch (error) {
            this.options.onNotify(error instanceof Error ? error.message : String(error), true);
        }
    };
}
