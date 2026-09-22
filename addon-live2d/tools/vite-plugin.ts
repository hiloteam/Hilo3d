import { cp } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin, type ResolvedConfig } from 'vite';
import { buildPinnedLive2DRuntime } from './prepare-runtime.js';
import type { BuildLive2DRuntimeResult } from './build-runtime.js';

/** Resolve source-checkout assets; installed packages already contain these beside their loader. */
export function live2DExampleRuntimePlugin(copyBuildNotices = false): Plugin {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const loader = resolve(root, 'addon-live2d/src/runtime/DefaultRuntime.ts');
    const directory = resolve(root, 'addon-live2d/.cache/prebuilt-runtime');
    const inputs = ['vendor', 'src', 'tools'].map(name => resolve(root, 'addon-live2d', name));
    const isInput = (id: string): boolean =>
        inputs.some(path => id === path || id.startsWith(`${path}${sep}`));
    let pending: Promise<BuildLive2DRuntimeResult> | null = null;
    let building: Promise<BuildLive2DRuntimeResult> | null = null;
    let revision = 0;
    let configuration: ResolvedConfig | null = null;
    const prepare = (): Promise<BuildLive2DRuntimeResult> => {
        if (pending === null) {
            const previous = building;
            const requestedRevision = revision;
            const attempt = (async (): Promise<BuildLive2DRuntimeResult> => {
                if (previous !== null) {
                    try {
                        await previous;
                    } catch {
                        /* A corrected input can retry. */
                    }
                }
                return buildPinnedLive2DRuntime(directory);
            })();
            building = attempt;
            const current: Promise<BuildLive2DRuntimeResult> = attempt.then(result =>
                requestedRevision === revision ? result : prepare()
            );
            pending = current;
            void current.catch(() => {
                if (pending === current) pending = null;
            });
        }
        return pending;
    };
    return {
        name: 'hilo3d-live2d-package-assets',
        enforce: 'pre',
        config() {
            // Generated writes must not reload the page while its first model is loading. The
            // explicit source/vendor watchers below own invalidation and reload after rebuilding.
            return { server: { watch: { ignored: [`${normalizePath(directory)}/**`] } } };
        },
        configResolved(config): void {
            configuration = config;
        },
        configureServer(server): void {
            let reloadTimer: ReturnType<typeof setTimeout> | null = null;
            const changed = (id: string): void => {
                if (!isInput(resolve(id))) return;
                const requested = pending !== null;
                revision++;
                pending = null;
                if (!requested && reloadTimer === null) return;
                if (reloadTimer !== null) clearTimeout(reloadTimer);
                reloadTimer = setTimeout(() => {
                    reloadTimer = null;
                    void prepare().then(
                        () => {
                            // Cache files are intentionally unwatched; drop their cached client
                            // transforms before the explicit reload after an input change.
                            server.environments.client.moduleGraph.invalidateAll();
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
            server.watcher.add(inputs);
            for (const event of ['change', 'add', 'unlink'] as const)
                server.watcher.on(event, changed);
            server.httpServer?.once('close', () => {
                if (reloadTimer !== null) clearTimeout(reloadTimer);
                for (const event of ['change', 'add', 'unlink'] as const)
                    server.watcher.off(event, changed);
            });
        },
        async transform(code, id): Promise<string | null> {
            if (normalizePath(id.split('?')[0] ?? '') !== normalizePath(loader)) return null;
            await prepare();
            const assets = relative(dirname(loader), directory).split(sep).join('/');
            // Only rewrite the first-party loader's asset locations. Vite treats the SDK files as
            // opaque URL assets, preserving Core bytes while copying/fingerprinting application files.
            return code.replaceAll("'./prebuilt/", `'${assets}/`);
        },
        watchChange(id): void {
            if (isInput(id)) {
                revision++;
                pending = null;
            }
        },
        async closeBundle(): Promise<void> {
            if (!copyBuildNotices || configuration?.command !== 'build' || pending === null) return;
            await pending;
            const destination = resolve(
                configuration.root,
                configuration.build.outDir,
                'examples/assets/live2d/licenses'
            );
            // Vite already emits both runtime assets through DefaultRuntime's static URLs.
            await cp(resolve(directory, 'licenses'), destination, { recursive: true });
        }
    };
}
