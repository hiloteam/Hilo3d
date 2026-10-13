import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { importAsset } from '../../editor/assets';
import { defaultAudioComponent } from '../../editor/components';
import { createProject, serializeProject } from '../../editor/project';
import { createDefaultScene } from '../../editor/scene';
import { testServerOrigin } from '../../scripts/playwright-test-server';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

interface AudioAudit {
    contexts: AudioContext[];
    errors: string[];
}
interface DeviceDeliveryGate {
    created: number;
    delivered: number;
    destroyed: number;
    release(): void;
}
type AuditWindow = Window & {
    __HILO_EDITOR_AUDIO_AUDIT__?: AudioAudit;
    __HILO_EDITOR_DEVICE_GATE__?: DeviceDeliveryGate;
};

async function audioProject(): Promise<string> {
    const bytes = new Uint8Array(44 + 1600);
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, value: string): void => {
        bytes.set(new TextEncoder().encode(value), offset);
    };
    tag(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    tag(36, 'data');
    view.setUint32(40, 1600, true);
    for (let sample = 0; sample < 800; sample += 1)
        view.setInt16(44 + sample * 2, Math.round(Math.sin((sample * Math.PI) / 20) * 4000), true);
    const asset = await importAsset(new File([bytes], 'editor-loop.wav'));
    const project = createProject(createDefaultScene(), 'Audio lifecycle regression');
    project.assets[asset.id] = asset;
    const node = project.scenes[project.activeSceneId]?.nodes['hero-sphere'];
    if (!node) throw new Error('Fixture node is missing');
    node.components = { audio: { ...defaultAudioComponent(asset.id), loop: true } };
    return serializeProject(project);
}

async function installAudioAudit(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const audit: AudioAudit = { contexts: [], errors: [] };
        (window as AuditWindow).__HILO_EDITOR_AUDIO_AUDIT__ = audit;
        const originalResume = Object.getOwnPropertyDescriptor(AudioContext.prototype, 'resume')
            ?.value as ((this: AudioContext) => Promise<void>) | undefined;
        if (!originalResume) throw new Error('Native AudioContext.resume is unavailable');
        // Observe real native contexts; neither the audio graph nor its scheduling is replaced.
        AudioContext.prototype.resume = function (this: AudioContext): Promise<void> {
            if (!audit.contexts.includes(this)) audit.contexts.push(this);
            return originalResume.call(this);
        };
        new MutationObserver(() => {
            const toast = document.querySelector('#toast.error');
            const message = toast?.textContent;
            if (message && !audit.errors.includes(message)) audit.errors.push(message);
        }).observe(document, {
            subtree: true,
            attributes: true,
            childList: true,
            characterData: true
        });
    });
}

async function installDeviceDeliveryGate(page: Page): Promise<void> {
    await page.addInitScript(() => {
        let release = (): void => {
            throw new Error('Device delivery gate is not initialized');
        };
        const wait = new Promise<void>(resolve => {
            release = resolve;
        });
        const state: DeviceDeliveryGate = { created: 0, delivered: 0, destroyed: 0, release };
        (window as AuditWindow).__HILO_EDITOR_DEVICE_GATE__ = state;
        const requestDevice = Object.getOwnPropertyDescriptor(GPUAdapter.prototype, 'requestDevice')
            ?.value as
            | ((this: GPUAdapter, descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>)
            | undefined;
        if (!requestDevice) throw new Error('Native GPUAdapter.requestDevice is unavailable');
        // Obtain the genuine device, preserving descriptors and all renderer work. Only delivery of
        // its promise is gated so pagehide deterministically lands inside Stage.create().
        GPUAdapter.prototype.requestDevice = async function (
            this: GPUAdapter,
            descriptor?: GPUDeviceDescriptor
        ): Promise<GPUDevice> {
            const device = await requestDevice.call(this, descriptor);
            state.created += 1;
            const destroy = device.destroy.bind(device);
            Object.defineProperty(device, 'destroy', {
                configurable: true,
                value(): void {
                    state.destroyed += 1;
                    destroy();
                }
            });
            await wait;
            state.delivered += 1;
            return device;
        };
    });
}

async function gateState(page: Page): Promise<Omit<DeviceDeliveryGate, 'release'>> {
    return page.evaluate(() => {
        const gate = (window as AuditWindow).__HILO_EDITOR_DEVICE_GATE__;
        if (!gate) return { created: 0, delivered: 0, destroyed: 0 };
        return { created: gate.created, delivered: gate.delivered, destroyed: gate.destroyed };
    });
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`Studio replaces a stopped audio owner after component removal on ${backend} @${backend}`, async ({
        browser
    }) => {
        test.setTimeout(60_000);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        await installRenderHealthProbe(page);
        await installAudioAudit(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${testServerOrigin}/editor/?backend=${backend}&test=1`);
            await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
            await page.getByRole('button', { name: 'Project browser', exact: true }).click();
            await page.getByLabel('Import project bundle', { exact: true }).setInputFiles({
                name: 'audio-lifecycle.hilo-project.json',
                mimeType: 'application/json',
                buffer: Buffer.from(await audioProject())
            });
            await expect(
                page.getByRole('dialog', { name: 'Project browser', exact: true })
            ).not.toBeVisible();
            await page.locator('[data-select="hero-sphere"]').click();
            await expect(
                page.getByRole('button', { name: 'Remove audio', exact: true })
            ).toBeVisible();
            await page.getByRole('button', { name: 'Play scene', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'playing');
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        (window as AuditWindow).__HILO_EDITOR_AUDIO_AUDIT__?.contexts.map(
                            item => item.state
                        )
                    )
                )
                .toEqual(['running']);
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
                .toBeGreaterThan(0);
            await page.getByRole('button', { name: 'Stop play mode', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'stopped');
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        (window as AuditWindow).__HILO_EDITOR_AUDIO_AUDIT__?.contexts.map(
                            item => item.state
                        )
                    )
                )
                .toEqual(['closed']);
            await page.getByRole('button', { name: 'Remove audio', exact: true }).click();
            await expect(page.getByRole('button', { name: '+ Audio', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Play scene', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'playing');
            await expect
                .poll(async () => Number.parseFloat(await page.locator('#play-time').innerText()))
                .toBeGreaterThan(0.05);
            expect(
                await page.evaluate(() =>
                    (window as AuditWindow).__HILO_EDITOR_AUDIO_AUDIT__?.contexts.map(
                        item => item.state
                    )
                )
            ).toEqual(['closed']);
            expect(
                await page.evaluate(
                    () => (window as AuditWindow).__HILO_EDITOR_AUDIO_AUDIT__?.errors
                )
            ).toEqual([]);
            await page.getByRole('button', { name: 'Stop play mode', exact: true }).click();
            await expect(page.locator('#app')).toHaveAttribute('data-play-state', 'stopped');
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
            );
            await expect(page.locator('#viewport canvas')).toHaveCount(0);
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const progress = nativeRenderProgress(await readRenderHealth(page), backend);
            await waitForStableAnimationFrames(page);
            expect(nativeRenderProgress(await readRenderHealth(page), backend)).toEqual(progress);
            failures.assertEmpty(`Studio ${backend} audio owner replacement and teardown`);
        } finally {
            await failures.dispose();
            await context.close();
        }
    });
}

for (const persisted of [false, true]) {
    test(`Studio handles ${persisted ? 'persisted' : 'normal'} pagehide during genuine WebGPU initialization @webgpu`, async ({
        browser
    }, info) => {
        test.setTimeout(60_000);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        await installRenderHealthProbe(page);
        await installDeviceDeliveryGate(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${testServerOrigin}/editor/?backend=webgpu&test=1`, {
                waitUntil: 'commit'
            });
            await expect.poll(async () => (await gateState(page)).created).toBe(1);
            expect(await gateState(page)).toEqual({ created: 1, delivered: 0, destroyed: 0 });
            await expect(page.locator('#app')).not.toHaveAttribute('data-ready', 'true');
            await page.evaluate(isPersisted => {
                window.dispatchEvent(
                    new PageTransitionEvent('pagehide', { persisted: isPersisted })
                );
                const gate = (window as AuditWindow).__HILO_EDITOR_DEVICE_GATE__;
                if (!gate) throw new Error('Missing device gate');
                gate.release();
            }, persisted);
            await expect.poll(async () => (await gateState(page)).delivered).toBe(1);
            if (persisted) {
                await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
                expect((await gateState(page)).destroyed).toBe(0);
                await waitForStableAnimationFrames(page);
                expect(completedRenderCommands(await readRenderHealth(page), 'webgpu')).toBe(0);
                await page.evaluate(() =>
                    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
                );
                await expect
                    .poll(async () =>
                        completedRenderCommands(await readRenderHealth(page), 'webgpu')
                    )
                    .toBeGreaterThan(0);
                const screenshot = await captureStableFrame(page, 'webgpu', { frames: 2 });
                const image = PNG.sync.read(screenshot);
                const bounds = await page.locator('#viewport canvas').boundingBox();
                if (!bounds) throw new Error('Missing resumed scene canvas');
                let warm = 0;
                for (
                    let y = Math.ceil(bounds.y);
                    y < Math.floor(bounds.y + bounds.height);
                    y += 1
                ) {
                    for (
                        let x = Math.ceil(bounds.x);
                        x < Math.floor(bounds.x + bounds.width);
                        x += 1
                    ) {
                        const offset = (y * image.width + x) * 4;
                        const red = image.data[offset] ?? 0;
                        if (
                            red > 100 &&
                            red > (image.data[offset + 1] ?? 0) * 1.25 &&
                            red > (image.data[offset + 2] ?? 0) * 1.4
                        )
                            warm += 1;
                    }
                }
                expect(warm).toBeGreaterThan(500);
                await info.attach('resumed-real-webgpu-scene', {
                    body: screenshot,
                    contentType: 'image/png'
                });
                await page.evaluate(() =>
                    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
                );
            }
            await expect
                .poll(async () => (await gateState(page)).destroyed, { timeout: 20_000 })
                .toBe(1);
            await expect(page.locator('#viewport canvas')).toHaveCount(0);
            if (!persisted)
                await expect(page.locator('#app')).not.toHaveAttribute('data-ready', 'true');
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            const progress = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
            await waitForStableAnimationFrames(page);
            expect(nativeRenderProgress(await readRenderHealth(page), 'webgpu')).toEqual(progress);
            failures.assertEmpty(
                `Studio late WebGPU device after ${persisted ? 'persisted' : 'normal'} pagehide`
            );
        } finally {
            await page
                .evaluate(() => (window as AuditWindow).__HILO_EDITOR_DEVICE_GATE__?.release())
                .catch(() => undefined);
            await failures.dispose();
            await context.close();
        }
    });
}
