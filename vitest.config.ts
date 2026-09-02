import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

const coverageRun = process.argv.includes('--coverage');
const githubActionsCoverageRun = coverageRun && process.env['GITHUB_ACTIONS'] === 'true';
const coverageShardRun = process.env['HILO3D_COVERAGE_SHARD'] === 'true';

export default mergeConfig(
    createViteConfig(),
    defineConfig({
        define: {
            __HILO3D_GITHUB_ACTIONS_COVERAGE__: JSON.stringify(githubActionsCoverageRun)
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
            exclude: [
                'test/spec/physics/PhysicsEcsSystem.test.ts',
                'test/spec/physics/RapierPhysics.test.ts',
                ...(coverageRun ? ['test/spec/**/*.native.test.ts'] : [])
            ],
            // Coverage instrumentation already adds substantial Chromium/SwiftShader pressure.
            // Hosted CI keeps one browser file active at a time. Local coverage uses exactly two
            // workers so one long-lived renderer does not accumulate all isolated test files and
            // lose its browser RPC connection before the suite completes.
            fileParallelism: !githubActionsCoverageRun,
            ...(coverageRun ? { maxWorkers: githubActionsCoverageRun ? 1 : 2 } : {}),
            testTimeout: 10_000,
            hookTimeout: 10_000,
            coverage: {
                provider: 'v8',
                include: ['src/**/*.ts'],
                exclude: ['src/**/*.d.ts'],
                reportsDirectory: 'coverage',
                reporter: ['text', 'json-summary', 'html'],
                reportOnFailure: true,
                ...(coverageShardRun
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
                    launchOptions: {
                        args: [
                            '--enable-unsafe-swiftshader',
                            '--enable-unsafe-webgpu',
                            '--use-angle=swiftshader',
                            '--use-webgpu-adapter=swiftshader'
                        ]
                    }
                }),
                instances: [{ browser: 'chromium' }]
            }
        }
    })
);
