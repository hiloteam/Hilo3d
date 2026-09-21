import { copyFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import {
    LIVE2D_EXAMPLE_RUNTIME_DIRECTORY,
    invalidateLive2DExampleRuntime,
    prepareLive2DExampleRuntime,
    type Live2DExampleRuntime
} from './prepare-live2d-example.js';

async function checkedRuntimeFile(
    runtime: Live2DExampleRuntime,
    name: string
): Promise<string | null> {
    const file = runtime.files.get(name);
    if (file === undefined) return null;
    const root = await realpath(runtime.directory);
    const canonical = await realpath(file);
    const local = relative(root, canonical);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
        throw new Error('Live2D runtime asset escaped its generated directory.');
    }
    return canonical;
}

async function serveRuntime(
    request: IncomingMessage,
    response: ServerResponse,
    name: string
): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end();
        return;
    }
    const runtime = await prepareLive2DExampleRuntime();
    const file = await checkedRuntimeFile(runtime, name);
    if (file === null) {
        response.writeHead(404);
        response.end('Live2D runtime asset not found.');
        return;
    }
    const bytes = await readFile(file);
    const extension = extname(file);
    response.writeHead(200, {
        'Content-Type':
            extension === '.js'
                ? 'text/javascript; charset=utf-8'
                : extension === '.json'
                  ? 'application/json; charset=utf-8'
                  : 'text/plain; charset=utf-8',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(bytes);
}

/** Serve generated runtime assets lazily in dev; optionally copy them into the example build. */
export function live2DExampleRuntimePlugin(copyBuildAssets = false): Plugin {
    let configuration: ResolvedConfig | null = null;
    return {
        name: 'hilo3d-live2d-example-runtime',
        ...(copyBuildAssets ? {} : { apply: 'serve' as const }),
        configResolved(config): void {
            configuration = config;
        },
        configureServer(server): void {
            const projectRoot = fileURLToPath(new URL('../', import.meta.url));
            const watched = [
                resolve(projectRoot, 'addon-live2d/src'),
                resolve(projectRoot, 'addon-live2d/tools'),
                resolve(projectRoot, 'third-party/live2d/cubism-5-r.5'),
                resolve(projectRoot, 'third-party/live2d/provenance.json')
            ];
            let requested = false;
            let reloadTimer: ReturnType<typeof setTimeout> | null = null;
            const changed = (path: string): void => {
                const absolute = resolve(path);
                if (
                    !watched.some(
                        directory =>
                            absolute === directory || absolute.startsWith(`${directory}${sep}`)
                    )
                )
                    return;
                invalidateLive2DExampleRuntime();
                if (!requested) return;
                if (reloadTimer !== null) clearTimeout(reloadTimer);
                reloadTimer = setTimeout(() => {
                    reloadTimer = null;
                    void prepareLive2DExampleRuntime().then(
                        () => {
                            server.ws.send({ type: 'full-reload' });
                        },
                        (error: unknown) => {
                            const message = error instanceof Error ? error.message : String(error);
                            server.config.logger.error(message);
                            server.ws.send({ type: 'error', err: { message, stack: '' } });
                        }
                    );
                }, 100);
            };
            server.watcher.add(watched);
            for (const event of ['change', 'add', 'unlink'] as const)
                server.watcher.on(event, changed);
            server.httpServer?.once('close', () => {
                if (reloadTimer !== null) clearTimeout(reloadTimer);
                for (const event of ['change', 'add', 'unlink'] as const)
                    server.watcher.off(event, changed);
            });
            const prefix = `/${LIVE2D_EXAMPLE_RUNTIME_DIRECTORY}/`;
            const basePrefix = server.config.base.startsWith('/')
                ? `${server.config.base.replace(/\/$/u, '')}${prefix}`
                : prefix;
            server.middlewares.use((request, response, next) => {
                const raw = request.url?.split('?')[0] ?? '';
                const match = raw.startsWith(basePrefix)
                    ? basePrefix
                    : raw.startsWith(prefix)
                      ? prefix
                      : null;
                if (match === null) {
                    next();
                    return;
                }
                let name: string;
                try {
                    name = decodeURIComponent(raw.slice(match.length));
                } catch {
                    response.writeHead(400);
                    response.end('Invalid runtime asset path.');
                    return;
                }
                requested = true;
                void serveRuntime(request, response, name).catch((error: unknown) => {
                    server.config.logger.error(
                        error instanceof Error ? error.message : String(error)
                    );
                    if (!response.headersSent) response.writeHead(500);
                    response.end('Live2D runtime preparation failed.');
                });
            });
        },
        async buildStart(): Promise<void> {
            if (copyBuildAssets && configuration?.command === 'build')
                await prepareLive2DExampleRuntime();
        },
        async closeBundle(): Promise<void> {
            if (!copyBuildAssets || configuration?.command !== 'build') return;
            const runtime = await prepareLive2DExampleRuntime();
            const destination = resolve(
                configuration.root,
                configuration.build.outDir,
                LIVE2D_EXAMPLE_RUNTIME_DIRECTORY
            );
            for (const name of runtime.files.keys()) {
                const source = await checkedRuntimeFile(runtime, name);
                if (source === null) throw new Error('Prepared Live2D asset is missing.');
                const target = resolve(destination, name);
                await mkdir(dirname(target), { recursive: true });
                await copyFile(source, target);
            }
        }
    };
}
