import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLayout } from '../../../editor/workspace';

const STORAGE_KEY = 'hilo3d-workspace-contract-test';
const instances: WorkspaceLayout[] = [];
const hosts: HTMLElement[] = [];

function fixture(width = 1200): {
    app: HTMLElement;
    workspace: HTMLElement;
    layout: WorkspaceLayout;
} {
    const app = document.createElement('div');
    app.style.cssText = `display:flex;flex-direction:column;width:${String(width)}px;height:640px;position:relative;`;
    app.innerHTML = `
        <main class="workspace" style="flex:1;min-height:0;">
            <aside class="hierarchy"><div class="panel-heading"><h2>Scene</h2></div><input aria-label="Scene filter" /></aside>
            <section class="center-workspace"><div class="viewport-panel"><canvas aria-label="Preview"></canvas></div><section class="assets-panel"><div class="assets-heading">Assets</div><button>Cube</button></section></section>
            <aside class="inspector"><div class="panel-heading"><h2>Inspector</h2></div><input aria-label="Object name" /></aside>
        </main>`;
    document.body.append(app);
    hosts.push(app);
    const layout = new WorkspaceLayout(app, { storageKey: STORAGE_KEY });
    instances.push(layout);
    return { app, workspace: query(app, '.workspace'), layout };
}

function query(parent: HTMLElement, selector: string): HTMLElement {
    const result = parent.querySelector<HTMLElement>(selector);
    if (!result) throw new Error(`Missing test element ${selector}`);
    return result;
}

function key(target: HTMLElement, value: string, shift = false): void {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: value,
            shiftKey: shift,
            bubbles: true,
            cancelable: true
        })
    );
}

function pointer(target: HTMLElement, type: string, x: number, y: number): void {
    target.dispatchEvent(
        new PointerEvent(type, {
            pointerId: 42,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true
        })
    );
}

async function resizeWorkspace(
    app: HTMLElement,
    workspace: HTMLElement,
    width: number
): Promise<void> {
    const resized = new Promise<void>(resolve => {
        const observer = new ResizeObserver(() => {
            if (workspace.getBoundingClientRect().width !== width) return;
            observer.disconnect();
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    resolve();
                });
            });
        });
        observer.observe(workspace);
    });
    app.style.width = `${String(width)}px`;
    await resized;
}

afterEach(() => {
    for (const instance of instances.splice(0)) instance.destroy();
    for (const host of hosts.splice(0)) host.remove();
    localStorage.removeItem(STORAGE_KEY);
    vi.restoreAllMocks();
});

describe('editor workspace layout', () => {
    it('docks existing live panels without replacing their inputs, listeners or viewport canvas', () => {
        const { app, layout } = fixture();
        const inspector = query(app, '.inspector');
        const input = query(inspector, 'input') as HTMLInputElement;
        const canvas = query(app, 'canvas');
        const changed = vi.fn();
        input.addEventListener('change', changed);
        input.value = 'Unsaved inspector value';
        layout.dock('inspector', 'left');
        expect(inspector.parentElement?.dataset['workspaceDock']).toBe('left');
        expect(query(inspector, 'input')).toBe(input);
        expect(input.value).toBe('Unsaved inspector value');
        input.dispatchEvent(new Event('change'));
        expect(changed).toHaveBeenCalledOnce();
        expect(query(app, 'canvas')).toBe(canvas);
        expect(layout.getState().panels.inspector.dock).toBe('left');
    });

    it('persists independent edited presets and restores them in a new instance', () => {
        const { layout } = fixture();
        layout.dock('assets', 'right');
        layout.setPreset('focus');
        expect(layout.getState().panels.hierarchy.collapsed).toBe(true);
        layout.setCollapsed('inspector', false);
        layout.setPreset('default');
        expect(layout.getState().panels.assets.dock).toBe('right');
        layout.savePreset('animation');
        expect(layout.getState().preset).toBe('animation');
        layout.destroy();
        const restored = fixture().layout;
        expect(restored.getState().panels.assets.dock).toBe('right');
        expect(restored.getState().preset).toBe('animation');
        restored.setPreset('focus');
        expect(restored.getState().panels.inspector.collapsed).toBe(false);
        expect(restored.getState().panels.assets.collapsed).toBe(true);
        restored.reset();
        expect(restored.getState().preset).toBe('default');
        expect(restored.getState().panels.assets.dock).toBe('bottom');
    });

    it('supports directional keyboard resize, coarse steps, limits and saved dimensions', () => {
        const { app, layout } = fixture();
        const left = query(app, '.workspace-splitter-left');
        const right = query(app, '.workspace-splitter-right');
        const bottom = query(app, '.workspace-splitter-bottom');
        key(left, 'ArrowRight');
        expect(layout.getState().leftWidth).toBe(238);
        key(right, 'ArrowLeft', true);
        expect(layout.getState().rightWidth).toBe(325);
        key(bottom, 'ArrowUp');
        expect(layout.getState().bottomHeight).toBe(205);
        key(left, 'Home');
        expect(layout.getState().leftWidth).toBe(180);
        key(left, 'End');
        expect(layout.getState().leftWidth).toBeLessThanOrEqual(600);
        key(left, 'Enter');
        expect(layout.getState().leftWidth).toBe(228);
        expect(left.getAttribute('aria-orientation')).toBe('vertical');
        expect(bottom.getAttribute('aria-orientation')).toBe('horizontal');
        expect(localStorage.getItem(STORAGE_KEY)).toContain('"rightWidth":325');
    });

    it('rolls back a pointer-canceled or Escape-canceled resize before persistence', () => {
        const { app, layout } = fixture();
        const left = query(app, '.workspace-splitter-left');
        vi.spyOn(left, 'setPointerCapture').mockImplementation(() => undefined);
        vi.spyOn(left, 'hasPointerCapture').mockReturnValue(false);
        const before = layout.getState();
        pointer(left, 'pointerdown', 235, 120);
        pointer(left, 'pointermove', 300, 120);
        expect(layout.getState().leftWidth).toBeGreaterThan(before.leftWidth);
        pointer(left, 'pointercancel', 300, 120);
        expect(layout.getState()).toEqual(before);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
        pointer(left, 'pointerdown', 235, 120);
        pointer(left, 'pointermove', 280, 120);
        key(left, 'Escape');
        expect(layout.getState()).toEqual(before);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('docks through an actual captured browser pointer drag and preserves panel identity', async () => {
        const { app, layout } = fixture();
        const inspector = query(app, '.inspector');
        const source = query(inspector, '.workspace-drag-handle');
        const target = query(app, '.workspace-dock-left');
        await userEvent.dragAndDrop(source, target);
        expect(layout.getState().panels.inspector.dock).toBe('left');
        expect(query(app, '.inspector')).toBe(inspector);
        expect(query(app, '.workspace-dock-overlay').hidden).toBe(true);
    });

    it('provides a keyboard docking menu and hides/restores panels through accessible controls', () => {
        const { app, layout } = fixture();
        const handle = query(app, '.inspector .workspace-drag-handle');
        handle.click();
        const menu = query(app, '.workspace-dock-menu');
        expect(menu.hidden).toBe(false);
        expect(document.activeElement?.textContent).toBe('Dock left');
        key(menu, 'End');
        expect(document.activeElement?.textContent).toBe('Dock bottom');
        (document.activeElement as HTMLElement).click();
        expect(layout.getState().panels.inspector.dock).toBe('bottom');
        expect(menu.hidden).toBe(true);
        query(app, '.inspector .workspace-collapse').click();
        expect(query(app, '.inspector').hidden).toBe(true);
        layout.focusPanel('inspector');
        expect(query(app, '.inspector').hidden).toBe(false);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Object name');
    });

    it('recovers narrow windows with accessible tabs without overwriting the wide layout', async () => {
        const { app, workspace, layout } = fixture();
        layout.dock('hierarchy', 'right');
        const wide = layout.getState();
        await resizeWorkspace(app, workspace, 420);
        expect(workspace.classList.contains('workspace-compact')).toBe(true);
        expect(query(app, '.workspace-dock-left').hidden).toBe(true);
        expect(query(app, '.workspace-dock-right').hidden).toBe(true);
        layout.focusPanel('inspector');
        expect(query(app, '.inspector').hidden).toBe(false);
        expect(query(app, '.hierarchy').hidden).toBe(true);
        const selectedTab = query(app, '[role="tab"][aria-selected="true"]');
        key(selectedTab, 'ArrowRight');
        expect(query(app, '.assets-panel').hidden).toBe(false);
        expect(query(app, '.inspector').hidden).toBe(true);
        await resizeWorkspace(app, workspace, 1200);
        expect(workspace.classList.contains('workspace-compact')).toBe(false);
        expect(query(app, '.hierarchy').parentElement?.dataset['workspaceDock']).toBe('right');
        expect(layout.getState()).toEqual(wide);
    });

    it('rejects malformed persisted layouts and surfaces storage write failure', () => {
        localStorage.setItem(STORAGE_KEY, '{"version":99}');
        const { layout, app } = fixture();
        expect(layout.getState().preset).toBe('default');
        expect(layout.persistenceError).toContain('unsupported');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Storage unavailable', 'QuotaExceededError');
        });
        layout.setCollapsed('assets', true);
        expect(layout.getState().panels.assets.collapsed).toBe(true);
        expect(layout.persistenceError).toContain('could not be saved');
        expect(query(app, '[role="status"]').textContent).toContain('Storage unavailable');
    });

    it('cycles keyboard focus by region and restores original DOM on teardown', () => {
        const { app, layout, workspace } = fixture();
        const canvas = query(app, 'canvas');
        layout.focusPanel('inspector');
        key(app, 'F6');
        expect(document.activeElement).toBe(query(app, '.assets-panel'));
        layout.destroy();
        expect(query(app, '.hierarchy').parentElement).toBe(workspace);
        expect(query(app, '.inspector').parentElement).toBe(workspace);
        expect(query(app, '.assets-panel').parentElement).toBe(query(app, '.center-workspace'));
        expect(query(app, 'canvas')).toBe(canvas);
        expect(app.querySelector('.workspace-layout-controls')).toBeNull();
        expect(app.querySelector('.workspace-drag-handle')).toBeNull();
        const event = new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true });
        app.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });
});
