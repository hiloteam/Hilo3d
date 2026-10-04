import { cloneScene, validateTransform, type SceneDocument, type SceneNode } from './scene';
import { validateScript, type ScriptDocument } from './script-types';
import { installScriptWorker, type ScriptWorkerBinding } from './script-worker';
import { installScriptFrame } from './script-frame';

type Transforms = Record<string, SceneNode['transform']>;
interface RuntimeResponse {
    id: number;
    transforms?: unknown;
    logs?: unknown;
    error?: unknown;
}
interface Pending {
    resolve: (value: Transforms) => void;
    reject: (error: Error) => void;
    timer: number;
}
export interface ScriptInput {
    keys: readonly string[];
    pointer: { x: number; y: number; buttons: number };
}

// Only compiled, self-contained TypeScript installers are serialized into the isolated contexts.
const WORKER_SOURCE = `(${installScriptWorker.toString()})(self);`;
const FRAME_SOURCE = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script>(${installScriptFrame.toString()})(window);</script></body></html>`;

/** Explicitly started user scripts run off the UI thread with no DOM/storage/network authority. */
export class ScriptRuntime {
    private frame: HTMLIFrameElement | null = null;
    private port: MessagePort | null = null;
    private sequence = 0;
    private pending: Pending | null = null;
    private activeIds = new Set<string>();
    private baseline: SceneDocument | null = null;
    private readonly input: ScriptInput = { keys: [], pointer: { x: 0, y: 0, buttons: 0 } };
    constructor(
        private readonly onLog: (message: string) => void = () => {
            /* Optional activity sink. */
        }
    ) {}

    async start(
        scene: SceneDocument,
        scripts: Readonly<Record<string, ScriptDocument>>
    ): Promise<Transforms> {
        this.dispose();
        const bindings: ScriptWorkerBinding[] = [];
        for (const [nodeId, node] of Object.entries(scene.nodes))
            for (const scriptId of node.scripts ?? []) {
                const source = scripts[scriptId];
                if (!source) throw new Error(`Missing script ${scriptId}.`);
                const script = validateScript(source);
                if (script.enabled)
                    bindings.push({ nodeId, scriptId, name: script.name, source: script.source });
            }
        if (bindings.length > 256)
            throw new Error('Play mode supports at most 256 active script bindings.');
        this.activeIds = new Set(bindings.map(binding => binding.nodeId));
        this.baseline = cloneScene(scene);
        await this.initialize();
        return this.command('start', scene, 0, 0, bindings);
    }
    setInput(value: ScriptInput): void {
        this.input.keys = value.keys
            .slice(0, 32)
            .filter(key => /^[a-z0-9]$|^Arrow(?:Up|Down|Left|Right)$|^Space$/u.test(key));
        this.input.pointer = {
            x: Math.max(-1, Math.min(1, value.pointer.x)),
            y: Math.max(-1, Math.min(1, value.pointer.y)),
            buttons: value.pointer.buttons & 7
        };
    }
    async step(scene: SceneDocument, dt: number, time: number): Promise<Transforms> {
        if (!Number.isFinite(dt) || dt < 0 || dt > 0.1 || !Number.isFinite(time) || time < 0)
            throw new Error('Invalid simulation step.');
        return this.command('step', scene, dt, time);
    }
    async stop(scene: SceneDocument): Promise<void> {
        try {
            if (this.port && !this.pending) await this.command('stop', scene, 0, 0);
        } finally {
            this.dispose();
        }
    }
    dispose(): void {
        if (this.pending) {
            window.clearTimeout(this.pending.timer);
            this.pending.reject(new Error('Script runtime stopped.'));
            this.pending = null;
        }
        this.port?.postMessage({ type: 'terminate' });
        this.port?.close();
        this.port = null;
        const frame = this.frame;
        this.frame = null;
        if (frame)
            window.setTimeout(() => {
                frame.remove();
            }, 100);
        this.activeIds.clear();
        this.baseline = null;
    }
    private async initialize(): Promise<void> {
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.sandbox.add('allow-scripts');
        frame.title = 'Isolated script runtime';
        frame.srcdoc = FRAME_SOURCE;
        this.frame = frame;
        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.dispose();
                reject(new Error('Script sandbox did not initialize.'));
            }, 3000);
            frame.addEventListener(
                'load',
                () => {
                    if (this.frame !== frame) {
                        window.clearTimeout(timer);
                        reject(new Error('Script startup cancelled.'));
                        return;
                    }
                    const channel = new MessageChannel();
                    this.port = channel.port1;
                    channel.port1.onmessage = event => {
                        const data: unknown = event.data;
                        if (
                            data &&
                            typeof data === 'object' &&
                            Reflect.get(data, 'ready') === true
                        ) {
                            window.clearTimeout(timer);
                            channel.port1.onmessage = message => {
                                this.receive(message.data as unknown);
                            };
                            resolve();
                        } else {
                            window.clearTimeout(timer);
                            this.dispose();
                            reject(new Error('Script worker initialization failed.'));
                        }
                    };
                    frame.contentWindow?.postMessage({ source: WORKER_SOURCE }, '*', [
                        channel.port2
                    ]);
                },
                { once: true }
            );
            document.body.append(frame);
        });
    }
    private command(
        type: 'start' | 'step' | 'stop',
        scene: SceneDocument,
        dt: number,
        time: number,
        bindings: ScriptWorkerBinding[] = []
    ): Promise<Transforms> {
        if (!this.port) return Promise.reject(new Error('Script runtime is not running.'));
        if (this.pending) return Promise.reject(new Error('A script step is already in progress.'));
        const id = ++this.sequence;
        const transforms: Transforms = {};
        const names: Record<string, string> = {};
        for (const nodeId of this.activeIds) {
            const node = scene.nodes[nodeId];
            if (node) {
                transforms[nodeId] = structuredClone(node.transform);
                names[nodeId] = node.name;
            }
        }
        return new Promise<Transforms>((resolve, reject) => {
            const budget = type === 'start' ? 1500 : 250;
            const timer = window.setTimeout(() => {
                const pending = this.pending;
                this.pending = null;
                this.dispose();
                pending?.reject(
                    new Error(
                        `Script exceeded the ${String(budget)} ms execution budget and was terminated.`
                    )
                );
            }, budget);
            this.pending = { resolve, reject, timer };
            this.port?.postMessage({
                id,
                type,
                bindings,
                transforms,
                names,
                input: this.input,
                dt,
                time
            });
        });
    }
    private receive(value: unknown): void {
        if (!this.pending || !value || typeof value !== 'object') return;
        const response = value as RuntimeResponse;
        if (response.id !== this.sequence && response.id !== 0) return;
        const pending = this.pending;
        this.pending = null;
        window.clearTimeout(pending.timer);
        if (Array.isArray(response.logs))
            for (const message of response.logs.slice(0, 32))
                if (typeof message === 'string') this.onLog(message.slice(0, 600));
        if (typeof response.error === 'string') {
            pending.reject(new Error(response.error.slice(0, 1000)));
            this.dispose();
            return;
        }
        try {
            if (
                !response.transforms ||
                typeof response.transforms !== 'object' ||
                Array.isArray(response.transforms) ||
                !this.baseline
            )
                throw new Error('Invalid script response.');
            const prototype: unknown = Object.getPrototypeOf(response.transforms);
            if (prototype !== Object.prototype && prototype !== null)
                throw new Error('Invalid script transform map.');
            const result: Transforms = {};
            for (const [id, transform] of Object.entries(response.transforms)) {
                if (!this.activeIds.has(id) || !Object.hasOwn(this.baseline.nodes, id))
                    throw new Error('Script tried to mutate an unbound object.');
                result[id] = validateTransform(transform, `script.transforms.${id}`);
            }
            pending.resolve(result);
        } catch (error) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
            this.dispose();
        }
    }
}
