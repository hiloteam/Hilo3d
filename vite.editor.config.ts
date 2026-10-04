import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { shaderIncludePlugin } from './vite.config';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
    base: './',
    plugins: [shaderIncludePlugin()],
    define: { HILO3D_VERSION: JSON.stringify(packageJson.version) },
    server: { host: '127.0.0.1', port: 5174, open: '/editor/' },
    build: {
        target: 'es2022',
        outDir: 'dist-editor',
        assetsDir: 'editor/assets',
        emptyOutDir: true,
        rolldownOptions: {
            input: fileURLToPath(new URL('./editor/index.html', import.meta.url))
        }
    }
});
