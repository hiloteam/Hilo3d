import { expect, type Page } from '@playwright/test';
import type { ExampleBackend } from './example-paths';
import { completedRenderCommands, readRenderHealth } from './render-health';

interface CaptureControl {
    pause(): Promise<void>;
    resume(): void;
}

type CaptureWindow = Window & { __HILO3D_TEST_CAPTURE__?: CaptureControl };

/** Captures submitted compositor pixels while the example's ticker yields the CPU. */
export async function captureStableFrame(
    page: Page,
    backend: ExampleBackend,
    options: { readonly style?: string } = {}
): Promise<Buffer> {
    expect(completedRenderCommands(await readRenderHealth(page), backend)).toBeGreaterThan(0);
    try {
        await page.evaluate(async () => {
            const control = (window as CaptureWindow).__HILO3D_TEST_CAPTURE__;
            if (!control) throw new Error('Stable capture requires an example opened with test=1');
            await control.pause();
        });
        return await page.screenshot({
            animations: 'disabled',
            fullPage: false,
            timeout: 30_000,
            ...options
        });
    } finally {
        if (!page.isClosed()) {
            await page.evaluate(() => {
                (window as CaptureWindow).__HILO3D_TEST_CAPTURE__?.resume();
            });
        }
    }
}
