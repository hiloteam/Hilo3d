import { expect, test } from '@playwright/test';
import { examplePaths } from './example-paths';

test.describe('all examples', () => {
    test.describe.configure({ mode: 'serial' });

    for (const examplePath of examplePaths) {
        test(`${examplePath} loads without browser errors`, async ({ page }) => {
            const consoleErrors: string[] = [];
            const pageErrors: string[] = [];
            const failedRequests: string[] = [];
            const failedResponses: string[] = [];

            page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text());
            });
            page.on('pageerror', error => pageErrors.push(error.message));
            page.on('requestfailed', request => {
                const failure = request.failure()?.errorText ?? 'unknown network failure';
                failedRequests.push(`${request.method()} ${request.url()}: ${failure}`);
            });
            page.on('response', response => {
                if (response.status() >= 400) {
                    failedResponses.push(
                        `${String(response.status())} ${response.request().method()} ${response.url()}`
                    );
                }
            });

            const response = await page.goto(`/examples/${examplePath}`, { waitUntil: 'load' });
            await page.waitForLoadState('networkidle');

            expect(response?.ok(), `HTTP status for ${examplePath}`).toBe(true);

            const contract = await page.evaluate(() => {
                const moduleScripts = [
                    ...document.querySelectorAll<HTMLScriptElement>('script[type="module"]')
                ];
                const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas')];
                return {
                    moduleScriptCount: moduleScripts.length,
                    bodyChildCount: document.body.children.length,
                    canvasSizes: canvases.map(canvas => ({
                        width: canvas.width,
                        height: canvas.height,
                        clientWidth: canvas.clientWidth,
                        clientHeight: canvas.clientHeight
                    }))
                };
            });

            expect(contract.moduleScriptCount).toBeGreaterThan(0);
            expect(contract.bodyChildCount).toBeGreaterThan(0);
            for (const size of contract.canvasSizes) {
                expect(size.width).toBeGreaterThan(0);
                expect(size.height).toBeGreaterThan(0);
                expect(size.clientWidth).toBeGreaterThan(0);
                expect(size.clientHeight).toBeGreaterThan(0);
            }

            expect(pageErrors, `page errors in ${examplePath}`).toEqual([]);
            expect(consoleErrors, `console errors in ${examplePath}`).toEqual([]);
            expect(failedRequests, `failed requests in ${examplePath}`).toEqual([]);
            expect(failedResponses, `HTTP failures in ${examplePath}`).toEqual([]);
        });
    }
});
