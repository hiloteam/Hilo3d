import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { captureStableFrame } from './stable-capture';

vi.mock('./render-health', () => ({
    completedRenderCommands: (): number => 1,
    readRenderHealth: (): Promise<[]> => Promise.resolve([])
}));

afterEach(() => vi.unstubAllGlobals());

describe('stable compositor capture cleanup', () => {
    it.each(['success', 'screenshot failure', 'queue failure'])(
        'resumes rendering after %s',
        async outcome => {
            const events: string[] = [];
            vi.stubGlobal('window', {
                __HILO3D_TEST_CAPTURE__: {
                    pause(): Promise<void> {
                        events.push('pause');
                        return outcome === 'queue failure'
                            ? Promise.reject(new Error('queue failed'))
                            : Promise.resolve();
                    },
                    resume(): void {
                        events.push('resume');
                    }
                }
            });
            const page = {
                evaluate: (callback: () => unknown): Promise<unknown> =>
                    Promise.resolve().then(callback),
                screenshot: (): Promise<Buffer> => {
                    events.push('screenshot');
                    if (outcome === 'screenshot failure')
                        return Promise.reject(new Error('capture failed'));
                    return Promise.resolve(Buffer.from('pixels'));
                },
                isClosed: (): boolean => false
            } as unknown as Page;
            const result = captureStableFrame(page, 'webgl2');
            if (outcome === 'success') await expect(result).resolves.toEqual(Buffer.from('pixels'));
            else await expect(result).rejects.toThrow(/failed/u);
            expect(events).toEqual(
                outcome === 'queue failure'
                    ? ['pause', 'resume']
                    : ['pause', 'screenshot', 'resume']
            );
        }
    );
});
