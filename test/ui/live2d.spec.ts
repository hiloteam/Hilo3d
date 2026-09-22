import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ExampleBackend } from './example-paths';
import { installPageFailureMonitor, type PageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';
import { captureStableFrame } from './stable-capture';

test.use({ video: 'off' });

const canvasOnlyStyle =
    'body { background: #0c1628 !important; } body * { visibility: hidden !important; } #live2d-canvas { visibility: visible !important; }';
const mikuAssets = [
    '/examples/models/live2d/Miku/miku_sample_t04.model3.json',
    '/examples/models/live2d/Miku/miku_sample_t04.moc3',
    '/examples/models/live2d/Miku/miku_sample_t04.2048/texture_00.png'
] as const;

const mikuMotionGroups = [
    { name: 'Idle', durations: [2.4, 2.4, 2.3] },
    { name: 'Tap', durations: [2.733, 3.067] },
    { name: 'Flick', durations: [2.767, 5.4] },
    { name: 'FlickUp', durations: [2.1] }
] as const;

interface CanvasBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

async function centerCanvas(page: Page): Promise<CanvasBounds> {
    const canvas = page.locator('#live2d-canvas');
    await canvas.evaluate(element => {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    });
    const bounds = await canvas.boundingBox();
    const viewport = page.viewportSize();
    if (!bounds || !viewport) throw new Error('Live2D canvas bounds are unavailable');
    // Fractional layout can put a subpixel at the viewport boundary without clipping a pixel.
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    return bounds;
}

interface CanvasPixels {
    readonly image: PNG;
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

async function captureModel(
    page: Page,
    backend: ExampleBackend,
    testInfo: TestInfo,
    name: string
): Promise<CanvasPixels> {
    // Playwright scrolls the lower controls into view; restore the complete model before sampling.
    const bounds = await centerCanvas(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Live2D viewport is unavailable');
    const capture = await captureStableFrame(page, backend, {
        frames: 2,
        style: canvasOnlyStyle
    });
    const model = (await page.locator('body').getAttribute('data-model')) ?? 'live2d';
    const capturePath = testInfo.outputPath(
        `${model}-${backend}-${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}.png`
    );
    await writeFile(capturePath, capture);
    await testInfo.attach(`${model} ${name} ${backend}`, {
        path: capturePath,
        contentType: 'image/png'
    });
    const image = PNG.sync.read(capture);
    const scaleX = image.width / viewport.width;
    const scaleY = image.height / viewport.height;
    return {
        image,
        left: Math.max(0, Math.ceil(bounds.x * scaleX)),
        top: Math.max(0, Math.ceil(bounds.y * scaleY)),
        right: Math.min(image.width, Math.floor((bounds.x + bounds.width) * scaleX)),
        bottom: Math.min(image.height, Math.floor((bounds.y + bounds.height) * scaleY))
    };
}

function assertModelPixels(pixels: CanvasPixels): void {
    const { image, left, top, right, bottom } = pixels;
    const colors = new Set<number>();
    // Full-body models have empty corners. Hidden DOM decorations leave the same page background
    // behind this transparent canvas, so its top-left interior provides the background reference.
    const backgroundOffset = ((top + 2) * image.width + left + 2) * 4;
    const backgroundRed = image.data[backgroundOffset] ?? 0;
    const backgroundGreen = image.data[backgroundOffset + 1] ?? 0;
    const backgroundBlue = image.data[backgroundOffset + 2] ?? 0;
    let samples = 0;
    let occupied = 0;
    let chromatic = 0;
    let bright = 0;
    let darkest = 255;
    let lightest = 0;
    for (let y = top; y < bottom; y += 2) {
        for (let x = left; x < right; x += 2) {
            const offset = (y * image.width + x) * 4;
            const red = image.data[offset] ?? 0;
            const green = image.data[offset + 1] ?? 0;
            const blue = image.data[offset + 2] ?? 0;
            samples++;
            if (
                Math.max(
                    Math.abs(red - backgroundRed),
                    Math.abs(green - backgroundGreen),
                    Math.abs(blue - backgroundBlue)
                ) <= 24
            ) {
                continue;
            }
            occupied++;
            const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
            const peak = Math.max(red, green, blue);
            if (peak > 65 && peak - Math.min(red, green, blue) > 22) chromatic++;
            if (luminance > 100) bright++;
            darkest = Math.min(darkest, luminance);
            lightest = Math.max(lightest, luminance);
            colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
        }
    }
    expect(samples).toBeGreaterThan(10_000);
    expect(occupied / samples, 'Miku must occupy a visible part of the canvas').toBeGreaterThan(
        0.06
    );
    expect(colors.size, 'Miku must show varied model texture colors').toBeGreaterThan(32);
    expect(lightest - darkest, 'Miku must contain visible light and dark forms').toBeGreaterThan(
        90
    );
    expect(bright / occupied, 'Miku must retain light model details').toBeGreaterThan(0.04);
    expect(chromatic / occupied, 'Miku must retain colored model accents').toBeGreaterThan(0.025);
}

function changedModelRatio(before: CanvasPixels, after: CanvasPixels): number {
    expect([after.image.width, after.image.height]).toEqual([
        before.image.width,
        before.image.height
    ]);
    expect([after.left, after.top, after.right, after.bottom]).toEqual([
        before.left,
        before.top,
        before.right,
        before.bottom
    ]);
    let changed = 0;
    let samples = 0;
    for (let y = before.top; y < before.bottom; y++) {
        for (let x = before.left; x < before.right; x++) {
            const offset = (y * before.image.width + x) * 4;
            let maximumDelta = 0;
            for (let channel = 0; channel < 3; channel++) {
                maximumDelta = Math.max(
                    maximumDelta,
                    Math.abs(
                        (before.image.data[offset + channel] ?? 0) -
                            (after.image.data[offset + channel] ?? 0)
                    )
                );
            }
            if (maximumDelta > 12) changed++;
            samples++;
        }
    }
    expect(samples).toBeGreaterThan(0);
    return changed / samples;
}

async function actAndRender(
    page: Page,
    backend: ExampleBackend,
    action: () => Promise<unknown>
): Promise<void> {
    const before = nativeRenderProgress(await readRenderHealth(page), backend);
    await action();
    await expect
        .poll(async () =>
            nativeRenderProgressAdvanced(
                before,
                nativeRenderProgress(await readRenderHealth(page), backend),
                backend
            )
        )
        .toBe(true);
}

async function assertGraphicsHealth(page: Page, backend: ExampleBackend): Promise<void> {
    await assertStableInstrumentationHealth(backend, `Live2D ${backend} graphics`, {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

function assertPageHealth(
    failures: PageFailureMonitor,
    expectedAborts: ReadonlySet<string>,
    context: string
): void {
    const snapshot = failures.snapshot();
    expect(
        {
            ...snapshot,
            failedRequests: snapshot.failedRequests.filter(request => !expectedAborts.has(request))
        },
        context
    ).toEqual({
        consoleErrors: [],
        graphicsErrors: [],
        pageErrors: [],
        failedRequests: [],
        failedResponses: []
    });
}

function createSignal(): { readonly promise: Promise<void>; resolve(): void } {
    let complete: (() => void) | undefined;
    const promise = new Promise<void>(resolve => {
        complete = resolve;
    });
    return {
        promise,
        resolve(): void {
            if (!complete) throw new Error('Live2D request signal is unavailable');
            complete();
        }
    };
}

interface HeldModelRequest {
    readonly url: string;
    readonly started: Promise<void>;
    release(): Promise<void>;
    unblock(): void;
}

/** Delay the initial model manifest, then deliver it after page disposal. */
async function holdModelRequest(page: Page): Promise<HeldModelRequest> {
    const path = mikuAssets[0];
    const url = new URL(path, page.url()).href;
    const manifest = await readFile(new URL(`../../${path.slice(1)}`, import.meta.url));
    const started = createSignal();
    const released = createSignal();
    const finished = createSignal();
    let failure: Error | undefined;
    await page.route(
        url,
        async route => {
            started.resolve();
            await released.promise;
            try {
                await route.fulfill({ body: manifest, contentType: 'application/json' });
            } catch (error: unknown) {
                failure =
                    error instanceof Error
                        ? error
                        : new Error('Delayed Live2D manifest delivery failed', { cause: error });
            } finally {
                finished.resolve();
            }
        },
        { times: 1 }
    );
    return {
        url,
        started: started.promise,
        async release(): Promise<void> {
            released.resolve();
            await finished.promise;
            if (failure !== undefined) throw failure;
        },
        unblock(): void {
            released.resolve();
        }
    };
}

async function numericReadout(page: Page, name: string): Promise<number> {
    const value = await page.locator('body').getAttribute(`data-${name}`);
    if (value === null || !Number.isFinite(Number(value))) {
        throw new Error(`Live2D numeric readout ${name} is unavailable`);
    }
    return Number(value);
}

async function exerciseFollowAndView(
    page: Page,
    backend: ExampleBackend,
    testInfo: TestInfo
): Promise<void> {
    const body = page.locator('body');
    await actAndRender(page, backend, () => page.locator('#reset').click());
    await actAndRender(page, backend, () => page.locator('#physics').uncheck());
    await expect(page.locator('#follow')).toBeChecked();
    const bounds = await centerCanvas(page);
    await actAndRender(page, backend, () =>
        page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.35)
    );
    await expect.poll(() => numericReadout(page, 'look-x')).toBeLessThan(-0.3);
    await expect.poll(() => numericReadout(page, 'evaluated-head-angle')).toBeLessThan(-3);
    expect(Math.abs(await numericReadout(page, 'look-y'))).toBeGreaterThan(0.1);
    await actAndRender(page, backend, () => page.locator('#pause').check());
    const lookingLeft = await captureModel(page, backend, testInfo, 'follow left');
    await actAndRender(page, backend, () => page.locator('#pause').uncheck());
    const rightBounds = await centerCanvas(page);
    await actAndRender(page, backend, () =>
        page.mouse.move(
            rightBounds.x + rightBounds.width * 0.8,
            rightBounds.y + rightBounds.height * 0.35
        )
    );
    await expect.poll(() => numericReadout(page, 'look-x')).toBeGreaterThan(0.3);
    await expect.poll(() => numericReadout(page, 'evaluated-head-angle')).toBeGreaterThan(3);
    await actAndRender(page, backend, () => page.locator('#pause').check());
    const lookingRight = await captureModel(page, backend, testInfo, 'follow right');
    expect(
        changedModelRatio(lookingLeft, lookingRight),
        'Pointer follow must visibly change the model before each paused capture'
    ).toBeGreaterThan(0.005);

    await actAndRender(page, backend, () => page.locator('#follow').uncheck());
    await expect(page.locator('#follow')).not.toBeChecked();
    await actAndRender(page, backend, () => page.locator('#view-full').click());
    await expect(body).toHaveAttribute('data-view', 'full');
    await expect.poll(() => numericReadout(page, 'zoom')).toBe(1);
    const fullBody = await captureModel(page, backend, testInfo, 'full body');
    await actAndRender(page, backend, () => page.locator('#view-head').click());
    await expect(body).toHaveAttribute('data-view', 'head');
    const headView = await captureModel(page, backend, testInfo, 'head view');
    expect(
        changedModelRatio(fullBody, headView),
        'Head view must visibly reframe the canvas model'
    ).toBeGreaterThan(0.05);
    await actAndRender(page, backend, () => page.locator('#zoom').fill('1.5'));
    await expect.poll(() => numericReadout(page, 'zoom')).toBe(1.5);
    expect(
        changedModelRatio(fullBody, await captureModel(page, backend, testInfo, 'zoom 1.5')),
        'Zoom must change rendered model pixels'
    ).toBeGreaterThan(0.005);
    await actAndRender(page, backend, () => page.locator('#view-full').click());
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`Miku renders all eight Live2D motions and interactive views through ${backend} @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(180_000);
        await page.setViewportSize({ width: 960, height: 720 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        const expectedAborts = new Set<string>();
        let heldRequest: HeldModelRequest | undefined;
        const loadedAssets = new Set<string>();
        const loadedOrigins = new Set<string>();
        let documentRequests = 0;
        page.on('request', request => {
            if (request.resourceType() === 'document' && request.frame() === page.mainFrame())
                documentRequests++;
        });
        page.on('response', response => {
            if (response.ok()) {
                const url = new URL(response.url());
                loadedAssets.add(url.pathname);
                loadedOrigins.add(url.origin);
            }
        });
        try {
            await page.goto(`/examples/live2d.html?backend=${backend}&test=1`, {
                waitUntil: 'load'
            });
            const body = page.locator('body');
            await expect(body).toHaveAttribute('data-example-ready', 'true', { timeout: 60_000 });
            await expect(body).toHaveAttribute('data-backend', backend);
            await expect(body).toHaveAttribute('data-model', 'miku');
            await expect(body).toHaveAttribute('data-drawable-count', '110');
            await expect(body).toHaveAttribute('data-parameter-count', '59');
            await expect(page.locator('#live2d-canvas')).toHaveAttribute(
                'data-hilo3d-backend',
                backend
            );
            await expect(page.locator('#live2d-canvas')).toBeVisible();
            for (const asset of mikuAssets) expect(loadedAssets.has(asset), asset).toBe(true);
            expect(loadedAssets.has('/addon-live2d/src/runtime/DefaultRuntime.ts')).toBe(true);
            for (const name of ['live2dcubismcore.min.js', 'runtime-core.js']) {
                expect(
                    [...loadedAssets].filter(asset => asset.endsWith(`/prebuilt-runtime/${name}`))
                ).toHaveLength(1);
            }
            expect([...loadedOrigins]).toEqual([new URL(page.url()).origin]);
            expect(
                [...loadedAssets].filter(asset =>
                    /\/Miku\/miku_sample_t04\.2048\/texture_\d+\.png$/u.test(asset)
                )
            ).toEqual([mikuAssets[2]]);
            await expect(page.locator('#motion-group option')).toHaveCount(8);
            expect(
                await page.locator('#motion-group option').evaluateAll(options =>
                    options.map(option => {
                        if (!(option instanceof HTMLOptionElement)) {
                            throw new TypeError('Live2D motion groups must be select options');
                        }
                        return option.value;
                    })
                )
            ).toEqual(
                mikuMotionGroups.flatMap(group =>
                    group.durations.map((_seconds, index) => `${group.name}:${String(index)}`)
                )
            );
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
                .toBeGreaterThan(0);

            await actAndRender(page, backend, () => page.locator('#pause').check());
            await expect(body).toHaveAttribute('data-paused', 'true');
            await actAndRender(page, backend, () => page.locator('#physics').uncheck());
            await expect(body).toHaveAttribute('data-physics', 'false');
            assertModelPixels(await captureModel(page, backend, testInfo, 'loaded model'));
            await actAndRender(page, backend, () => page.locator('#reset').click());
            await expect(body).toHaveAttribute('data-paused', 'false');
            await expect(body).toHaveAttribute('data-physics', 'true');
            await expect(body).toHaveAttribute('data-motion', 'Idle');
            await expect(body).toHaveAttribute('data-motion-state', 'loop');
            await expect(page.locator('#pause')).not.toBeChecked();
            await expect(page.locator('#physics')).toBeChecked();

            // The eight authored clips total 23.167 seconds. Each must reach its end naturally;
            // all groups, including Idle, are played once by the public motion button.
            for (const group of mikuMotionGroups) {
                for (const [index, seconds] of group.durations.entries()) {
                    await test.step(`Play ${group.name} motion ${String(index + 1)} to completion`, async () => {
                        await page
                            .locator('#motion-group')
                            .selectOption(`${group.name}:${String(index)}`);
                        await actAndRender(page, backend, () =>
                            page.locator('#motion-tap').click()
                        );
                        await expect(body).toHaveAttribute('data-motion', group.name);
                        await expect(body).toHaveAttribute('data-motion-index', String(index));
                        await expect(body).toHaveAttribute('data-motion-state', 'oneshot');
                        const playing = nativeRenderProgress(await readRenderHealth(page), backend);
                        await expect(body).toHaveAttribute('data-motion-state', 'loop', {
                            timeout: Math.ceil(seconds * 1000) + 10_000
                        });
                        await expect(body).toHaveAttribute('data-motion', 'Idle');
                        await expect(body).toHaveAttribute('data-motion-index', '0');
                        expect(
                            nativeRenderProgressAdvanced(
                                playing,
                                nativeRenderProgress(await readRenderHealth(page), backend),
                                backend
                            )
                        ).toBe(true);
                        await assertGraphicsHealth(page, backend);
                        failures.assertEmpty(
                            `Miku ${backend} ${group.name} motion ${String(index)}`
                        );
                    });
                }
            }
            await expect(body).toHaveAttribute('data-motion', 'Idle');
            await expect(body).toHaveAttribute('data-motion-state', 'loop');
            expect(
                documentRequests,
                'Runtime preparation must not trigger a Vite page reload'
            ).toBe(1);
            await exerciseFollowAndView(page, backend, testInfo);
            await assertGraphicsHealth(page, backend);
            failures.assertEmpty(`Miku ${backend} pointer follow and camera views`);

            const cachedFrames = await page.evaluate(async () => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
                const before = document.body.dataset['frames'];
                for (let frame = 0; frame < 3; frame++) {
                    await new Promise<void>(resolve => {
                        requestAnimationFrame(() => {
                            resolve();
                        });
                    });
                }
                return { before, after: document.body.dataset['frames'] };
            });
            expect(cachedFrames.before).toBeDefined();
            expect(cachedFrames.after).toBe(cachedFrames.before);
            await expect(body).toHaveAttribute('data-stage-destroyed', 'false');
            await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            });
            await actAndRender(page, backend, () => page.locator('#reset').click());
            await page.locator('#motion-group').selectOption('Tap:0');
            await actAndRender(page, backend, () => page.locator('#motion-tap').click());
            await expect(body).toHaveAttribute('data-motion-state', 'oneshot');
            await assertGraphicsHealth(page, backend);
            const disposedFrames = await page.evaluate(async () => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
                const before = document.body.dataset['frames'];
                // Keep the document alive to observe callbacks after animation/resource disposal.
                for (let frame = 0; frame < 3; frame++) {
                    await new Promise<void>(resolve => {
                        requestAnimationFrame(() => {
                            resolve();
                        });
                    });
                }
                return { before, after: document.body.dataset['frames'] };
            });
            await expect(body).toHaveAttribute('data-stage-destroyed', 'true');
            expect(disposedFrames.after).toBe(disposedFrames.before);
            await assertGraphicsHealth(page, backend);
            failures.assertEmpty(`Miku ${backend} after resource teardown`);

            // A second initial load is held before model creation, then canceled by pagehide.
            // Deliver the actual manifest afterward to catch callbacks that resurrect a dead stage.
            heldRequest = await holdModelRequest(page);
            await page.reload({ waitUntil: 'load' });
            await heldRequest.started;
            await expect(body).toHaveAttribute('data-example-ready', 'false');
            await expect(body).toHaveAttribute('data-stage-destroyed', 'false');
            expectedAborts.add(`GET ${heldRequest.url}: net::ERR_ABORTED`);
            const initialFrames = await page.evaluate(() => {
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
                return document.body.dataset['frames'];
            });
            await expect(body).toHaveAttribute('data-stage-destroyed', 'true');
            await heldRequest.release();
            await assertGraphicsHealth(page, backend);
            await expect(body).toHaveAttribute('data-example-ready', 'false');
            await expect(body).toHaveAttribute('data-stage-destroyed', 'true');
            expect(await body.getAttribute('data-frames')).toBe(initialFrames ?? null);
            assertPageHealth(
                failures,
                expectedAborts,
                `Miku ${backend} disposed during initial load`
            );
        } finally {
            heldRequest?.unblock();
            await failures.dispose();
        }
    });
}
