import { expect, type Page } from '@playwright/test';
import type { ExampleBackend } from './example-paths';
import { completedRenderCommands, readRenderHealth } from './render-health';

interface CaptureControl {
    waitForFrames(count: number): Promise<void>;
    pause(): Promise<void>;
    resume(): void;
}

type CaptureWindow = Window & { __HILO3D_TEST_CAPTURE__?: CaptureControl };

/** Captures submitted compositor pixels while the example's ticker yields the CPU. */
export async function captureStableFrame(
    page: Page,
    backend: ExampleBackend,
    options: { readonly style?: string; readonly frames?: number } = {}
): Promise<Buffer> {
    const { frames = 0, ...screenshotOptions } = options;
    expect(completedRenderCommands(await readRenderHealth(page), backend)).toBeGreaterThan(0);
    try {
        if (frames > 0) {
            await page.evaluate(async count => {
                const control = (window as CaptureWindow).__HILO3D_TEST_CAPTURE__;
                if (!control) throw new Error('Frame capture requires test=1');
                await control.waitForFrames(count);
            }, frames);
        }
        await page.evaluate(async () => {
            const control = (window as CaptureWindow).__HILO3D_TEST_CAPTURE__;
            if (!control) throw new Error('Stable capture requires an example opened with test=1');
            await control.pause();
        });
        return await page.screenshot({
            animations: 'disabled',
            fullPage: false,
            timeout: 30_000,
            ...screenshotOptions
        });
    } finally {
        if (!page.isClosed()) {
            await page.evaluate(() => {
                (window as CaptureWindow).__HILO3D_TEST_CAPTURE__?.resume();
            });
        }
    }
}
