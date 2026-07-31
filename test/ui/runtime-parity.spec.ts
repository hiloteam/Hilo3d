import { resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { backendsForExample, type ExampleBackend } from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames,
    type NativeRenderProgress
} from './render-health';

const serverOrigin = 'http://127.0.0.1:4173';

async function createPage(
    browser: Browser,
    deviceScaleFactor = 1,
    viewport: { width: number; height: number } = { width: 800, height: 600 }
): Promise<Page> {
    const context = await browser.newContext({
        deviceScaleFactor,
        viewport
    });
    return context.newPage();
}

async function currentProgress(page: Page, backend: ExampleBackend): Promise<NativeRenderProgress> {
    return nativeRenderProgress(await readRenderHealth(page), backend);
}

async function expectActionProgress(
    page: Page,
    backend: ExampleBackend,
    before: NativeRenderProgress,
    context: string
): Promise<void> {
    await expect
        .poll(
            async () =>
                nativeRenderProgressAdvanced(before, await currentProgress(page, backend), backend),
            { message: context, timeout: 15_000 }
        )
        .toBe(true);
}

async function assertFinalGraphicsHealth(
    page: Page,
    backend: ExampleBackend,
    context: string
): Promise<void> {
    await assertStableInstrumentationHealth(backend, context, {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`ShaderToy pointer input stays screen-space on ${backend} @${backend}`, async ({
        browser
    }) => {
        test.skip(
            process.env['GITHUB_ACTIONS'] === 'true',
            'ShaderToy is performance-intensive and is covered by local UI runs.'
        );
        const page = await createPage(browser);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${serverOrigin}/examples/shaderToy.html?backend=${backend}`, {
                waitUntil: 'networkidle'
            });
            const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
            await expect(canvas).toBeVisible();
            await page.waitForFunction(
                () => window.__HILO3D_SHADER_TOY_DIAGNOSTICS__ !== undefined
            );
            const initial = await page.evaluate(async () => {
                const diagnostics = window.__HILO3D_SHADER_TOY_DIAGNOSTICS__;
                if (!diagnostics) throw new Error('ShaderToy diagnostics are unavailable.');
                return diagnostics.capture({ keepPaused: true });
            });
            expect(initial.backend).toBe(backend);
            expect(initial.coloredPixelCount).toBeGreaterThan(0);
            const before = await currentProgress(page, backend);

            const box = await canvas.boundingBox();
            if (!box) throw new Error('ShaderToy canvas has no layout box');
            await page.mouse.move(box.x + 80, box.y + 90);
            await page.mouse.down();
            await page.mouse.move(box.x + 180, box.y + 140, { steps: 3 });
            await page.mouse.up();
            const after = await page.evaluate(async () => {
                const diagnostics = window.__HILO3D_SHADER_TOY_DIAGNOSTICS__;
                if (!diagnostics) throw new Error('ShaderToy diagnostics are unavailable.');
                return diagnostics.capture();
            });

            expect(after.backend).toBe(backend);
            expect(after.coloredPixelCount).toBeGreaterThan(0);
            expect(after.pointer.x).toBeGreaterThan(initial.pointer.x);
            expect(after.pointer.y).toBeGreaterThan(0);
            expect(after.pointer.isDown).toBe(false);
            expect(after.hash).not.toBe(initial.hash);
            await expectActionProgress(
                page,
                backend,
                before,
                `ShaderToy pointer update must issue a new native ${backend} draw${backend === 'webgpu' ? ' and queue submission' : ''}`
            );
            await assertFinalGraphicsHealth(
                page,
                backend,
                `ShaderToy pointer graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`ShaderToy pointer failures on ${backend}`);
        } finally {
            await failures.dispose();
            await page.context().close();
        }
    });

    test(`glTF Viewer replaces and releases a loaded model on ${backend} @${backend}`, async ({
        browser
    }) => {
        const page = await createPage(browser);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(
                `${serverOrigin}/examples/glTFViewer/index.html?backend=${backend}&url=${encodeURIComponent('/examples/models/Tmall/Tmall.gltf')}`,
                { waitUntil: 'networkidle' }
            );
            await expect(page.locator('body')).toHaveAttribute('data-model-ready', 'true', {
                timeout: 15_000
            });
            await page.waitForFunction(
                () => window.__HILO3D_GLTF_VIEWER_DIAGNOSTICS__ !== undefined
            );
            const initialGeneration = await page
                .locator('body')
                .getAttribute('data-model-generation');
            const initial = await page.evaluate(async () => {
                const diagnostics = window.__HILO3D_GLTF_VIEWER_DIAGNOSTICS__;
                if (!diagnostics) throw new Error('glTF Viewer diagnostics are unavailable.');
                return diagnostics.capture();
            });
            expect(initial.backend).toBe(backend);
            expect(initial.coloredPixelCount).toBeGreaterThan(0);

            await page
                .locator('#input')
                .setInputFiles(resolve('examples/models/DamagedHelmet/DamagedHelmet.glb'));
            await expect
                .poll(() => page.locator('body').getAttribute('data-model-generation'), {
                    timeout: 15_000
                })
                .not.toBe(initialGeneration);
            await expect(page.locator('body')).toHaveAttribute('data-model-ready', 'true');
            const before = await currentProgress(page, backend);
            const replacement = await page.evaluate(async () => {
                const diagnostics = window.__HILO3D_GLTF_VIEWER_DIAGNOSTICS__;
                if (!diagnostics) throw new Error('glTF Viewer diagnostics are unavailable.');
                return diagnostics.capture();
            });

            expect(replacement.backend).toBe(backend);
            expect(replacement.generation).not.toBe(initial.generation);
            expect(replacement.coloredPixelCount).toBeGreaterThan(0);
            expect(replacement.hash).not.toBe(initial.hash);
            await expectActionProgress(
                page,
                backend,
                before,
                `glTF replacement capture must issue a new native ${backend} draw${backend === 'webgpu' ? ' and queue submission' : ''}`
            );
            await assertFinalGraphicsHealth(
                page,
                backend,
                `glTF replacement graphics errors on ${backend}`
            );

            await page.goto('about:blank');
            failures.assertEmpty(`glTF Viewer lifecycle failures on ${backend}`);
        } finally {
            await failures.dispose();
            await page.context().close();
        }
    });

    test(`Layered PBR studio toggles material lobes on ${backend} @${backend}`, async ({
        browser
    }) => {
        const page = await createPage(browser);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(
                `${serverOrigin}/examples/pbr_layered_materials.html?backend=${backend}`,
                { waitUntil: 'networkidle' }
            );
            await expect(page.locator('body')).toHaveAttribute('data-showcase-ready', 'true', {
                timeout: 15_000
            });
            const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
            await expect(canvas).toBeVisible();

            for (const feature of ['anisotropy', 'clearcoat', 'transmission'] as const) {
                const button = page.locator(`[data-feature="${feature}"]`);
                const before = await currentProgress(page, backend);
                await button.click();
                await expect(button).toHaveAttribute('aria-pressed', 'false');
                await expectActionProgress(
                    page,
                    backend,
                    before,
                    `${feature} toggle must issue a new native ${backend} draw`
                );
            }

            await assertFinalGraphicsHealth(
                page,
                backend,
                `Layered PBR studio graphics errors on ${backend}`
            );
            await page.goto('about:blank');
            failures.assertEmpty(`Layered PBR studio failures on ${backend}`);
        } finally {
            await failures.dispose();
            await page.context().close();
        }
    });

    test(`Khronos material gallery switches layered glTF assets on ${backend} @${backend}`, async ({
        browser
    }) => {
        // Loading and rendering all seven production glTF assets is intentionally heavyweight on
        // CI SwiftShader, while each individual readiness and native-progress assertion stays strict.
        test.slow();
        const page = await createPage(browser);
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(
                `${serverOrigin}/examples/gltf_material_extensions.html?backend=${backend}&asset=lamp`,
                { waitUntil: 'networkidle' }
            );
            const body = page.locator('body');
            const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
            await expect(body).toHaveAttribute('data-showcase-ready', 'lamp', {
                timeout: 30_000
            });
            await expect(canvas).toBeVisible();
            await expect(page.locator('.showcaseHint')).toContainText('±90°');

            const orbitBounds = await canvas.boundingBox();
            if (!orbitBounds) throw new Error('Khronos gallery canvas has no orbit bounds');
            const beforeOrbit = await currentProgress(page, backend);
            await page.mouse.move(
                orbitBounds.x + orbitBounds.width * 0.65,
                orbitBounds.y + orbitBounds.height * 0.22
            );
            await page.mouse.down();
            await page.mouse.move(
                orbitBounds.x + orbitBounds.width * 0.65,
                orbitBounds.y + orbitBounds.height * 0.78,
                { steps: 12 }
            );
            await page.mouse.up();
            await expectActionProgress(
                page,
                backend,
                beforeOrbit,
                `90-degree gallery orbit must issue a new native ${backend} draw`
            );

            for (const asset of [
                'wicker',
                'dragon',
                'dish',
                'candle',
                'amber',
                'helmet'
            ] as const) {
                const before = await currentProgress(page, backend);
                await page.locator(`[data-asset="${asset}"]`).click();
                await expect(body).toHaveAttribute('data-showcase-ready', asset, {
                    timeout: 30_000
                });
                await expect(page.locator('#assetStatus')).toHaveText('ready');
                await expectActionProgress(
                    page,
                    backend,
                    before,
                    `${asset} selection must issue a new native ${backend} draw`
                );
            }

            await assertFinalGraphicsHealth(
                page,
                backend,
                `Khronos material gallery graphics errors on ${backend}`
            );
            await page.goto('about:blank');
            failures.assertEmpty(`Khronos material gallery failures on ${backend}`);
        } finally {
            await failures.dispose();
            await page.context().close();
        }
    });
}

const fractionalDprExamples = ['renderTarget.html', 'bloom.html', 'lifegame.html'] as const;

for (const deviceScaleFactor of [1.25, 1.5] as const) {
    for (const backend of ['webgl2', 'webgpu'] as const) {
        for (const examplePath of fractionalDprExamples) {
            if (!backendsForExample(examplePath).includes(backend)) continue;
            test(`${examplePath} renders at DPR ${String(deviceScaleFactor)} on ${backend} @${backend}`, async ({
                browser
            }) => {
                const page = await createPage(browser, deviceScaleFactor, {
                    width: 375,
                    height: 667
                });
                await installRenderHealthProbe(page);
                const failures = await installPageFailureMonitor(page);
                try {
                    await page.goto(`${serverOrigin}/examples/${examplePath}?backend=${backend}`, {
                        waitUntil: 'networkidle'
                    });
                    await expect
                        .poll(
                            async () =>
                                completedRenderCommands(await readRenderHealth(page), backend),
                            { timeout: 15_000 }
                        )
                        .toBeGreaterThan(0);
                    const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
                    await expect(canvas).toBeVisible();
                    const dimensions = await canvas.evaluate(element => {
                        const canvasElement = element as HTMLCanvasElement;
                        return {
                            backingWidth: canvasElement.width,
                            backingHeight: canvasElement.height,
                            cssWidth: canvasElement.clientWidth,
                            cssHeight: canvasElement.clientHeight,
                            dpr: devicePixelRatio
                        };
                    });
                    expect(dimensions.dpr).toBe(deviceScaleFactor);
                    expect(dimensions.backingWidth).toBe(
                        Math.max(1, Math.round(dimensions.cssWidth * deviceScaleFactor))
                    );
                    expect(dimensions.backingHeight).toBe(
                        Math.max(1, Math.round(dimensions.cssHeight * deviceScaleFactor))
                    );
                    await assertFinalGraphicsHealth(
                        page,
                        backend,
                        `${examplePath} fractional-DPR graphics errors on ${backend}`
                    );

                    await page.goto('about:blank');
                    failures.assertEmpty(`${examplePath} fractional-DPR failures on ${backend}`);
                } finally {
                    await failures.dispose();
                    await page.context().close();
                }
            });
        }
    }
}

declare global {
    interface Window {
        __HILO3D_SHADER_TOY_DIAGNOSTICS__?: {
            capture(options?: { readonly keepPaused?: boolean }): Promise<{
                readonly backend: ExampleBackend;
                readonly hash: string;
                readonly coloredPixelCount: number;
                readonly pointer: {
                    readonly x: number;
                    readonly y: number;
                    readonly deltaX: number;
                    readonly deltaY: number;
                    readonly isDown: boolean;
                };
            }>;
        };
        __HILO3D_GLTF_VIEWER_DIAGNOSTICS__?: {
            capture(): Promise<{
                readonly backend: ExampleBackend;
                readonly generation: number;
                readonly hash: string;
                readonly coloredPixelCount: number;
            }>;
        };
    }
}
