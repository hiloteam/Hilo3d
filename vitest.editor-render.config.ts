import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createViteConfig } from './vite.config';

/** Real editor GPU/resource contracts run independently of the instrumented engine coverage process. */
export default mergeConfig(
    createViteConfig(),
    defineConfig({
        test: {
            name: 'editor-render',
            globals: false,
            clearMocks: true,
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
            include: ['test/editor-render/**/*.test.ts'],
            fileParallelism: false,
            testTimeout: 10_000,
            hookTimeout: 10_000,
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
