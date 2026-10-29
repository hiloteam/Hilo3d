import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { snapshotMeshletAssetManifest } from '../../src/geometry/meshlet/MeshletAsset';
import type { TestFrameControl } from '../../examples/shared/test-frame-control';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface StrataDiagnostics {
    readonly ready: boolean;
    readonly disposed: boolean;
    readonly suspended: boolean;
    readonly submittedFrames: number;
    readonly view: 'overview' | 'passage' | 'surface';
    readonly detail: 'adaptive' | 'coarse';
    readonly streaming: boolean;
    readonly sourceTriangles: number;
    readonly coarseTriangles: number;
    readonly coarsePageIds: readonly string[];
    readonly requestedPageIds: readonly string[];
    readonly cpuBytes: number;
    readonly residentBytes: number;
    readonly allocatedBytes: number;
    readonly visibleMeshletCount: number;
    readonly deferredPageCount: number;
    readonly uploadedBytes: number;
    readonly cameraPosition: readonly number[];
}

interface StrataAPI {
    diagnostics(): StrataDiagnostics;
    setView(view: StrataDiagnostics['view']): void;
    dispose(): void;
}

type StrataWindow = Window & {
    __HILO3D_STRATA__?: StrataAPI;
    __HILO3D_TEST_CAPTURE__?: TestFrameControl;
};

interface GeometryRequestTracker {
    readonly started: number;
    readonly completedIds: ReadonlySet<string>;
    complete(ids: readonly string[]): boolean;
    dispose(): void;
}

function geometryPageId(request: Request): string | null {
    const match = /\/Strata\/pages\/([^/?]+)\/(?:[a-f0-9]{64}\/)?(page-\d+\.bin)(?:\?|$)/u.exec(
        request.url()
    );
    return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : null;
}

async function coarseGeometryPageIds(): Promise<ReadonlySet<string>> {
    const directory = new URL('../../examples/models/Strata/', import.meta.url);
    const scene: unknown = JSON.parse(await readFile(new URL('scene.json', directory), 'utf8'));
    if (
        scene === null ||
        typeof scene !== 'object' ||
        !('assets' in scene) ||
        !Array.isArray(scene.assets)
    )
        throw new TypeError('STRATA scene must declare asset records.');
    const coarse = new Set<string>();
    const assets: readonly unknown[] = scene.assets;
    for (const asset of assets) {
        if (
            asset === null ||
            typeof asset !== 'object' ||
            !('streamed' in asset) ||
            asset.streamed !== true
        )
            continue;
        if (
            !('name' in asset) ||
            typeof asset.name !== 'string' ||
            !('manifestURL' in asset) ||
            typeof asset.manifestURL !== 'string'
        )
            throw new TypeError('Streamed STRATA assets require name and manifestURL.');
        const manifest = snapshotMeshletAssetManifest(
            JSON.parse(await readFile(new URL(asset.manifestURL, directory), 'utf8'))
        );
        for (const group of manifest.groups) {
            const page = group.lods.at(-1);
            if (!page) throw new Error('STRATA group requires a coarse page.');
            coarse.add(`${asset.name}/page-${String(page.pageId)}.bin`);
        }
    }
    return coarse;
}

function trackGeometryRequests(page: Page): GeometryRequestTracker {
    const requests = new Map<Request, { readonly id: string; complete: boolean }>();
    const latest = new Map<string, Request>();
    const pending = new Set<Request>();
    const completedIds = new Set<string>();
    const start = (request: Request): void => {
        const id = geometryPageId(request);
        if (id === null) return;
        requests.set(request, { id, complete: false });
        latest.set(id, request);
        pending.add(request);
    };
    const finish = (request: Request): void => {
        const tracked = requests.get(request);
        if (!tracked) return;
        tracked.complete = true;
        completedIds.add(tracked.id);
        pending.delete(request);
    };
    const fail = (request: Request): void => {
        pending.delete(request);
    };
    page.on('request', start);
    page.on('requestfinished', finish);
    page.on('requestfailed', fail);
    return {
        get started(): number {
            return requests.size;
        },
        completedIds,
        complete(ids): boolean {
            return (
                pending.size === 0 &&
                ids.every(id => {
                    const request = latest.get(id);
                    return request !== undefined && requests.get(request)?.complete === true;
                })
            );
        },
        dispose(): void {
            page.off('request', start);
            page.off('requestfinished', finish);
            page.off('requestfailed', fail);
        }
    };
}

const SCENE_STYLE = `body * { visibility: hidden !important; }
#scene canvas { visibility: visible !important; }`;

function requestURL(testInfo: TestInfo): string {
    const query = new URLSearchParams({ backend: 'webgpu', test: '1' });
    if (testInfo.project.name === 'chromium-native-webgpu') query.set('quality', 'production');
    return `/examples/meshlet_strata.html?${query.toString()}`;
}

async function diagnostics(page: Page): Promise<StrataDiagnostics> {
    return page.evaluate(() => {
        const api = (window as StrataWindow).__HILO3D_STRATA__;
        if (!api) throw new Error('STRATA test API unavailable');
        return api.diagnostics();
    });
}

async function liveFrames(page: Page, count = 3): Promise<StrataDiagnostics> {
    const before = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
    await page.evaluate(async frames => {
        const control = (window as StrataWindow).__HILO3D_TEST_CAPTURE__;
        if (!control) throw new Error('STRATA shared frame control unavailable');
        await control.waitForFrames(frames);
    }, count);
    await awaitTrackedGPUQueues(page);
    const after = nativeRenderProgress(await readRenderHealth(page), 'webgpu');
    expect(nativeRenderProgressAdvanced(before, after, 'webgpu')).toBe(true);
    expect(after.canvasAcquisitions).toBeGreaterThan(before.canvasAcquisitions);
    return diagnostics(page);
}

async function openScene(page: Page, testInfo: TestInfo): Promise<void> {
    await installRenderHealthProbe(page);
    await page.goto(requestURL(testInfo), { waitUntil: 'load' });
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 90_000 });
    const ready = await diagnostics(page);
    expect(ready.ready).toBe(true);
    expect(ready.disposed).toBe(false);
    await expect(page.locator('#scene canvas[data-hilo3d-backend="webgpu"]')).toHaveCount(1);
    await liveFrames(page, 8);
}

function sceneStatistics(buffer: Buffer): { readonly colors: number; readonly range: number } {
    const image = PNG.sync.read(buffer);
    const colors = new Set<number>();
    let minimum = 255;
    let maximum = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const red = image.data[offset] ?? 0;
        const green = image.data[offset + 1] ?? 0;
        const blue = image.data[offset + 2] ?? 0;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        minimum = Math.min(minimum, luminance);
        maximum = Math.max(maximum, luminance);
        colors.add((red >> 3) * 1024 + (green >> 3) * 32 + (blue >> 3));
    }
    return { colors: colors.size, range: maximum - minimum };
}

function changedPixelRatio(first: Buffer, second: Buffer): number {
    const left = PNG.sync.read(first),
        right = PNG.sync.read(second);
    expect([left.width, left.height]).toEqual([right.width, right.height]);
    let changed = 0;
    for (let offset = 0; offset < left.data.length; offset += 4) {
        if (
            Math.max(
                Math.abs((left.data[offset] ?? 0) - (right.data[offset] ?? 0)),
                Math.abs((left.data[offset + 1] ?? 0) - (right.data[offset + 1] ?? 0)),
                Math.abs((left.data[offset + 2] ?? 0) - (right.data[offset + 2] ?? 0))
            ) > 8
        )
            changed++;
    }
    return changed / (left.width * left.height);
}

async function captureScene(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
    const capture = await captureStableFrame(page, 'webgpu', { style: SCENE_STYLE, frames: 2 });
    const statistics = sceneStatistics(capture);
    expect(
        statistics.colors,
        `${name} should contain shaded sandstone and environment pixels`
    ).toBeGreaterThan(32);
    expect(statistics.range, `${name} should contain meaningful light and shadow`).toBeGreaterThan(
        70
    );
    await testInfo.attach(name, { body: capture, contentType: 'image/png' });
    return capture;
}

async function waitForRequestedPages(
    page: Page,
    requests: GeometryRequestTracker
): Promise<StrataDiagnostics> {
    // A UI change creates demand on the first tick and starts its requests on the next update.
    // Observe both before accepting completion of an older request for the same page identity.
    await liveFrames(page, 3);
    await expect
        .poll(
            async () => {
                const state = await diagnostics(page);
                const status = await page.locator('#strata-status').innerText();
                return (
                    state.requestedPageIds.length > 0 &&
                    requests.complete(state.requestedPageIds) &&
                    status ===
                        (state.streaming
                            ? state.detail === 'coarse'
                                ? 'Coarse comparison'
                                : 'Ready'
                            : 'Coarse pages retained')
                );
            },
            {
                timeout: 60_000,
                message: 'Every claimed page must finish its real production HTTP response'
            }
        )
        .toBe(true);
    // The showcase samples submitted GPU counters every fifteen live frames.
    return liveFrames(page, 18);
}

async function assertGPUHealth(page: Page): Promise<void> {
    await assertStableInstrumentationHealth('webgpu', 'STRATA', {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

async function observeAfterTeardown(page: Page): Promise<StrataDiagnostics> {
    await page.evaluate(async () => {
        await new Promise<void>(resolve =>
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    resolve();
                })
            )
        );
    });
    const stopped = await diagnostics(page);
    await page.waitForTimeout(180);
    const after = await diagnostics(page);
    expect(after.disposed).toBe(true);
    expect(after.submittedFrames).toBe(stopped.submittedFrames);
    expect(after.cpuBytes).toBe(0);
    return after;
}

test('STRATA streams finer geometry after a close camera view @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const failures = await installPageFailureMonitor(page);
    const requests = trackGeometryRequests(page);
    try {
        await openScene(page, testInfo);
        const initial = await waitForRequestedPages(page, requests);
        expect(initial.sourceTriangles).toBeGreaterThan(20_000);
        expect(initial.coarseTriangles).toBeGreaterThan(0);
        expect(initial.coarseTriangles).toBeLessThan(initial.sourceTriangles);
        expect(initial.coarsePageIds.length).toBeGreaterThan(0);
        expect(initial.coarsePageIds.every(id => requests.completedIds.has(id))).toBe(true);
        expect(initial.visibleMeshletCount).toBeGreaterThan(0);
        expect(initial.residentBytes).toBeGreaterThan(0);
        expect(initial.residentBytes).toBeLessThanOrEqual(initial.allocatedBytes);
        const overview = await captureScene(page, testInfo, 'strata-overview');

        await page.locator('#streaming-toggle').uncheck();
        const beforePausedRequests = requests.started;
        await page.locator('#view-surface').click();
        const pausedSurface = await liveFrames(page, 12);
        expect(pausedSurface.view).toBe('surface');
        expect(pausedSurface.streaming).toBe(false);
        expect(requests.started).toBe(beforePausedRequests);
        expect(pausedSurface.cameraPosition).not.toEqual(initial.cameraPosition);

        await page.locator('#streaming-toggle').check();
        await expect
            .poll(
                async () =>
                    (await diagnostics(page)).requestedPageIds.some(
                        id => !initial.requestedPageIds.includes(id)
                    ),
                { timeout: 45_000 }
            )
            .toBe(true);
        const refined = await waitForRequestedPages(page, requests);
        expect(refined.streaming).toBe(true);
        expect(refined.detail).toBe('adaptive');
        expect(refined.uploadedBytes).toBeGreaterThan(initial.uploadedBytes);
        expect(refined.residentBytes).toBeLessThanOrEqual(refined.allocatedBytes);
        expect(refined.visibleMeshletCount).toBeGreaterThan(0);
        const surface = await captureScene(page, testInfo, 'strata-surface');
        expect(changedPixelRatio(overview, surface)).toBeGreaterThan(0.03);

        await page.locator('#detail-mode').selectOption('coarse');
        const coarse = await liveFrames(page, 18);
        expect(coarse.detail).toBe('coarse');
        expect(coarse.visibleMeshletCount).toBeGreaterThan(0);
        expect(coarse.visibleMeshletCount).toBeLessThan(refined.visibleMeshletCount);
        await captureScene(page, testInfo, 'strata-coarse');
        await page.locator('#detail-mode').selectOption('adaptive');
        const resumed = await waitForRequestedPages(page, requests);
        expect(resumed.submittedFrames).toBeGreaterThan(coarse.submittedFrames);
        await testInfo.attach('strata-streaming-evidence', {
            body: JSON.stringify(
                {
                    initial,
                    pausedSurface,
                    refined,
                    coarse,
                    resumed,
                    completed: [...requests.completedIds],
                    requestsStarted: requests.started
                },
                null,
                2
            ),
            contentType: 'application/json'
        });
        await assertGPUHealth(page);
        await page.evaluate(() => {
            (window as StrataWindow).__HILO3D_STRATA__?.dispose();
        });
        await observeAfterTeardown(page);
        failures.assertEmpty('STRATA real HTTP streaming, pixels and post-teardown observation');
    } finally {
        requests.dispose();
        await failures.dispose();
    }
});

test('STRATA follows resized demand while initial fine responses are pending @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const coarse = await coarseGeometryPageIds();
    const held = new Map<Request, string>();
    const cancelled = new Map<Request, string>();
    let releaseGate!: () => void;
    let released = false;
    const gate = new Promise<void>(resolve => {
        releaseGate = resolve;
    });
    const routePattern = /\/Strata\/pages\/.*\/page-\d+\.bin(?:\?|$)/u;
    const onFailed = (request: Request): void => {
        const id = held.get(request);
        if (id !== undefined && request.failure()?.errorText === 'net::ERR_ABORTED')
            cancelled.set(request, id);
    };
    const failures = await installPageFailureMonitor(page);
    const requests = trackGeometryRequests(page);
    page.on('requestfailed', onFailed);
    await page.route(routePattern, async route => {
        const request = route.request();
        const id = geometryPageId(request);
        if (!released && id !== null && !coarse.has(id)) {
            held.set(request, id);
            await gate;
        }
        await route.continue();
    });
    try {
        await installRenderHealthProbe(page);
        await page.goto(requestURL(testInfo), { waitUntil: 'load' });
        await expect(page.locator('#loading-message')).toHaveText(
            'Finding the detail in the stone…',
            { timeout: 90_000 }
        );
        await expect.poll(() => held.size, { timeout: 30_000 }).toBeGreaterThan(0);
        const initial = await diagnostics(page);
        expect(initial.ready).toBe(false);
        expect(initial.disposed).toBe(false);
        expect(initial.coarsePageIds.every(id => coarse.has(id))).toBe(true);
        const initiallyHeld = new Set(held.values());
        await page.setViewportSize({ width: 1440, height: 320 });
        await expect
            .poll(
                async () => {
                    const state = await diagnostics(page);
                    return [...initiallyHeld].some(id => !state.requestedPageIds.includes(id));
                },
                { timeout: 30_000 }
            )
            .toBe(true);
        await expect.poll(() => cancelled.size, { timeout: 30_000 }).toBeGreaterThan(0);
        const resized = await diagnostics(page);
        expect(resized.ready).toBe(false);
        expect(resized.disposed).toBe(false);
        expect([...cancelled.values()].every(id => !resized.requestedPageIds.includes(id))).toBe(
            true
        );
        released = true;
        releaseGate();
        await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {
            timeout: 90_000
        });
        const settled = await waitForRequestedPages(page, requests);
        expect(settled.disposed).toBe(false);
        expect(settled.submittedFrames).toBeGreaterThan(initial.submittedFrames);
        await expect(page.locator('#failure')).toBeHidden();
        await page.setViewportSize({ width: 960, height: 640 });
        await waitForRequestedPages(page, requests);
        await captureScene(page, testInfo, 'strata-resized-initial-streaming');
        await assertGPUHealth(page);
        await page.evaluate(() => {
            (window as StrataWindow).__HILO3D_STRATA__?.dispose();
        });
        await observeAfterTeardown(page);
        const observed = failures.snapshot();
        expect(observed.consoleErrors).toEqual([]);
        expect(observed.graphicsErrors).toEqual([]);
        expect(observed.pageErrors).toEqual([]);
        expect(observed.failedResponses).toEqual([]);
        expect([...observed.failedRequests].sort()).toEqual(
            [
                ...new Set(
                    [...cancelled.keys()].map(
                        request => `${request.method()} ${request.url()}: net::ERR_ABORTED`
                    )
                )
            ].sort()
        );
        await testInfo.attach('strata-initial-demand-cancellation', {
            body: JSON.stringify(
                { initial, resized, settled, cancelled: [...cancelled.values()] },
                null,
                2
            ),
            contentType: 'application/json'
        });
    } finally {
        released = true;
        releaseGate();
        await page.unrouteAll({ behavior: 'wait' });
        page.off('requestfailed', onFailed);
        requests.dispose();
        await failures.dispose();
    }
});

test('STRATA remains interactive across stable captures and page lifecycle @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 960, height: 640 });
    const failures = await installPageFailureMonitor(page);
    const requests = trackGeometryRequests(page);
    try {
        await openScene(page, testInfo);
        await waitForRequestedPages(page, requests);
        // Complete current responses before exercising camera/lifecycle separately. The first
        // test covers live refinement; this test keeps real coarse geometry while orbiting.
        await page.locator('#streaming-toggle').uncheck();
        await liveFrames(page, 18);
        const initial = await diagnostics(page);
        const overview = await captureScene(page, testInfo, 'strata-interactive-overview');
        const canvas = page.locator('#scene canvas');
        const bounds = await canvas.boundingBox();
        if (!bounds) throw new Error('STRATA canvas has no layout box');
        const x = bounds.x + bounds.width * 0.65,
            y = bounds.y + bounds.height * 0.55;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 85, y - 22, { steps: 8 });
        await page.mouse.up();
        const orbited = await liveFrames(page, 12);
        expect(orbited.cameraPosition).not.toEqual(initial.cameraPosition);
        const orbitPixels = await captureScene(page, testInfo, 'strata-orbit');
        expect(changedPixelRatio(overview, orbitPixels)).toBeGreaterThan(0.02);
        await page.mouse.wheel(0, -180);
        const dolly = await liveFrames(page, 12);
        expect(dolly.cameraPosition).not.toEqual(orbited.cameraPosition);
        await page.locator('#view-passage').click();
        const passage = await liveFrames(page, 12);
        expect(passage.view).toBe('passage');
        await captureScene(page, testInfo, 'strata-passage');

        await page.setViewportSize({ width: 390, height: 844 });
        const portrait = await liveFrames(page, 8);
        expect(portrait.submittedFrames).toBeGreaterThan(passage.submittedFrames);
        const layout = await canvas.evaluate(element => ({
            width: element.clientWidth,
            height: element.clientHeight,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth
        }));
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
        await testInfo.attach('strata-portrait', {
            body: await captureStableFrame(page, 'webgpu'),
            contentType: 'image/png'
        });
        await page.locator('#view-overview').click();
        const portraitInteraction = await liveFrames(page, 8);
        expect(portraitInteraction.view).toBe('overview');

        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        });
        await page.waitForTimeout(180);
        const retained = await diagnostics(page);
        expect(retained.suspended).toBe(true);
        expect(retained.disposed).toBe(false);
        await page.waitForTimeout(180);
        expect((await diagnostics(page)).submittedFrames).toBe(retained.submittedFrames);
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        const restored = await liveFrames(page, 5);
        expect(restored.suspended).toBe(false);
        expect(restored.submittedFrames).toBeGreaterThan(retained.submittedFrames);
        await assertGPUHealth(page);
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        });
        await observeAfterTeardown(page);
        failures.assertEmpty('STRATA interactive camera and retained/final page lifecycle');
    } finally {
        requests.dispose();
        await failures.dispose();
    }
});
