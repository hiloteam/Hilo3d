import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import { shaderIncludePlugin } from './vite.config';

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

const dracoDecoderModuleId = 'virtual:hilo3d-draco-decoder';
const resolvedDracoDecoderModuleId = `\0${dracoDecoderModuleId}`;

/** Adapts the upstream browser-only Draco WASM wrapper into a typed ESM module. */
function dracoBrowserDecoderPlugin(): Plugin {
    const decoderDirectory = resolve('node_modules/@loaders.gl/draco/dist/libs');
    const wrapperPath = resolve(decoderDirectory, 'draco_wasm_wrapper.js');
    const wasmPath = resolve(decoderDirectory, 'draco_decoder.wasm');
    return {
        name: 'hilo3d-draco-browser-decoder',
        resolveId(source) {
            return source === dracoDecoderModuleId ? resolvedDracoDecoderModuleId : null;
        },
        load(id) {
            if (id !== resolvedDracoDecoderModuleId) return null;
            const wrapper = readFileSync(wrapperPath, 'utf8');
            const commonJsFooter = wrapper.indexOf(
                '"object"===typeof exports&&"object"===typeof module'
            );
            if (commonJsFooter < 0) {
                throw new Error(
                    'The upstream Draco wrapper no longer has the expected UMD footer.'
                );
            }
            const esmWrapper = wrapper
                .slice(0, commonJsFooter)
                .replaceAll('require("path")', 'undefined')
                .replaceAll('require("fs")', 'undefined');
            if (esmWrapper.includes('require("')) {
                throw new Error('The upstream Draco browser wrapper contains a new Node import.');
            }
            return [
                `import decoderWasmUrl from ${JSON.stringify(`${wasmPath}?url`)};`,
                esmWrapper,
                'export { decoderWasmUrl };',
                'export default DracoDecoderModule;'
            ].join('\n');
        }
    };
}

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
    plugins: [dracoBrowserDecoderPlugin(), shaderIncludePlugin(), copyExampleAssets()],
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
