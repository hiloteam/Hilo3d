import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import { exampleManifestPlugin, shaderIncludePlugin } from './vite.config';

function collectHtmlFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectHtmlFiles(path);
        return entry.name.endsWith('.html') ? [resolve(path)] : [];
    });
}

const htmlInputs = Object.fromEntries(
    collectHtmlFiles('examples').map(path => {
        const name = relative('examples', path).slice(0, -'.html'.length).split(sep).join('/');
        return [name, path];
    })
);

function copyExampleAssets(): Plugin {
    return {
        name: 'hilo3d-example-assets',
        closeBundle() {
            const copyDirectory = (directory: string): void => {
                for (const entry of readdirSync(directory, { withFileTypes: true })) {
                    const source = join(directory, entry.name);
                    if (entry.isDirectory()) {
                        copyDirectory(source);
                        continue;
                    }
                    if (
                        entry.name === '.DS_Store' ||
                        ['.html', '.ts', '.css'].includes(extname(source))
                    ) {
                        continue;
                    }

                    const destination = resolve('dist-examples', source);
                    mkdirSync(dirname(destination), { recursive: true });
                    copyFileSync(source, destination);
                }
            };

            copyDirectory('examples');
        }
    };
}

export default defineConfig({
    appType: 'mpa',
    base: './',
    plugins: [shaderIncludePlugin(), exampleManifestPlugin(), copyExampleAssets()],
    define: {
        HILO3D_VERSION: JSON.stringify(packageJson.version),
        process: 'undefined',
        __filename: 'undefined'
    },
    build: {
        target: 'es2022',
        outDir: 'dist-examples',
        emptyOutDir: true,
        copyPublicDir: false,
        rolldownOptions: {
            input: htmlInputs
        }
    }
});
