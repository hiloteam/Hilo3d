import * as Hilo3d from '../../src/Hilo3d';

interface OrbitControlsOptions {
    model?: hilo3d.Node;
    isLockZ?: boolean;
    isLockScale?: boolean;
    isLockRotate?: boolean;
    isLockMove?: boolean;
    rotationXLimit?: number;
    eulerOrder?: string;
}

interface PointerState {
    startX: number;
    startY: number;
    startPointerDistance: number;
    isDown: boolean;
    state: number;
}

const tempEuler = new Hilo3d.Euler();
tempEuler.order = 'XYZ';
const tempQuaternion = new Hilo3d.Quaternion();
const tempVector = new Hilo3d.Vector3();
const MOUSE = { LEFT: 0, RIGHT: 2 } as const;
const STATE = { NONE: -1, MOVE: 0, ZOOM: 1, PAN: 2 } as const;

/** Mouse and touch orbit controls shared by the examples. */
class OrbitControls {
    readonly stage: hilo3d.Stage;
    readonly canvas: HTMLCanvasElement;
    readonly model: hilo3d.Node;
    readonly isLockZ: boolean;
    readonly isLockScale: boolean;
    readonly isLockRotate: boolean;
    readonly isLockMove: boolean;
    readonly rotationXLimit: number | undefined;
    readonly mouseInfo: PointerState = {
        startX: 0,
        startY: 0,
        startPointerDistance: 0,
        isDown: false,
        state: STATE.NONE
    };
    isEnabled = false;
    onScale?: (scale: number) => void;

    constructor(stage: hilo3d.Stage, modelOrOptions: hilo3d.Node | OrbitControlsOptions = {}) {
        const options = modelOrOptions instanceof Hilo3d.Node
            ? { model: modelOrOptions }
            : modelOrOptions;

        this.stage = stage;
        this.canvas = stage.canvas;
        this.model = options.model ?? stage;
        this.isLockZ = options.isLockZ ?? false;
        this.isLockScale = options.isLockScale ?? false;
        this.isLockRotate = options.isLockRotate ?? false;
        this.isLockMove = options.isLockMove ?? false;
        this.rotationXLimit = options.rotationXLimit;

        if (options.eulerOrder) tempEuler.order = options.eulerOrder;
        if (this.isLockZ) {
            tempEuler.x = this.model.rotationX * Math.PI / 180;
            tempEuler.y = this.model.rotationY * Math.PI / 180;
        }

        this.enable();
    }

    private readonly preventContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    enable(): void {
        if (this.isEnabled) return;
        this.isEnabled = true;
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

        if ('ontouchmove' in window) {
            this.canvas.addEventListener('touchstart', this.onPointerDown, { passive: false });
            this.canvas.addEventListener('touchmove', this.onPointerMove, { passive: false });
            this.canvas.addEventListener('touchend', this.onPointerUp);
        } else {
            document.addEventListener('contextmenu', this.preventContextMenu);
            this.canvas.addEventListener('mousedown', this.onPointerDown);
            this.canvas.addEventListener('mousemove', this.onPointerMove);
            this.canvas.addEventListener('mouseup', this.onPointerUp);
        }
    }

    disable(): void {
        if (!this.isEnabled) return;
        this.isEnabled = false;
        this.mouseInfo.isDown = false;
        this.mouseInfo.state = STATE.NONE;
        this.canvas.removeEventListener('wheel', this.onWheel);

        if ('ontouchmove' in window) {
            this.canvas.removeEventListener('touchstart', this.onPointerDown);
            this.canvas.removeEventListener('touchmove', this.onPointerMove);
            this.canvas.removeEventListener('touchend', this.onPointerUp);
        } else {
            document.removeEventListener('contextmenu', this.preventContextMenu);
            this.canvas.removeEventListener('mousedown', this.onPointerDown);
            this.canvas.removeEventListener('mousemove', this.onPointerMove);
            this.canvas.removeEventListener('mouseup', this.onPointerUp);
        }
    }

    rotate(distanceX: number, distanceY: number): void {
        if (this.isLockRotate) return;
        const x = distanceY / 200;
        const y = distanceX / 200;

        if (this.isLockZ) {
            tempEuler.x += x;
            tempEuler.y += y;
            if (this.rotationXLimit !== undefined) {
                tempEuler.x = Math.max(-this.rotationXLimit, Math.min(this.rotationXLimit, tempEuler.x));
            }
            this.model.quaternion.fromEuler(tempEuler);
            return;
        }

        tempEuler.set(x, y, 0);
        tempQuaternion.fromEuler(tempEuler);
        this.model.quaternion.premultiply(tempQuaternion);
    }

    scale(scale: number): void {
        if (this.isLockScale) return;
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

    private readonly onPointerDown = (event: Event): void => {
        this.mouseInfo.isDown = true;

        if (event instanceof TouchEvent) {
            const firstTouch = event.touches[0];
            if (!firstTouch) return;
            this.mouseInfo.startX = firstTouch.pageX;
            this.mouseInfo.startY = firstTouch.pageY;

            if (event.touches.length === 1) {
                this.mouseInfo.state = STATE.MOVE;
            } else if (event.touches.length === 2) {
                const secondTouch = event.touches[1];
                if (!secondTouch) return;
                this.mouseInfo.startPointerDistance = Math.hypot(
                    secondTouch.pageX - firstTouch.pageX,
                    secondTouch.pageY - firstTouch.pageY
                );
                this.mouseInfo.state = STATE.ZOOM;
            } else if (event.touches.length >= 3) {
                this.mouseInfo.state = STATE.PAN;
            }
            return;
        }

        if (!(event instanceof MouseEvent)) return;
        if (event.button !== MOUSE.LEFT && event.button !== MOUSE.RIGHT) return;
        this.mouseInfo.startX = event.pageX;
        this.mouseInfo.startY = event.pageY;
        this.mouseInfo.state = event.button === MOUSE.RIGHT ? STATE.PAN : STATE.MOVE;
    };

    private readonly onPointerMove = (event: Event): void => {
        if (!this.mouseInfo.isDown) return;
        event.preventDefault();
        event.stopPropagation();

        if (event instanceof TouchEvent) {
            if (this.mouseInfo.state === STATE.MOVE) this.handleTouchMove(event);
            else if (this.mouseInfo.state === STATE.ZOOM) this.handleTouchZoom(event);
            else if (this.mouseInfo.state === STATE.PAN) this.handleTouchPan(event);
            return;
        }

        if (!(event instanceof MouseEvent)) return;
        if (this.mouseInfo.state === STATE.MOVE) this.handlePointerMove(event);
        else if (this.mouseInfo.state === STATE.PAN) this.handleMousePan(event);
    };

    private readonly onPointerUp = (): void => {
        this.mouseInfo.isDown = false;
        this.mouseInfo.state = STATE.NONE;
    };

    private readonly onWheel = (event: Event): void => {
        event.preventDefault();
        const wheelEvent = event as WheelEvent;
        const delta = Math.max(-90, Math.min(90, wheelEvent.deltaY));
        this.scale(1 / (1 + delta * 0.001));
    };

    private handleMousePan(event: MouseEvent): void {
        const distanceX = event.pageX - this.mouseInfo.startX;
        const distanceY = event.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = event.pageX;
        this.mouseInfo.startY = event.pageY;
        this.model.worldMatrix.getScaling(tempVector);
        this.move(distanceX * 2 * tempVector.x, distanceY * 2 * tempVector.y);
    }

    private handlePointerMove(pointer: Pick<MouseEvent | Touch, 'pageX' | 'pageY'>): void {
        const distanceX = pointer.pageX - this.mouseInfo.startX;
        const distanceY = pointer.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = pointer.pageX;
        this.mouseInfo.startY = pointer.pageY;
        this.rotate(distanceX, distanceY);
    }

    private handleTouchZoom(event: TouchEvent): void {
        const firstTouch = event.touches[0];
        const secondTouch = event.touches[1];
        if (!firstTouch || !secondTouch) return;
        const distance = Math.hypot(
            secondTouch.pageX - firstTouch.pageX,
            secondTouch.pageY - firstTouch.pageY
        );
        const scale = distance / this.mouseInfo.startPointerDistance;
        this.mouseInfo.startPointerDistance = distance;
        if (Number.isFinite(scale) && scale !== 1) this.scale(scale);
    }

    private handleTouchPan(event: TouchEvent): void {
        const touch = event.touches[0];
        if (!touch) return;
        const distanceX = touch.pageX - this.mouseInfo.startX;
        const distanceY = touch.pageY - this.mouseInfo.startY;
        this.mouseInfo.startX = touch.pageX;
        this.mouseInfo.startY = touch.pageY;
        this.move(distanceX * 0.01, -distanceY * 0.01);
    }

    private handleTouchMove(event: TouchEvent): void {
        const touch = event.touches[0];
        if (touch) this.handlePointerMove(touch);
    }

    bindEvent(): void {
        // Kept for backwards compatibility with older examples.
    }
}

declare global {
    interface Window {
        OrbitControls: typeof OrbitControls;
    }
}

window.OrbitControls = OrbitControls;

export type { OrbitControlsOptions };
export default OrbitControls;
