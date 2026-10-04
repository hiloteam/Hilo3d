import './workspace.css';

/** Built-in named workspaces, each retaining its own edited panel arrangement. */
export type WorkspacePreset = 'default' | 'focus' | 'animation';
export type WorkspacePanel = 'hierarchy' | 'inspector' | 'assets';
export type WorkspaceDock = 'left' | 'right' | 'bottom';

export interface WorkspacePanelState {
    dock: WorkspaceDock;
    collapsed: boolean;
}

/** Workspace preferences are local UI state and never enter the scene document. */
export interface WorkspaceSnapshot {
    preset: WorkspacePreset;
    leftWidth: number;
    rightWidth: number;
    bottomHeight: number;
    panels: Record<WorkspacePanel, WorkspacePanelState>;
}

export interface WorkspaceLayoutOptions {
    storageKey?: string;
    onError?: (message: string) => void;
}

interface SavedWorkspaces {
    version: 1;
    active: WorkspacePreset;
    layouts: Record<WorkspacePreset, WorkspaceSnapshot>;
}

interface PanelElements {
    panel: HTMLElement;
    originalParent: HTMLElement;
    originalNext: ChildNode | null;
    controls: HTMLElement;
    toggle: HTMLButtonElement;
    tab: HTMLButtonElement;
    originalId: string;
    originalRole: string | null;
    originalTabIndex: string | null;
}

interface ResizeGesture {
    kind: 'resize';
    dock: WorkspaceDock;
    pointer: number;
    element: HTMLElement;
    start: number;
    original: WorkspaceSnapshot;
    initialSize: number;
}

interface DockGesture {
    kind: 'dock';
    panel: WorkspacePanel;
    pointer: number;
    element: HTMLElement;
    x: number;
    y: number;
    moved: boolean;
    target: WorkspaceDock | null;
}

const PANEL_IDS: readonly WorkspacePanel[] = ['hierarchy', 'inspector', 'assets'];
const DOCK_IDS: readonly WorkspaceDock[] = ['left', 'right', 'bottom'];
const PRESETS: readonly WorkspacePreset[] = ['default', 'focus', 'animation'];
const PANEL_LABELS: Record<WorkspacePanel, string> = {
    hierarchy: 'Scene',
    inspector: 'Inspector',
    assets: 'Assets'
};
const SIZE_KEYS = {
    left: 'leftWidth',
    right: 'rightWidth',
    bottom: 'bottomHeight'
} as const;
const STORAGE_KEY = 'hilo-studio.workspace.v1';
let instanceSequence = 0;

function defaults(preset: WorkspacePreset): WorkspaceSnapshot {
    return {
        preset,
        leftWidth: 228,
        rightWidth: 285,
        bottomHeight: preset === 'animation' ? 280 : 195,
        panels: {
            hierarchy: { dock: 'left', collapsed: preset === 'focus' },
            inspector: { dock: 'right', collapsed: preset === 'focus' },
            assets: { dock: 'bottom', collapsed: preset === 'focus' }
        }
    };
}

function defaultWorkspaces(): SavedWorkspaces {
    return {
        version: 1,
        active: 'default',
        layouts: {
            default: defaults('default'),
            focus: defaults('focus'),
            animation: defaults('animation')
        }
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPreset(value: unknown): value is WorkspacePreset {
    return value === 'default' || value === 'focus' || value === 'animation';
}

function isDock(value: unknown): value is WorkspaceDock {
    return value === 'left' || value === 'right' || value === 'bottom';
}

function bounded(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function readSnapshot(value: unknown, preset: WorkspacePreset): WorkspaceSnapshot {
    if (
        !isRecord(value) ||
        value['preset'] !== preset ||
        !bounded(value['leftWidth'], 180, 600) ||
        !bounded(value['rightWidth'], 180, 600) ||
        !bounded(value['bottomHeight'], 110, 600) ||
        !isRecord(value['panels'])
    ) {
        throw new Error('Saved workspace dimensions or preset are invalid.');
    }
    const panels: Record<WorkspacePanel, WorkspacePanelState> = {
        hierarchy: { dock: 'left', collapsed: false },
        inspector: { dock: 'right', collapsed: false },
        assets: { dock: 'bottom', collapsed: false }
    };
    for (const id of PANEL_IDS) {
        const entry = value['panels'][id];
        if (!isRecord(entry) || !isDock(entry['dock']) || typeof entry['collapsed'] !== 'boolean') {
            throw new Error('Saved workspace panel arrangement is invalid.');
        }
        panels[id] = { dock: entry['dock'], collapsed: entry['collapsed'] };
    }
    return {
        preset,
        leftWidth: value['leftWidth'],
        rightWidth: value['rightWidth'],
        bottomHeight: value['bottomHeight'],
        panels
    };
}

function readWorkspaces(source: string): SavedWorkspaces {
    if (source.length > 10_000) throw new Error('Saved workspace exceeds its size limit.');
    const value: unknown = JSON.parse(source);
    if (!isRecord(value) || value['version'] !== 1 || !isPreset(value['active'])) {
        throw new Error('Saved workspace version is unsupported.');
    }
    const layouts = value['layouts'];
    if (!isRecord(layouts)) throw new Error('Saved workspace layouts are missing.');
    return {
        version: 1,
        active: value['active'],
        layouts: {
            default: readSnapshot(layouts['default'], 'default'),
            focus: readSnapshot(layouts['focus'], 'focus'),
            animation: readSnapshot(layouts['animation'], 'animation')
        }
    };
}

function requiredElement(parent: HTMLElement, selector: string): HTMLElement {
    const result = parent.querySelector<HTMLElement>(selector);
    if (!result) throw new Error(`Workspace requires ${selector}.`);
    return result;
}

function makeButton(label: string, className = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
}

/** Persistent dock layout with cancelable resizing, accessible docking and compact-screen recovery. */
export class WorkspaceLayout {
    private readonly workspace: HTMLElement;
    private readonly center: HTMLElement;
    private readonly controller = new AbortController();
    private readonly observer: ResizeObserver;
    private readonly toolbar = document.createElement('nav');
    private readonly presetSelect = document.createElement('select');
    private readonly status = document.createElement('span');
    private readonly compactTabs = document.createElement('div');
    private readonly overlay = document.createElement('div');
    private readonly dockMenu = document.createElement('div');
    private readonly zones = new Map<WorkspaceDock, HTMLElement>();
    private readonly splitters = new Map<WorkspaceDock, HTMLElement>();
    private readonly panels = new Map<WorkspacePanel, PanelElements>();
    private readonly storageKey: string;
    private readonly onError: ((message: string) => void) | undefined;
    private saved = defaultWorkspaces();
    private gesture: ResizeGesture | DockGesture | null = null;
    private compact = false;
    private compactPanel: WorkspacePanel = 'assets';
    private menuPanel: WorkspacePanel | null = null;
    private suppressedClick: { panel: WorkspacePanel; until: number } | null = null;
    private destroyed = false;
    private lastWidth = 0;
    private lastHeight = 0;
    private resizeFrame = 0;
    private storageFailure: string | null = null;

    constructor(
        private readonly app: HTMLElement,
        options: WorkspaceLayoutOptions = {}
    ) {
        this.workspace = requiredElement(app, '.workspace');
        this.center = requiredElement(this.workspace, '.center-workspace');
        this.storageKey = options.storageKey ?? STORAGE_KEY;
        this.onError = options.onError;
        // Validate required panel hosts before making any DOM changes.
        const sources = PANEL_IDS.map(id => {
            const panel = requiredElement(app, id === 'assets' ? '.assets-panel' : `.${id}`);
            const heading = requiredElement(
                panel,
                id === 'assets' ? '.assets-heading' : '.panel-heading'
            );
            const parent = panel.parentElement;
            if (!parent) throw new Error(`Workspace panel ${id} is detached.`);
            return { id, panel, heading, parent };
        });
        this.mountToolbar();
        this.workspace.classList.add('workspace-managed');
        this.app.classList.add('workspace-layout-enabled');
        this.center.classList.add('workspace-scene-region');
        this.center.tabIndex = -1;
        for (const dock of DOCK_IDS) this.mountDock(dock);
        this.compactTabs.className = 'workspace-compact-tabs';
        this.compactTabs.setAttribute('role', 'tablist');
        this.compactTabs.setAttribute('aria-label', 'Workspace panels');
        this.zones.get('bottom')?.append(this.compactTabs);
        const instance = ++instanceSequence;
        for (const source of sources) this.mountPanel(source, instance);
        this.mountDockMenu();
        this.overlay.className = 'workspace-dock-overlay';
        this.overlay.hidden = true;
        this.overlay.setAttribute('aria-hidden', 'true');
        for (const dock of DOCK_IDS) {
            const target = document.createElement('div');
            target.className = `workspace-drop-zone workspace-drop-${dock}`;
            target.dataset['dock'] = dock;
            target.textContent = `Dock ${dock}`;
            this.overlay.append(target);
        }
        this.workspace.append(this.overlay);
        try {
            const source = localStorage.getItem(this.storageKey);
            if (source) this.saved = readWorkspaces(source);
        } catch (cause) {
            this.reportError(`Workspace restored to defaults: ${this.errorMessage(cause)}`);
        }
        const signal = this.controller.signal;
        document.addEventListener('keydown', this.handleGlobalKeyDown, { signal, capture: true });
        document.addEventListener('pointerdown', this.handleOutsidePointer, { signal });
        this.observer = new ResizeObserver(() => {
            const rect = this.workspace.getBoundingClientRect();
            if (rect.width === this.lastWidth && rect.height === this.lastHeight) return;
            if (this.resizeFrame) return;
            // Reparenting panels changes their observed geometry. Apply in the next frame rather
            // than mutating layout inside ResizeObserver delivery and creating a feedback loop.
            this.resizeFrame = requestAnimationFrame(() => {
                this.resizeFrame = 0;
                if (this.destroyed) return;
                if (this.gesture) this.cancelGesture();
                this.apply();
            });
        });
        this.observer.observe(this.workspace);
        this.apply();
    }

    /** A detached snapshot of the current named layout, before responsive size clamping. */
    getState(): WorkspaceSnapshot {
        return structuredClone(this.current);
    }

    get persistenceError(): string | null {
        return this.storageFailure;
    }

    /** Restore a named layout; changes to each preset are saved independently. */
    setPreset(preset: WorkspacePreset): void {
        if (this.destroyed) return;
        this.cancelGesture();
        this.closeMenu();
        this.saved.active = preset;
        this.apply();
        this.persist();
        this.announce(`${preset} workspace restored.`);
    }

    /** Copy the current arrangement into a named slot and activate that slot. */
    savePreset(preset: WorkspacePreset): void {
        if (this.destroyed) return;
        this.cancelGesture();
        this.saved.layouts[preset] = { ...this.getState(), preset };
        this.saved.active = preset;
        this.apply();
        this.persist();
        this.announce(`Current arrangement saved as ${preset}.`);
    }

    /** Restore all factory presets and activate the default workspace. */
    reset(): void {
        if (this.destroyed) return;
        this.cancelGesture();
        this.closeMenu();
        this.saved = defaultWorkspaces();
        this.apply();
        this.persist();
        this.announce('Default workspace restored.');
    }

    /** Move a live panel without recreating its controls or engine canvas. */
    dock(panel: WorkspacePanel, dock: WorkspaceDock): void {
        if (this.destroyed) return;
        this.current.panels[panel] = { dock, collapsed: false };
        this.compactPanel = panel;
        this.apply();
        this.persist();
        this.announce(`${PANEL_LABELS[panel]} docked ${dock}.`);
    }

    setCollapsed(panel: WorkspacePanel, collapsed: boolean): void {
        if (this.destroyed) return;
        this.current.panels[panel].collapsed = collapsed;
        if (!collapsed) this.compactPanel = panel;
        this.apply();
        this.persist();
        this.announce(`${PANEL_LABELS[panel]} ${collapsed ? 'hidden' : 'shown'}.`);
    }

    /** Reveal a panel and focus its first enabled control. */
    focusPanel(panel: WorkspacePanel): void {
        if (this.destroyed) return;
        this.setCollapsed(panel, false);
        const host = this.panels.get(panel)?.panel;
        const target =
            host?.querySelector<HTMLElement>(
                'input:not([disabled]),textarea:not([disabled]),select:not([disabled])'
            ) ?? host?.querySelector<HTMLElement>('button:not([disabled])');
        (target ?? host)?.focus();
    }

    /** Remove listeners and layout chrome and return panels to their original DOM parents. */
    destroy(): void {
        if (this.destroyed) return;
        this.cancelGesture();
        this.destroyed = true;
        this.observer.disconnect();
        cancelAnimationFrame(this.resizeFrame);
        this.resizeFrame = 0;
        this.controller.abort();
        for (const elements of this.panels.values()) {
            const { panel, originalParent, originalNext } = elements;
            if (originalNext?.parentNode === originalParent)
                originalParent.insertBefore(panel, originalNext);
            else originalParent.append(panel);
            elements.controls.remove();
            panel.hidden = false;
            panel.classList.remove('workspace-docked-panel');
            panel.id = elements.originalId;
            this.restoreAttribute(panel, 'role', elements.originalRole);
            this.restoreAttribute(panel, 'tabindex', elements.originalTabIndex);
            panel.removeAttribute('aria-labelledby');
            delete panel.dataset['workspacePanel'];
        }
        for (const zone of this.zones.values()) zone.remove();
        for (const splitter of this.splitters.values()) splitter.remove();
        this.toolbar.remove();
        this.dockMenu.remove();
        this.overlay.remove();
        this.workspace.classList.remove(
            'workspace-managed',
            'workspace-compact',
            'workspace-dragging'
        );
        this.center.classList.remove('workspace-scene-region');
        this.app.classList.remove('workspace-layout-enabled');
        for (const name of [
            'left',
            'right',
            'bottom',
            'left-split',
            'right-split',
            'bottom-split'
        ]) {
            this.workspace.style.removeProperty(`--workspace-${name}`);
        }
    }

    private get current(): WorkspaceSnapshot {
        return this.saved.layouts[this.saved.active];
    }

    private mountToolbar(): void {
        this.toolbar.className = 'workspace-layout-controls';
        this.toolbar.setAttribute('aria-label', 'Workspace layout');
        const label = document.createElement('label');
        label.textContent = 'Workspace';
        this.presetSelect.setAttribute('aria-label', 'Workspace preset');
        for (const preset of PRESETS) {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
            this.presetSelect.append(option);
        }
        this.presetSelect.addEventListener(
            'change',
            () => {
                if (isPreset(this.presetSelect.value)) this.setPreset(this.presetSelect.value);
            },
            { signal: this.controller.signal }
        );
        label.append(this.presetSelect);
        this.toolbar.append(label);
        const reset = makeButton('Reset layout', 'workspace-reset');
        reset.addEventListener(
            'click',
            () => {
                this.reset();
            },
            { signal: this.controller.signal }
        );
        this.status.className = 'workspace-layout-status';
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');
        this.toolbar.append(reset, this.status);
        this.workspace.before(this.toolbar);
    }

    private mountDock(dock: WorkspaceDock): void {
        const zone = document.createElement('div');
        zone.className = `workspace-dock workspace-dock-${dock}`;
        zone.dataset['workspaceDock'] = dock;
        this.zones.set(dock, zone);
        const splitter = document.createElement('div');
        splitter.className = `workspace-splitter workspace-splitter-${dock}`;
        splitter.tabIndex = 0;
        splitter.setAttribute('role', 'separator');
        splitter.setAttribute('aria-label', `Resize ${dock} panels`);
        splitter.setAttribute('aria-orientation', dock === 'bottom' ? 'horizontal' : 'vertical');
        splitter.title =
            'Drag to resize. Arrow keys resize; Shift changes by 40px. Escape cancels.';
        const signal = this.controller.signal;
        splitter.addEventListener(
            'pointerdown',
            event => {
                this.startResize(dock, event);
            },
            { signal }
        );
        splitter.addEventListener('pointermove', this.handlePointerMove, { signal });
        splitter.addEventListener('pointerup', this.handlePointerUp, { signal });
        splitter.addEventListener('pointercancel', this.handlePointerCancel, { signal });
        splitter.addEventListener('lostpointercapture', this.handlePointerCancel, { signal });
        splitter.addEventListener(
            'keydown',
            event => {
                this.resizeWithKeyboard(dock, event);
            },
            { signal }
        );
        splitter.addEventListener(
            'dblclick',
            () => {
                this.current[SIZE_KEYS[dock]] = defaults(this.saved.active)[SIZE_KEYS[dock]];
                this.apply();
                this.persist();
            },
            { signal }
        );
        this.splitters.set(dock, splitter);
        this.workspace.append(zone, splitter);
    }

    private mountPanel(
        source: {
            id: WorkspacePanel;
            panel: HTMLElement;
            heading: HTMLElement;
            parent: HTMLElement;
        },
        instance: number
    ): void {
        const { id, panel, heading, parent } = source;
        const controls = document.createElement('div');
        controls.className = 'workspace-panel-controls';
        const drag = makeButton('⠿', 'workspace-drag-handle');
        drag.setAttribute('aria-label', `Move ${PANEL_LABELS[id]} panel`);
        drag.setAttribute('aria-haspopup', 'menu');
        drag.setAttribute('aria-expanded', 'false');
        drag.title = `Drag ${PANEL_LABELS[id]} to dock, or click for docking options`;
        const collapse = makeButton('−', 'workspace-collapse');
        collapse.setAttribute('aria-label', `Hide ${PANEL_LABELS[id]} panel`);
        collapse.title = `Hide ${PANEL_LABELS[id]} panel`;
        const toggle = makeButton(PANEL_LABELS[id], 'workspace-panel-toggle');
        toggle.setAttribute('aria-label', `Toggle ${PANEL_LABELS[id]} panel`);
        const tab = makeButton(PANEL_LABELS[id]);
        tab.id = `workspace-${String(instance)}-${id}-tab`;
        tab.setAttribute('role', 'tab');
        const originalId = panel.id;
        panel.id ||= `workspace-${String(instance)}-${id}`;
        toggle.setAttribute('aria-controls', panel.id);
        tab.setAttribute('aria-controls', panel.id);
        this.panels.set(id, {
            panel,
            originalParent: parent,
            originalNext: panel.nextSibling,
            controls,
            toggle,
            tab,
            originalId,
            originalRole: panel.getAttribute('role'),
            originalTabIndex: panel.getAttribute('tabindex')
        });
        panel.classList.add('workspace-docked-panel');
        panel.dataset['workspacePanel'] = id;
        panel.tabIndex = -1;
        panel.setAttribute('role', 'region');
        const signal = this.controller.signal;
        drag.addEventListener(
            'pointerdown',
            event => {
                this.startDock(id, event);
            },
            { signal }
        );
        drag.addEventListener('pointermove', this.handlePointerMove, { signal });
        drag.addEventListener('pointerup', this.handlePointerUp, { signal });
        drag.addEventListener('pointercancel', this.handlePointerCancel, { signal });
        drag.addEventListener('lostpointercapture', this.handlePointerCancel, { signal });
        drag.addEventListener(
            'click',
            event => {
                event.stopPropagation();
                if (
                    this.suppressedClick?.panel === id &&
                    performance.now() < this.suppressedClick.until
                ) {
                    this.suppressedClick = null;
                    return;
                }
                this.openMenu(id, drag);
            },
            { signal }
        );
        collapse.addEventListener(
            'click',
            () => {
                this.setCollapsed(id, true);
            },
            { signal }
        );
        toggle.addEventListener(
            'click',
            () => {
                if (
                    this.compact &&
                    this.compactPanel !== id &&
                    !this.current.panels[id].collapsed
                ) {
                    this.compactPanel = id;
                    this.apply();
                } else this.setCollapsed(id, !this.current.panels[id].collapsed);
            },
            { signal }
        );
        tab.addEventListener(
            'click',
            () => {
                this.compactPanel = id;
                this.apply();
            },
            { signal }
        );
        tab.addEventListener(
            'keydown',
            event => {
                this.switchCompactTab(id, event);
            },
            { signal }
        );
        controls.append(drag, collapse);
        heading.append(controls);
        this.toolbar.insertBefore(toggle, this.toolbar.querySelector('.workspace-reset'));
        this.compactTabs.append(tab);
    }

    private mountDockMenu(): void {
        this.dockMenu.className = 'workspace-dock-menu';
        this.dockMenu.hidden = true;
        this.dockMenu.setAttribute('role', 'menu');
        this.dockMenu.setAttribute('aria-label', 'Dock panel');
        for (const dock of DOCK_IDS) {
            const button = makeButton(`Dock ${dock}`);
            button.setAttribute('role', 'menuitem');
            button.addEventListener(
                'click',
                () => {
                    const panel = this.menuPanel;
                    this.closeMenu();
                    if (panel) {
                        this.dock(panel, dock);
                        this.focusPanel(panel);
                    }
                },
                { signal: this.controller.signal }
            );
            this.dockMenu.append(button);
        }
        this.dockMenu.addEventListener(
            'keydown',
            event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const items = Array.from(
                    this.dockMenu.querySelectorAll<HTMLButtonElement>('button')
                );
                const current = items.findIndex(item => item === document.activeElement);
                const next =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                            items.length;
                items[next]?.focus();
                event.preventDefault();
            },
            { signal: this.controller.signal }
        );
        this.app.append(this.dockMenu);
    }

    private apply(): void {
        if (this.destroyed) return;
        const rect = this.workspace.getBoundingClientRect();
        this.lastWidth = rect.width;
        this.lastHeight = rect.height;
        this.compact = rect.width < 760;
        this.workspace.classList.toggle('workspace-compact', this.compact);
        this.compactTabs.hidden = !this.compact;
        this.presetSelect.value = this.saved.active;
        const visible = PANEL_IDS.filter(id => !this.current.panels[id].collapsed);
        if (!visible.includes(this.compactPanel)) this.compactPanel = visible[0] ?? 'assets';
        for (const id of PANEL_IDS) {
            const elements = this.panels.get(id);
            if (!elements) continue;
            const entry = this.current.panels[id];
            const zone = this.zones.get(this.compact ? 'bottom' : entry.dock);
            if (zone && elements.panel.parentElement !== zone) zone.append(elements.panel);
            const hidden = entry.collapsed || (this.compact && this.compactPanel !== id);
            if (hidden && elements.panel.contains(document.activeElement)) elements.toggle.focus();
            elements.panel.hidden = hidden;
            elements.toggle.setAttribute('aria-pressed', String(!entry.collapsed));
            elements.toggle.classList.toggle(
                'active',
                !entry.collapsed && (!this.compact || id === this.compactPanel)
            );
            elements.tab.hidden = entry.collapsed;
            elements.tab.tabIndex = id === this.compactPanel ? 0 : -1;
            elements.tab.setAttribute('aria-selected', String(id === this.compactPanel));
            elements.panel.setAttribute('role', this.compact ? 'tabpanel' : 'region');
            if (this.compact) elements.panel.setAttribute('aria-labelledby', elements.tab.id);
            else elements.panel.removeAttribute('aria-labelledby');
        }
        const populated = (dock: WorkspaceDock): boolean =>
            this.compact
                ? dock === 'bottom' && visible.length > 0
                : visible.some(id => this.current.panels[id].dock === dock);
        const leftVisible = populated('left');
        const rightVisible = populated('right');
        let left = leftVisible ? this.current.leftWidth : 0;
        let right = rightVisible ? this.current.rightWidth : 0;
        const available = Math.max(
            0,
            rect.width - 280 - (leftVisible ? 6 : 0) - (rightVisible ? 6 : 0) - 8
        );
        if (left + right > available) {
            const minimumLeft = leftVisible ? 180 : 0;
            const minimumRight = rightVisible ? 180 : 0;
            const extra = left + right - minimumLeft - minimumRight;
            const ratio =
                extra > 0 ? Math.max(0, available - minimumLeft - minimumRight) / extra : 0;
            left = minimumLeft + (left - minimumLeft) * ratio;
            right = minimumRight + (right - minimumRight) * ratio;
        }
        const bottom = populated('bottom')
            ? Math.min(this.current.bottomHeight, Math.max(90, rect.height - 180))
            : 0;
        const sizes: Record<WorkspaceDock, number> = { left, right, bottom };
        for (const dock of DOCK_IDS) {
            const shown = populated(dock);
            const zone = this.zones.get(dock);
            const splitter = this.splitters.get(dock);
            if (zone) zone.hidden = !shown;
            if (splitter) {
                splitter.hidden = !shown;
                splitter.setAttribute('aria-valuemin', String(dock === 'bottom' ? 110 : 180));
                splitter.setAttribute('aria-valuemax', String(this.maximumSize(dock)));
                splitter.setAttribute('aria-valuenow', String(Math.round(sizes[dock])));
                splitter.setAttribute(
                    'aria-valuetext',
                    `${String(Math.round(sizes[dock]))} pixels`
                );
            }
            this.workspace.style.setProperty(`--workspace-${dock}`, `${String(sizes[dock])}px`);
            this.workspace.style.setProperty(`--workspace-${dock}-split`, shown ? '6px' : '0px');
        }
    }

    private maximumSize(dock: WorkspaceDock): number {
        if (dock === 'bottom') return Math.max(110, Math.min(600, this.lastHeight - 180));
        const other: WorkspaceDock = dock === 'left' ? 'right' : 'left';
        const hasOther = PANEL_IDS.some(
            id => !this.current.panels[id].collapsed && this.current.panels[id].dock === other
        );
        return Math.max(180, Math.min(600, this.lastWidth - 296 - (hasOther ? 180 : 0)));
    }

    private resize(dock: WorkspaceDock, size: number): void {
        this.current[SIZE_KEYS[dock]] = Math.max(
            dock === 'bottom' ? 110 : 180,
            Math.min(this.maximumSize(dock), size)
        );
        this.apply();
    }

    private startResize(dock: WorkspaceDock, event: PointerEvent): void {
        if (event.button !== 0 || this.destroyed || !(event.currentTarget instanceof HTMLElement))
            return;
        this.cancelGesture();
        this.closeMenu();
        event.preventDefault();
        const element = event.currentTarget;
        element.focus();
        const bounds = this.zones.get(dock)?.getBoundingClientRect();
        this.gesture = {
            kind: 'resize',
            dock,
            pointer: event.pointerId,
            element,
            start: dock === 'bottom' ? event.clientY : event.clientX,
            original: this.getState(),
            initialSize: bounds
                ? dock === 'bottom'
                    ? bounds.height
                    : bounds.width
                : this.current[SIZE_KEYS[dock]]
        };
        element.setPointerCapture(event.pointerId);
        this.workspace.classList.add('workspace-dragging');
    }

    private resizeWithKeyboard(dock: WorkspaceDock, event: KeyboardEvent): void {
        if (this.gesture) return;
        const horizontal = dock !== 'bottom';
        const negative = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const positive = horizontal ? 'ArrowRight' : 'ArrowDown';
        let size = this.current[SIZE_KEYS[dock]];
        if (event.key === negative || event.key === positive) {
            const sign = (event.key === positive ? 1 : -1) * (dock === 'left' ? 1 : -1);
            size += sign * (event.shiftKey ? 40 : 10);
        } else if (event.key === 'Home') size = dock === 'bottom' ? 110 : 180;
        else if (event.key === 'End') size = this.maximumSize(dock);
        else if (event.key === 'Enter') size = defaults(this.saved.active)[SIZE_KEYS[dock]];
        else return;
        event.preventDefault();
        event.stopPropagation();
        this.resize(dock, size);
        this.persist();
    }

    private startDock(panel: WorkspacePanel, event: PointerEvent): void {
        if (event.button !== 0 || this.destroyed || !(event.currentTarget instanceof HTMLElement))
            return;
        this.cancelGesture();
        this.closeMenu();
        this.gesture = {
            kind: 'dock',
            panel,
            pointer: event.pointerId,
            element: event.currentTarget,
            x: event.clientX,
            y: event.clientY,
            moved: false,
            target: null
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (event.pointerId !== gesture?.pointer) return;
        if (gesture.kind === 'resize') {
            const coordinate = gesture.dock === 'bottom' ? event.clientY : event.clientX;
            const delta = (coordinate - gesture.start) * (gesture.dock === 'left' ? 1 : -1);
            this.resize(gesture.dock, gesture.initialSize + delta);
            return;
        }
        if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6)
            return;
        gesture.moved = true;
        this.overlay.hidden = false;
        this.workspace.classList.add('workspace-dragging');
        const rect = this.workspace.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        gesture.target =
            x < 0 || y < 0 || x > rect.width || y > rect.height
                ? null
                : x < rect.width * 0.27
                  ? 'left'
                  : x > rect.width * 0.73
                    ? 'right'
                    : y > rect.height * 0.65
                      ? 'bottom'
                      : null;
        for (const target of this.overlay.children) {
            if (target instanceof HTMLElement)
                target.classList.toggle('active', target.dataset['dock'] === gesture.target);
        }
    };

    private readonly handlePointerUp = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (event.pointerId !== gesture?.pointer) return;
        this.gesture = null;
        this.endPointer(gesture);
        if (gesture.kind === 'resize') this.persist();
        else if (gesture.moved) {
            this.suppressedClick = { panel: gesture.panel, until: performance.now() + 500 };
            if (gesture.target) this.dock(gesture.panel, gesture.target);
            else this.announce('Docking canceled.');
        }
    };

    private readonly handlePointerCancel = (event: PointerEvent): void => {
        if (this.gesture?.pointer === event.pointerId) this.cancelGesture();
    };

    private cancelGesture(): void {
        const gesture = this.gesture;
        if (!gesture) return;
        this.gesture = null;
        if (gesture.kind === 'resize') this.saved.layouts[this.saved.active] = gesture.original;
        this.endPointer(gesture);
        this.apply();
        this.announce('Workspace change canceled.');
    }

    private endPointer(gesture: ResizeGesture | DockGesture): void {
        if (gesture.element.hasPointerCapture(gesture.pointer))
            gesture.element.releasePointerCapture(gesture.pointer);
        this.overlay.hidden = true;
        this.workspace.classList.remove('workspace-dragging');
    }

    private openMenu(panel: WorkspacePanel, button: HTMLElement): void {
        this.menuPanel = panel;
        button.setAttribute('aria-expanded', 'true');
        this.dockMenu.hidden = false;
        const rect = button.getBoundingClientRect();
        this.dockMenu.style.left = `${String(Math.max(4, Math.min(rect.left, innerWidth - 164)))}px`;
        this.dockMenu.style.top = `${String(Math.min(rect.bottom + 4, innerHeight - 116))}px`;
        this.dockMenu.querySelector<HTMLButtonElement>('button')?.focus();
    }

    private closeMenu(restoreFocus = false): void {
        const panel = this.menuPanel;
        this.menuPanel = null;
        this.dockMenu.hidden = true;
        if (panel)
            this.panels
                .get(panel)
                ?.controls.querySelector('button')
                ?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && panel)
            this.panels.get(panel)?.controls.querySelector<HTMLButtonElement>('button')?.focus();
    }

    private readonly handleOutsidePointer = (event: PointerEvent): void => {
        if (event.target instanceof Node && !this.dockMenu.contains(event.target)) this.closeMenu();
    };

    private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && (this.gesture || this.menuPanel)) {
            event.preventDefault();
            event.stopPropagation();
            this.cancelGesture();
            this.closeMenu(true);
        }
        if (event.key === 'F6' && !this.app.querySelector('dialog[open]')) {
            const regions = [
                this.toolbar,
                this.center,
                ...PANEL_IDS.flatMap(id => {
                    const panel = this.panels.get(id)?.panel;
                    return panel && !panel.hidden ? [panel] : [];
                })
            ];
            const current = regions.findIndex(region => region.contains(document.activeElement));
            const next =
                regions[(current + (event.shiftKey ? -1 : 1) + regions.length) % regions.length];
            if (next === this.toolbar) this.presetSelect.focus();
            else next?.focus();
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private switchCompactTab(panel: WorkspacePanel, event: KeyboardEvent): void {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const visible = PANEL_IDS.filter(id => !this.current.panels[id].collapsed);
        const index = visible.indexOf(panel);
        const next =
            event.key === 'Home'
                ? visible[0]
                : event.key === 'End'
                  ? visible.at(-1)
                  : visible[
                        (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) %
                            visible.length
                    ];
        if (next) {
            this.compactPanel = next;
            this.apply();
            this.panels.get(next)?.tab.focus();
        }
        event.preventDefault();
    }

    private persist(): void {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.saved));
            this.storageFailure = null;
            this.toolbar.removeAttribute('data-storage-error');
        } catch (cause) {
            this.reportError(`Workspace could not be saved: ${this.errorMessage(cause)}`);
        }
        this.app.dispatchEvent(
            new CustomEvent<WorkspaceSnapshot>('workspacechange', { detail: this.getState() })
        );
    }

    private announce(message: string): void {
        this.status.textContent = this.storageFailure ?? message;
    }

    private reportError(message: string): void {
        this.storageFailure = message;
        this.toolbar.dataset['storageError'] = 'true';
        this.status.textContent = message;
        this.onError?.(message);
    }

    private errorMessage(cause: unknown): string {
        return cause instanceof Error ? cause.message : String(cause);
    }

    private restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
    }
}
