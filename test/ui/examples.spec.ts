import { expect, test, type Page } from '@playwright/test';
import { createExampleCatalog, examplesForBackend } from '../../examples/shared/catalog';
import {
    completionContractForExample,
    exampleCases,
    examplePaths,
    exampleRequestUrl,
    exampleRequiresRendering,
    exampleUsesDedicatedReleaseTest,
    type ExampleBackend,
    type ExampleCompletionContract
} from './example-paths';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    instrumentationErrors,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface CanvasContract {
    readonly frameUrl: string;
    readonly backend: string | null;
    readonly width: number;
    readonly height: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
}

interface PageContract {
    readonly canvases: readonly CanvasContract[];
    readonly backendCanvases: readonly CanvasContract[];
}

interface CanvasPresentation {
    readonly frameUrl: string;
    readonly width: number;
    readonly height: number;
    readonly distinctColorCount: number;
    readonly visiblePixelCount: number;
}

interface CompressedTextureResult {
    readonly backend: string;
    readonly supportedSources: readonly string[];
    readonly renderedSources: readonly string[];
}

const GPU_DIAGNOSTIC_ERROR =
    /(?:webgl|webgpu|gpu(?:adapter|bindgroup|buffer|command|device|pipeline|queue|sampler|texture)|gl_invalid|validation error|framebuffer[^\n]*(?:incomplete|unsupported)|invalid (?:bind|buffer|command|pipeline|render|sampler|texture)|shader[^\n]*(?:compil|link))/iu;
const PRESENTATION_TIMEOUT = process.env['CI'] === 'true' ? 30_000 : 15_000;

function recordUnique(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

async function readPageContract(page: Page): Promise<PageContract> {
    const frameContracts = await Promise.all(
        page.frames().map(async frame => {
            const frameUrl = frame.url();
            try {
                const canvases = await frame.evaluate(() =>
                    [...document.querySelectorAll<HTMLCanvasElement>('canvas')].map(canvas => ({
                        backend: canvas.dataset['hilo3dBackend'] ?? null,
                        width: canvas.width,
                        height: canvas.height,
                        clientWidth: canvas.clientWidth,
                        clientHeight: canvas.clientHeight
                    }))
                );
                return { frameUrl, canvases };
            } catch (error: unknown) {
                if (frame.isDetached()) return { frameUrl, canvases: [] };
                throw error;
            }
        })
    );
    const canvases = frameContracts.flatMap(({ frameUrl, canvases: frameCanvases }) =>
        frameCanvases.map(canvas => ({ frameUrl, ...canvas }))
    );
    return {
        canvases,
        backendCanvases: canvases.filter(canvas => canvas.backend !== null)
    };
}

async function readCanvasBufferPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const framePresentations = await Promise.all(
        page.frames().map(async frame => {
            const frameUrl = frame.url();
            try {
                const presentations = await frame.evaluate(expectedBackend => {
                    return [
                        ...document.querySelectorAll<HTMLCanvasElement>(
                            `canvas[data-hilo3d-backend="${expectedBackend}"]`
                        )
                    ].map(source => {
                        const width = Math.min(128, source.width);
                        const height = Math.min(128, source.height);
                        const scratch = document.createElement('canvas');
                        scratch.width = width;
                        scratch.height = height;
                        const context = scratch.getContext('2d', { willReadFrequently: true });
                        if (!context) throw new Error('Unable to create a presentation readback');
                        context.drawImage(source, 0, 0, width, height);
                        const pixels = context.getImageData(0, 0, width, height).data;
                        const colors = new Set<number>();
                        let visiblePixelCount = 0;
                        for (let offset = 0; offset < pixels.length; offset += 4) {
                            const red = pixels[offset] ?? 0;
                            const green = pixels[offset + 1] ?? 0;
                            const blue = pixels[offset + 2] ?? 0;
                            const alpha = pixels[offset + 3] ?? 0;
                            if (alpha > 0) visiblePixelCount++;
                            colors.add((red << 16) | (green << 8) | blue);
                            if (colors.size > 1 && visiblePixelCount > 0) break;
                        }
                        return {
                            width,
                            height,
                            distinctColorCount: colors.size,
                            visiblePixelCount
                        };
                    });
                }, backend);
                return presentations.map(presentation => ({ frameUrl, ...presentation }));
            } catch (error: unknown) {
                if (frame.isDetached()) return [];
                throw error;
            }
        })
    );
    return framePresentations.flat();
}

async function inspectCompositorPng(
    page: Page,
    dataUrl: string,
    frameUrl: string
): Promise<CanvasPresentation> {
    return page.evaluate(
        async ({ encodedPng, sourceFrame }) => {
            const response = await fetch(encodedPng);
            const bitmap = await createImageBitmap(await response.blob());
            const width = Math.min(128, bitmap.width);
            const height = Math.min(128, bitmap.height);
            const scratch = document.createElement('canvas');
            scratch.width = width;
            scratch.height = height;
            const context = scratch.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Unable to inspect the compositor canvas snapshot');
            context.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();
            const pixels = context.getImageData(0, 0, width, height).data;
            const colors = new Set<number>();
            let visiblePixelCount = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
                const red = pixels[offset] ?? 0;
                const green = pixels[offset + 1] ?? 0;
                const blue = pixels[offset + 2] ?? 0;
                const alpha = pixels[offset + 3] ?? 0;
                if (alpha > 0) visiblePixelCount++;
                colors.add((red << 16) | (green << 8) | blue);
                if (colors.size > 1 && visiblePixelCount > 0) break;
            }
            return {
                frameUrl: sourceFrame,
                width,
                height,
                distinctColorCount: colors.size,
                visiblePixelCount
            };
        },
        { encodedPng: dataUrl, sourceFrame: frameUrl }
    );
}

async function readCompositorCanvasPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const selector = `canvas[data-hilo3d-backend="${backend}"]`;
    const presentations: CanvasPresentation[] = [];
    for (const frame of page.frames()) {
        const canvases = frame.locator(selector);
        const count = await canvases.count();
        for (let index = 0; index < count; index++) {
            const png = await canvases.nth(index).screenshot({
                type: 'png',
                animations: 'allow',
                caret: 'hide'
            });
            presentations.push(
                await inspectCompositorPng(
                    page,
                    `data:image/png;base64,${png.toString('base64')}`,
                    frame.url()
                )
            );
        }
    }
    return presentations;
}

async function readCanvasPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const direct = await readCanvasBufferPresentations(page, backend);
    if (
        direct.length > 0 &&
        direct.every(
            presentation =>
                presentation.visiblePixelCount > 0 && presentation.distinctColorCount > 1
        )
    ) {
        return direct;
    }
    return readCompositorCanvasPresentations(page, backend);
}

function canvasPresentationsAreVisible(presentations: readonly CanvasPresentation[]): boolean {
    return (
        presentations.length > 0 &&
        presentations.every(
            presentation =>
                presentation.width > 0 &&
                presentation.height > 0 &&
                presentation.visiblePixelCount > 0 &&
                presentation.distinctColorCount > 1
        )
    );
}

async function expectVisibleCanvasPresentations(
    page: Page,
    examplePath: string,
    backend: ExampleBackend
): Promise<void> {
    const deadline = Date.now() + PRESENTATION_TIMEOUT;
    let presentations: readonly CanvasPresentation[] = [];
    // Do not discard a valid compositor read merely because the read itself crossed the deadline.
    // The deadline controls whether another probe may start; the enclosing Playwright timeout still
    // bounds a stalled screenshot operation.
    while (Date.now() < deadline) {
        presentations = await readCanvasPresentations(page, backend);
        if (canvasPresentationsAreVisible(presentations)) return;
        if (Date.now() >= deadline) break;
        await page.waitForTimeout(100);
    }
    expect(
        canvasPresentationsAreVisible(presentations),
        `${examplePath} must present a visible non-uniform ${backend} frame`
    ).toBe(true);
}

async function assertCompletionContract(
    page: Page,
    contract: ExampleCompletionContract | null,
    backend: ExampleBackend
): Promise<void> {
    if (contract === null) return;
    if (contract === 'gltf-viewer') {
        await expect(page.locator('body')).toHaveAttribute('data-model-ready', 'true', {
            timeout: 15_000
        });
        return;
    }
    if (contract === 'resource-diagnostics') {
        await expect(page.locator('body')).toHaveAttribute(
            'data-resource-diagnostics-complete',
            'true',
            { timeout: 15_000 }
        );
        await expect(page.locator('#resource-diagnostics')).toContainText('textureBox destroyed');
        await expect(page.locator('#resource-diagnostics')).toContainText(
            'post-destroy mesh rendered'
        );
        return;
    }

    await page.waitForFunction(
        expectedBackend => {
            const result = (
                window as Window & {
                    __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureResult;
                }
            ).__HILO3D_COMPRESSED_TEXTURE_RESULT__;
            return (
                result?.backend === expectedBackend &&
                result.renderedSources.length === result.supportedSources.length &&
                result.renderedSources.every(
                    (source, index) => source === result.supportedSources[index]
                )
            );
        },
        backend,
        { timeout: 15_000 }
    );
    const result = await page.evaluate(
        () =>
            (
                window as Window & {
                    __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureResult;
                }
            ).__HILO3D_COMPRESSED_TEXTURE_RESULT__
    );
    expect(result?.backend).toBe(backend);
    expect(result?.renderedSources).toEqual(result?.supportedSources);
}

async function assertObservableRender(
    page: Page,
    examplePath: string,
    backend: ExampleBackend
): Promise<void> {
    await expect
        .poll(async () => completedRenderCommands(await readRenderHealth(page), backend), {
            message: `${examplePath} must issue a native ${backend} render command`,
            timeout: 15_000
        })
        .toBeGreaterThan(0);
}

test('canonical examples index opens the WebGPU gallery by default', async ({ page }) => {
    await page.goto('/examples/index.html', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/examples\/list\.html#\w+$/u);
    await expect(page.locator('#backendSelect')).toHaveValue('webgpu');
    await expect(page.locator('#exampleFrame')).toHaveAttribute(
        'src',
        /[?&]backend=webgpu(?:&|$)/u
    );
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`example gallery discovers every ${backend} page @${backend}`, async ({ page }) => {
        await page.goto(`/examples/list.html?backend=${backend}`, { waitUntil: 'networkidle' });
        const expected = examplesForBackend(createExampleCatalog(examplePaths), backend);
        const navigationItems = page.locator('#exampleNavigation .exampleButton');
        expect(
            await navigationItems.evaluateAll(items => items.map(item => item.textContent))
        ).toEqual(expected.map(entry => entry.title));
        expect(
            await navigationItems.evaluateAll(items =>
                items.map(item => (item as HTMLElement).dataset['examplePath'])
            )
        ).toEqual(expected.map(entry => entry.path));

        const exampleFrame = page.locator('#exampleFrame');
        await expect(page.locator('#currentTitle')).toHaveText('Quick Start');
        await expect(exampleFrame).toHaveAttribute(
            'src',
            new RegExp(`[?&]backend=${backend}(?:&|$)`, 'u')
        );

        await page.locator('#exampleSearch').fill('Geometry Box');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="geometry_box.html"]').click();
        await expect(page.frameLocator('#exampleFrame').locator('.hilo3dStats')).toContainText(
            `renderBackend: ${backend === 'webgl2' ? 'WebGL 2' : 'WebGPU'}`
        );

        await page.locator('#exampleSearch').fill('glTF Viewer');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="glTFViewer/index.html"]').click();
        const gltfSource = await exampleFrame.getAttribute('src');
        if (!gltfSource) throw new Error('glTF Viewer navigation did not set an iframe source.');
        expect(new URL(gltfSource).searchParams.get('url')).toBe(
            '/examples/models/Tmall/Tmall.gltf'
        );

        await page.locator('#exampleSearch').fill('Quick Start');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="quickStart.html"]').click();
        const quickStartSource = await exampleFrame.getAttribute('src');
        if (!quickStartSource)
            throw new Error('Quick Start navigation did not set an iframe source.');
        const quickStartUrl = new URL(quickStartSource);
        expect(quickStartUrl.searchParams.get('backend')).toBe(backend);
        expect(quickStartUrl.searchParams.has('url')).toBe(false);

        await page.setViewportSize({ width: 600, height: 720 });
        const sidebarToggle = page.locator('#sidebarToggle');
        await expect(sidebarToggle).toBeVisible();
        await sidebarToggle.click();
        await expect(page.locator('body')).toHaveClass(/sidebarOpen/u);
        await page.locator('#sidebarBackdrop').click({ position: { x: 590, y: 300 } });
        await expect(page.locator('body')).not.toHaveClass(/sidebarOpen/u);
    });
}

test.describe('examples using the generic release gate', () => {
    // Parallel mode lets Playwright shard individual catalog cases across isolated CI machines.
    // Every machine still uses one worker, so SwiftShader work remains serial within each process;
    // unlike serial mode, one failure cannot skip the remainder of the release matrix. Heavy
    // examples may use a dedicated gate with stronger example-specific output.
    test.describe.configure({ mode: 'parallel' });

    for (const exampleCase of exampleCases) {
        const { path: examplePath, backend } = exampleCase;
        if (exampleUsesDedicatedReleaseTest(examplePath)) continue;
        test(`${examplePath} renders through ${backend} @${backend}`, async ({ page }) => {
            await installRenderHealthProbe(page);

            const consoleErrors: string[] = [];
            const cdpGraphicsErrors: string[] = [];
            const pageErrors: string[] = [];
            const failedRequests: string[] = [];
            const failedResponses: string[] = [];
            const devtools = await page.context().newCDPSession(page);
            await devtools.send('Log.enable');

            devtools.on('Log.entryAdded', ({ entry }) => {
                const description = `${entry.source}: ${entry.text}`;
                if (
                    entry.level === 'error' &&
                    (entry.source === 'rendering' || GPU_DIAGNOSTIC_ERROR.test(description))
                ) {
                    recordUnique(cdpGraphicsErrors, description);
                }
            });
            page.on('console', message => {
                if (message.type() === 'error') recordUnique(consoleErrors, message.text());
            });
            page.on('pageerror', error => {
                recordUnique(pageErrors, error.message);
            });
            page.on('requestfailed', request => {
                const failure = request.failure()?.errorText ?? 'unknown network failure';
                recordUnique(failedRequests, `${request.method()} ${request.url()}: ${failure}`);
            });
            page.on('response', response => {
                if (response.status() >= 400) {
                    recordUnique(
                        failedResponses,
                        `${String(response.status())} ${response.request().method()} ${response.url()}`
                    );
                }
            });

            const response = await page.goto(exampleRequestUrl(examplePath, backend), {
                waitUntil: 'load'
            });
            await page.waitForLoadState('networkidle');
            await assertCompletionContract(
                page,
                completionContractForExample(examplePath),
                backend
            );
            if (exampleRequiresRendering(examplePath)) {
                await assertObservableRender(page, examplePath, backend);
            }

            expect(response?.ok(), `HTTP status for ${examplePath} on ${backend}`).toBe(true);

            const rootContract = await page.evaluate(() => ({
                moduleScriptCount: document.querySelectorAll('script[type="module"]').length,
                bodyChildCount: document.body.children.length
            }));
            expect(rootContract.moduleScriptCount).toBeGreaterThan(0);
            expect(rootContract.bodyChildCount).toBeGreaterThan(0);

            const contract = await readPageContract(page);
            for (const canvas of contract.canvases) {
                expect(canvas.width, `${canvas.frameUrl} canvas width`).toBeGreaterThan(0);
                expect(canvas.height, `${canvas.frameUrl} canvas height`).toBeGreaterThan(0);
                expect(
                    canvas.clientWidth,
                    `${canvas.frameUrl} canvas client width`
                ).toBeGreaterThan(0);
                expect(
                    canvas.clientHeight,
                    `${canvas.frameUrl} canvas client height`
                ).toBeGreaterThan(0);
            }

            if (exampleRequiresRendering(examplePath)) {
                expect(
                    contract.backendCanvases.length,
                    `${examplePath} must expose a renderer-owned backend canvas`
                ).toBeGreaterThan(0);
                expect(
                    [...new Set(contract.backendCanvases.map(canvas => canvas.backend))],
                    `renderer backend for ${examplePath}`
                ).toEqual([backend]);
            } else {
                expect(
                    contract.backendCanvases,
                    `${examplePath} is the declared non-rendering example`
                ).toEqual([]);
            }

            if (exampleRequiresRendering(examplePath)) {
                await assertStableInstrumentationHealth(
                    backend,
                    `graphics instrumentation errors in ${examplePath} on ${backend}`,
                    {
                        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                        readRenderHealth: () => readRenderHealth(page)
                    }
                );
                await expectVisibleCanvasPresentations(page, examplePath, backend);
            } else {
                await waitForStableAnimationFrames(page);
            }

            await devtools.detach();
            expect(pageErrors, `page errors in ${examplePath} on ${backend}`).toEqual([]);
            expect(consoleErrors, `console errors in ${examplePath} on ${backend}`).toEqual([]);
            expect(
                cdpGraphicsErrors,
                `CDP graphics errors in ${examplePath} on ${backend}`
            ).toEqual([]);
            expect(failedRequests, `failed requests in ${examplePath} on ${backend}`).toEqual([]);
            expect(failedResponses, `HTTP failures in ${examplePath} on ${backend}`).toEqual([]);
        });
    }
});

test.describe('WebGL render-health browser contract', () => {
    test('counts a valid native draw and keeps the final health gate clean', async ({ page }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=valid', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute('data-render-health-complete', 'valid');

        expect(completedRenderCommands(await readRenderHealth(page), 'webgl2')).toBe(1);
        await expect(
            assertStableInstrumentationHealth('webgl2', 'valid WebGL draw', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).resolves.toBeUndefined();
    });

    test('retains an invalid native draw error and refuses to count it as progress', async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=invalid', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute(
            'data-render-health-complete',
            'invalid'
        );

        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, 'webgl2')).toBe(0);
        expect(instrumentationErrors(health, 'webgl2').join('\n')).toContain(
            'INVALID_OPERATION (0x0502)'
        );
        await expect(
            assertStableInstrumentationHealth('webgl2', 'invalid WebGL draw', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).rejects.toThrow('INVALID_OPERATION (0x0502)');
    });

    test('samples native errors issued after the final draw before accepting health', async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=invalid-after-draw', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute(
            'data-render-health-complete',
            'invalid-after-draw'
        );

        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, 'webgl2')).toBe(1);
        expect(instrumentationErrors(health, 'webgl2').join('\n')).toContain(
            'finalHealthSnapshot: INVALID_ENUM (0x0500)'
        );
        await expect(
            assertStableInstrumentationHealth('webgl2', 'trailing WebGL error', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).rejects.toThrow('finalHealthSnapshot: INVALID_ENUM (0x0500)');
    });
});

test.describe('WebGPU render-health browser contract', () => {
    test('fences every tracked native GPUQueue before the final snapshot', async ({ page }) => {
        await installRenderHealthProbe(page);
        await page.goto('/examples/math.html?backend=webgpu', { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
            const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: false });
            if (!adapter) throw new Error('WebGPU queue-fence fixture requires an adapter.');
            const device = await adapter.requestDevice();
            const queue = device.queue;
            const nativeCompletion = queue.onSubmittedWorkDone.bind(queue);
            Reflect.set(window, '__HILO3D_QUEUE_FENCE_COUNT__', 0);
            Reflect.set(window, '__HILO3D_QUEUE_FENCE_DEVICE__', device);
            Object.defineProperty(queue, 'onSubmittedWorkDone', {
                configurable: true,
                writable: true,
                async value(): Promise<void> {
                    const current: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                    Reflect.set(
                        window,
                        '__HILO3D_QUEUE_FENCE_COUNT__',
                        typeof current === 'number' ? current + 1 : 1
                    );
                    await nativeCompletion();
                }
            });
            const encoder = device.createCommandEncoder({ label: 'render-health queue fence' });
            queue.submit([encoder.finish()]);
        });

        expect(
            await page.evaluate(() => {
                const value: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                return typeof value === 'number' ? value : -1;
            })
        ).toBe(0);
        await assertStableInstrumentationHealth('webgpu', 'native queue fence contract', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        expect(
            await page.evaluate(() => {
                const value: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                return typeof value === 'number' ? value : -1;
            })
        ).toBeGreaterThan(0);
        await page.evaluate(() => {
            const device: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_DEVICE__');
            if (typeof device === 'object' && device !== null) {
                const destroy: unknown = Reflect.get(device, 'destroy');
                if (typeof destroy === 'function') Reflect.apply(destroy, device, []);
            }
        });
    });
});
