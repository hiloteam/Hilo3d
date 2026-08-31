import type Stage from './Stage';

/** Stage plugin ABI implemented by this Hilo3D release. */
export const STAGE_PLUGIN_API_VERSION = 1 as const;

/** Typed identity used by plugins to publish services without string-key collisions. */
export class StagePluginService<T> {
    /** Human-readable token name used in diagnostics. */
    readonly name: string;
    declare private readonly serviceType: T;

    constructor(name: string) {
        if (name.trim().length === 0) {
            throw new TypeError('Stage plugin service names cannot be empty.');
        }
        this.name = name;
    }
}

/** Create a typed service identity shared by a provider and its consumers. */
export function createStagePluginService<T>(name: string): StagePluginService<T> {
    return new StagePluginService<T>(name);
}

/** Immutable metadata used for dependency validation before plugin setup begins. */
export interface StagePluginDescriptor {
    /** Stable, package-qualified plugin identity. */
    readonly id: string;
    /** Plugin implementation version for diagnostics. */
    readonly version: string;
    /** Exact Hilo3D plugin ABI expected by this plugin. */
    readonly apiVersion: typeof STAGE_PLUGIN_API_VERSION;
    /** Plugin identities that must be present and initialized first. */
    readonly requires?: readonly string[];
}

/** Context available only while a plugin factory is being initialized. */
export interface StagePluginSetupContext {
    /** Stage that owns this plugin runtime. */
    readonly stage: Stage;
    /** Publish one service for this runtime. A token may have only one provider. */
    provide<T>(service: StagePluginService<T>, value: T): void;
    /** Read a required service published by an initialized dependency. */
    get<T>(service: StagePluginService<T>): T;
    /** Read an optional service published by an initialized dependency. */
    getOptional<T>(service: StagePluginService<T>): T | undefined;
}

/** Synchronous hooks owned by one initialized Stage plugin. */
export interface StagePluginRuntime {
    /** Run before scene-node updates for a frame. */
    beforeUpdate?(deltaTimeMilliseconds: number): void;
    /** Run after scene-node updates for a frame. */
    afterUpdate?(deltaTimeMilliseconds: number): void;
    /** Run immediately before rendering a frame. */
    beforeRender?(): void;
    /** Run after each render attempt, including a failed render. */
    afterRender?(): void;
    /** Release resources owned by this runtime. */
    destroy?(): void;
}

/** Reusable factory. Each Stage receives a distinct runtime from `setup()`. */
export interface StagePlugin {
    /** Versioned identity and dependency metadata. */
    readonly descriptor: StagePluginDescriptor;
    /** Create a fresh runtime for one Stage. */
    setup(context: StagePluginSetupContext): StagePluginRuntime | Promise<StagePluginRuntime>;
}

interface InstalledStagePlugin {
    readonly plugin: StagePlugin;
    readonly runtime: StagePluginRuntime;
    readonly services: readonly StagePluginService<unknown>[];
}

function readRuntimeProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key);
}

function validatePluginRuntime(value: unknown, pluginId: string): StagePluginRuntime {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`Stage plugin ${pluginId} returned no runtime.`);
    }
    for (const hook of [
        'beforeUpdate',
        'afterUpdate',
        'beforeRender',
        'afterRender',
        'destroy'
    ] as const) {
        const callback = readRuntimeProperty(value, hook);
        if (callback !== undefined && typeof callback !== 'function') {
            throw new TypeError(
                `Stage plugin ${pluginId} runtime hook ${hook} must be a function.`
            );
        }
    }
    return value;
}

function validatePluginDescriptor(descriptor: StagePluginDescriptor): void {
    if (descriptor.id.trim().length === 0) {
        throw new TypeError('Stage plugin ids cannot be empty.');
    }
    if (descriptor.version.trim().length === 0) {
        throw new TypeError(`Stage plugin ${descriptor.id} must declare a version.`);
    }
    if (readRuntimeProperty(descriptor, 'apiVersion') !== STAGE_PLUGIN_API_VERSION) {
        throw new TypeError(
            `Stage plugin ${descriptor.id} targets API ${String(descriptor.apiVersion)}; Hilo3D requires ${String(STAGE_PLUGIN_API_VERSION)}.`
        );
    }
    const dependencies = descriptor.requires ?? [];
    if (new Set(dependencies).size !== dependencies.length) {
        throw new TypeError(`Stage plugin ${descriptor.id} declares duplicate dependencies.`);
    }
    if (dependencies.includes(descriptor.id)) {
        throw new TypeError(`Stage plugin ${descriptor.id} cannot depend on itself.`);
    }
}

function sortPlugins(plugins: readonly StagePlugin[]): StagePlugin[] {
    const pluginsById = new Map<string, StagePlugin>();
    for (const plugin of plugins) {
        validatePluginDescriptor(plugin.descriptor);
        const id = plugin.descriptor.id;
        if (pluginsById.has(id)) throw new TypeError(`Duplicate Stage plugin ${id}.`);
        pluginsById.set(id, plugin);
    }

    for (const plugin of plugins) {
        for (const dependency of plugin.descriptor.requires ?? []) {
            if (!pluginsById.has(dependency)) {
                throw new TypeError(
                    `Stage plugin ${plugin.descriptor.id} requires missing plugin ${dependency}.`
                );
            }
        }
    }

    const sorted: StagePlugin[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (plugin: StagePlugin): void => {
        const id = plugin.descriptor.id;
        if (visited.has(id)) return;
        if (visiting.has(id)) {
            throw new TypeError(`Stage plugin dependency cycle includes ${id}.`);
        }
        visiting.add(id);
        for (const dependency of plugin.descriptor.requires ?? []) {
            const requiredPlugin = pluginsById.get(dependency);
            if (requiredPlugin) visit(requiredPlugin);
        }
        visiting.delete(id);
        visited.add(id);
        sorted.push(plugin);
    };
    for (const plugin of plugins) visit(plugin);
    return sorted;
}

/**
 * Per-Stage plugin owner. It validates dependencies before setup, rolls back partial setup, keeps
 * frame hooks synchronous, and destroys runtimes in reverse dependency order.
 */
export class StagePluginHost {
    /** Stage that owns this plugin host. */
    readonly stage: Stage;
    private readonly installed = new Map<string, InstalledStagePlugin>();
    private readonly installationOrder: InstalledStagePlugin[] = [];
    private readonly services = new Map<StagePluginService<unknown>, unknown>();
    private dispatching = false;
    private initializing = false;
    private settingUp = false;
    private destroyingRuntime = false;
    private initialized = false;
    private destroyed = false;

    constructor(stage: Stage) {
        this.stage = stage;
    }

    /** Initialize an entire plugin set transactionally. Intended for `Stage.create()`. */
    async initialize(plugins: readonly StagePlugin[]): Promise<void> {
        this.requireMutable('initialize plugins');
        if (this.initialized) {
            throw new Error('Stage plugins have already been initialized.');
        }
        this.initialized = true;
        this.initializing = true;
        try {
            const sorted = sortPlugins(plugins);
            for (const plugin of sorted) await this.installResolved(plugin);
        } catch (cause) {
            this.initializing = false;
            try {
                this.destroy();
            } catch (rollbackCause) {
                throw new AggregateError(
                    [cause, rollbackCause],
                    'Stage plugin setup and rollback both failed.',
                    { cause: rollbackCause }
                );
            }
            throw cause;
        } finally {
            this.initializing = false;
        }
    }

    /** Install one plugin after its declared dependencies are already active. */
    async install(plugin: StagePlugin): Promise<void> {
        this.requireMutable('install a plugin');
        validatePluginDescriptor(plugin.descriptor);
        const id = plugin.descriptor.id;
        if (this.installed.has(id)) throw new TypeError(`Stage plugin ${id} is already installed.`);
        for (const dependency of plugin.descriptor.requires ?? []) {
            if (!this.installed.has(dependency)) {
                throw new TypeError(`Stage plugin ${id} requires missing plugin ${dependency}.`);
            }
        }
        await this.installResolved(plugin);
    }

    /** Remove one leaf plugin. Dependants must be removed first. */
    uninstall(id: string): void {
        this.requireMutable('uninstall a plugin');
        const installed = this.installed.get(id);
        if (!installed) return;
        for (const candidate of this.installationOrder) {
            if (candidate.plugin.descriptor.requires?.includes(id)) {
                throw new Error(
                    `Cannot uninstall Stage plugin ${id} while ${candidate.plugin.descriptor.id} depends on it.`
                );
            }
        }
        this.destroyInstalled(installed);
    }

    /** Return whether a plugin identity is currently installed. */
    has(id: string): boolean {
        return this.installed.has(id);
    }

    /** Read an installed plugin runtime for diagnostics or explicit extension APIs. */
    getRuntime(id: string): StagePluginRuntime | undefined {
        return this.installed.get(id)?.runtime;
    }

    /** Read a required typed service published by an installed plugin. */
    get<T>(service: StagePluginService<T>): T {
        if (!this.services.has(service)) {
            throw new Error(`Stage plugin service ${service.name} is not available.`);
        }
        return this.services.get(service) as T;
    }

    /** Read a typed service when its provider is optional. */
    getOptional<T>(service: StagePluginService<T>): T | undefined {
        return this.services.get(service) as T | undefined;
    }

    /** Dispatch the pre-update hook in dependency order. */
    runBeforeUpdate(deltaTimeMilliseconds: number): void {
        this.dispatch(runtime => runtime.beforeUpdate?.(deltaTimeMilliseconds));
    }

    /** Dispatch the post-update hook in dependency order. */
    runAfterUpdate(deltaTimeMilliseconds: number): void {
        this.dispatch(runtime => runtime.afterUpdate?.(deltaTimeMilliseconds));
    }

    /** Dispatch the pre-render hook in dependency order. */
    runBeforeRender(): void {
        this.dispatch(runtime => runtime.beforeRender?.());
    }

    /** Dispatch the post-render hook in dependency order. */
    runAfterRender(): void {
        this.dispatch(runtime => runtime.afterRender?.());
    }

    /** Destroy every runtime and its published services in reverse dependency order. */
    destroy(): void {
        if (this.destroyed) return;
        if (this.destroyingRuntime) {
            throw new Error('Cannot destroy Stage plugins recursively.');
        }
        if (this.dispatching)
            throw new Error('Cannot destroy Stage plugins while hooks are running.');
        this.destroyed = true;
        const errors: unknown[] = [];
        for (const installed of [...this.installationOrder].reverse()) {
            try {
                this.destroyInstalled(installed);
            } catch (cause) {
                errors.push(cause);
            }
        }
        if (errors.length > 0)
            throw new AggregateError(errors, 'One or more Stage plugins failed to destroy.');
    }

    private async installResolved(plugin: StagePlugin): Promise<void> {
        const publishedServices = new Map<StagePluginService<unknown>, unknown>();
        let setupActive = true;
        const context: StagePluginSetupContext = {
            stage: this.stage,
            provide: <T>(service: StagePluginService<T>, value: T): void => {
                if (!setupActive) {
                    throw new Error('Stage plugin services can only be published during setup.');
                }
                if (this.services.has(service) || publishedServices.has(service)) {
                    throw new TypeError(
                        `Stage plugin service ${service.name} already has a provider.`
                    );
                }
                publishedServices.set(service, value);
            },
            get: <T>(service: StagePluginService<T>): T => {
                if (publishedServices.has(service)) {
                    return publishedServices.get(service) as T;
                }
                return this.get(service);
            },
            getOptional: <T>(service: StagePluginService<T>): T | undefined => {
                if (publishedServices.has(service)) {
                    return publishedServices.get(service) as T;
                }
                return this.getOptional(service);
            }
        };
        this.settingUp = true;
        try {
            const runtimeValue: unknown = await plugin.setup(context);
            const runtime = validatePluginRuntime(runtimeValue, plugin.descriptor.id);
            if (this.destroyed) {
                try {
                    runtime.destroy?.();
                } catch (destroyCause) {
                    throw new AggregateError(
                        [destroyCause],
                        `Stage plugin ${plugin.descriptor.id} finished setup after its Stage was destroyed and its runtime failed to destroy.`,
                        { cause: destroyCause }
                    );
                }
                throw new Error(
                    `Stage plugin ${plugin.descriptor.id} finished setup after its Stage was destroyed.`
                );
            }
            for (const [service, value] of publishedServices) {
                this.services.set(service, value);
            }
            const installed: InstalledStagePlugin = {
                plugin,
                runtime,
                services: [...publishedServices.keys()]
            };
            this.installed.set(plugin.descriptor.id, installed);
            this.installationOrder.push(installed);
        } catch (cause) {
            for (const service of publishedServices.keys()) this.services.delete(service);
            throw cause;
        } finally {
            setupActive = false;
            this.settingUp = false;
        }
    }

    private destroyInstalled(installed: InstalledStagePlugin): void {
        if (this.destroyingRuntime) {
            throw new Error('Stage plugin runtimes cannot be destroyed recursively.');
        }
        this.destroyingRuntime = true;
        try {
            installed.runtime.destroy?.();
        } finally {
            const id = installed.plugin.descriptor.id;
            this.installed.delete(id);
            const index = this.installationOrder.indexOf(installed);
            if (index >= 0) this.installationOrder.splice(index, 1);
            for (const service of installed.services) this.services.delete(service);
            this.destroyingRuntime = false;
        }
    }

    private dispatch(callback: (runtime: StagePluginRuntime) => void): void {
        if (this.destroyed || this.installationOrder.length === 0) return;
        if (this.dispatching)
            throw new Error('Stage plugin hooks cannot be dispatched recursively.');
        this.dispatching = true;
        try {
            for (const installed of this.installationOrder) callback(installed.runtime);
        } finally {
            this.dispatching = false;
        }
    }

    private requireMutable(operation: string): void {
        if (this.destroyed)
            throw new Error(`Cannot ${operation} after the Stage plugin host is destroyed.`);
        if (this.initializing || this.settingUp) {
            throw new Error(`Cannot ${operation} while Stage plugins are being initialized.`);
        }
        if (this.destroyingRuntime) {
            throw new Error(`Cannot ${operation} while a Stage plugin runtime is being destroyed.`);
        }
        if (this.dispatching)
            throw new Error(`Cannot ${operation} while Stage plugin hooks are running.`);
    }
}
