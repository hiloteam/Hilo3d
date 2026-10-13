import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { addonAliases, shaderIncludePlugin } from './vite.config';
import packageJson from './package.json' with { type: 'json' };

function templateManifest(): Plugin {
    return {
        name: 'hilo3d-player-template',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'LICENSE.txt',
                source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8')
            });
            this.emitFile({
                type: 'asset',
                fileName: 'THIRD_PARTY_NOTICES.txt',
                source: [
                    ['gl-matrix', './node_modules/gl-matrix/LICENSE.md'],
                    ['Rapier 3D', './node_modules/@dimforge/rapier3d-compat/LICENSE'],
                    ['web-naga', './node_modules/web-naga/LICENSE']
                ]
                    .map(
                        ([name, path]) =>
                            `${name ?? ''}\n\n${readFileSync(new URL(path ?? '', import.meta.url), 'utf8')}`
                    )
                    .join('\n\n--------------------\n\n')
            });
        },
        writeBundle() {
            // Vite emits transformed HTML after ordinary generateBundle hooks. Inventory the
            // completed output so entry HTML, WASM and license assets are all checksum-covered.
            const directory = fileURLToPath(new URL('./dist-player', import.meta.url));
            const files: { path: string; bytes: number; sha256: string }[] = [];
            const visit = (prefix: string): void => {
                for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
                    const path = `${prefix}${entry.name}`;
                    if (entry.isDirectory()) visit(`${path}/`);
                    else if (entry.isFile() && path !== 'template.json') {
                        const data = readFileSync(join(directory, path));
                        files.push({
                            path,
                            bytes: data.byteLength,
                            sha256: createHash('sha256').update(data).digest('hex')
                        });
                    }
                }
            };
            visit('');
            files.sort((left, right) =>
                left.path < right.path ? -1 : left.path > right.path ? 1 : 0
            );
            writeFileSync(
                join(directory, 'template.json'),
                JSON.stringify({
                    format: 'hilo3d-player-template',
                    version: 1,
                    engineVersion: packageJson.version,
                    files
                })
            );
        }
    };
}

export default defineConfig({
    root: fileURLToPath(new URL('./editor/player', import.meta.url)),
    base: './',
    publicDir: false,
    plugins: [shaderIncludePlugin(), templateManifest()],
    resolve: { alias: [...addonAliases] },
    define: {
        HILO3D_VERSION: JSON.stringify(packageJson.version),
        process: 'undefined',
        __filename: 'undefined'
    },
    build: {
        target: 'es2022',
        outDir: fileURLToPath(new URL('./dist-player', import.meta.url)),
        emptyOutDir: true,
        sourcemap: false
    }
});
