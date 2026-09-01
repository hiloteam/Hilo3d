import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

interface PageFailureMonitor {
    readonly failures: string[];
    readonly firstFailure: Promise<never>;
}

function monitorPageFailures(page: Page, failures: string[] = []): PageFailureMonitor {
    let rejectFirstFailure: (error: Error) => void = () => undefined;
    const firstFailure = new Promise<never>((_resolve, reject) => {
        rejectFirstFailure = reject;
    });
    void firstFailure.catch(() => undefined);

    const recordFailure = (message: string): void => {
        failures.push(message);
        rejectFirstFailure(new Error(message));
    };
    page.on('console', message => {
        if (message.type() === 'error') recordFailure(message.text());
    });
    page.on('pageerror', error => {
        recordFailure(error.message);
    });
    return { failures, firstFailure };
}

async function waitForVisualFirstFrame(page: Page, monitor: PageFailureMonitor): Promise<void> {
    if (monitor.failures.length > 0) throw new Error(monitor.failures[0]);
    await Promise.race([
        page.waitForFunction(() => window.__HILO3D_VISUAL_FIRST_FRAME__ !== undefined),
        monitor.firstFailure
    ]);
}

test('@visual committed WebGPU and WebGL2 ECS baselines match exactly', async () => {
    const [webgl2, webgpu] = await Promise.all([
        readFile(
            new URL(
                './__screenshots__/visual.spec.ts/ecs-lit-pbr-scene-webgl2-chromium-linux.png',
                import.meta.url
            )
        ),
        readFile(
            new URL(
                './__screenshots__/visual.spec.ts/ecs-lit-pbr-scene-webgpu-chromium-linux.png',
                import.meta.url
            )
        )
    ]);
    expect(webgpu.equals(webgl2), 'committed WebGPU pixels must match WebGL2').toBe(true);
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`@visual renders a deterministic ECS PBR scene through ${backend}`, async ({ page }) => {
        const monitor = monitorPageFailures(page);

        await page.goto(`/test/ui/fixtures/visual.html?backend=${backend}`, {
            waitUntil: 'load'
        });
        await waitForVisualFirstFrame(page, monitor);

        expect(monitor.failures).toEqual([]);
        expect(await page.evaluate(() => window.__HILO3D_VISUAL_FIRST_FRAME__?.backend)).toBe(
            backend
        );
        await expect(page.locator('canvas')).toHaveScreenshot(`ecs-lit-pbr-scene-${backend}.png`, {
            animations: 'disabled',
            maxDiffPixels: 0,
            threshold: 0
        });

        await page.evaluate(() => window.__HILO3D_VISUAL_CONTINUE__?.());
        await page.waitForFunction(() => window.__HILO3D_VISUAL_RESULT__ !== undefined);
        const result = await page.evaluate(() => window.__HILO3D_VISUAL_RESULT__);
        expect(result?.backend).toBe(backend);
        expect(result?.readback.backgroundPixel).toEqual([20, 26, 36, 255]);
        expect(result?.readback.transformedPixelCount).toBeGreaterThan(500);
        expect(result?.readback.directionalLightPixelCount).toBeGreaterThan(500);
        expect(result?.readback.litForegroundColorCount).toBeGreaterThan(2);
        expect(result?.readback.viewportBytes).toEqual([0, 0, 37, 23]);
    });
}
