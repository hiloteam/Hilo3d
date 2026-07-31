import PerspectiveCamera from '../camera/PerspectiveCamera';
import type Stage from '../core/Stage';
import Vector3 from '../math/Vector3';

/** Configuration for {@link OrbitControls}. */
export interface OrbitControlsOptions {
    /** Perspective camera to control. Defaults to the Stage primary camera. */
    camera?: PerspectiveCamera;
    /** Orbit center in the camera parent's coordinate space. */
    target?: Vector3;
    /** Whether event listeners are attached immediately. Defaults to `true`. */
    enabled?: boolean;
    /** Whether pointer gestures can orbit the camera. Defaults to `true`. */
    enableRotate?: boolean;
    /** Whether wheel and pinch gestures can dolly the camera. Defaults to `true`. */
    enableZoom?: boolean;
    /** Whether secondary-drag, Shift-drag, and two-finger gestures can pan. Defaults to `true`. */
    enablePan?: boolean;
    /** Orbit sensitivity multiplier. Defaults to `1`. */
    rotateSpeed?: number;
    /** Dolly sensitivity multiplier. Defaults to `1`. */
    zoomSpeed?: number;
    /** Pan sensitivity multiplier. Defaults to `1`. */
    panSpeed?: number;
    /** Minimum camera distance from the target. Defaults to the camera near plane. */
    minDistance?: number;
    /** Maximum camera distance from the target. Defaults to positive infinity. */
    maxDistance?: number;
    /** Minimum polar orbit angle in radians. */
    minPolarAngle?: number;
    /** Maximum polar orbit angle in radians. */
    maxPolarAngle?: number;
}

interface PointerPosition {
    x: number;
    y: number;
}

const POLAR_EPSILON = 1e-5;
const MIN_DISTANCE_EPSILON = 1e-6;

function requireNonNegative(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite non-negative number.`);
    }
    return value;
}

function requireFiniteVector(vector: Vector3, name: string): void {
    if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
        throw new RangeError(`${name} must contain finite coordinates.`);
    }
}

/**
 * Camera-centric orbit, dolly, and pan controls for a {@link PerspectiveCamera}.
 *
 * Mouse: drag to orbit, right-drag or Shift-drag to pan, and wheel to dolly.
 * Touch: drag with one finger to orbit, or use two fingers to pan and pinch-to-dolly.
 */
export default class OrbitControls {
    /** Stage that owns the controlled canvas and default camera. */
    readonly stage: Stage;
    /** Canvas that receives pointer, wheel, and touch events. */
    readonly canvas: HTMLCanvasElement;
    /** Perspective camera manipulated by these controls. */
    readonly camera: PerspectiveCamera;
    /** Mutable orbit center in the camera parent's coordinate space. */
    readonly target: Vector3;

    /** Whether orbit gestures are accepted. */
    enableRotate: boolean;
    /** Whether dolly gestures are accepted. */
    enableZoom: boolean;
    /** Whether pan gestures are accepted. */
    enablePan: boolean;
    /** Orbit sensitivity multiplier. */
    rotateSpeed: number;
    /** Dolly sensitivity multiplier. */
    zoomSpeed: number;
    /** Pan sensitivity multiplier. */
    panSpeed: number;
    /** Minimum camera distance from the target. */
    minDistance: number;
    /** Maximum camera distance from the target. */
    maxDistance: number;
    /** Minimum polar orbit angle in radians. */
    minPolarAngle: number;
    /** Maximum polar orbit angle in radians. */
    maxPolarAngle: number;
    /** Whether browser event listeners are currently attached. */
    isEnabled = false;
    /** Optional callback invoked after the controls change the camera view. */
    onChange: (() => void) | undefined;

    private readonly initialCameraPosition: Vector3;
    private readonly initialTarget: Vector3;
    private readonly pointers = new Map<number, PointerPosition>();
    private readonly offset = new Vector3();
    private readonly right = new Vector3();
    private readonly up = new Vector3();
    private readonly panOffset = new Vector3();
    private readonly initialTouchAction: string;

    /** Create controls for a stage and optionally attach their browser event listeners. */
    constructor(stage: Stage, options: OrbitControlsOptions = {}) {
        const camera = options.camera ?? stage.camera;
        if (!(camera instanceof PerspectiveCamera)) {
            throw new TypeError('OrbitControls requires a PerspectiveCamera.');
        }

        this.stage = stage;
        this.canvas = stage.canvas;
        this.camera = camera;
        this.target = options.target?.clone() ?? new Vector3();
        this.enableRotate = options.enableRotate ?? true;
        this.enableZoom = options.enableZoom ?? true;
        this.enablePan = options.enablePan ?? true;
        this.rotateSpeed = requireNonNegative(options.rotateSpeed ?? 1, 'rotateSpeed');
        this.zoomSpeed = requireNonNegative(options.zoomSpeed ?? 1, 'zoomSpeed');
        this.panSpeed = requireNonNegative(options.panSpeed ?? 1, 'panSpeed');
        this.minDistance = requireNonNegative(
            options.minDistance ?? Math.max(camera.near, MIN_DISTANCE_EPSILON),
            'minDistance'
        );
        this.maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
        this.minPolarAngle = options.minPolarAngle ?? POLAR_EPSILON;
        this.maxPolarAngle = options.maxPolarAngle ?? Math.PI - POLAR_EPSILON;
        this.initialTouchAction = this.canvas.style.touchAction;

        requireFiniteVector(this.target, 'target');
        this.validateLimits();
        this.update();
        this.initialCameraPosition = this.camera.position.clone();
        this.initialTarget = this.target.clone();

        if (options.enabled ?? true) this.enable();
    }

    /** Attach pointer, wheel, touch, and context-menu listeners to the canvas. */
    enable(): void {
        if (this.isEnabled) return;
        this.isEnabled = true;
        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        this.canvas.addEventListener('pointermove', this.handlePointerMove);
        this.canvas.addEventListener('pointerup', this.handlePointerEnd);
        this.canvas.addEventListener('pointercancel', this.handlePointerEnd);
        this.canvas.addEventListener('lostpointercapture', this.handlePointerEnd);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this.preventContextMenu);
    }

    /** Detach all listeners and restore the canvas touch-action style. */
    disable(): void {
        if (!this.isEnabled) return;
        this.isEnabled = false;
        for (const pointerId of this.pointers.keys()) {
            if (this.canvas.hasPointerCapture(pointerId)) {
                this.canvas.releasePointerCapture(pointerId);
            }
        }
        this.pointers.clear();
        this.canvas.style.touchAction = this.initialTouchAction;
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerEnd);
        this.canvas.removeEventListener('pointercancel', this.handlePointerEnd);
        this.canvas.removeEventListener('lostpointercapture', this.handlePointerEnd);
        this.canvas.removeEventListener('wheel', this.handleWheel);
        this.canvas.removeEventListener('contextmenu', this.preventContextMenu);
    }

    /** Release the browser event listeners owned by these controls. */
    dispose(): void {
        this.disable();
    }

    /** Reorient the camera toward the target and enforce the configured orbit limits. */
    update(): void {
        const { radius, polarAngle, azimuthAngle } = this.readSpherical();
        this.applySpherical(radius, polarAngle, azimuthAngle);
    }

    /** Replace the orbit center and reorient the camera toward it. */
    setTarget(target: Vector3): void {
        requireFiniteVector(target, 'target');
        this.target.copy(target);
        this.update();
    }

    /**
     * Set a complete camera view while applying the configured orbit limits.
     *
     * This is useful for scripted tours that should share the same camera contract as pointer
     * interaction.
     */
    setView(position: Vector3, target: Vector3): void {
        requireFiniteVector(position, 'position');
        requireFiniteVector(target, 'target');
        this.target.copy(target);
        this.camera.position.copy(position);
        this.update();
    }

    /** Orbit by a pointer delta measured in CSS pixels. */
    rotate(deltaX: number, deltaY: number): void {
        if (!this.enableRotate || (!deltaX && !deltaY)) return;
        const viewportHeight = Math.max(this.canvas.clientHeight, this.canvas.height, 1);
        const { radius, polarAngle, azimuthAngle } = this.readSpherical();
        const radiansPerPixel = (Math.PI * 2 * this.rotateSpeed) / viewportHeight;
        this.applySpherical(
            radius,
            polarAngle - deltaY * radiansPerPixel,
            azimuthAngle - deltaX * radiansPerPixel
        );
    }

    /**
     * Move the camera toward its target. Values above one zoom in; values below one zoom out.
     */
    dolly(scale: number): void {
        if (!this.enableZoom || !Number.isFinite(scale) || scale <= 0 || scale === 1) return;
        const { radius, polarAngle, azimuthAngle } = this.readSpherical();
        this.applySpherical(radius / scale, polarAngle, azimuthAngle);
    }

    /** Pan in screen pixels while preserving the camera-to-target offset. */
    pan(deltaX: number, deltaY: number): void {
        if (!this.enablePan || (!deltaX && !deltaY)) return;
        const { radius } = this.readSpherical();
        const viewportHeight = Math.max(this.canvas.clientHeight, this.canvas.height, 1);
        const worldUnitsPerPixel =
            (2 * radius * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportHeight;
        const amount = worldUnitsPerPixel * this.panSpeed;

        this.camera.lookAt(this.target);
        this.right.set(1, 0, 0).transformQuat(this.camera.quaternion);
        this.up.set(0, 1, 0).transformQuat(this.camera.quaternion);
        this.panOffset
            .copy(this.right)
            .scale(-deltaX * amount)
            .scaleAndAdd(deltaY * amount, this.up);

        this.target.add(this.panOffset);
        this.camera.position.add(this.panOffset);
        this.camera.lookAt(this.target);
        this.onChange?.();
    }

    /** Restore the camera position and target captured at construction time. */
    reset(): void {
        this.target.copy(this.initialTarget);
        this.camera.position.copy(this.initialCameraPosition);
        this.camera.lookAt(this.target);
        this.onChange?.();
    }

    private validateLimits(): void {
        if (
            (this.maxDistance !== Number.POSITIVE_INFINITY && !Number.isFinite(this.maxDistance)) ||
            this.maxDistance < this.minDistance ||
            this.maxDistance <= 0
        ) {
            throw new RangeError('maxDistance must be positive and at least minDistance.');
        }
        if (
            !Number.isFinite(this.minPolarAngle) ||
            !Number.isFinite(this.maxPolarAngle) ||
            this.minPolarAngle < 0 ||
            this.maxPolarAngle > Math.PI ||
            this.minPolarAngle > this.maxPolarAngle ||
            this.minPolarAngle >= Math.PI - POLAR_EPSILON ||
            this.maxPolarAngle <= POLAR_EPSILON
        ) {
            throw new RangeError(
                'Polar angle limits must define a non-singular range within 0..PI.'
            );
        }
    }

    private readSpherical(): {
        radius: number;
        polarAngle: number;
        azimuthAngle: number;
    } {
        this.offset.subtract(this.camera.position, this.target);
        const radius = this.offset.length();
        if (radius <= MIN_DISTANCE_EPSILON) {
            return {
                radius: Math.max(this.minDistance, MIN_DISTANCE_EPSILON),
                polarAngle: Math.PI / 2,
                azimuthAngle: 0
            };
        }
        return {
            radius,
            polarAngle: Math.acos(Math.max(-1, Math.min(1, this.offset.y / radius))),
            azimuthAngle: Math.atan2(this.offset.x, this.offset.z)
        };
    }

    private applySpherical(radius: number, polarAngle: number, azimuthAngle: number): void {
        const clampedRadius = Math.max(this.minDistance, Math.min(this.maxDistance, radius));
        const clampedPolar = Math.max(
            Math.max(POLAR_EPSILON, this.minPolarAngle),
            Math.min(Math.min(Math.PI - POLAR_EPSILON, this.maxPolarAngle), polarAngle)
        );
        const sinPolar = Math.sin(clampedPolar);

        this.camera.position.set(
            this.target.x + clampedRadius * sinPolar * Math.sin(azimuthAngle),
            this.target.y + clampedRadius * Math.cos(clampedPolar),
            this.target.z + clampedRadius * sinPolar * Math.cos(azimuthAngle)
        );
        this.camera.lookAt(this.target);
        this.onChange?.();
    }

    private readonly preventContextMenu = (event: Event): void => {
        event.preventDefault();
    };

    private readonly handlePointerDown = (event: PointerEvent): void => {
        event.preventDefault();
        this.canvas.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    };

    private readonly handlePointerMove = (event: PointerEvent): void => {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;

        event.preventDefault();
        const previousGesture = this.readGesture();
        previous.x = event.clientX;
        previous.y = event.clientY;

        if (this.pointers.size >= 2) {
            const currentGesture = this.readGesture();
            this.pan(
                currentGesture.centerX - previousGesture.centerX,
                currentGesture.centerY - previousGesture.centerY
            );
            if (previousGesture.distance > 0) {
                this.dolly(currentGesture.distance / previousGesture.distance);
            }
            return;
        }

        const deltaX = event.clientX - previousGesture.centerX;
        const deltaY = event.clientY - previousGesture.centerY;
        if ((event.buttons & 2) !== 0 || event.shiftKey) this.pan(deltaX, deltaY);
        else this.rotate(deltaX, deltaY);
    };

    private readonly handlePointerEnd = (event: PointerEvent): void => {
        this.pointers.delete(event.pointerId);
        if (event.type !== 'lostpointercapture' && this.canvas.hasPointerCapture(event.pointerId)) {
            this.canvas.releasePointerCapture(event.pointerId);
        }
    };

    private readonly handleWheel = (event: WheelEvent): void => {
        event.preventDefault();
        const delta =
            event.deltaY *
            (event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? 16
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                  ? Math.max(this.canvas.clientHeight, 1)
                  : 1);
        this.dolly(Math.exp(-delta * 0.001 * this.zoomSpeed));
    };

    private readGesture(): { centerX: number; centerY: number; distance: number } {
        const [first, second] = this.pointers.values();
        if (!first) return { centerX: 0, centerY: 0, distance: 0 };
        if (!second) return { centerX: first.x, centerY: first.y, distance: 0 };
        return {
            centerX: (first.x + second.x) * 0.5,
            centerY: (first.y + second.y) * 0.5,
            distance: Math.hypot(second.x - first.x, second.y - first.y)
        };
    }
}
