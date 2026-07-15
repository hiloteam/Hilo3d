import { RHIValidationError, type RHIExecutionInteropHost, type RHIViewport } from '../../core';
import type { WebGL2RHIDevice } from './WebGL2Device';
import { WebGL2Surface } from './WebGL2Surface';

interface WebGL2ControlledOperationLease {
    readonly generation: number;
    readonly operation: string;
}

export interface WebGL2NativeExtension {
    readonly state: Readonly<{ bindSystemFramebuffer(): void }>;

    makeXRCompatible(): Promise<void>;
    createXRWebGLLayer(session: object, init?: Readonly<Record<string, unknown>>): object;
    bindExternalFramebuffer(framebuffer: WebGLFramebuffer, width?: number, height?: number): void;
    viewport(x?: number, y?: number, width?: number, height?: number): void;
    renderScene(): void;
}

function positiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
    return value;
}

function currentDevice(host: RHIExecutionInteropHost): WebGL2RHIDevice {
    const device = host.executionDevice;
    if (device.backend !== 'webgl2' || !('nativePresentation' in device)) {
        throw new RHIValidationError(
            'wrong-device',
            'WebGL2 native extension requires the current WebGL2 device generation',
            'extension'
        );
    }
    return device as WebGL2RHIDevice;
}

function currentSurface(host: RHIExecutionInteropHost, device: WebGL2RHIDevice): WebGL2Surface {
    const surface = host.presentationSurface;
    if (!(surface instanceof WebGL2Surface) || surface.owner !== device) {
        throw new RHIValidationError(
            'wrong-device',
            'WebGL2 native extension requires the current presentation surface generation',
            'extension.surface'
        );
    }
    return surface;
}

/** Backend-owned native presentation target and canonical-state ownership protocol. */
export class WebGL2NativePresentationState {
    readonly #systemDrawBuffers: GLenum[];
    readonly #externalDrawBuffers: GLenum[];
    #externalFramebuffer: WebGLFramebuffer | null = null;
    #externalActive = false;
    #viewport: Readonly<RHIViewport> | null = null;
    #controlledOperation: WebGL2ControlledOperationLease | null = null;

    constructor(readonly owner: WebGL2RHIDevice) {
        this.#systemDrawBuffers = [owner.gl.BACK];
        this.#externalDrawBuffers = [owner.gl.COLOR_ATTACHMENT0];
    }

    get framebuffer(): WebGLFramebuffer | null {
        return this.#externalActive ? this.#externalFramebuffer : null;
    }

    get colorAttachment(): GLenum {
        return this.#externalActive ? this.owner.gl.COLOR_ATTACHMENT0 : this.owner.gl.BACK;
    }

    get drawBuffers(): GLenum[] {
        return this.#externalActive ? this.#externalDrawBuffers : this.#systemDrawBuffers;
    }

    get externalActive(): boolean {
        return this.#externalActive;
    }

    get viewport(): Readonly<RHIViewport> | null {
        return this.#externalActive ? this.#viewport : null;
    }

    bindExternalFramebuffer(
        host: RHIExecutionInteropHost,
        framebuffer: WebGLFramebuffer,
        width: number,
        height: number
    ): void {
        const checkedWidth = positiveSafeInteger(width, 'External framebuffer width');
        const checkedHeight = positiveSafeInteger(height, 'External framebuffer height');
        if (framebuffer === null || typeof framebuffer !== 'object') {
            throw new TypeError('External framebuffer must be a WebGLFramebuffer');
        }
        if (!this.owner.gl.isFramebuffer(framebuffer)) {
            throw new RHIValidationError(
                'invalid-state',
                'external framebuffer does not belong to the current WebGL2 context generation',
                'extension.framebuffer'
            );
        }
        host.assertPresentationMutationAllowed('bind an external presentation framebuffer');
        this.assertIdle('bind an external presentation framebuffer');
        const surface = currentSurface(host, this.owner);
        surface.setExternalPresentationExtent(checkedWidth, checkedHeight);

        const viewport = Object.freeze({
            x: 0,
            y: 0,
            width: checkedWidth,
            height: checkedHeight,
            minDepth: 0,
            maxDepth: 1
        });
        this.#externalFramebuffer = framebuffer;
        this.#externalActive = true;
        this.#viewport = viewport;
        this.owner.state.reset();
        this.owner.state.bindFramebuffer(this.owner.gl.FRAMEBUFFER, framebuffer);
        this.owner.gl.drawBuffers(this.#externalDrawBuffers);
        this.owner.state.setViewport(0, 0, checkedWidth, checkedHeight);
        host.setPresentationViewport(viewport);
    }

    bindSystemFramebuffer(host: RHIExecutionInteropHost): void {
        host.assertPresentationMutationAllowed('restore the system presentation framebuffer');
        this.assertIdle('restore the system presentation framebuffer');
        const surface = currentSurface(host, this.owner);
        surface.clearExternalPresentationExtent();
        this.#externalFramebuffer = null;
        this.#externalActive = false;
        this.#viewport = null;
        this.owner.state.reset();
        this.owner.state.bindFramebuffer(this.owner.gl.FRAMEBUFFER, null);
        this.owner.gl.drawBuffers(this.#systemDrawBuffers);
        host.setPresentationViewport(null);
    }

    setViewport(
        host: RHIExecutionInteropHost,
        x?: number,
        y?: number,
        width?: number,
        height?: number
    ): void {
        host.assertPresentationMutationAllowed('change the native presentation viewport');
        this.assertIdle('change the native presentation viewport');
        const surface = currentSurface(host, this.owner);
        const configuration = surface.configuration;
        if (configuration === null) {
            throw new RHIValidationError(
                'invalid-state',
                'presentation surface is unconfigured',
                'extension.viewport'
            );
        }
        const viewportX = nonNegativeSafeInteger(x ?? 0, 'Viewport x');
        const viewportY = nonNegativeSafeInteger(y ?? 0, 'Viewport y');
        const viewportWidth = positiveSafeInteger(
            width ?? configuration.width - viewportX,
            'Viewport width'
        );
        const viewportHeight = positiveSafeInteger(
            height ?? configuration.height - viewportY,
            'Viewport height'
        );
        if (
            viewportX > configuration.width - viewportWidth ||
            viewportY > configuration.height - viewportHeight
        ) {
            throw new RangeError('Viewport rectangle exceeds the presentation extent');
        }
        const viewport = Object.freeze({
            x: viewportX,
            y: viewportY,
            width: viewportWidth,
            height: viewportHeight,
            minDepth: 0,
            maxDepth: 1
        });
        this.#viewport = this.#externalActive ? viewport : null;
        this.owner.state.setViewport(viewportX, viewportY, viewportWidth, viewportHeight);
        host.setPresentationViewport(
            this.#externalActive ||
                x !== undefined ||
                y !== undefined ||
                width !== undefined ||
                height !== undefined
                ? viewport
                : null
        );
    }

    release(): void {
        this.#externalFramebuffer = null;
        this.#externalActive = false;
        this.#viewport = null;
        this.#controlledOperation = null;
    }

    beginControlledOperation(
        host: RHIExecutionInteropHost,
        operation: string
    ): WebGL2ControlledOperationLease {
        host.assertPresentationMutationAllowed(operation);
        this.assertIdle(operation);
        this.owner.state.reset();
        const lease = Object.freeze({ generation: this.owner.generation, operation });
        this.#controlledOperation = lease;
        return lease;
    }

    endControlledOperation(
        host: RHIExecutionInteropHost,
        lease: WebGL2ControlledOperationLease
    ): void {
        if (this.#controlledOperation !== lease) {
            throw new RHIValidationError(
                'invalid-state',
                `${lease.operation} completed after its WebGL2 interop lease became stale`,
                'extension'
            );
        }
        this.#controlledOperation = null;
        const current = host.executionDevice;
        if (
            current !== this.owner ||
            this.owner.destroyed ||
            this.owner.generation !== lease.generation
        ) {
            throw new RHIValidationError(
                'invalid-state',
                `${lease.operation} completed for a stale WebGL2 device generation`,
                'extension'
            );
        }
        host.assertPresentationMutationAllowed(lease.operation);
        this.assertIdle(lease.operation);
        this.owner.state.reset();
    }

    assertFrameAvailable(): void {
        const lease = this.#controlledOperation;
        if (lease !== null) {
            throw new RHIValidationError(
                'invalid-state',
                `cannot begin a frame while ${lease.operation} is pending`,
                'queue'
            );
        }
    }

    private assertIdle(operation: string): void {
        if (this.#controlledOperation !== null) {
            throw new RHIValidationError(
                'invalid-state',
                `cannot ${operation} while ${this.#controlledOperation.operation} is pending`,
                'extension'
            );
        }
        if (this.owner.graphicsQueue.state !== 'idle') {
            throw new RHIValidationError(
                'invalid-state',
                `cannot ${operation} while the graphics queue is ${this.owner.graphicsQueue.state}`,
                'extension'
            );
        }
    }
}

class WebGL2NativeExtensionImplementation implements WebGL2NativeExtension {
    readonly state: Readonly<{ bindSystemFramebuffer(): void }>;
    readonly #host: RHIExecutionInteropHost;

    constructor(host: RHIExecutionInteropHost) {
        this.#host = host;
        this.state = Object.freeze({
            bindSystemFramebuffer: () => {
                const device = currentDevice(this.#host);
                device.nativePresentation.bindSystemFramebuffer(this.#host);
            }
        });
    }

    async makeXRCompatible(): Promise<void> {
        const device = currentDevice(this.#host);
        const operation = 'make the WebGL2 context XR compatible';
        const lease = device.nativePresentation.beginControlledOperation(this.#host, operation);
        let failure: unknown;
        try {
            const makeCompatible: unknown = Reflect.get(device.gl, 'makeXRCompatible');
            if (typeof makeCompatible !== 'function') {
                throw new Error('WebXR context compatibility is unavailable');
            }
            await Reflect.apply(makeCompatible, device.gl, []);
        } catch (error) {
            failure = error;
        }
        device.nativePresentation.endControlledOperation(this.#host, lease);
        if (failure !== undefined) throw failure;
    }

    createXRWebGLLayer(session: object, init?: Readonly<Record<string, unknown>>): object {
        const device = currentDevice(this.#host);
        const operation = 'create an XR WebGL presentation layer';
        const lease = device.nativePresentation.beginControlledOperation(this.#host, operation);
        let layer: object;
        try {
            const Layer: unknown = Reflect.get(globalThis, 'XRWebGLLayer');
            if (typeof Layer !== 'function') throw new Error('XRWebGLLayer is unavailable');
            layer = Reflect.construct(Layer, [session, device.gl, init]) as object;
        } finally {
            device.nativePresentation.endControlledOperation(this.#host, lease);
        }
        return layer;
    }

    bindExternalFramebuffer(framebuffer: WebGLFramebuffer, width?: number, height?: number): void {
        const device = currentDevice(this.#host);
        device.nativePresentation.bindExternalFramebuffer(
            this.#host,
            framebuffer,
            width ?? device.gl.drawingBufferWidth,
            height ?? device.gl.drawingBufferHeight
        );
    }

    viewport(x?: number, y?: number, width?: number, height?: number): void {
        const device = currentDevice(this.#host);
        device.nativePresentation.setViewport(this.#host, x, y, width, height);
    }

    renderScene(): void {
        currentDevice(this.#host);
        this.#host.executeRetainedPresentation();
    }
}

const EXTENSIONS = new WeakMap<RHIExecutionInteropHost, WebGL2NativeExtension>();

export function resolveWebGL2NativeExtension(
    device: WebGL2RHIDevice,
    name: string,
    host: RHIExecutionInteropHost
): object | null {
    if (name !== 'webgl2-native') return null;
    if (host.executionDevice !== device) {
        throw new RHIValidationError(
            'wrong-device',
            'interop host does not reference this device generation',
            'extension'
        );
    }
    let extension = EXTENSIONS.get(host);
    if (extension === undefined) {
        extension = new WebGL2NativeExtensionImplementation(host);
        EXTENSIONS.set(host, extension);
    }
    return extension;
}
