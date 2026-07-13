import type { CDPSession, ConsoleMessage, Page, Request, Response } from '@playwright/test';

const GPU_DIAGNOSTIC_ERROR =
    /(?:webgl|webgpu|gpu(?:adapter|bindgroup|buffer|command|device|pipeline|queue|sampler|texture)|gl_invalid|validation error|framebuffer[^\n]*(?:incomplete|unsupported)|invalid (?:bind|buffer|command|pipeline|render|sampler|texture)|shader[^\n]*(?:compil|link))/iu;

function recordUnique(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

export interface PageFailureSnapshot {
    readonly consoleErrors: readonly string[];
    readonly graphicsErrors: readonly string[];
    readonly pageErrors: readonly string[];
    readonly failedRequests: readonly string[];
    readonly failedResponses: readonly string[];
}

export interface PageFailureMonitor {
    snapshot(): PageFailureSnapshot;
    assertEmpty(context: string): void;
    dispose(): Promise<void>;
}

/** Observe all browser surfaces that can otherwise hide an asynchronous rendering failure. */
export async function installPageFailureMonitor(page: Page): Promise<PageFailureMonitor> {
    const consoleErrors: string[] = [];
    const graphicsErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const failedResponses: string[] = [];
    const devtools: CDPSession = await page.context().newCDPSession(page);
    await devtools.send('Log.enable');

    devtools.on('Log.entryAdded', ({ entry }) => {
        const description = `${entry.source}: ${entry.text}`;
        if (
            entry.level === 'error' &&
            (entry.source === 'rendering' || GPU_DIAGNOSTIC_ERROR.test(description))
        ) {
            recordUnique(graphicsErrors, description);
        }
    });
    const handleConsole = (message: ConsoleMessage): void => {
        if (message.type() === 'error') recordUnique(consoleErrors, message.text());
    };
    const handlePageError = (error: Error): void => {
        recordUnique(pageErrors, error.message);
    };
    const handleRequestFailed = (request: Request): void => {
        const failure = request.failure()?.errorText ?? 'unknown network failure';
        recordUnique(failedRequests, `${request.method()} ${request.url()}: ${failure}`);
    };
    const handleResponse = (response: Response): void => {
        if (response.status() >= 400) {
            recordUnique(
                failedResponses,
                `${String(response.status())} ${response.request().method()} ${response.url()}`
            );
        }
    };

    page.on('console', handleConsole);
    page.on('pageerror', handlePageError);
    page.on('requestfailed', handleRequestFailed);
    page.on('response', handleResponse);

    let disposed = false;
    const snapshot = (): PageFailureSnapshot => ({
        consoleErrors: [...consoleErrors],
        graphicsErrors: [...graphicsErrors],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
        failedResponses: [...failedResponses]
    });

    return {
        snapshot,
        assertEmpty(context: string): void {
            const failures = snapshot();
            const messages = [
                ...failures.consoleErrors.map(entry => `consoleErrors: ${entry}`),
                ...failures.graphicsErrors.map(entry => `graphicsErrors: ${entry}`),
                ...failures.pageErrors.map(entry => `pageErrors: ${entry}`),
                ...failures.failedRequests.map(entry => `failedRequests: ${entry}`),
                ...failures.failedResponses.map(entry => `failedResponses: ${entry}`)
            ];
            if (messages.length > 0) {
                throw new Error(`${context}:\n${messages.join('\n')}`);
            }
        },
        async dispose(): Promise<void> {
            if (disposed) return;
            disposed = true;
            page.off('console', handleConsole);
            page.off('pageerror', handlePageError);
            page.off('requestfailed', handleRequestFailed);
            page.off('response', handleResponse);
            await devtools.detach();
        }
    };
}
