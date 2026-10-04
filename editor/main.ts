import './style.css';
import schemaUrl from './scene.schema.json?url';
import { icon } from './icons';
import {
    cloneScene,
    createDefaultScene,
    parseScene,
    serializeScene,
    type SceneDocument,
    type SceneNode
} from './scene';
import { EditorViewport } from './viewport';
import type { TransformGesture, TransformMode } from './transform-gizmo';
import { ProjectController } from './project-controller';
import type { ProjectDocument } from './project';
import { WorkspaceLayout } from './workspace';
import { ProjectPanel } from './project-panel';
import { AssetPanel } from './asset-panel';
import { validateProjectAssetDecoding } from './assets';
import { PrefabPanel } from './prefab-panel';
import { Timeline } from './timeline';
import { ScriptPanel } from './script-panel';
import { PlayController } from './play-controller';
import { duplicateSelection } from './selection';
import { prefabOverrides } from './prefabs';
import { CollaborationPanel } from './collaboration-panel';

const STORAGE_KEY = 'hilo-studio.scene.v1';
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Editor root is missing.');
const app = root;
app.innerHTML =
    '<div class="editor-startup"><span class="loading-ring"></span>Opening your workspace…</div>';
let startupWarning = '';
let initial = createDefaultScene();
try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) initial = parseScene(saved);
} catch (error) {
    startupWarning = `Could not restore local scene: ${errorMessage(error)}`;
}
const projectController = await ProjectController.restore(initial);
startupWarning ||= projectController.startupWarning;
let history = projectController.history;
let projectView = history.project;
let authoringEpoch = 0;
let scene = history.scene;
let selected: string | null = Object.hasOwn(scene.nodes, 'hero-sphere')
    ? 'hero-sphere'
    : (Object.keys(scene.nodes).find(id => scene.nodes[id]?.type === 'mesh') ?? null);
const selectedIds = new Set<string>(selected ? [selected] : []);
let transformMode: TransformMode = 'translate';
let transformSnap = false;
let viewport: EditorViewport | undefined;
let preview = false;
let gridVisible = true;
let assetTab:
    'primitives' | 'materials' | 'console' | 'files' | 'prefabs' | 'timeline' | 'scripts' =
    'primitives';
let viewportSync = 0;
const collapsed = new Set<string>();
const logs: string[] = [];
let toastTimer = 0;
let logFrame = 0;
const pendingLogs: string[] = [];
let canEditShared = true;
let applyingRemote = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}
function element<T extends HTMLElement = HTMLElement>(selector: string, type?: new () => T): T {
    const result = app.querySelector<T>(selector);
    if (!result || (type && !(result instanceof type)))
        throw new Error(`Missing editor element ${selector}`);
    return result;
}
function button(command: string, symbol: string, label: string, extra = ''): string {
    return `<button type="button" data-action="${command}" title="${label}" aria-label="${label}" ${extra}>${icon(symbol)}</button>`;
}

app.innerHTML = `
<header class="menubar">
    <a class="brand" href="./" aria-label="Hilo Studio home"><span class="brand-mark">h</span><strong>hilo<span>studio</span></strong><span class="alpha-tag">PREVIEW</span></a>
    <nav class="main-menu" aria-label="Main menu"><button data-action="source">Scene</button><button data-action="add-menu">Add</button><button data-action="focus">View</button><button data-action="help">Help</button></nav>
    <div class="workspace-tabs"><span class="workspace-tab active">Layout</span><button data-action="source">Scene JSON ${icon('code')}</button></div>
    <button class="shortcuts-button" data-action="commands">${icon('search')}<span>Quick actions</span><kbd>⌘ K</kbd></button>
</header>
<section class="projectbar">
    <div class="project-location">${icon('group')}<span>LOCAL PROJECT</span><span class="slash">/</span><button id="project-name" data-action="scene-settings"></button><span class="save-state" id="save-state"><i></i> Local scene</span></div>
    <div class="play-controls">${button('undo', 'undo', 'Undo (⌘ Z)', 'id="undo"')}${button('redo', 'redo', 'Redo (⌘ ⇧ Z)', 'id="redo"')}<span class="divider"></span><button id="play-button" data-action="play" aria-label="Play scene" title="Play scene">${icon('play')}Play</button>${button('pause-play', 'pause', 'Pause scene', 'id="pause-play" disabled')}${button('step-play', 'step', 'Step one frame', 'id="step-play"')}${button('stop-play', 'stop', 'Stop play mode', 'id="stop-play" disabled')}<select id="runtime-clip" aria-label="Play animation clip"><option value="">No animation</option></select><span id="play-time" hidden></span><button id="preview" data-action="preview" title="Orbit preview" aria-label="Orbit preview" aria-pressed="false">${icon('play')}<span>Preview</span></button></div>
    <div class="file-controls"><button data-action="import">${icon('import')}<span>Open</span></button><button data-action="save">${icon('save')}<span>Save</span></button><button class="export-button" data-action="export">${icon('export')}Export scene</button></div>
</section>
<main class="workspace">
    <aside class="hierarchy panel" aria-label="Scene hierarchy">
        <div class="panel-heading"><h2>${icon('group')}Scene collection</h2>${button('add-menu', 'plus', 'Add object')}</div>
        <label class="search-field">${icon('search')}<input id="hierarchy-search" placeholder="Search objects…" aria-label="Search objects"/><kbd>⌕</kbd></label>
        <div class="collection-label"><span>${icon('down')} ${icon('group')} Collection</span><span id="object-count"></span></div>
        <div id="hierarchy-tree" role="tree" aria-label="Scene objects"></div>
        <div class="hierarchy-footer"><span><i class="status-dot"></i>Scene document</span><button data-action="source" title="Edit scene JSON">${icon('code')} v2</button></div>
    </aside>
    <section class="center-workspace">
        <section class="viewport-panel panel" aria-label="3D scene viewport">
            <div class="viewport-heading"><div class="viewport-tab">${icon('cube')}Scene <span class="orange-dot"></span></div><span class="view-subtitle">Studio workspace</span><div class="view-settings"><select id="authored-camera" aria-label="Scene camera"><option value="">Editor camera</option></select><select id="transform-space" aria-label="Transform space"><option value="world">World</option><option value="local">Local</option></select><button id="snap-button" data-action="snap" title="Snap: 0.5 m / 15° / 0.1 scale" aria-label="Toggle snapping" aria-pressed="false">${icon('snap')}</button>${button('grid', 'grid', 'Toggle grid', 'id="grid-button" class="active" aria-pressed="true"')}${button('focus', 'focus', 'Frame selection (F)')}<span class="divider"></span><label class="view-select"><select id="camera-view" aria-label="Camera view"><option value="perspective">Perspective</option><option value="top">Top</option><option value="front">Front</option><option value="right">Right</option></select>${icon('down')}</label></div></div>
            <div id="viewport"><div class="viewport-loading" id="viewport-loading"><span class="loading-ring"></span>Preparing your workspace…</div></div>
            <div class="viewport-overlay"><span>User perspective</span><strong id="selection-label"></strong></div>
            <div class="viewport-tools">${button('tool-move', 'move', 'Move (W)', 'class="active"')}${button('tool-rotate', 'rotate', 'Rotate (E)')}${button('tool-scale', 'scale', 'Scale (R)')}${button('focus', 'focus', 'Frame selection (F)')}${button('scene-settings', 'settings', 'Scene settings')}${button('add-menu', 'plus', 'Add object')}</div>
            <div class="view-axis"><button data-action="view-right" class="axis-x" title="Right view">X</button><button data-action="view-top" class="axis-y" title="Top view">Y</button><button data-action="view-front" class="axis-z" title="Front view">Z</button><span></span></div>
            <div class="viewport-bottom"><span><i class="status-dot"></i><button id="renderer-state" data-action="retry-assets" title="Retry failed asset loading" aria-label="Retry asset loading">Initializing renderer</button></span><span>Drag to orbit <b>·</b> Shift + drag to pan <b>·</b> Scroll to zoom</span></div>
        </section>
        <section class="assets-panel panel" aria-label="Asset library">
            <div class="assets-heading"><div class="asset-tabs"><button class="active" data-asset-tab="primitives">${icon('cube')}Primitives</button><button data-asset-tab="files">${icon('group')}Assets</button><button data-asset-tab="prefabs">${icon('copy')}Prefabs</button><button data-asset-tab="materials">${icon('material')}Materials</button><button data-asset-tab="scripts">${icon('code')}Scripts</button><button data-asset-tab="timeline">${icon('play')}Timeline</button><button data-asset-tab="console">${icon('terminal')}Activity<span id="log-count">0</span></button></div><span class="assets-caption" id="assets-caption">Click to add to your scene</span><label class="asset-search">${icon('search')}<input id="asset-search" placeholder="Filter assets" aria-label="Filter assets"/></label></div>
            <div id="asset-content"></div><div id="timeline-host" hidden></div>
        </section>
    </section>
    <aside class="inspector panel" aria-label="Inspector"><div class="panel-heading"><h2>${icon('settings')}Inspector</h2><span class="muted small">PROPERTIES</span></div><div id="inspector-content"></div><div class="inspector-footer">${icon('code')}Human readable. AI ready.<button data-action="source">View JSON ↗</button></div></aside>
</main>
<footer class="statusbar"><span><span class="status-dot"></span>Hilo3D engine<span class="status-separator">/</span><span id="backend-label">connecting</span></span><span id="scene-summary"></span><span>1 unit = 1 meter <span class="status-separator">|</span><button data-action="help">Keyboard shortcuts ${icon('info')}</button></span></footer>
<div id="add-menu" class="popover" hidden><span class="menu-title">CREATE OBJECT</span>${(['cube', 'sphere', 'cylinder', 'plane', 'group', 'light', 'camera'] as const).map(kind => `<button data-create="${kind}">${icon(kind)}${kind.charAt(0).toUpperCase()}${kind.slice(1)}<span>+</span></button>`).join('')}</div>
<div id="toast" role="status" hidden></div>
<input id="file-input" type="file" accept=".json,application/json" hidden />
<dialog id="source-dialog" class="source-dialog"><div class="dialog-heading"><div>${icon('code')}<strong>Scene document</strong><span>JSON · v2</span></div>${button('close-dialog', 'close', 'Close dialog')}</div><div class="source-intro"><span>Stable IDs. Explicit units. Ready for your AI workflow.</span><a href="${schemaUrl}" target="_blank" rel="noreferrer">JSON Schema ↗</a></div><textarea id="scene-source" spellcheck="false" aria-label="Scene JSON"></textarea><div class="source-error" id="source-error" role="alert"></div><div class="dialog-footer"><span>Edits are validated before replacing the scene.</span><button data-action="copy-source">Copy JSON</button><button class="primary" data-action="apply-source">Apply scene</button></div></dialog>
<dialog id="help-dialog" class="help-dialog"><div class="dialog-heading"><strong>Your space to create.</strong>${button('close-dialog', 'close', 'Close dialog')}</div><p>Build a scene, tune its materials, and take the document anywhere. Everything stays in this browser until you export it.</p><div class="shortcut-grid"><span>Save locally</span><kbd>⌘ / Ctrl S</kbd><span>Undo / Redo</span><kbd>⌘ Z / ⌘ ⇧ Z</kbd><span>Duplicate selection</span><kbd>⌘ / Ctrl D</kbd><span>Delete selection</span><kbd>Delete</kbd><span>Frame selection</span><kbd>F</kbd><span>Quick actions</span><kbd>⌘ / Ctrl K</kbd><span>Orbit / Pan</span><kbd>Drag / Shift drag</kbd></div><p class="help-note">Projects bundle scenes, GLB models, textures, prefabs, scripts and animation clips. Use W/E/R for transforms and Ctrl/⌘ click for multiple objects. Play runs isolated scripts; Stop restores authored state. AI can edit the exported JSON against its schema; no hosted AI service is connected.</p><div class="dialog-footer"><button data-action="reset">Restore sample scene</button><button class="primary" data-action="close-dialog">Let's create</button></div></dialog>
<dialog id="command-dialog" class="command-dialog"><div class="command-input">${icon('search')}<input id="command-search" aria-label="Search actions" placeholder="What would you like to do?"/>${button('close-dialog', 'close', 'Close dialog')}</div><div id="command-list"></div></dialog>
`;

function recordActivity(message: string): void {
    pendingLogs.push(message.slice(0, 2000));
    if (pendingLogs.length > 80) pendingLogs.shift();
    if (logFrame) return;
    logFrame = requestAnimationFrame(() => {
        logFrame = 0;
        const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        logs.unshift(
            ...pendingLogs
                .splice(0)
                .reverse()
                .map(line => `${stamp}  ${line}`)
        );
        if (logs.length > 80) logs.length = 80;
        element('#log-count').textContent = String(logs.length);
        if (assetTab === 'console') renderAssets();
    });
}
function notify(message: string, isError = false): void {
    recordActivity(message);
    const toast = element('#toast');
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
        () => {
            toast.hidden = true;
        },
        isError ? 8000 : 3200
    );
}
function persist(announce = false): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeScene(scene));
    } catch (error) {
        notify(`Scene recovery copy failed: ${errorMessage(error)}`, true);
    }
    void projectController
        .save()
        .then(() => {
            if (announce)
                notify('Project saved in this browser. Export a bundle for a portable backup.');
        })
        .catch((error: unknown) => {
            notify(errorMessage(error), true);
        });
}
function syncViewport(): void {
    const current = viewport;
    if (!current) return;
    const revision = ++viewportSync;
    current.setScene(scene);
    current.select([...selectedIds]);
    element('#renderer-state').textContent = Object.keys(projectView.assets).length
        ? 'Loading assets…'
        : 'Material preview';
    void current
        .setAssets(projectView.assets)
        .then(() => {
            if (revision !== viewportSync) return;
            return current.waitForAssets().then(() => {
                if (revision === viewportSync)
                    element('#renderer-state').textContent = 'Material preview';
            });
        })
        .catch((error: unknown) => {
            if (revision === viewportSync) {
                element('#renderer-state').textContent = 'Asset error · see Activity';
                notify(errorMessage(error), true);
            }
        });
}
function commitProject(next: ProjectDocument, message: string, remote = false): void {
    if (!remote && !canEditShared)
        throw new Error('Viewer access: disconnect or keep a local copy to edit this project.');
    if (playController.active) playController.stop();
    if (!history.commitProject(next)) return;
    projectView = history.project;
    scene = history.scene;
    selectedIds.clear();
    if (selected && scene.nodes[selected]) selectedIds.add(selected);
    else selected = null;
    syncViewport();
    authoringEpoch++;
    projectController.markChanged();
    if (!applyingRemote) collaborationPanel.projectChanged();
    render();
    notify(message);
}
function commit(next: SceneDocument, message: string, preserveInputs = false): void {
    if (!canEditShared)
        throw new Error('Viewer access: disconnect or keep a local copy to edit this project.');
    if (playController.active) playController.stop();
    timeline.suspend();
    if (!history.commit(next)) return;
    authoringEpoch++;
    projectController.markChanged();
    if (!applyingRemote) collaborationPanel.projectChanged();
    setPreview(false);
    projectView = history.project;
    scene = history.scene;
    for (const id of selectedIds) if (!scene.nodes[id]) selectedIds.delete(id);
    if (selected && !scene.nodes[selected]) selected = null;
    if (selected && !selectedIds.has(selected)) {
        selectedIds.clear();
        selectedIds.add(selected);
    }
    syncViewport();
    if (preserveInputs) patchPropertyView();
    else render();
    persist();
    notify(message);
}
function mutate(
    update: (next: SceneDocument) => void,
    message: string,
    preserveInputs = false
): boolean {
    const previousSelection = selected;
    const previousIds = [...selectedIds];
    try {
        const next = cloneScene(scene);
        update(next);
        commit(next, message, preserveInputs);
        return true;
    } catch (error) {
        selected = previousSelection;
        selectedIds.clear();
        for (const id of previousIds) selectedIds.add(id);
        notify(errorMessage(error), true);
        if (preserveInputs) patchPropertyView();
        else renderInspector();
        syncViewport();
        return false;
    }
}
function select(id: string | null, additive = false): void {
    if (!additive) selectedIds.clear();
    if (id) {
        if (additive && selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
    }
    selected = [...selectedIds].at(-1) ?? null;
    viewport?.select([...selectedIds]);
    if (assetTab === 'timeline') timeline.render();
    renderHierarchy();
    renderInspector();
    element('#selection-label').textContent =
        selectedIds.size > 1
            ? `${String(selectedIds.size)} selected · active: ${scene.nodes[selected ?? '']?.name ?? ''}`
            : selected
              ? (scene.nodes[selected]?.name ?? '')
              : 'Scene collection';
}
function handleTransform(gesture: TransformGesture): void {
    if (gesture.phase === 'preview') {
        const value = selected ? gesture.transforms[selected] : undefined;
        if (value)
            for (const kind of ['position', 'rotation', 'scale'] as const)
                for (const axis of ['x', 'y', 'z'] as const) {
                    const input = app.querySelector<HTMLInputElement>(
                        `[data-field="${kind}.${axis}"]`
                    );
                    if (input && document.activeElement !== input)
                        input.value = String(Math.round(value[kind][axis] * 10000) / 10000);
                }
    } else if (gesture.phase === 'commit') {
        mutate(next => {
            for (const [id, transform] of Object.entries(gesture.transforms)) {
                const node = next.nodes[id];
                if (node) node.transform = structuredClone(transform);
            }
        }, 'Transform applied');
    } else renderInspector();
}
function setTransformTool(mode: TransformMode): void {
    transformMode = mode;
    setPreview(false);
    viewport?.setTransformMode(mode);
    for (const [actionName, value] of [
        ['tool-move', 'translate'],
        ['tool-rotate', 'rotate'],
        ['tool-scale', 'scale']
    ]) {
        app.querySelector(`[data-action="${actionName ?? ''}"]`)?.classList.toggle(
            'active',
            value === mode
        );
    }
}
function nodeIcon(node: SceneNode): string {
    return node.type === 'mesh' ? (node.geometry ?? 'cube') : node.type;
}
function renderHierarchy(): void {
    const search = element<HTMLInputElement>('#hierarchy-search').value.toLowerCase();
    const entries = Object.entries(scene.nodes);
    function rows(parent: string | null, depth: number): string {
        return entries
            .filter(([, node]) => node.parent === parent)
            .map(([id, node]) => {
                const hasChildren = entries.some(([, child]) => child.parent === id);
                const matches =
                    !search || node.name.toLowerCase().includes(search) || id.includes(search);
                const row = matches
                    ? `<div role="treeitem" aria-selected="${String(selectedIds.has(id))}" class="tree-row ${selectedIds.has(id) ? 'selected' : ''} ${node.visible ? '' : 'invisible'}" style="--depth:${String(depth)}"><button class="tree-expand" data-collapse="${id}" aria-label="${collapsed.has(id) ? 'Expand' : 'Collapse'} ${escapeHtml(node.name)}" ${hasChildren ? '' : 'disabled'}>${hasChildren ? icon(collapsed.has(id) ? 'chevron' : 'down') : ''}</button><button class="tree-select" data-select="${id}" title="${id}">${icon(nodeIcon(node))}<span>${escapeHtml(node.name)}</span></button><button class="tree-eye" data-lock="${id}" aria-label="${node.locked ? 'Unlock' : 'Lock'} ${escapeHtml(node.name)}">${icon(node.locked ? 'lock' : 'unlock')}</button><button class="tree-eye" data-visibility="${id}" aria-label="${node.visible ? 'Hide' : 'Show'} ${escapeHtml(node.name)}">${icon(node.visible ? 'eye' : 'hidden')}</button></div>`
                    : '';
                return row + (!collapsed.has(id) || search ? rows(id, depth + 1) : '');
            })
            .join('');
    }
    element('#hierarchy-tree').innerHTML =
        rows(null, 0) || '<div class="empty-search">No matching objects</div>';
    element('#object-count').textContent = String(entries.length);
}
function field(label: string, control: string): string {
    return `<label class="property-field"><span>${label}</span>${control}</label>`;
}
function patchPropertyView(): void {
    element('#project-name').textContent = scene.name;
    element<HTMLButtonElement>('#undo').disabled = !canEditShared || !history.canUndo;
    element<HTMLButtonElement>('#redo').disabled = !canEditShared || !history.canRedo;
    const node = selected ? scene.nodes[selected] : undefined;
    const material = node?.material ? scene.materials[node.material] : undefined;
    const values: Record<string, string | number | boolean> = {
        'scene-name': scene.name,
        background: scene.environment.background,
        ambient: scene.environment.ambientIntensity
    };
    if (node) {
        values['name'] = node.name;
        values['visible'] = node.visible;
        values['parent'] = node.parent ?? '';
        values['material'] = node.material ?? '';
        values['asset'] = node.asset ?? '';
        for (const kind of ['position', 'rotation', 'scale'] as const)
            for (const axis of ['x', 'y', 'z'] as const)
                values[`${kind}.${axis}`] = node.transform[kind][axis];
        if (node.light) {
            values['light-color'] = node.light.color;
            values['intensity'] = node.light.intensity;
        }
        if (node.camera)
            for (const key of ['fov', 'near', 'far'] as const)
                values[`camera.${key}`] = node.camera[key];
    }
    if (material) {
        values['color'] = material.color;
        values['metallic'] = material.metallic;
        values['roughness'] = material.roughness;
        values['material-name'] = material.name;
        values['emissiveColor'] = material.emissiveColor ?? '#000000';
        for (const slot of [
            'baseColorTexture',
            'normalTexture',
            'metallicRoughnessTexture',
            'emissiveTexture'
        ] as const)
            values[slot] = material[slot] ?? '';
        const previewName = app.querySelector('.material-preview strong');
        if (previewName) previewName.textContent = material.name;
        app.querySelector<HTMLElement>('.material-preview .material-orb')?.style.setProperty(
            '--material',
            material.color
        );
        const hex = app.querySelector('.color-field span');
        if (hex) hex.textContent = material.color.toUpperCase();
    }
    for (const input of app.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        '#inspector-content [data-field]'
    )) {
        const value = values[input.dataset['field'] ?? ''];
        if (value === undefined) continue;
        if (input instanceof HTMLInputElement && input.type === 'checkbox')
            input.checked = value === true;
        else input.value = String(value);
        const output = input.parentElement?.querySelector('output');
        if (output && typeof value === 'number') output.value = value.toFixed(2);
    }
    for (const row of app.querySelectorAll<HTMLElement>('.tree-select[data-select]')) {
        const id = row.dataset['select'] ?? '';
        const item = scene.nodes[id];
        if (!item) continue;
        const label = row.querySelector('span');
        if (label) label.textContent = item.name;
        row.closest('.tree-row')?.classList.toggle('invisible', !item.visible);
    }
    for (const card of app.querySelectorAll<HTMLElement>('[data-material]')) {
        const item = scene.materials[card.dataset['material'] ?? ''];
        if (!item) continue;
        const label = card.querySelector('strong');
        if (label) label.textContent = item.name;
        card.querySelector<HTMLElement>('.material-orb')?.style.setProperty(
            '--material',
            item.color
        );
    }
    const instance = Object.values(projectView.instances).find(
        item =>
            item.sceneId === projectView.activeSceneId &&
            Object.values(item.nodeMap).includes(selected ?? '')
    );
    const overrideLabel = app.querySelector('.prefab-section .property-hint');
    if (instance && overrideLabel)
        overrideLabel.textContent = `${String(prefabOverrides(scene, instance).length)} instance overrides`;
    element('#selection-label').textContent =
        selectedIds.size > 1
            ? `${String(selectedIds.size)} selected · ${node?.name ?? ''}`
            : (node?.name ?? 'Scene collection');
}
function numberInput(name: string, value: number, extra = ''): string {
    return `<input type="number" aria-label="${name}" data-field="${name}" value="${String(value)}" step="0.1" ${extra}/>`;
}
function renderInspector(): void {
    const node = selected ? scene.nodes[selected] : undefined;
    if (!node) {
        element('#inspector-content').innerHTML =
            `<div class="selection-header"><span class="object-symbol">${icon('group')}</span><div><strong>Scene settings</strong><span>Document & environment</span></div></div><section class="property-section"><h3>${icon('down')}Document</h3>${field('Name', `<input data-field="scene-name" aria-label="Scene name" value="${escapeHtml(scene.name)}" maxlength="120"/>`)}<div class="property-field"><span>Units</span><span class="value-text">Meters · rotation in degrees</span></div><div class="property-field"><span>Format</span><span class="value-text">hilo3d-scene · version 2</span></div></section><section class="property-section"><h3>${icon('down')}Environment</h3>${field('Background', `<input type="color" data-field="background" aria-label="Background color" value="${scene.environment.background}"/>`)}${field('Ambient light', numberInput('ambient', scene.environment.ambientIntensity, 'min="0" max="10"'))}</section><div class="inspector-note">${icon('info')}Select an object in the scene collection or viewport to edit its properties.</div>`;
        return;
    }
    const transform = (['position', 'rotation', 'scale'] as const)
        .map(
            kind =>
                `<div class="transform-row"><span>${kind.charAt(0).toUpperCase()}${kind.slice(1)}</span><div class="vector-fields">${(['x', 'y', 'z'] as const).map(axis => `<label class="axis-field ${axis}"><span>${axis.toUpperCase()}</span>${numberInput(`${kind}.${axis}`, node.transform[kind][axis], kind === 'scale' ? 'min="0.001" max="1000"' : '')}</label>`).join('')}</div></div>`
        )
        .join('');
    const material = node.material ? scene.materials[node.material] : undefined;
    const descendants = subtree(selected ?? '');
    element('#inspector-content').innerHTML =
        `<div class="selection-header"><span class="object-symbol">${icon(nodeIcon(node))}</span><div><input data-field="name" aria-label="Object name" value="${escapeHtml(node.name)}" maxlength="120"/><span>${escapeHtml(node.type === 'mesh' ? `${node.geometry ?? ''} mesh` : node.type)}<b>·</b><code>${selected ?? ''}</code></span></div><input type="checkbox" data-field="visible" aria-label="Object visible" ${node.visible ? 'checked' : ''}/></div>
    <section class="property-section transform-section"><h3>${icon('down')}${icon('move')}Transform<span>LOCAL</span></h3>${transform}<div class="transform-meta">Position · m <span>Rotation · °</span><button data-action="reset-transform">Reset</button></div>${field(
        'Parent',
        `<select data-field="parent" aria-label="Parent object"><option value="">Scene root</option>${Object.entries(
            scene.nodes
        )
            .filter(([id]) => !descendants.has(id))
            .map(
                ([id, candidate]) =>
                    `<option value="${id}" ${node.parent === id ? 'selected' : ''}>${escapeHtml(candidate.name)}</option>`
            )
            .join('')}</select>`
    )}</section>
    ${
        material
            ? `<section class="property-section"><h3>${icon('down')}${icon('material')}Material<span>PBR</span></h3><div class="material-preview"><div class="material-orb" style="--material:${material.color}"></div><div><strong>${escapeHtml(material.name)}</strong><span>Principled surface</span></div>${icon('material')}</div>${field(
                  'Material',
                  `<select data-field="material" aria-label="Material">${node.type === 'model' ? '<option value="">Original glTF materials</option>' : ''}${Object.entries(
                      scene.materials
                  )
                      .map(
                          ([id, value]) =>
                              `<option value="${id}" ${node.material === id ? 'selected' : ''}>${escapeHtml(value.name)}</option>`
                      )
                      .join('')}</select>`
              )}${field('Base color', `<div class="color-field"><input type="color" data-field="color" aria-label="Base color" value="${material.color}"/><span>${material.color.toUpperCase()}</span></div>`)}${field('Metallic', `<div class="range-field"><input type="range" data-field="metallic" aria-label="Metallic" min="0" max="1" step="0.01" value="${String(material.metallic)}"/><output>${material.metallic.toFixed(2)}</output></div>`)}${field('Roughness', `<div class="range-field"><input type="range" data-field="roughness" aria-label="Roughness" min="0" max="1" step="0.01" value="${String(material.roughness)}"/><output>${material.roughness.toFixed(2)}</output></div>`)}<p class="property-hint">Material changes apply to all objects using this surface.</p></section>`
            : ''
    }
    ${node.light ? `<section class="property-section"><h3>${icon('down')}${icon('light')}Light<span>${node.light.kind}</span></h3>${field('Color', `<input type="color" data-field="light-color" aria-label="Light color" value="${node.light.color}"/>`)}${field('Intensity', numberInput('intensity', node.light.intensity, 'min="0" max="20"'))}</section>` : ''}
    <section class="property-section object-actions"><h3>${icon('down')}Object</h3><div class="object-id"><span>Stable ID</span><code>${selected ?? ''}</code></div><div><button data-action="duplicate">${icon('copy')}Duplicate</button><button data-action="delete">${icon('trash')}Delete</button></div></section>`;
    if (node.camera) {
        element('#inspector-content').insertAdjacentHTML(
            'beforeend',
            `<section class="property-section"><h3>${icon('camera')}Camera</h3>${field('Field of view', numberInput('camera.fov', node.camera.fov, 'min="1" max="170"'))}${field('Near clip', numberInput('camera.near', node.camera.near, 'min="0.001" step="0.01"'))}${field('Far clip', numberInput('camera.far', node.camera.far, 'min="0.01"'))}</section>`
        );
    }
    if (material) {
        const section =
            element('#inspector-content').querySelector('.material-preview')?.parentElement;
        const textures = Object.values(projectView.assets).filter(
            asset => asset.kind === 'texture'
        );
        const rows = [
            ['baseColorTexture', 'Base color map'],
            ['normalTexture', 'Normal map'],
            ['metallicRoughnessTexture', 'Metal / rough map'],
            ['emissiveTexture', 'Emission map']
        ] as const;
        section?.insertAdjacentHTML(
            'beforeend',
            field(
                'Name',
                `<input data-field="material-name" aria-label="Material name" maxlength="120" value="${escapeHtml(material.name)}"/>`
            ) +
                rows
                    .map(([slot, label]) =>
                        field(
                            label,
                            `<select data-field="${slot}" aria-label="${label}"><option value="">None</option>${textures.map(asset => `<option value="${asset.id}" ${material[slot] === asset.id ? 'selected' : ''}>${escapeHtml(asset.name)}</option>`).join('')}</select>`
                        )
                    )
                    .join('') +
                field(
                    'Emission',
                    `<input type="color" data-field="emissiveColor" aria-label="Emission color" value="${material.emissiveColor ?? '#000000'}"/>`
                )
        );
    }
    if (node.type === 'model') {
        element('#inspector-content').insertAdjacentHTML(
            'beforeend',
            `<section class="property-section"><h3>${icon('cube')}Model asset</h3>${field(
                'Asset',
                `<select data-field="asset" aria-label="Model asset">${Object.values(
                    projectView.assets
                )
                    .filter(asset => asset.kind === 'model')
                    .map(
                        asset =>
                            `<option value="${asset.id}" ${node.asset === asset.id ? 'selected' : ''}>${escapeHtml(asset.name)}</option>`
                    )
                    .join('')}</select>`
            )}${
                !material
                    ? field(
                          'Override',
                          `<select data-field="material" aria-label="Material"><option value="">Original glTF materials</option>${Object.entries(
                              scene.materials
                          )
                              .map(
                                  ([id, value]) =>
                                      `<option value="${id}">${escapeHtml(value.name)}</option>`
                              )
                              .join('')}</select>`
                      )
                    : ''
            }</section>`
        );
    }
    prefabPanel.renderInspector(element('#inspector-content'));
    scriptPanel.renderInspector(element('#inspector-content'));
}
const primitives = [
    { kind: 'cube', title: 'Cube', sub: 'Box primitive' },
    { kind: 'sphere', title: 'Sphere', sub: 'UV sphere' },
    { kind: 'cylinder', title: 'Cylinder', sub: 'Radial primitive' },
    { kind: 'plane', title: 'Plane', sub: 'Ground surface' },
    { kind: 'group', title: 'Collection', sub: 'Empty group' },
    { kind: 'light', title: 'Sun light', sub: 'Directional' }
] as const;
function renderAssets(): void {
    const search = element<HTMLInputElement>('#asset-search').value.toLowerCase();
    app.querySelectorAll<HTMLElement>('[data-asset-tab]').forEach(tab =>
        tab.classList.toggle('active', tab.dataset['assetTab'] === assetTab)
    );
    element('#assets-caption').textContent =
        assetTab === 'materials'
            ? 'Select a mesh, then click to apply'
            : assetTab === 'console'
              ? 'Your session activity'
              : 'Click to add to your scene';
    element('#asset-content').hidden = assetTab === 'timeline';
    element('#timeline-host').hidden = assetTab !== 'timeline';
    if (assetTab === 'timeline') {
        timeline.render();
        return;
    }
    if (assetTab === 'files') {
        assetPanel.render(element('#asset-content'), search);
        return;
    }
    if (assetTab === 'scripts') {
        scriptPanel.render(element('#asset-content'), search);
        return;
    }
    if (assetTab === 'prefabs') {
        prefabPanel.render(element('#asset-content'), search);
        return;
    }
    element('#asset-content').innerHTML =
        (assetTab === 'materials'
            ? '<div class="authoring-library-actions"><button data-action="new-material">+ New material</button><span>Select a mesh to assign or edit its material</span></div>'
            : '') +
        (assetTab === 'console'
            ? `<div class="activity-log">${
                  logs
                      .filter(log => log.toLowerCase().includes(search))
                      .map(log => `<div>${icon('check')}<span>${escapeHtml(log)}</span></div>`)
                      .join('') || '<p>Your scene activity will appear here.</p>'
              }</div>`
            : `<div class="asset-grid">${
                  assetTab === 'primitives'
                      ? primitives
                            .filter(item => item.title.toLowerCase().includes(search))
                            .map(
                                item =>
                                    `<button class="asset-card" data-create="${item.kind}" aria-label="Add ${item.title}"><div class="asset-thumbnail ${item.kind}"><span class="primitive-shape"></span>${item.kind === 'group' || item.kind === 'light' ? icon(item.kind) : ''}</div><strong>${item.title}</strong><span>${item.sub}</span><small>+</small></button>`
                            )
                            .join('')
                      : Object.entries(scene.materials)
                            .filter(([, material]) => material.name.toLowerCase().includes(search))
                            .map(
                                ([id, material]) =>
                                    `<button class="asset-card" data-material="${id}" aria-label="Apply ${escapeHtml(material.name)}"><div class="asset-thumbnail"><div class="material-orb" style="--material:${material.color}"></div></div><strong>${escapeHtml(material.name)}</strong><span>PBR material</span><small>↗</small></button>`
                            )
                            .join('')
              }</div>`);
}
function render(): void {
    element('#project-name').textContent = scene.name;
    const clipSelect = element<HTMLSelectElement>('#runtime-clip');
    const clipId = clipSelect.value;
    clipSelect.innerHTML = `<option value="">No animation</option>${Object.values(projectView.clips)
        .filter(clip => clip.sceneId === projectView.activeSceneId)
        .map(clip => `<option value="${clip.id}">${escapeHtml(clip.name)}</option>`)
        .join('')}`;
    clipSelect.value = Object.hasOwn(projectView.clips, clipId) ? clipId : '';
    const cameraSelect = element<HTMLSelectElement>('#authored-camera');
    const cameraId = cameraSelect.value;
    cameraSelect.innerHTML = `<option value="">Editor camera</option>${Object.entries(scene.nodes)
        .filter(([, node]) => node.type === 'camera')
        .map(([id, node]) => `<option value="${id}">${escapeHtml(node.name)}</option>`)
        .join('')}`;
    cameraSelect.value = scene.nodes[cameraId]?.type === 'camera' ? cameraId : '';
    element<HTMLButtonElement>('#undo').disabled = !canEditShared || !history.canUndo;
    element<HTMLButtonElement>('#redo').disabled = !canEditShared || !history.canRedo;
    element('#scene-summary').textContent =
        `${String(Object.keys(scene.nodes).length)} objects  ·  ${String(Object.keys(scene.materials).length)} materials`;
    renderHierarchy();
    renderInspector();
    renderAssets();
    void projectPanel.refresh();
    element('#selection-label').textContent = selected
        ? (scene.nodes[selected]?.name ?? '')
        : 'Scene collection';
}
function subtree(id: string): Set<string> {
    const result = new Set([id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [key, node] of Object.entries(scene.nodes)) {
            if (node.parent && result.has(node.parent) && !result.has(key)) {
                result.add(key);
                changed = true;
            }
        }
    }
    return result;
}
function newId(prefix: string, record: Record<string, unknown>): string {
    const base = prefix.slice(0, 56).replace(/-+$/u, '');
    let index = 1;
    while (Object.hasOwn(record, `${base}-${String(index).padStart(3, '0')}`)) index++;
    return `${base}-${String(index).padStart(3, '0')}`;
}
function createObject(kind: string): void {
    if (!['cube', 'sphere', 'cylinder', 'plane', 'group', 'light', 'camera'].includes(kind)) return;
    for (
        let ancestor = selected ? scene.nodes[selected] : undefined;
        ancestor;
        ancestor = ancestor.parent ? scene.nodes[ancestor.parent] : undefined
    ) {
        if (ancestor.locked) {
            notify('Unlock the selected collection before adding objects.', true);
            return;
        }
    }
    const id = newId(kind, scene.nodes);
    const parent = selected && scene.nodes[selected]?.type === 'group' ? selected : null;
    const geometry =
        kind === 'cube' || kind === 'sphere' || kind === 'cylinder' || kind === 'plane'
            ? kind
            : undefined;
    const materialId = Object.keys(scene.materials)[0] ?? 'default-material';
    mutate(next => {
        next.materials[materialId] ??= {
            name: 'Default',
            color: '#c48c69',
            metallic: 0,
            roughness: 0.5
        };
        next.nodes[id] = {
            name: kind.charAt(0).toUpperCase() + kind.slice(1),
            type: geometry
                ? 'mesh'
                : kind === 'group'
                  ? 'group'
                  : kind === 'camera'
                    ? 'camera'
                    : 'light',
            parent,
            visible: true,
            transform: {
                position: { x: 0, y: geometry === 'plane' ? 0 : 0.5, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            ...(geometry ? { geometry, material: materialId } : {}),
            ...(kind === 'camera'
                ? {
                      camera: { fov: 50, near: 0.05, far: 200 },
                      transform: {
                          position: { x: 0, y: 2, z: 7 },
                          rotation: { x: 0, y: 0, z: 0 },
                          scale: { x: 1, y: 1, z: 1 }
                      }
                  }
                : {}),
            ...(kind === 'light'
                ? {
                      light: { kind: 'directional' as const, color: '#ffffff', intensity: 1 },
                      transform: {
                          position: { x: 4, y: 6, z: 3 },
                          rotation: { x: -45, y: 30, z: 0 },
                          scale: { x: 1, y: 1, z: 1 }
                      }
                  }
                : {})
        };
        selected = id;
        if (parent) collapsed.delete(parent);
    }, `Created ${kind}`);
    element('#add-menu').hidden = true;
}
function duplicate(): void {
    if (!selectedIds.size) {
        notify('Select objects to duplicate.');
        return;
    }
    const result = duplicateSelection(history.project, [...selectedIds]);
    commitProject(result.project, 'Selection duplicated');
    selectedIds.clear();
    for (const id of result.selection) selectedIds.add(id);
    selected = result.selection.at(-1) ?? null;
    viewport?.select(result.selection);
    render();
}
function changeHistory(direction: 'undo' | 'redo'): void {
    if (!canEditShared) {
        notify('Viewer access: disconnect or keep a local copy before editing.', true);
        return;
    }
    if (direction === 'undo' ? !history.canUndo : !history.canRedo) return;
    if (playController.active) playController.stop();
    timeline.suspend();
    setPreview(false);
    scene = history[direction]();
    projectView = history.project;
    authoringEpoch++;
    projectController.markChanged();
    if (!applyingRemote) collaborationPanel.projectChanged();
    for (const id of selectedIds) if (!scene.nodes[id]) selectedIds.delete(id);
    if (selected && !scene.nodes[selected]) selected = null;
    if (selected && !selectedIds.has(selected)) {
        selectedIds.clear();
        selectedIds.add(selected);
    }
    syncViewport();
    render();
    persist();
    notify(direction === 'undo' ? 'Change undone' : 'Change restored');
}
function dialog(id: string): void {
    element<HTMLDialogElement>(id).showModal();
}
function closeDialogs(): void {
    app.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(item => {
        item.close();
    });
}
function download(): void {
    const url = URL.createObjectURL(
        new Blob([serializeScene(scene)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${scene.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-') || 'scene'}.hilo.json`;
    link.click();
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
    notify('Scene JSON exported');
}
const commands = [
    { action: 'save', label: 'Save scene locally', icon: 'save', key: '⌘ S' },
    { action: 'export', label: 'Export scene JSON', icon: 'export', key: '' },
    { action: 'import', label: 'Open scene JSON', icon: 'import', key: '' },
    { action: 'source', label: 'Edit scene document', icon: 'code', key: '' },
    { action: 'focus', label: 'Frame selection', icon: 'focus', key: 'F' },
    { action: 'duplicate', label: 'Duplicate selection', icon: 'copy', key: '⌘ D' },
    { action: 'undo', label: 'Undo last change', icon: 'undo', key: '⌘ Z' },
    { action: 'reset', label: 'Restore sample scene', icon: 'group', key: '' },
    { action: 'new-scene', label: 'Create a new scene', icon: 'plus', key: '' }
];
function renderCommands(): void {
    const search = element<HTMLInputElement>('#command-search').value.toLowerCase();
    element('#command-list').innerHTML =
        commands
            .filter(command => command.label.toLowerCase().includes(search))
            .map(
                command =>
                    `<button data-command="${command.action}">${icon(command.icon)}<span>${command.label}</span><kbd>${command.key}</kbd></button>`
            )
            .join('') || '<p>No matching actions</p>';
}
function setPreview(enabled: boolean): void {
    if (preview === enabled) return;
    preview = enabled;
    viewport?.setPreview(enabled);
    element('#preview').classList.toggle('active', enabled);
    element('#preview').innerHTML =
        `${icon(enabled ? 'stop' : 'play')}<span>${enabled ? 'Stop' : 'Preview'}</span>`;
    element('#preview').setAttribute('aria-pressed', String(enabled));
}
function focusSelection(): void {
    setPreview(false);
    viewport?.setCamera(null);
    element<HTMLSelectElement>('#authored-camera').value = '';
    viewport?.focus(selected);
}
async function action(name: string, trigger?: HTMLElement): Promise<void> {
    switch (name) {
        case 'tool-move':
            setTransformTool('translate');
            break;
        case 'tool-rotate':
            setTransformTool('rotate');
            break;
        case 'tool-scale':
            setTransformTool('scale');
            break;
        case 'snap':
            transformSnap = !transformSnap;
            viewport?.setTransformSnap(transformSnap);
            element('#snap-button').setAttribute('aria-pressed', String(transformSnap));
            element('#snap-button').classList.toggle('active', transformSnap);
            break;
        case 'play':
            timeline.stop();
            setPreview(false);
            await playController.play();
            break;
        case 'pause-play':
            playController.pause();
            break;
        case 'step-play':
            timeline.stop();
            await playController.step();
            break;
        case 'stop-play':
            playController.stop();
            break;
        case 'retry-assets':
            if (viewport) {
                element('#renderer-state').textContent = 'Retrying assets…';
                await viewport.retryAssets();
                element('#renderer-state').textContent = 'Material preview';
                notify('Asset loading complete');
            }
            break;
        case 'new-material':
            mutate(next => {
                const id = newId('material', next.materials);
                next.materials[id] = {
                    name: 'New Material',
                    color: '#b98b72',
                    metallic: 0,
                    roughness: 0.5
                };
                const node = selected ? next.nodes[selected] : undefined;
                if (node?.type === 'mesh' || node?.type === 'model') node.material = id;
            }, 'Material created');
            break;
        case 'new-scene': {
            const project = history.project;
            const id = newId('scene', project.scenes);
            project.scenes[id] = createDefaultScene();
            project.scenes[id].name = 'New Scene';
            project.activeSceneId = id;
            commitProject(project, 'Scene created');
            break;
        }
        case 'save':
            persist(true);
            break;
        case 'export':
            download();
            break;
        case 'import':
            element<HTMLInputElement>('#file-input').click();
            break;
        case 'undo':
            changeHistory('undo');
            break;
        case 'redo':
            changeHistory('redo');
            break;
        case 'duplicate':
            duplicate();
            break;
        case 'delete': {
            if (!selected) break;
            const ids = new Set(
                [...selectedIds]
                    .filter(id => !scene.nodes[id]?.locked)
                    .flatMap(id => [...subtree(id)])
            );
            mutate(next => {
                next.nodes = Object.fromEntries(
                    Object.entries(next.nodes).filter(([id]) => !ids.has(id))
                );
            }, 'Deleted selection');
            break;
        }
        case 'focus':
            focusSelection();
            break;
        case 'scene-settings':
            select(null);
            break;
        case 'preview':
            setPreview(!preview);
            break;
        case 'grid':
            gridVisible = !gridVisible;
            viewport?.setGrid(gridVisible);
            element('#grid-button').classList.toggle('active', gridVisible);
            element('#grid-button').setAttribute('aria-pressed', String(gridVisible));
            break;
        case 'view-right':
        case 'view-top':
        case 'view-front': {
            const view = name === 'view-right' ? 'right' : name === 'view-top' ? 'top' : 'front';
            setPreview(false);
            viewport?.setCamera(null);
            element<HTMLSelectElement>('#authored-camera').value = '';
            viewport?.setView(view);
            element<HTMLSelectElement>('#camera-view').value = view;
            break;
        }
        case 'add-menu': {
            const menu = element('#add-menu');
            const rect = trigger?.getBoundingClientRect();
            menu.style.left = `${String(Math.min(rect?.left ?? 240, innerWidth - 220))}px`;
            menu.style.top = `${String(rect?.bottom ?? 110)}px`;
            menu.hidden = !menu.hidden;
            break;
        }
        case 'source':
            element<HTMLTextAreaElement>('#scene-source').value = serializeScene(scene);
            element('#source-error').textContent = '';
            dialog('#source-dialog');
            break;
        case 'apply-source':
            try {
                const next = parseScene(element<HTMLTextAreaElement>('#scene-source').value);
                commit(next, 'Scene document applied');
                closeDialogs();
            } catch (error) {
                element('#source-error').textContent = errorMessage(error);
            }
            break;
        case 'copy-source':
            await navigator.clipboard.writeText(
                element<HTMLTextAreaElement>('#scene-source').value
            );
            notify('Scene JSON copied');
            break;
        case 'help':
            dialog('#help-dialog');
            break;
        case 'close-dialog':
            closeDialogs();
            break;
        case 'commands':
            element<HTMLInputElement>('#command-search').value = '';
            renderCommands();
            dialog('#command-dialog');
            element<HTMLInputElement>('#command-search').focus();
            break;
        case 'reset':
            commit(
                createDefaultScene(),
                'Sample scene restored. Undo to return to your previous scene.'
            );
            closeDialogs();
            viewport?.focus(null);
            break;
        case 'reset-transform':
            mutate(next => {
                const node = selected ? next.nodes[selected] : undefined;
                if (node)
                    node.transform = {
                        position: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 },
                        scale: { x: 1, y: 1, z: 1 }
                    };
            }, 'Transform reset');
            break;
    }
}
function runAction(name: string, trigger?: HTMLElement): void {
    void action(name, trigger).catch((error: unknown) => {
        notify(errorMessage(error), true);
    });
}
app.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('button,[data-select]');
    if (!target) return;
    const data = target.dataset;
    if (data['select']) select(data['select'], event.ctrlKey || event.metaKey || event.shiftKey);
    if (data['lock'])
        mutate(next => {
            const node = next.nodes[data['lock'] ?? ''];
            if (node) node.locked = !node.locked;
        }, 'Object lock changed');
    if (data['collapse']) {
        const id = data['collapse'];
        if (collapsed.has(id)) collapsed.delete(id);
        else collapsed.add(id);
        renderHierarchy();
    }
    if (data['visibility'])
        mutate(next => {
            const node = next.nodes[data['visibility'] ?? ''];
            if (node) node.visible = !node.visible;
        }, 'Visibility updated');
    if (data['create']) createObject(data['create']);
    if (
        data['assetTab'] === 'primitives' ||
        data['assetTab'] === 'materials' ||
        data['assetTab'] === 'console' ||
        data['assetTab'] === 'files' ||
        data['assetTab'] === 'prefabs' ||
        data['assetTab'] === 'timeline' ||
        data['assetTab'] === 'scripts'
    ) {
        if (assetTab === 'timeline') timeline.stop();
        assetTab = data['assetTab'];
        if (assetTab === 'timeline') workspaceLayout.setPreset('animation');
        renderAssets();
    }
    if (data['material']) {
        if (!selected || scene.nodes[selected]?.type !== 'mesh') {
            notify('Select a mesh before applying a material.');
            return;
        }
        mutate(next => {
            const node = next.nodes[selected ?? ''];
            if (node) node.material = data['material'] ?? '';
        }, 'Material applied');
    }
    if (data['command']) {
        closeDialogs();
        runAction(data['command'], target);
    }
    if (data['action']) runAction(data['action'], target);
});
document.addEventListener('pointerdown', event => {
    if (
        event.target instanceof Element &&
        !event.target.closest('#add-menu,[data-action="add-menu"]')
    )
        element('#add-menu').hidden = true;
});
element('#inspector-content').addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    const key = input.dataset['field'];
    if (!key) return;
    for (
        let ancestor = selected ? scene.nodes[selected] : undefined;
        ancestor;
        ancestor = ancestor.parent ? scene.nodes[ancestor.parent] : undefined
    ) {
        if (ancestor.locked) {
            notify('Unlock this object or its parent before editing properties.', true);
            renderInspector();
            return;
        }
    }
    mutate(
        next => {
            if (key === 'scene-name') {
                next.name = input.value.trim();
                return;
            }
            if (key === 'background') {
                next.environment.background = input.value;
                return;
            }
            if (key === 'ambient') {
                next.environment.ambientIntensity = Number(input.value);
                return;
            }
            const node = selected ? next.nodes[selected] : undefined;
            if (!node) return;
            if (key === 'name') node.name = input.value.trim();
            else if (key === 'visible' && input instanceof HTMLInputElement)
                node.visible = input.checked;
            else if (key === 'parent') node.parent = input.value || null;
            else if (key === 'asset' && node.type === 'model') node.asset = input.value;
            else if (key === 'material') {
                if (input.value) node.material = input.value;
                else Reflect.deleteProperty(node, 'material');
            } else if (key === 'light-color' && node.light) node.light.color = input.value;
            else if (key === 'intensity' && node.light) node.light.intensity = Number(input.value);
            else if (key.startsWith('camera.') && node.camera) {
                const property = key.slice(7);
                if (property === 'fov' || property === 'near' || property === 'far')
                    node.camera[property] = Number(input.value);
            } else if (key.includes('.')) {
                const [kind, axis] = key.split('.');
                if (
                    (kind === 'position' || kind === 'rotation' || kind === 'scale') &&
                    (axis === 'x' || axis === 'y' || axis === 'z')
                )
                    node.transform[kind][axis] = Number(input.value);
            } else {
                const material = node.material ? next.materials[node.material] : undefined;
                if (!material) return;
                if (key === 'color') material.color = input.value;
                if (key === 'material-name') material.name = input.value.trim();
                if (key === 'emissiveColor') material.emissiveColor = input.value;
                if (
                    key === 'baseColorTexture' ||
                    key === 'normalTexture' ||
                    key === 'metallicRoughnessTexture' ||
                    key === 'emissiveTexture'
                ) {
                    if (input.value) material[key] = input.value;
                    else Reflect.deleteProperty(material, key);
                }
                if (key === 'metallic' || key === 'roughness') material[key] = Number(input.value);
            }
        },
        'Properties updated',
        true
    );
    if (key === 'parent') renderHierarchy();
    if (key === 'material') {
        renderInspector();
        app.querySelector<HTMLElement>('[data-field="material"]')?.focus({ preventScroll: true });
    }
});
element('#inspector-content').addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
        const output = event.target.parentElement?.querySelector('output');
        if (output) output.value = Number(event.target.value).toFixed(2);
    }
});
element('#hierarchy-search').addEventListener('input', renderHierarchy);
element('#asset-search').addEventListener('input', renderAssets);
element('#command-search').addEventListener('input', renderCommands);
element('#authored-camera').addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) viewport?.setCamera(event.target.value || null);
});
element('#transform-space').addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement)
        viewport?.setTransformSpace(event.target.value === 'local' ? 'local' : 'world');
});
element('#camera-view').addEventListener('change', event => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    if (value === 'perspective' || value === 'top' || value === 'front' || value === 'right') {
        setPreview(false);
        viewport?.setCamera(null);
        element<HTMLSelectElement>('#authored-camera').value = '';
        viewport?.setView(value);
    }
});
element('#file-input').addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        notify('Scene exceeds the 2 MiB import limit.', true);
        input.value = '';
        return;
    }
    void file
        .text()
        .then(text => {
            commit(parseScene(text), 'Scene imported');
            viewport?.focus(null);
        })
        .catch((error: unknown) => {
            notify(errorMessage(error), true);
        })
        .finally(() => {
            input.value = '';
        });
});
document.addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (element<HTMLDialogElement>('#source-dialog').open) {
            runAction('apply-source');
        } else {
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && focused.closest('#inspector-content'))
                focused.blur();
            persist(true);
        }
        return;
    }
    const editing =
        event.target instanceof Element &&
        !!event.target.closest('input,textarea,select,[contenteditable]');
    if (app.querySelector('dialog[open]') || editing) return;
    const key = event.key.toLowerCase();
    if (playController.active && key === 'escape') {
        event.preventDefault();
        playController.stop();
        return;
    }
    if (playController.active && !modifier) return;
    if (modifier && key === 'z') {
        event.preventDefault();
        changeHistory(event.shiftKey ? 'redo' : 'undo');
    } else if (modifier && key === 'y') {
        event.preventDefault();
        changeHistory('redo');
    } else if (modifier && key === 'd') {
        event.preventDefault();
        duplicate();
    } else if (modifier && key === 'k') {
        event.preventDefault();
        runAction('commands');
    } else if (key === 'w' || key === 'e' || key === 'r') {
        event.preventDefault();
        setTransformTool(key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale');
    } else if (key === 'f') {
        event.preventDefault();
        focusSelection();
    } else if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        runAction('delete');
    } else if (key === 'escape') {
        select(null);
        element('#add-menu').hidden = true;
    }
});
const authoringOptions = {
    getProject: (): ProjectDocument => history.project,
    getSelected: (): string | null => selected,
    onCommit: commitProject,
    onSelect: select,
    onNotify: notify
};
const projectPanel = new ProjectPanel(app, { controller: projectController, ...authoringOptions });
const assetPanel = new AssetPanel(authoringOptions);
const prefabPanel = new PrefabPanel(authoringOptions);
const scriptPanel = new ScriptPanel(app, authoringOptions);
const playController = new PlayController({
    getProject: () => history.project,
    getClipId: () => element<HTMLSelectElement>('#runtime-clip').value || null,
    onTransforms: transforms => {
        viewport?.applyTransforms(transforms);
        handleTransform({ phase: 'preview', transforms });
    },
    onRestore: () => {
        viewport?.setCamera(null);
        element<HTMLSelectElement>('#authored-camera').value = '';
        viewport?.setScene(scene);
        patchPropertyView();
    },
    onState: (state, time) => {
        const active = state !== 'stopped';
        app.dataset['playState'] = state;
        element('#play-button').classList.toggle('active', active);
        element<HTMLButtonElement>('#pause-play').disabled = state !== 'playing';
        element<HTMLButtonElement>('#stop-play').disabled = !active;
        element<HTMLButtonElement>('#play-button').disabled =
            state === 'playing' || state === 'starting';
        element('#play-time').hidden = !active;
        element('#play-time').textContent = `${time.toFixed(2)} s`;
        viewport?.setInteractionEnabled(!active);
        if (state === 'starting')
            viewport?.setCamera(element<HTMLSelectElement>('#authored-camera').value || null);
    },
    onLog: recordActivity,
    onError: message => {
        notify(`Play mode stopped: ${message}`, true);
    }
});
const runtimeKeys = new Set<string>();
let runtimePointer = { x: 0, y: 0, buttons: 0 };
function updateRuntimeInput(): void {
    playController.setInput({ keys: [...runtimeKeys], pointer: runtimePointer });
}
document.addEventListener('keydown', event => {
    if (
        !playController.active ||
        (event.target instanceof Element && event.target.closest('input,textarea,select'))
    )
        return;
    runtimeKeys.add(
        event.code === 'Space'
            ? 'Space'
            : event.key.startsWith('Arrow')
              ? event.key
              : event.key.toLowerCase()
    );
    updateRuntimeInput();
});
document.addEventListener('keyup', event => {
    runtimeKeys.delete(
        event.code === 'Space'
            ? 'Space'
            : event.key.startsWith('Arrow')
              ? event.key
              : event.key.toLowerCase()
    );
    updateRuntimeInput();
});
element('#viewport').addEventListener('pointermove', event => {
    const bounds = element('#viewport').getBoundingClientRect();
    runtimePointer = {
        x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        y: 1 - ((event.clientY - bounds.top) / bounds.height) * 2,
        buttons: event.buttons
    };
    updateRuntimeInput();
});
window.addEventListener('blur', () => {
    runtimeKeys.clear();
    runtimePointer = { ...runtimePointer, buttons: 0 };
    updateRuntimeInput();
    playController.pause();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        runtimeKeys.clear();
        runtimePointer = { ...runtimePointer, buttons: 0 };
        updateRuntimeInput();
        playController.pause();
    }
});
const timeline = new Timeline(element('#timeline-host'), {
    getScene: () => scene,
    getSceneId: () => projectView.activeSceneId,
    getClips: () => Object.values(projectView.clips),
    getSelected: () => selected,
    onChangeClip: clip => {
        const project = history.project;
        project.clips[clip.id] = clip;
        commitProject(project, 'Animation clip updated');
    },
    onDeleteClip: id => {
        const project = history.project;
        project.clips = Object.fromEntries(
            Object.entries(project.clips).filter(([key]) => key !== id)
        );
        commitProject(project, 'Animation clip deleted');
    },
    onPreview: transforms => {
        setPreview(false);
        viewport?.applyTransforms(transforms);
        handleTransform({ phase: 'preview', transforms });
    },
    onStop: () => {
        viewport?.setScene(scene);
        patchPropertyView();
    },
    onError: message => {
        notify(message, true);
    }
});
const workspaceLayout = new WorkspaceLayout(app, {
    onError: message => {
        notify(message, true);
    }
});
function updateAuthoringPermissions(): void {
    for (const input of app.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >('#inspector-content input, #inspector-content select, #inspector-content button'))
        input.disabled = !canEditShared;
    element<HTMLButtonElement>('#undo').disabled = !canEditShared || !history.canUndo;
    element<HTMLButtonElement>('#redo').disabled = !canEditShared || !history.canRedo;
}
const permissionObserver = new MutationObserver(updateAuthoringPermissions);
permissionObserver.observe(element('#inspector-content'), { childList: true, subtree: true });
const collaborationPanel = new CollaborationPanel(app, {
    getProject: () => history.project,
    onRemoteProject: async (incoming, label) => {
        const receivingHistory = history;
        const receivingEpoch = authoringEpoch;
        await validateProjectAssetDecoding(incoming.assets);
        if (receivingHistory !== history || receivingEpoch !== authoringEpoch) {
            window.setTimeout(() => {
                collaborationPanel.projectChanged();
            }, 0);
            throw new Error(
                'Local work changed while shared assets were being checked. Newer edits were kept; review the shared revision again.'
            );
        }
        const current = history.project;
        const next = {
            ...incoming,
            id: current.id,
            revision: current.revision,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        };
        applyingRemote = true;
        try {
            timeline.stop();
            commitProject(next, label, true);
        } finally {
            applyingRemote = false;
        }
    },
    onSaveCopy: async () => {
        await projectController.saveCopy();
    },
    onNotify: notify,
    onRole: role => {
        canEditShared = role !== 'viewer';
        viewport?.setAuthoringEnabled(canEditShared);
        updateAuthoringPermissions();
        app.dataset['collaborationRole'] = role ?? 'local';
    }
});
projectController.onStatus = (state, message) => {
    const indicator = element('#save-state');
    indicator.textContent =
        state === 'saved'
            ? 'Saved locally'
            : state === 'saving'
              ? 'Saving…'
              : state === 'pending'
                ? 'Unsaved changes'
                : state === 'conflict'
                  ? 'Project conflict'
                  : 'Save unavailable';
    indicator.title = message;
    indicator.dataset['state'] = state;
    if (state === 'error' || state === 'conflict' || state === 'unavailable') notify(message, true);
};
projectController.onStatus(
    projectController.state,
    projectController.startupWarning || 'Project ready'
);
app.dataset['playState'] = 'stopped';
projectController.onProject = (_project, message) => {
    if (playController.active) playController.stop();
    timeline.stop();
    closeDialogs();
    history = projectController.history;
    authoringEpoch++;
    projectView = history.project;
    scene = history.scene;
    selectedIds.clear();
    selected = null;
    setPreview(false);
    syncViewport();
    render();
    collaborationPanel.projectChanged();
    notify(message);
};
window.addEventListener('pagehide', event => {
    if (event.persisted) {
        runtimeKeys.clear();
        runtimePointer = { ...runtimePointer, buttons: 0 };
        updateRuntimeInput();
        playController.pause();
    }
    if (!event.persisted) {
        cancelAnimationFrame(logFrame);
        logFrame = 0;
        viewport?.destroy();
        playController.stop();
        scriptPanel.destroy();
        permissionObserver.disconnect();
        collaborationPanel.destroy();
        workspaceLayout.destroy();
        projectPanel.destroy();
        assetPanel.destroy();
        timeline.destroy();
    }
});
render();
try {
    viewport = await EditorViewport.create(
        element('#viewport'),
        id => {
            select(id);
        },
        message => {
            notify(message, true);
        },
        handleTransform
    );
    await viewport.setAssets(projectView.assets);
    viewport.setScene(scene);
    viewport.select([...selectedIds]);
    viewport.setAuthoringEnabled(canEditShared);
    viewport.setTransformMode(transformMode);
    viewport.setTransformSnap(transformSnap);
    viewport.setGrid(gridVisible);
    const currentView = element<HTMLSelectElement>('#camera-view').value;
    if (currentView === 'top' || currentView === 'front' || currentView === 'right')
        viewport.setView(currentView);
    viewport.setPreview(preview);
    element('#viewport-loading').remove();
    element('#renderer-state').textContent = 'Material preview';
    element('#backend-label').textContent = viewport.backend.toUpperCase();
    void viewport.waitForAssets().catch((error: unknown) => {
        element('#renderer-state').textContent = 'Asset error · see Activity';
        notify(errorMessage(error), true);
    });
    app.dataset['ready'] = 'true';
    notify(startupWarning || 'Workspace ready. Make something worth exploring.', !!startupWarning);
} catch (error) {
    element('#viewport-loading').textContent = `Renderer unavailable: ${errorMessage(error)}`;
    element('#renderer-state').textContent = 'Renderer unavailable';
    notify(errorMessage(error), true);
}
