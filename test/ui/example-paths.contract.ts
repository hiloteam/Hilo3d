import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    EXAMPLE_COMPLETION_CONTRACTS,
    EXAMPLE_QUERY_PARAMETERS,
    NON_RENDERING_EXAMPLE_PATHS,
    WEBGL2_ONLY_EXAMPLE_PATHS,
    backendsForExample,
    exampleCases,
    examplePaths,
    exampleRequestUrl
} from './example-paths';
import {
    assertStableInstrumentationHealth,
    completedRenderCommands,
    instrumentationErrorMessage,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    unexpectedBackendUsage,
    type FrameRenderHealth
} from './render-health';

const examplesDirectory = fileURLToPath(new URL('../../examples/', import.meta.url));

function collectHtmlFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectHtmlFiles(path);
        return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    });
}

function independentlyDiscoverHtml(): string[] {
    return collectHtmlFiles(examplesDirectory)
        .map(path => relative(examplesDirectory, path).split(sep).join('/'))
        .sort();
}

describe('example release matrix contract', () => {
    it('discovers every HTML entry recursively with no hand-maintained gallery omissions', () => {
        expect(examplePaths).toEqual(independentlyDiscoverHtml());
        expect(new Set(examplePaths).size).toBe(examplePaths.length);
        expect(examplePaths).toHaveLength(78);
    });

    it('expands 78 pages into the complete 155-case backend matrix', () => {
        expect(exampleCases).toHaveLength(155);
        expect(new Set(exampleCases.map(item => `${item.path}:${item.backend}`)).size).toBe(
            exampleCases.length
        );
        for (const path of examplePaths) {
            const expectedBackends = path === 'webxr.html' ? ['webgl2'] : ['webgl2', 'webgpu'];
            expect(backendsForExample(path), path).toEqual(expectedBackends);
            expect(
                exampleCases.filter(item => item.path === path).map(item => item.backend),
                path
            ).toEqual(expectedBackends);
        }
    });

    it('keeps renderer and completion exceptions explicit and minimal', () => {
        expect(WEBGL2_ONLY_EXAMPLE_PATHS).toEqual(['webxr.html']);
        expect(NON_RENDERING_EXAMPLE_PATHS).toEqual(['math.html']);
        expect(EXAMPLE_COMPLETION_CONTRACTS).toEqual({
            'compressed_texture.html': 'compressed-textures',
            'glTFViewer/index.html': 'gltf-viewer',
            'resourceManagerTest.html': 'resource-diagnostics'
        });
        expect(EXAMPLE_QUERY_PARAMETERS).toEqual({
            'glTFViewer/index.html': { url: '/examples/models/Tmall/Tmall.gltf' }
        });
        expect(exampleRequestUrl('glTFViewer/index.html', 'webgpu')).toBe(
            '/examples/glTFViewer/index.html?backend=webgpu&url=%2Fexamples%2Fmodels%2FTmall%2FTmall.gltf'
        );
        expect(
            Object.keys(EXAMPLE_COMPLETION_CONTRACTS).every(path => examplePaths.includes(path))
        ).toBe(true);
    });

    it('keeps WebXR native access controlled and recovers failed or lost sessions', () => {
        const source = readFileSync(join(examplesDirectory, 'webxr.ts'), 'utf8');

        expect(source).not.toMatch(/native\s*\.\s*gl/u);
        expect(source).toMatch(/native\.makeXRCompatible\(\)/u);
        expect(source).toMatch(/native\.createXRWebGLLayer\(/u);
        expect(source).toMatch(/renderer\.on\('webglContextLost'/u);
        expect(source).toMatch(/renderer\.on\('webglContextRestored'/u);
        expect(source).toMatch(/function handleWebGLContextLost[\s\S]*?session\.end\(\)\.catch/u);
        expect(source).toMatch(/ignoredSessionEnds\.add\(session\)/u);
        expect(source).toMatch(/await session\.end\(\)/u);
        expect(source).toMatch(/if \(!webGLContextLost\) restoreWindowPresentation\(\)/u);
    });

    it('requires native draw calls instead of accepting clears or queue submissions', () => {
        const frame = {
            url: 'https://example.test/example.html',
            snapshot: {
                webgl2Contexts: 1,
                webgl2ClearCalls: 4,
                webgl2DrawCalls: 0,
                webgpuCanvasAcquisitions: 3,
                webgpuRenderPasses: 3,
                webgpuDrawCalls: 0,
                webgpuQueueSubmissions: 5,
                instrumentationErrors: []
            }
        } satisfies FrameRenderHealth;
        const health: readonly FrameRenderHealth[] = [frame];

        expect(completedRenderCommands(health, 'webgl2')).toBe(0);
        expect(completedRenderCommands(health, 'webgpu')).toBe(0);

        const withDraws: readonly FrameRenderHealth[] = [
            {
                ...frame,
                snapshot: {
                    ...frame.snapshot,
                    webgl2DrawCalls: 2,
                    webgpuDrawCalls: 7
                }
            }
        ];
        expect(completedRenderCommands(withDraws, 'webgl2')).toBe(2);
        expect(completedRenderCommands(withDraws, 'webgpu')).toBe(7);
        const webglBefore = nativeRenderProgress(health, 'webgl2');
        const webglAfter = nativeRenderProgress(withDraws, 'webgl2');
        expect(nativeRenderProgressAdvanced(webglBefore, webglAfter, 'webgl2')).toBe(true);
        const webgpuBefore = nativeRenderProgress(health, 'webgpu');
        const webgpuDrawWithoutSubmit = nativeRenderProgress(withDraws, 'webgpu');
        expect(nativeRenderProgressAdvanced(webgpuBefore, webgpuDrawWithoutSubmit, 'webgpu')).toBe(
            false
        );
        const drawnFrame = withDraws[0];
        if (!drawnFrame) throw new Error('The native draw contract requires one frame.');
        const withDrawAndSubmit: readonly FrameRenderHealth[] = [
            {
                ...drawnFrame,
                snapshot: {
                    ...drawnFrame.snapshot,
                    webgpuQueueSubmissions: 6
                }
            }
        ];
        expect(
            nativeRenderProgressAdvanced(
                webgpuBefore,
                nativeRenderProgress(withDrawAndSubmit, 'webgpu'),
                'webgpu'
            )
        ).toBe(true);
        expect(
            completedRenderCommands(
                [
                    {
                        ...frame,
                        snapshot: {
                            ...frame.snapshot,
                            webgpuCanvasAcquisitions: 0,
                            webgpuDrawCalls: 7
                        }
                    }
                ],
                'webgpu'
            )
        ).toBe(0);
    });

    it('preserves GPU validation messages from browser-native non-Error objects', () => {
        expect(
            instrumentationErrorMessage({ message: "'fwidth' requires uniform control flow" })
        ).toBe("'fwidth' requires uniform control flow");
        expect(instrumentationErrorMessage(new Error('device lost'))).toBe('device lost');
        expect(instrumentationErrorMessage({ code: 7 })).toBe('[object Object]');
    });

    it('rejects hidden work from the backend that was not selected', () => {
        const health: readonly FrameRenderHealth[] = [
            {
                url: 'https://example.test/mixed-backends.html',
                snapshot: {
                    webgl2Contexts: 1,
                    webgl2ClearCalls: 0,
                    webgl2DrawCalls: 1,
                    webgpuCanvasAcquisitions: 1,
                    webgpuRenderPasses: 1,
                    webgpuDrawCalls: 1,
                    webgpuQueueSubmissions: 1,
                    instrumentationErrors: []
                }
            }
        ];

        expect(unexpectedBackendUsage(health, 'webgpu')).toEqual([
            'https://example.test/mixed-backends.html: selected WebGPU but created 1 WebGL2 context(s)'
        ]);
        expect(unexpectedBackendUsage(health, 'webgl2')).toEqual([
            'https://example.test/mixed-backends.html: selected WebGL2 but issued 4 WebGPU operation(s)'
        ]);
    });

    it('fences GPU queues before sampling delayed uncaptured validation errors', async () => {
        const observations: string[] = [];
        const initialFrame = {
            url: 'https://example.test/delayed-validation.html',
            snapshot: {
                webgl2Contexts: 0,
                webgl2ClearCalls: 0,
                webgl2DrawCalls: 0,
                webgpuCanvasAcquisitions: 1,
                webgpuRenderPasses: 1,
                webgpuDrawCalls: 1,
                webgpuQueueSubmissions: 1,
                instrumentationErrors: []
            }
        } satisfies FrameRenderHealth;
        let health: readonly FrameRenderHealth[] = [initialFrame];

        const finalGate = assertStableInstrumentationHealth(
            'webgpu',
            'delayed WebGPU validation contract',
            {
                waitForStableAnimationFrames: () => {
                    observations.push('stable-frames');
                    return Promise.resolve();
                },
                awaitTrackedGPUQueues: () => {
                    observations.push('gpu-queues');
                    health = [
                        {
                            ...initialFrame,
                            snapshot: {
                                ...initialFrame.snapshot,
                                instrumentationErrors: [
                                    'webgpu.device.uncapturederror: delayed validation failure'
                                ]
                            }
                        }
                    ];
                    return Promise.resolve();
                },
                readRenderHealth: () => {
                    observations.push('final-health');
                    return Promise.resolve(health);
                }
            }
        );

        await expect(finalGate).rejects.toThrow('delayed validation failure');
        expect(observations).toEqual(['stable-frames', 'gpu-queues', 'final-health']);
    });

    it('treats queue fence rejection and device loss as hard final-gate failures', async () => {
        const observations: string[] = [];
        const queueFailure = assertStableInstrumentationHealth('webgpu', 'queue failure', {
            waitForStableAnimationFrames: () => {
                observations.push('stable-frames');
                return Promise.resolve();
            },
            awaitTrackedGPUQueues: () => {
                observations.push('gpu-queues');
                return Promise.reject(new Error('native queue fence rejected'));
            },
            readRenderHealth: () => {
                observations.push('final-health');
                return Promise.resolve([]);
            }
        });
        await expect(queueFailure).rejects.toThrow('native queue fence rejected');
        expect(observations).toEqual(['stable-frames', 'gpu-queues']);

        const lostDeviceFrame: FrameRenderHealth = {
            url: 'https://example.test/device-lost.html',
            snapshot: {
                webgl2Contexts: 0,
                webgl2ClearCalls: 0,
                webgl2DrawCalls: 0,
                webgpuCanvasAcquisitions: 1,
                webgpuRenderPasses: 1,
                webgpuDrawCalls: 1,
                webgpuQueueSubmissions: 1,
                instrumentationErrors: ['webgpu.device.lost: reason=unknown']
            }
        };
        await expect(
            assertStableInstrumentationHealth('webgpu', 'device loss', {
                waitForStableAnimationFrames: () => Promise.resolve(),
                awaitTrackedGPUQueues: () => Promise.resolve(),
                readRenderHealth: () => Promise.resolve([lostDeviceFrame])
            })
        ).rejects.toThrow('webgpu.device.lost: reason=unknown');
    });
});
