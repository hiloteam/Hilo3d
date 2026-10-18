import { playwright } from '@vitest/browser-playwright';
import type { LaunchOptions } from 'playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';
import { browserCanvasTestPolicy } from './scripts/browser-test-capabilities';

const coverageRun = process.argv.includes('--coverage');
const githubActionsCoverageRun = coverageRun && process.env['GITHUB_ACTIONS'] === 'true';
const coverageShard =
    coverageRun &&
    process.argv.some(argument => argument === '--shard' || argument.startsWith('--shard='));
const monolithicCoverageRun =
    githubActionsCoverageRun && process.env['HILO3D_MONOLITHIC_COVERAGE'] === 'true';
const browserLaunchOptions: LaunchOptions = {
    args: [
        '--enable-unsafe-swiftshader',
        '--enable-unsafe-webgpu',
        '--use-angle=swiftshader',
        '--use-webgpu-adapter=swiftshader'
    ]
};

export default mergeConfig(
    createViteConfig(),
    defineConfig({
        define: {
            __HILO3D_GITHUB_ACTIONS_COVERAGE__: JSON.stringify(githubActionsCoverageRun),
            __HILO3D_BROWSER_CANVAS_TEST_POLICY__: JSON.stringify(
                browserCanvasTestPolicy({
                    platform: process.platform,
                    coverage: coverageRun,
                    chromiumChannel: browserLaunchOptions.channel
                })
            )
        },
        test: {
            name: 'browser',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            setupFiles: ['./test/setup.ts'],
            include: ['test/spec/**/*.test.ts', 'examples/**/*.test.ts'],
            // Native WebGPU owns an actual device and must not share the heavily instrumented
            // coverage process. The dedicated RHI suite runs it immediately afterward.
            exclude: coverageRun ? ['test/spec/**/*.native.test.ts'] : [],
            // Coverage instrumentation already adds substantial Chromium/SwiftShader pressure.
            // Four hosted-CI shards bound each long-lived browser to about 60 isolated files,
            // with one file active at a time. A monolithic release
            // validation and local coverage use exactly two workers so one long-lived renderer
            // does not accumulate all isolated test files and lose its browser RPC connection.
            fileParallelism: !githubActionsCoverageRun || monolithicCoverageRun,
            ...(coverageRun
                ? { maxWorkers: githubActionsCoverageRun && !monolithicCoverageRun ? 1 : 2 }
                : {}),
            testTimeout: 10_000,
            hookTimeout: 10_000,
            coverage: {
                provider: 'v8',
                include: ['src/**/*.ts'],
                exclude: ['src/**/*.d.ts'],
                reportsDirectory: 'coverage',
                reporter: ['text', 'json-summary', 'html'],
                reportOnFailure: true,
                // A partial shard cannot meet a whole-suite coverage contract. The required
                // merge-reports job has no --shard and enforces these unchanged global gates.
                ...(coverageShard
                    ? {}
                    : {
                          thresholds: {
                              branches: 40,
                              functions: 58,
                              lines: 62,
                              statements: 60
                          }
                      })
            },
            browser: {
                enabled: true,
                headless: true,
                provider: playwright({
                    launchOptions: browserLaunchOptions
                }),
                instances: [{ browser: 'chromium' }]
            }
        }
    })
);
