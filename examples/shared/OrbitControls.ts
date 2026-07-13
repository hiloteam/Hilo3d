import * as Hilo3d from '../../src/Hilo3d';
import type { EulerOrder } from '../../src/math/Euler';

export interface OrbitControlsOptions {
    model?: Hilo3d.Node;
    isLockZ?: boolean;
    isLockScale?: boolean;
    isLockRotate?: boolean;
    isLockMove?: boolean;
    rotationXLimit?: number;
    eulerOrder?: EulerOrder;
}

interface PointerPosition {
    x: number;
    y: number;
}

const tempEuler = new Hilo3d.Euler();
tempEuler.order = 'XYZ';
const tempQuaternion = new Hilo3d.Quaternion();
const tempVector = new Hilo3d.Vector3();

/** Pointer Events based orbit controls shared by the examples. */
export default class OrbitControls {
    readonly stage: Hilo3d.Stage<Hilo3d.RendererBackend>;
    readonly canvas: HTMLCanvasElement;
    readonly model: Hilo3d.Node;
    isLockZ: boolean;
    isLockScale: boolean;
    isLockRotate: boolean;
    isLockMove: boolean;
    rotationXLimit: number | undefined;
    isEnabled = false;
    onScale: ((scale: number) => void) | undefined;

    private readonly pointers = new Map<number, PointerPosition>();
    private pointerDistance = 0;

    constructor(
        stage: Hilo3d.Stage<Hilo3d.RendererBackend>,
        modelOrOptions: Hilo3d.Node | OrbitControlsOptions = {}
    ) {
        const options =
            modelOrOptions instanceof Hilo3d.Node ? { model: modelOrOptions } : modelOrOptions;

        this.stage = stage;
        this.canvas = stage.canvas;
        this.model = options.model ?? stage;
        this.isLockZ = options.isLockZ ?? false;
        this.isLockScale = options.isLockScale ?? false;
        this.isLockRotate = options.isLockRotate ?? false;
        this.isLockMove = options.isLockMove ?? false;
        this.rotationXLimit = options.rotationXLimit;

        if (options.eulerOrder !== undefined) tempEuler.order = options.eulerOrder;
        if (this.isLockZ) {
            tempEuler.x = (this.model.rotationX * Math.PI) / 180;
            tempEuler.y = (this.model.rotationY * Math.PI) / 180;
        }

        this.enable();
    }

    enable(): void {
        if (this.isEnabled) return;
        this.isEnabled = true;
        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        this.canvas.addEventListener('pointermove', this.handlePointerMove);
        this.canvas.addEventListener('pointerup', this.handlePointerEnd);
        this.canvas.addEventListener('pointercancel', this.handlePointerEnd);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this.preventContextMenu);
    }

    disable(): void {
        if (!this.isEnabled) return;
        this.isEnabled = false;
        this.pointers.clear();
        this.pointerDistance = 0;
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerEnd);
        this.canvas.removeEventListener('pointercancel', this.handlePointerEnd);
        this.canvas.removeEventListener('wheel', this.handleWheel);
        this.canvas.removeEventListener('contextmenu', this.preventContextMenu);
    }

    rotate(distanceX: number, distanceY: number): void {
        if (this.isLockRotate) return;
        const x = distanceY / 200;
        const y = distanceX / 200;

        if (this.isLockZ) {
            tempEuler.x += x;
            tempEuler.y += y;
            if (this.rotationXLimit !== undefined) {
                tempEuler.x = Math.max(
                    -this.rotationXLimit,
                    Math.min(this.rotationXLimit, tempEuler.x)
                );
            }
            this.model.quaternion.fromEuler(tempEuler);
            return;
        }

        tempEuler.set(x, y, 0);
        tempQuaternion.fromEuler(tempEuler);
        this.model.quaternion.premultiply(tempQuaternion);
    }

    scale(scale: number): void {
        if (this.isLockScale || !Number.isFinite(scale) || scale <= 0) return;
        this.model.scaleX *= scale;
        this.model.scaleY *= scale;
        this.model.scaleZ *= scale;
        this.onScale?.(scale);
    }

    move(x: number, y: number): void {
        if (this.isLockMove) return;
        this.model.x += x;
        this.model.y += y;
    }

    private readonly preventContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    private readonly handlePointerDown = (event: PointerEvent): void => {
        event.preventDefault();
        this.canvas.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.pointerDistance = this.getPointerDistance();
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;

        event.preventDefault();
        const current = { x: event.clientX, y: event.clientY };
        this.pointers.set(event.pointerId, current);

        if (this.pointers.size >= 2) {
            const distance = this.getPointerDistance();
            if (this.pointerDistance > 0) this.scale(distance / this.pointerDistance);
            this.pointerDistance = distance;
            return;
        }

        const distanceX = current.x - previous.x;
        const distanceY = current.y - previous.y;
        if (event.button === 2 || event.buttons === 2) {
            this.model.worldMatrix.getScaling(tempVector);
            this.move(distanceX * 2 * tempVector.x, distanceY * 2 * tempVector.y);
        } else {
            this.rotate(distanceX, distanceY);
        }
    };

    private readonly handlePointerEnd = (event: PointerEvent): void => {
        this.pointers.delete(event.pointerId);
        if (this.canvas.hasPointerCapture(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId);
        }
        this.pointerDistance = this.getPointerDistance();
    };

    private readonly handleWheel = (event: WheelEvent): void => {
        event.preventDefault();
        const delta = Math.max(-90, Math.min(90, event.deltaY));
        this.scale(1 / (1 + delta * 0.001));
    };

    private getPointerDistance(): number {
        const [first, second] = [...this.pointers.values()];
        return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
    }
}
