import type Engine from '../core/Engine';
import type { Entity } from '../ecs/Entity';
import type World from '../ecs/World';
import Vector3 from '../math/Vector3';
import { getTransformStore } from '../scene/components/Transform';

export interface OrbitControlsOptions {
    readonly enabled?: boolean;
    readonly target?: Vector3;
    readonly distance?: number;
    readonly minDistance?: number;
    readonly maxDistance?: number;
    readonly minPolarAngle?: number;
    readonly maxPolarAngle?: number;
    readonly rotateSpeed?: number;
    readonly zoomSpeed?: number;
    readonly panSpeed?: number;
}

/** ECS camera orbit, dolly, and pan controller over World Transform data. */
export default class OrbitControls {
    readonly engine: Engine;
    readonly world: World;
    readonly camera: Entity;
    readonly target: Vector3;
    enabled: boolean;
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    rotateSpeed: number;
    zoomSpeed: number;
    panSpeed: number;
    private azimuth = 0;
    private polar = Math.PI * 0.5;
    private distance: number;
    private pointerId: number | null = null;
    private pointerX = 0;
    private pointerY = 0;
    private readonly onPointerDownBound = (event: PointerEvent): void => {
        if (!this.enabled || this.pointerId !== null) return;
        this.pointerId = event.pointerId;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.engine.canvas.setPointerCapture(event.pointerId);
    };
    private readonly onPointerMoveBound = (event: PointerEvent): void => {
        if (!this.enabled || event.pointerId !== this.pointerId) return;
        const deltaX = event.clientX - this.pointerX;
        const deltaY = event.clientY - this.pointerY;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        if ((event.buttons & 2) !== 0 || event.shiftKey) this.pan(deltaX, deltaY);
        else this.rotate(deltaX, deltaY);
    };
    private readonly onPointerUpBound = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        this.pointerId = null;
        if (this.engine.canvas.hasPointerCapture(event.pointerId)) {
            this.engine.canvas.releasePointerCapture(event.pointerId);
        }
    };
    private readonly onWheelBound = (event: WheelEvent): void => {
        if (!this.enabled) return;
        event.preventDefault();
        this.dolly(Math.exp(event.deltaY * 0.001 * this.zoomSpeed));
    };

    constructor(engine: Engine, world: World, camera: Entity, options: OrbitControlsOptions = {}) {
        if (!world.isAlive(camera)) throw new ReferenceError('OrbitControls camera is stale.');
        this.engine = engine;
        this.world = world;
        this.camera = camera;
        this.enabled = options.enabled ?? true;
        this.target = options.target?.clone() ?? new Vector3();
        this.distance = options.distance ?? 10;
        this.minDistance = options.minDistance ?? 0.01;
        this.maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
        this.minPolarAngle = options.minPolarAngle ?? 0.001;
        this.maxPolarAngle = options.maxPolarAngle ?? Math.PI - 0.001;
        this.rotateSpeed = options.rotateSpeed ?? 1;
        this.zoomSpeed = options.zoomSpeed ?? 1;
        this.panSpeed = options.panSpeed ?? 1;
        this.validateRanges();
        const canvas = engine.canvas;
        canvas.addEventListener('pointerdown', this.onPointerDownBound);
        canvas.addEventListener('pointermove', this.onPointerMoveBound);
        canvas.addEventListener('pointerup', this.onPointerUpBound);
        canvas.addEventListener('pointercancel', this.onPointerUpBound);
        canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
        this.applyView();
    }

    /** Set target and spherical camera position in one deterministic update. */
    setView(
        target: { readonly x: number; readonly y: number; readonly z: number },
        distance: number,
        azimuth: number,
        polar: number
    ): this {
        this.target.set(target.x, target.y, target.z);
        this.distance = distance;
        this.azimuth = azimuth;
        this.polar = polar;
        this.validateRanges();
        return this.applyView();
    }

    rotate(deltaX: number, deltaY: number): this {
        this.azimuth -= deltaX * 0.005 * this.rotateSpeed;
        this.polar = Math.max(
            this.minPolarAngle,
            Math.min(this.maxPolarAngle, this.polar + deltaY * 0.005 * this.rotateSpeed)
        );
        return this.applyView();
    }

    dolly(scale: number): this {
        if (!Number.isFinite(scale) || scale <= 0) {
            throw new RangeError('OrbitControls dolly scale must be finite and positive.');
        }
        this.distance = Math.max(
            this.minDistance,
            Math.min(this.maxDistance, this.distance * scale)
        );
        return this.applyView();
    }

    pan(deltaX: number, deltaY: number): this {
        const scale = this.distance * 0.001 * this.panSpeed;
        const sin = Math.sin(this.azimuth);
        const cos = Math.cos(this.azimuth);
        this.target.x += (-cos * deltaX + sin * deltaY) * scale;
        this.target.y += deltaY * scale;
        this.target.z += (sin * deltaX + cos * deltaY) * scale;
        return this.applyView();
    }

    destroy(): void {
        const canvas = this.engine.canvas;
        canvas.removeEventListener('pointerdown', this.onPointerDownBound);
        canvas.removeEventListener('pointermove', this.onPointerMoveBound);
        canvas.removeEventListener('pointerup', this.onPointerUpBound);
        canvas.removeEventListener('pointercancel', this.onPointerUpBound);
        canvas.removeEventListener('wheel', this.onWheelBound);
        this.pointerId = null;
    }

    private applyView(): this {
        const sinPolar = Math.sin(this.polar);
        const x = this.target.x + this.distance * sinPolar * Math.sin(this.azimuth);
        const y = this.target.y + this.distance * Math.cos(this.polar);
        const z = this.target.z + this.distance * sinPolar * Math.cos(this.azimuth);
        const forwardX = this.target.x - x;
        const forwardY = this.target.y - y;
        const forwardZ = this.target.z - z;
        const yaw = Math.atan2(-forwardX, -forwardZ);
        const pitch = Math.atan2(forwardY, Math.hypot(forwardX, forwardZ));
        const halfYaw = yaw * 0.5;
        const halfPitch = pitch * 0.5;
        const sinYaw = Math.sin(halfYaw);
        const cosYaw = Math.cos(halfYaw);
        const sinPitch = Math.sin(halfPitch);
        const cosPitch = Math.cos(halfPitch);
        const entityIndex = this.world.entityIndex(this.camera);
        const transforms = getTransformStore(this.world);
        transforms.setPosition(entityIndex, x, y, z);
        transforms.setRotation(
            entityIndex,
            sinPitch * cosYaw,
            cosPitch * sinYaw,
            -sinPitch * sinYaw,
            cosPitch * cosYaw
        );
        return this;
    }

    private validateRanges(): void {
        if (
            !Number.isFinite(this.distance) ||
            this.distance <= 0 ||
            !Number.isFinite(this.minDistance) ||
            this.minDistance <= 0 ||
            this.maxDistance < this.minDistance ||
            this.minPolarAngle < 0 ||
            this.maxPolarAngle > Math.PI ||
            this.maxPolarAngle <= this.minPolarAngle
        ) {
            throw new RangeError('OrbitControls distance or polar limits are invalid.');
        }
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        this.polar = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.polar));
    }
}
