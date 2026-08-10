import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    createExampleCatalog,
    EXAMPLE_CATEGORIES,
    examplesForBackend
} from '../../examples/shared/catalog';
import {
    DEDICATED_RELEASE_TEST_EXAMPLE_PATHS,
    EXAMPLE_COMPLETION_CONTRACTS,
    EXAMPLE_QUERY_PARAMETERS,
    NON_RENDERING_EXAMPLE_PATHS,
    WEBGL2_ONLY_EXAMPLE_PATHS,
    WEBGPU_ONLY_EXAMPLE_PATHS,
    backendsForExample,
    exampleCases,
    examplePaths,
    exampleRequestUrl,
    exampleUsesDedicatedReleaseTest
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
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const genericReleaseTestSource = readFileSync(
    fileURLToPath(new URL('./examples.spec.ts', import.meta.url)),
    'utf8'
);
const dedicatedReleaseTestSource = readFileSync(
    fileURLToPath(new URL('./runtime-parity.spec.ts', import.meta.url)),
    'utf8'
);
const nativeReleaseTestSource = readFileSync(
    fileURLToPath(new URL('./native-webgpu.spec.ts', import.meta.url)),
    'utf8'
);

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
        expect(examplePaths).toHaveLength(77);
    });

    it('expands 77 pages into the complete 146-case backend matrix', () => {
        expect(exampleCases).toHaveLength(146);
        expect(new Set(exampleCases.map(item => `${item.path}:${item.backend}`)).size).toBe(
            exampleCases.length
        );
        for (const path of examplePaths) {
            const expectedBackends =
                path === 'webxr.html'
                    ? ['webgl2']
                    : path === 'bloom.html' ||
                        path === 'clustered_forward_plus_sponza.html' ||
                        path === 'temporal_aa_observatory.html' ||
                        path === 'compute_gpu_driven.html' ||
                        path === 'compute_eclipse_shrine.html' ||
                        path === 'compute_particles.html' ||
                        path === 'compute_raytracing.html'
                      ? ['webgpu']
                      : ['webgl2', 'webgpu'];
            expect(backendsForExample(path), path).toEqual(expectedBackends);
            expect(
                exampleCases.filter(item => item.path === path).map(item => item.backend),
                path
            ).toEqual(expectedBackends);
        }
    });

    it('builds complete, categorized gallery metadata with valid source links', () => {
        const catalog = createExampleCatalog(examplePaths);
        expect(catalog).toHaveLength(75);
        expect(new Set(catalog.map(entry => entry.id)).size).toBe(catalog.length);
        expect(new Set(catalog.map(entry => entry.path))).toEqual(
            new Set(examplePaths.filter(path => path !== 'index.html' && path !== 'list.html'))
        );
        expect(new Set(catalog.map(entry => entry.category))).toEqual(
            new Set(EXAMPLE_CATEGORIES.map(category => category.id))
        );
        expect(catalog[0]?.id).toBe('quickStart');
        expect(examplesForBackend(catalog, 'webgl2')).toHaveLength(68);
        expect(examplesForBackend(catalog, 'webgpu')).toHaveLength(74);
        expect(catalog.filter(entry => entry.featured).length).toBeGreaterThan(12);
        expect(catalog.filter(entry => entry.featured).length).toBeLessThan(catalog.length);
        expect(
            examplesForBackend(catalog, 'webgpu').some(entry => entry.path === 'webxr.html')
        ).toBe(false);
        expect(
            examplesForBackend(catalog, 'webgl2').some(
                entry => entry.path === 'clustered_forward_plus_sponza.html'
            )
        ).toBe(false);
        expect(
            examplesForBackend(catalog, 'webgl2').some(
                entry => entry.path === 'compute_gpu_driven.html'
            )
        ).toBe(false);
        expect(
            examplesForBackend(catalog, 'webgl2').some(
                entry => entry.path === 'compute_eclipse_shrine.html'
            )
        ).toBe(false);
        expect(
            examplesForBackend(catalog, 'webgl2').some(
                entry => entry.path === 'compute_particles.html'
            )
        ).toBe(false);
        expect(
            examplesForBackend(catalog, 'webgl2').some(
                entry => entry.path === 'compute_raytracing.html'
            )
        ).toBe(false);

        for (const entry of catalog) {
            expect(entry.title.length, `${entry.path} title`).toBeGreaterThan(0);
            expect(entry.description.length, `${entry.path} description`).toBeGreaterThan(0);
            expect(
                existsSync(join(examplesDirectory, entry.sourcePath)),
                `${entry.path} source ${entry.sourcePath}`
            ).toBe(true);
        }
    });

    it('uses the curated CC0 HDR environment instead of legacy LDR cube assets', () => {
        const legacyEnvironmentAssets = [
            'bakedDiffuse_01.jpg',
            'bakedDiffuse_02.jpg',
            'bakedDiffuse_03.jpg',
            'bakedDiffuse_04.jpg',
            'bakedDiffuse_05.jpg',
            'bakedDiffuse_06.jpg',
            'px.jpg',
            'nx.jpg',
            'py.jpg',
            'ny.jpg',
            'pz.jpg',
            'nz.jpg'
        ];
        for (const asset of legacyEnvironmentAssets) {
            expect(existsSync(join(examplesDirectory, 'image', asset)), asset).toBe(false);
        }

        const initializationSource = readFileSync(
            join(examplesDirectory, 'shared', 'init.ts'),
            'utf8'
        );
        const environmentSource = readFileSync(
            join(examplesDirectory, 'shared', 'defaultEnvironment.ts'),
            'utf8'
        );
        const environmentDirectory = join(
            examplesDirectory,
            'image',
            'environment',
            'ferndale-studio-03'
        );
        const normalizedEnvironmentSource = environmentSource.replaceAll(/\s+/gu, '');
        expect(initializationSource).toContain('loadDefaultEnvironmentMaps()');
        expect(initializationSource).toContain('loadDefaultSkyboxMap()');
        expect(environmentSource).toContain("const RGBD_MAGIC = 'H3DRGBD1'");
        const runtimeEnvironmentAssets = [
            'diffuse.rgbd',
            'specular.rgbd',
            'right.jpg',
            'left.jpg',
            'top.jpg',
            'bottom.jpg',
            'front.jpg',
            'back.jpg'
        ];
        for (const asset of runtimeEnvironmentAssets) {
            expect(existsSync(join(environmentDirectory, asset)), asset).toBe(true);
            expect(normalizedEnvironmentSource, asset).toContain(
                `newURL('../image/environment/ferndale-studio-03/${asset}',import.meta.url)`
            );
        }
        expect(existsSync(join(environmentDirectory, 'README.md'))).toBe(true);
        expect(environmentSource).not.toContain('ASSET_DIRECTORY');
        expect(`${initializationSource}\n${environmentSource}`).not.toMatch(
            /bakedDiffuse_|(?:^|[/_"'])p[xyz]\.jpg|(?:^|[/_"'])n[xyz]\.jpg/u
        );
    });

    it('keeps renderer and completion exceptions explicit and minimal', () => {
        expect(WEBGL2_ONLY_EXAMPLE_PATHS).toEqual(['webxr.html']);
        expect(WEBGPU_ONLY_EXAMPLE_PATHS).toEqual([
            'bloom.html',
            'clustered_forward_plus_sponza.html',
            'temporal_aa_observatory.html',
            'compute_gpu_driven.html',
            'compute_eclipse_shrine.html',
            'compute_particles.html',
            'compute_raytracing.html'
        ]);
        expect(NON_RENDERING_EXAMPLE_PATHS).toEqual([]);
        expect(DEDICATED_RELEASE_TEST_EXAMPLE_PATHS).toEqual([
            'clustered_forward_plus_sponza.html',
            'shaderToy.html'
        ]);
        expect(exampleUsesDedicatedReleaseTest('clustered_forward_plus_sponza.html')).toBe(true);
        expect(exampleUsesDedicatedReleaseTest('shaderToy.html')).toBe(true);
        expect(exampleUsesDedicatedReleaseTest('quickStart.html')).toBe(false);
        const genericCases = exampleCases.filter(
            item => !exampleUsesDedicatedReleaseTest(item.path)
        );
        const dedicatedCases = DEDICATED_RELEASE_TEST_EXAMPLE_PATHS.flatMap(path =>
            backendsForExample(path).map(backend => ({ path, backend }))
        );
        expect(genericCases).toHaveLength(143);
        expect(
            [...genericCases, ...dedicatedCases].map(item => `${item.path}:${item.backend}`).sort()
        ).toEqual(exampleCases.map(item => `${item.path}:${item.backend}`).sort());
        expect(genericReleaseTestSource).toContain(
            'if (exampleUsesDedicatedReleaseTest(examplePath)) continue;'
        );
        expect(nativeReleaseTestSource).toContain(
            'Sponza Forward+ exposes stable camera and lighting controls @webgpu'
        );
        expect(dedicatedReleaseTestSource).toContain(
            "for (const backend of ['webgl2', 'webgpu'] as const)"
        );
        expect(dedicatedReleaseTestSource).toContain(
            'ShaderToy pointer input stays screen-space on ${backend}'
        );
        expect(EXAMPLE_COMPLETION_CONTRACTS).toEqual({
            'compressed_texture.html': 'compressed-textures',
            'glTFViewer/index.html': 'gltf-viewer',
            'resourceManagerTest.html': 'resource-diagnostics'
        });
        expect(EXAMPLE_QUERY_PARAMETERS).toEqual({
            'compute_eclipse_shrine.html': { test: '1' },
            'glTFViewer/index.html': { url: '/examples/models/Tmall/Tmall.gltf' },
            'temporal_aa_observatory.html': { test: '1' }
        });
        expect(exampleRequestUrl('glTFViewer/index.html', 'webgpu')).toBe(
            '/examples/glTFViewer/index.html?backend=webgpu&url=%2Fexamples%2Fmodels%2FTmall%2FTmall.gltf'
        );
        expect(
            Object.keys(EXAMPLE_COMPLETION_CONTRACTS).every(path => examplePaths.includes(path))
        ).toBe(true);
    });

    it('separates the full local browser matrix from hosted CI presentation coverage', () => {
        const packageJson = JSON.parse(
            readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
        ) as {
            readonly scripts?: Readonly<Record<string, unknown>>;
        };
        expect(packageJson.scripts?.['test:browser']).toBe(
            'npm run test:webgpu && npm run test:ui && npm run test:visual'
        );
        expect(packageJson.scripts?.['test:browser:ci']).toBe(
            'npm run test:ui:webgl2 && npm run test:visual:webgl2'
        );
        expect(packageJson.scripts?.['test:ui:webgl2:ci']).toBe(
            'playwright test test/ui/examples.spec.ts test/ui/post-processing.spec.ts test/ui/runtime-parity.spec.ts test/ui/visual.spec.ts --project=chromium --grep "@webgl2|through webgl2"'
        );
        expect(packageJson.scripts?.['test:visual:webgl2']).toBe(
            'playwright test test/ui/visual.spec.ts --project=chromium --grep "through webgl2"'
        );
        const validateCI = packageJson.scripts?.['validate:ci'];
        expect(validateCI).toBeTypeOf('string');
        if (typeof validateCI !== 'string') throw new TypeError('validate:ci must be a string');
        expect(validateCI).toContain('npm run test:rhi');
        expect(validateCI).toContain('npm run test:browser:ci');
        expect(validateCI).not.toMatch(/npm run test:browser(?:\s|&&|$)/u);
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
