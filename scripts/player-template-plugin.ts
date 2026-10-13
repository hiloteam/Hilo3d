import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist-player');
const mime: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain; charset=utf-8'
};

/** Serve one production Player in development and carry exactly that artifact into Studio builds. */
export function playerTemplatePlugin(includeInBuild = true): Plugin {
    let preparation: Promise<void> | undefined;
    return {
        name: 'hilo3d-studio-player-template',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const route = new URL(request.url ?? '/', 'http://localhost').pathname;
                const marker = '/editor/player-template/';
                if (!route.startsWith(marker)) {
                    next();
                    return;
                }
                preparation ??= build({
                    configFile: resolve(root, 'vite.player.config.ts'),
                    logLevel: 'warn'
                }).then(() => undefined);
                void preparation
                    .then(async () => {
                        const path = resolve(
                            output,
                            decodeURIComponent(route.slice(marker.length))
                        );
                        if (!path.startsWith(`${output}${sep}`))
                            throw new Error('Invalid template path');
                        const body = await readFile(path);
                        response.writeHead(200, {
                            'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
                            'Cache-Control': 'no-store'
                        });
                        response.end(body);
                    })
                    .catch((error: unknown) => {
                        preparation = undefined;
                        response.writeHead(500, { 'Content-Type': 'text/plain' });
                        response.end(error instanceof Error ? error.message : String(error));
                    });
            });
        },
        async generateBundle() {
            if (!includeInBuild) return;
            const copy = async (directory: string, prefix: string): Promise<void> => {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    const path = resolve(directory, entry.name);
                    const name = `${prefix}${entry.name}`;
                    if (entry.isDirectory()) await copy(path, `${name}/`);
                    else if (entry.isFile()) {
                        this.emitFile({
                            type: 'asset',
                            fileName: `editor/player-template/${name}`,
                            source: await readFile(path)
                        });
                    }
                }
            };
            await copy(output, '');
        }
    };
}
