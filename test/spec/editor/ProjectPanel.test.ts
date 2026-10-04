import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPanel } from '../../../editor/project-panel';
import { ProjectController } from '../../../editor/project-controller';
import { ProjectStore } from '../../../editor/project-store';
import { createProject, serializeProject } from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';
import { exportProjectArchive } from '../../../editor/project-archive';

const nativeOpen = ProjectStore.open.bind(ProjectStore);
let databaseName = '';
const stores: ProjectStore[] = [];
const panels: ProjectPanel[] = [];
const hosts: HTMLElement[] = [];
const releases: (() => void)[] = [];

beforeEach(() => {
    databaseName = `hilo-project-panel-${crypto.randomUUID()}`;
    const get = Reflect.get(Storage.prototype, 'getItem');
    const set = Reflect.get(Storage.prototype, 'setItem');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
        this: Storage,
        key: string
    ): string | null {
        return key === 'hilo-studio.last-project' ? null : get.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string
    ): void {
        if (key !== 'hilo-studio.last-project') set.call(this, key, value);
    });
    vi.spyOn(ProjectStore, 'open').mockImplementation(async () => {
        const store = await nativeOpen(databaseName);
        stores.push(store);
        return store;
    });
});

afterEach(async () => {
    for (const release of releases.splice(0)) release();
    for (const panel of panels.splice(0)) panel.destroy();
    for (const host of hosts.splice(0)) host.remove();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    for (const store of stores.splice(0)) store.close();
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => {
            resolve();
        };
        request.onerror = () => {
            reject(request.error ?? new Error('Panel cleanup failed'));
        };
        request.onblocked = () => {
            reject(new Error('Panel kept a database connection'));
        };
    });
});

function gate(): { promise: Promise<void>; release: () => void } {
    let release: () => void = () => undefined;
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    releases.push(release);
    return { promise, release };
}

async function fixture(): Promise<{
    app: HTMLElement;
    panel: ProjectPanel;
    controller: ProjectController;
}> {
    const app = document.createElement('div');
    app.innerHTML = '<div class="file-controls"></div>';
    document.body.append(app);
    hosts.push(app);
    const controller = await ProjectController.restore(createDefaultScene());
    const panel = new ProjectPanel(app, {
        controller,
        getProject: () => controller.project,
        onCommit: project => {
            controller.history.commitProject(project);
            controller.markChanged();
        },
        onNotify: () => undefined
    });
    panels.push(panel);
    await panel.open();
    return { app, panel, controller };
}

function input(app: HTMLElement): HTMLInputElement {
    const result = app.querySelector<HTMLInputElement>('.project-bundle-input');
    if (!result) throw new Error('Missing project import input');
    return result;
}

function click(app: HTMLElement, action: string): void {
    const button = app.querySelector<HTMLButtonElement>(`[data-project-action="${action}"]`);
    if (!button) throw new Error(`Missing ${action} action`);
    button.click();
}

function upload(app: HTMLElement, file: File): void {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = input(app);
    target.files = transfer.files;
    target.dispatchEvent(new Event('change', { bubbles: true }));
}

async function settle(): Promise<void> {
    await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
    });
}

describe('project browser ZIP integration and cancellation', () => {
    it('accepts JSON and ZIP while keeping the same file-picker element across refreshes', async () => {
        const { app, panel, controller } = await fixture();
        const picker = input(app);
        expect(picker.accept).toContain('.zip');
        expect(picker.accept).toContain('.json');
        await panel.refresh();
        expect(input(app)).toBe(picker);
        const source = createProject(createDefaultScene(), 'AI Workspace Round Trip');
        const originalId = controller.project.id;
        const zip = await exportProjectArchive(source);
        upload(app, new File([zip], 'study.hilo-workspace.zip', { type: 'application/zip' }));
        await expect.poll(() => controller.project.name).toBe(source.name);
        expect(controller.project.id).not.toBe(source.id);
        expect(controller.project.id).not.toBe(originalId);
        expect(controller.project.scenes).toEqual(source.scenes);
        await expect
            .poll(() => app.querySelector('dialog')?.getAttribute('aria-busy'))
            .toBe('false');
    });

    it('does not activate an import whose file read finishes after the dialog closes', async () => {
        const { app, controller } = await fixture();
        const read = gate();
        const started = gate();
        const finished = gate();
        class DelayedFile extends File {
            override async text(): Promise<string> {
                started.release();
                await read.promise;
                const value = await super.text();
                finished.release();
                return value;
            }
        }
        const original = controller.project;
        const imports = vi.spyOn(controller, 'import');
        upload(
            app,
            new DelayedFile(
                [serializeProject(createProject(createDefaultScene(), 'Late import'))],
                'late.json',
                { type: 'application/json' }
            )
        );
        await started.promise;
        click(app, 'close');
        read.release();
        await finished.promise;
        await settle();
        expect(imports).not.toHaveBeenCalled();
        expect(controller.project).toEqual(original);
    });

    it('keeps newer authored changes made while ZIP bytes are still loading', async () => {
        const { app, controller } = await fixture();
        const read = gate();
        const started = gate();
        class DelayedArchive extends File {
            override async arrayBuffer(): Promise<ArrayBuffer> {
                started.release();
                await read.promise;
                return super.arrayBuffer();
            }
        }
        const archive = await exportProjectArchive(
            createProject(createDefaultScene(), 'Incoming project')
        );
        const imports = vi.spyOn(controller, 'import');
        upload(app, new DelayedArchive([archive], 'incoming.zip', { type: 'application/zip' }));
        await started.promise;
        const edited = controller.project;
        edited.name = 'Typed while decoding';
        controller.history.commitProject(edited);
        controller.markChanged();
        read.release();
        await expect
            .poll(() => app.querySelector('.project-browser-error')?.textContent)
            .toContain('Newer local changes');
        expect(imports).not.toHaveBeenCalled();
        expect(controller.project.name).toBe('Typed while decoding');
    });

    it('aborts a pending import transaction when the panel is destroyed', async () => {
        const { app, panel, controller } = await fixture();
        const store = controller.store;
        if (!store) throw new Error('Missing test store');
        const saving = gate();
        const started = gate();
        const finished = gate();
        const original = controller.project;
        const nativeSave = store.save.bind(store);
        vi.spyOn(store, 'save').mockImplementation(async (project, expected, signal) => {
            if (project.id !== original.id) {
                started.release();
                await saving.promise;
            }
            try {
                return await nativeSave(project, expected, signal);
            } finally {
                finished.release();
            }
        });
        const installed = vi.fn();
        controller.onProject = installed;
        upload(
            app,
            new File(
                [serializeProject(createProject(createDefaultScene(), 'Canceled import'))],
                'canceled.json',
                { type: 'application/json' }
            )
        );
        await started.promise;
        panel.destroy();
        saving.release();
        await finished.promise;
        await settle();
        expect(installed).not.toHaveBeenCalled();
        expect(controller.project).toEqual(original);
        expect(await store.list()).toHaveLength(1);
    });

    it('does not trigger a late ZIP download after close or teardown', async () => {
        const { app, panel } = await fixture();
        const downloaded = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => undefined);
        click(app, 'export-workspace');
        click(app, 'close');
        await settle();
        expect(downloaded).not.toHaveBeenCalled();
        await panel.open();
        click(app, 'export-workspace');
        panel.destroy();
        await settle();
        expect(downloaded).not.toHaveBeenCalled();
    });

    it('retains the existing JSON export action and reports malformed ZIPs without replacing the project', async () => {
        const { app, controller } = await fixture();
        const original = controller.project;
        const downloaded = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => undefined);
        click(app, 'export');
        expect(downloaded).toHaveBeenCalledOnce();
        upload(app, new File(['not a zip file'], 'bad.zip', { type: 'application/zip' }));
        await expect
            .poll(() => app.querySelector('.project-browser-error')?.textContent)
            .toContain('Workspace ZIP');
        expect(controller.project).toEqual(original);
    });
});
