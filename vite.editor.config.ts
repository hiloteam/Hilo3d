import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { addonAliases, shaderIncludePlugin } from './vite.config';
import { playerTemplatePlugin } from './scripts/player-template-plugin';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
    base: './',
    plugins: [shaderIncludePlugin(), playerTemplatePlugin()],
    resolve: { alias: [...addonAliases] },
    define: {
        HILO3D_VERSION: JSON.stringify(packageJson.version),
        process: 'undefined',
        __filename: 'undefined'
    },
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
