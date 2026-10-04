import { Euler, Matrix4, Quaternion, Ray, Vector3, type PerspectiveCamera } from '../src/Hilo3d';
import type { SceneDocument, SceneNode, Vec3 } from './scene';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
export type TransformAxis = 'x' | 'y' | 'z';
export type TransformHandle = TransformAxis | 'xy' | 'xz' | 'yz' | 'screen' | 'uniform';
export interface TransformGesture {
    phase: 'preview' | 'commit' | 'cancel';
    transforms: Record<string, SceneNode['transform']>;
}
type Transform = SceneNode['transform'];
const AXES = ['x', 'y', 'z'] as const;
const BASIS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const COLORS = { x: '#ef7474', y: '#a9d27c', z: '#76a8f4' };
const EPSILON = 1e-6;
const SVG_NS = 'http://www.w3.org/2000/svg';

function vector(value: Vec3): Vector3 {
    return new Vector3(value.x, value.y, value.z);
}
function rounded(value: number): number {
    return Math.round(value * 1e6) / 1e6;
}
function components(value: Vector3): Vec3 {
    return { x: rounded(value.x), y: rounded(value.y), z: rounded(value.z) };
}
function rotation(value: Vec3): Quaternion {
    return new Quaternion().fromEuler(new Euler().setDegree(value.x, value.y, value.z));
}
function degrees(value: Quaternion): Vec3 {
    const euler = new Euler().fromQuat(value.normalize());
    return { x: rounded(euler.degX), y: rounded(euler.degY), z: rounded(euler.degZ) };
}
function cloneTransform(value: Transform): Transform {
    return {
        position: { ...value.position },
        rotation: { ...value.rotation },
        scale: { ...value.scale }
    };
}
function matrix(value: Transform): Matrix4 {
    return new Matrix4().compose(
        rotation(value.rotation),
        vector(value.position),
        vector(value.scale)
    );
}

/** Snap gesture deltas, preserving a node's authored offset from the snap lattice. */
export function snapTransformValue(value: number, step: number, enabled: boolean): number {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0)
        throw new RangeError('Invalid transform snap value.');
    return enabled ? Math.round(value / step) * step : value;
}

/** Excludes selected descendants so a selected hierarchy receives a transform only once. */
export function transformRoots(scene: SceneDocument, selected: readonly string[]): string[] {
    const selection = new Set(selected.filter(id => scene.nodes[id] !== undefined));
    return [...selection].filter(id => {
        let node = scene.nodes[id];
        if (!node || node.locked || !node.visible) return false;
        while (node.parent) {
            if (selection.has(node.parent)) return false;
            node = scene.nodes[node.parent];
            if (!node || node.locked || !node.visible) return false;
        }
        return true;
    });
}

interface TransformTarget {
    readonly id: string;
    readonly original: Transform;
    readonly world: Matrix4;
    readonly parentInverse: Matrix4;
}
export interface TransformSnapshot {
    readonly targets: readonly TransformTarget[];
    readonly pivot: Vector3;
    readonly axes: Readonly<Record<TransformAxis, Vector3>>;
    readonly space: TransformSpace;
}

/** Captures immutable local values and parent frames at the start of a drag. */
export function createTransformSnapshot(
    scene: SceneDocument,
    selected: readonly string[],
    space: TransformSpace
): TransformSnapshot {
    const worldMatrices = new Map<string, Matrix4>();
    const worldRotations = new Map<string, Quaternion>();
    const visiting = new Set<string>();
    const resolve = (id: string): Matrix4 => {
        const cached = worldMatrices.get(id);
        if (cached) return cached;
        const node = scene.nodes[id];
        if (!node || visiting.has(id))
            throw new Error('Transform hierarchy has a missing parent or cycle.');
        visiting.add(id);
        const world = matrix(node.transform);
        const quaternion = rotation(node.transform.rotation);
        if (node.parent) {
            world.premultiply(resolve(node.parent));
            const parentRotation = worldRotations.get(node.parent);
            if (parentRotation) quaternion.premultiply(parentRotation);
        }
        visiting.delete(id);
        worldMatrices.set(id, world);
        worldRotations.set(id, quaternion);
        return world;
    };
    const targets = transformRoots(scene, selected).map(id => {
        const node = scene.nodes[id];
        if (!node) throw new Error('Transform selection changed.');
        const parentWorld = node.parent ? resolve(node.parent) : new Matrix4();
        if (Math.abs(parentWorld.determinant()) < 1e-12)
            throw new Error('Cannot transform inside a singular parent.');
        return {
            id,
            original: cloneTransform(node.transform),
            world: resolve(id).clone(),
            parentInverse: parentWorld.clone().invert()
        };
    });
    const pivot = new Vector3();
    for (const target of targets) pivot.add(target.world.getTranslation(new Vector3()));
    if (targets.length > 0) pivot.scale(1 / targets.length);
    const active = targets.at(-1);
    const orientation =
        space === 'local' && active
            ? (worldRotations.get(active.id) ?? new Quaternion())
            : new Quaternion();
    return {
        targets,
        pivot,
        space,
        axes: {
            x: BASIS.x.clone().transformQuat(orientation),
            y: BASIS.y.clone().transformQuat(orientation),
            z: BASIS.z.clone().transformQuat(orientation)
        }
    };
}

export type TransformOperation =
    | { mode: 'translate'; offset: Vec3 }
    | { mode: 'rotate'; axis: TransformAxis; angle: number }
    | { mode: 'scale'; axis: TransformAxis | 'uniform'; factor: number };

function decodeMatrix(value: Matrix4): Transform {
    const position = new Vector3();
    const scale = new Vector3();
    const quaternion = new Quaternion();
    value.decompose(quaternion, position, scale);
    const reconstructed = new Matrix4().compose(quaternion, position, scale);
    for (let index = 0; index < 16; index++) {
        const expected = value.elements[index];
        const actual = reconstructed.elements[index];
        if (
            expected === undefined ||
            actual === undefined ||
            !Number.isFinite(actual) ||
            Math.abs(expected - actual) > 2e-5 * Math.max(1, Math.abs(expected))
        ) {
            throw new Error(
                'This world transform would introduce shear. Use Local space or uniform scale on the parent.'
            );
        }
    }
    return {
        position: components(position),
        rotation: degrees(quaternion),
        scale: components(scale)
    };
}

/** Applies a world-space gesture to the captured transforms without accumulating preview error. */
export function applyTransformOperation(
    snapshot: TransformSnapshot,
    operation: TransformOperation
): Record<string, Transform> {
    const result: Record<string, Transform> = {};
    const neutral =
        operation.mode === 'translate'
            ? operation.offset.x === 0 && operation.offset.y === 0 && operation.offset.z === 0
            : operation.mode === 'rotate'
              ? operation.angle === 0
              : operation.factor === 1;
    if (neutral) {
        for (const target of snapshot.targets) result[target.id] = cloneTransform(target.original);
        return result;
    }
    const axis =
        operation.mode !== 'translate' && operation.axis !== 'uniform'
            ? snapshot.axes[operation.axis]
            : null;
    const pivot = snapshot.pivot;
    let delta = new Matrix4();
    if (operation.mode === 'rotate') {
        if (!Number.isFinite(operation.angle) || !axis)
            throw new RangeError('Invalid rotation angle.');
        delta.fromQuat(new Quaternion().setAxisAngle(axis, operation.angle));
    } else if (operation.mode === 'scale') {
        if (!Number.isFinite(operation.factor) || operation.factor <= 0)
            throw new RangeError('Scale must stay positive.');
        if (operation.axis === 'uniform')
            delta.fromScaling(new Vector3(operation.factor, operation.factor, operation.factor));
        else {
            const axes = snapshot.axes;
            const orientation = new Matrix4().set(
                axes.x.x,
                axes.x.y,
                axes.x.z,
                0,
                axes.y.x,
                axes.y.y,
                axes.y.z,
                0,
                axes.z.x,
                axes.z.y,
                axes.z.z,
                0,
                0,
                0,
                0,
                1
            );
            const scaling = new Vector3(1, 1, 1);
            scaling[operation.axis] = operation.factor;
            delta = orientation
                .clone()
                .multiply(new Matrix4().fromScaling(scaling))
                .multiply(orientation.clone().invert());
        }
    }
    if (operation.mode !== 'translate') {
        delta
            .premultiply(new Matrix4().fromTranslation(pivot))
            .multiply(new Matrix4().fromTranslation(pivot.clone().scale(-1)));
    }
    for (const target of snapshot.targets) {
        const next = cloneTransform(target.original);
        if (operation.mode === 'translate') {
            const offset = vector(operation.offset);
            if (![offset.x, offset.y, offset.z].every(Number.isFinite))
                throw new RangeError('Invalid translation.');
            next.position = components(
                target.world
                    .getTranslation(new Vector3())
                    .add(offset)
                    .transformMat4(target.parentInverse)
            );
            result[target.id] = next;
        } else if (snapshot.space === 'local') {
            next.position = components(
                target.world
                    .getTranslation(new Vector3())
                    .transformMat4(delta)
                    .transformMat4(target.parentInverse)
            );
            if (operation.mode === 'rotate')
                next.rotation = degrees(
                    rotation(next.rotation).multiply(
                        new Quaternion().setAxisAngle(BASIS[operation.axis], operation.angle)
                    )
                );
            else if (operation.axis === 'uniform')
                for (const component of AXES)
                    next.scale[component] = rounded(next.scale[component] * operation.factor);
            else
                next.scale[operation.axis] = rounded(next.scale[operation.axis] * operation.factor);
            result[target.id] = next;
        } else
            result[target.id] = decodeMatrix(
                target.parentInverse.clone().multiply(delta).multiply(target.world)
            );
        const transformed = result[target.id];
        if (!transformed) continue;
        for (const component of AXES) {
            if (transformed.scale[component] < 0.001 || transformed.scale[component] > 10_000)
                throw new RangeError('Scale must remain between 0.001 and 10000.');
            if (Math.abs(transformed.position[component]) > 10_000)
                throw new RangeError('Position must remain within ±10000 meters.');
        }
    }
    return result;
}

/** Closest point on a drag axis; null rejects an almost parallel camera ray. */
export function dragAxisParameter(ray: Ray, pivot: Vector3, axis: Vector3): number | null {
    const parallel = ray.direction.dot(axis);
    const denominator = 1 - parallel * parallel;
    if (denominator < 1e-5) return null;
    const offset = ray.origin.clone().subtract(pivot);
    return (axis.dot(offset) - parallel * ray.direction.dot(offset)) / denominator;
}

/** Ray/plane intersection used by planar moves and axis rotation. */
export function dragPlanePoint(ray: Ray, pivot: Vector3, normal: Vector3): Vector3 | null {
    const denominator = ray.direction.dot(normal);
    if (Math.abs(denominator) < 1e-5) return null;
    const distance = pivot.clone().subtract(ray.origin).dot(normal) / denominator;
    return distance < 0 ? null : ray.origin.clone().scaleAndAdd(distance, ray.direction);
}

interface ActiveDrag {
    pointer: number;
    button: HTMLElement | SVGElement;
    handle: TransformHandle;
    snapshot: TransformSnapshot;
    mode: TransformMode;
    startX: number;
    startY: number;
    size: number;
    normal: Vector3;
    startPoint: Vector3;
    startParameter: number;
    lastAngle: number;
    angle: number;
    transforms: Record<string, Transform>;
    changed: boolean;
    reportedError: string;
}
interface GizmoOptions {
    container: HTMLElement;
    camera: PerspectiveCamera;
    onTransform: (gesture: TransformGesture) => void;
    onActiveChange: (active: boolean) => void;
    onError: (message: string) => void;
}

/** Projected, pointer-accessible handles whose edits are solved in actual scene coordinates. */
export class TransformGizmo {
    private readonly overlay = document.createElement('div');
    private readonly svg = document.createElementNS(SVG_NS, 'svg');
    private readonly buttons = new Map<TransformHandle, HTMLButtonElement>();
    private readonly paths = new Map<TransformAxis, SVGPathElement>();
    private readonly hitPaths = new Map<TransformAxis, SVGPathElement>();
    private scene: SceneDocument | null = null;
    private selected: readonly string[] = [];
    private frame: TransformSnapshot | null = null;
    private mode: TransformMode = 'translate';
    private space: TransformSpace = 'world';
    private snapping = false;
    private enabled = true;
    private visible = true;
    private drag: ActiveDrag | null = null;
    private size = 1;
    private disposed = false;

    constructor(private readonly options: GizmoOptions) {
        this.overlay.className = 'transform-gizmo';
        this.overlay.dataset['testid'] = 'transform-gizmo';
        Object.assign(this.overlay.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '4',
            overflow: 'hidden'
        });
        Object.assign(this.svg.style, {
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none'
        });
        this.svg.setAttribute('aria-hidden', 'true');
        this.overlay.append(this.svg);
        for (const axis of AXES) {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', COLORS[axis]);
            path.setAttribute('stroke-width', '2');
            this.paths.set(axis, path);
            this.svg.append(path);
            const hit = document.createElementNS(SVG_NS, 'path');
            hit.setAttribute('fill', 'none');
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', '14');
            hit.style.pointerEvents = 'stroke';
            hit.style.cursor = 'grab';
            hit.addEventListener('pointerdown', event => {
                this.begin(event, axis, hit);
            });
            hit.addEventListener('pointermove', this.move);
            hit.addEventListener('pointerup', this.end);
            hit.addEventListener('pointercancel', this.cancelPointer);
            hit.addEventListener('lostpointercapture', this.cancelPointer);
            this.hitPaths.set(axis, hit);
            this.svg.append(hit);
        }
        for (const handle of [...AXES, 'xy', 'xz', 'yz', 'screen', 'uniform'] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset['transformHandle'] = handle;
            Object.assign(button.style, {
                position: 'absolute',
                width: '23px',
                height: '23px',
                padding: '0',
                border: '1px solid currentColor',
                borderRadius: '4px',
                background: '#25272ae8',
                font: 'bold 10px system-ui',
                lineHeight: '21px',
                color:
                    handle === 'x' || handle === 'y' || handle === 'z' ? COLORS[handle] : '#e8c99a',
                pointerEvents: 'auto',
                touchAction: 'none',
                cursor: 'grab',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 1px 4px #0008'
            });
            button.textContent =
                handle === 'screen' ? '⊕' : handle === 'uniform' ? '◇' : handle.toUpperCase();
            button.addEventListener('pointerdown', event => {
                this.begin(event, handle, button);
            });
            button.addEventListener('pointermove', this.move);
            button.addEventListener('pointerup', this.end);
            button.addEventListener('pointercancel', this.cancelPointer);
            button.addEventListener('lostpointercapture', this.cancelPointer);
            this.buttons.set(handle, button);
            this.overlay.append(button);
        }
        options.container.append(this.overlay);
        window.addEventListener('keydown', this.keydown, true);
        window.addEventListener('blur', this.cancelOnBlur);
        this.update();
    }

    get active(): boolean {
        return this.drag !== null;
    }
    setScene(scene: SceneDocument): void {
        this.scene = scene;
        this.refresh();
    }
    select(ids: readonly string[]): void {
        if (ids.join('\0') !== this.selected.join('\0')) this.cancel();
        this.selected = [...ids];
        this.refresh();
    }
    setMode(mode: TransformMode): void {
        if (this.mode !== mode) this.cancel();
        this.mode = mode;
        this.update();
    }
    setSpace(space: TransformSpace): void {
        if (this.space !== space) this.cancel();
        this.space = space;
        this.refresh();
    }
    setSnap(enabled: boolean): void {
        this.snapping = enabled;
    }
    setEnabled(enabled: boolean): void {
        if (!enabled) this.cancel();
        this.enabled = enabled;
        this.update();
    }
    setVisible(visible: boolean): void {
        if (!visible) this.cancel();
        this.visible = visible;
        this.update();
    }

    private refresh(): void {
        if (this.scene) {
            try {
                this.frame = createTransformSnapshot(this.scene, this.selected, this.space);
            } catch {
                this.frame = null;
            }
        }
        if (
            this.drag &&
            this.scene &&
            this.drag.snapshot.targets.some(target => !this.scene?.nodes[target.id])
        )
            this.cancel();
        this.update();
    }

    update(): void {
        const { container, camera } = this.options;
        const width = container.clientWidth;
        const height = container.clientHeight;
        const frame = this.frame;
        const available =
            this.enabled &&
            this.visible &&
            frame !== null &&
            frame.targets.length > 0 &&
            width > 0 &&
            height > 0;
        this.overlay.hidden = !available;
        this.overlay.style.display = available ? 'block' : 'none';
        if (!available) return;
        camera.updateMatrixWorld();
        camera.updateViewProjectionMatrix();
        const viewPoint = frame.pivot.clone().transformMat4(camera.viewMatrix);
        if (viewPoint.z >= -camera.near) {
            this.overlay.hidden = true;
            this.overlay.style.display = 'none';
            return;
        }
        const center = camera.projectVector(frame.pivot, width, height);
        if (
            center.x < -120 ||
            center.x > width + 120 ||
            center.y < -120 ||
            center.y > height + 120
        ) {
            this.overlay.hidden = true;
            this.overlay.style.display = 'none';
            return;
        }
        this.size = Math.max(
            0.02,
            (-viewPoint.z * Math.tan((camera.fov * Math.PI) / 360) * 2 * 92) / height
        );
        const project = (point: Vector3): Vector3 => camera.projectVector(point, width, height);
        const moveButton = (handle: TransformHandle, point: Vector3, show: boolean): void => {
            const button = this.buttons.get(handle);
            if (!button) return;
            button.hidden = !show;
            button.style.display = show ? 'block' : 'none';
            button.style.left = `${String(point.x)}px`;
            button.style.top = `${String(point.y)}px`;
            const prefix =
                this.mode === 'translate' ? 'Move' : this.mode === 'rotate' ? 'Rotate' : 'Scale';
            const name = `${prefix} ${handle === 'uniform' ? 'Uniform' : handle === 'screen' ? 'Screen' : handle.toUpperCase()}`;
            button.setAttribute('aria-label', name);
            button.title = `${name} · drag${this.snapping ? ' · snapping enabled' : ''}`;
            button.style.cursor = this.drag ? 'grabbing' : 'grab';
        };
        for (const axis of AXES) {
            const path = this.paths.get(axis);
            if (!path) continue;
            const endpoint = project(frame.pivot.clone().scaleAndAdd(this.size, frame.axes[axis]));
            const projectedLength = Math.hypot(endpoint.x - center.x, endpoint.y - center.y);
            if (this.mode === 'rotate') {
                const perpendicular =
                    axis === 'x'
                        ? (['y', 'z'] as const)
                        : axis === 'y'
                          ? (['z', 'x'] as const)
                          : (['x', 'y'] as const);
                const a = frame.axes[perpendicular[0]];
                const b = frame.axes[perpendicular[1]];
                const points: Vector3[] = [];
                for (let index = 0; index <= 64; index++) {
                    const angle = (index / 64) * Math.PI * 2;
                    points.push(
                        project(
                            frame.pivot
                                .clone()
                                .scaleAndAdd(Math.cos(angle) * this.size, a)
                                .scaleAndAdd(Math.sin(angle) * this.size, b)
                        )
                    );
                }
                path.setAttribute(
                    'd',
                    points
                        .map(
                            (point, index) =>
                                `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
                        )
                        .join(' ')
                );
                const labelAngle = axis === 'x' ? 0.4 : axis === 'y' ? 2.3 : 4.2;
                const label = project(
                    frame.pivot
                        .clone()
                        .scaleAndAdd(Math.cos(labelAngle) * this.size, a)
                        .scaleAndAdd(Math.sin(labelAngle) * this.size, b)
                );
                moveButton(axis, label, true);
            } else {
                path.setAttribute(
                    'd',
                    `M${String(center.x)},${String(center.y)} L${String(endpoint.x)},${String(endpoint.y)}`
                );
                moveButton(axis, endpoint, projectedLength > 10);
            }
            path.style.display = '';
            this.hitPaths.get(axis)?.setAttribute('d', path.getAttribute('d') ?? '');
        }
        for (const handle of ['xy', 'xz', 'yz'] as const) {
            const first = handle[0] as TransformAxis;
            const second = handle[1] as TransformAxis;
            const point = project(
                frame.pivot
                    .clone()
                    .scaleAndAdd(this.size * 0.35, frame.axes[first])
                    .scaleAndAdd(this.size * 0.35, frame.axes[second])
            );
            const view = camera.position.clone().subtract(frame.pivot).normalize();
            const normal = frame.axes[first].clone().cross(frame.axes[second]);
            moveButton(
                handle,
                point,
                this.mode === 'translate' && Math.abs(view.dot(normal)) > 0.12
            );
        }
        moveButton('screen', center, this.mode === 'translate');
        moveButton('uniform', center, this.mode === 'scale');
    }

    private ray(event: PointerEvent): Ray {
        const rect = this.options.container.getBoundingClientRect();
        const ray = new Ray();
        ray.fromCamera(
            this.options.camera,
            event.clientX - rect.left,
            event.clientY - rect.top,
            rect.width,
            rect.height
        );
        return ray;
    }

    private begin(
        event: PointerEvent,
        handle: TransformHandle,
        button: HTMLElement | SVGElement
    ): void {
        if (event.button !== 0 || !this.enabled || !this.visible || !this.scene || this.drag)
            return;
        event.preventDefault();
        event.stopPropagation();
        const snapshot = createTransformSnapshot(this.scene, this.selected, this.space);
        if (snapshot.targets.length === 0) return;
        const ray = this.ray(event);
        const singleAxis = handle === 'x' || handle === 'y' || handle === 'z';
        const normal = this.options.camera.position.clone().subtract(snapshot.pivot).normalize();
        let startPoint = snapshot.pivot.clone();
        let startParameter = 0;
        if (this.mode === 'rotate' && singleAxis) {
            normal.copy(snapshot.axes[handle]);
            const hit = dragPlanePoint(ray, snapshot.pivot, normal);
            if (!hit || hit.clone().subtract(snapshot.pivot).length() < EPSILON) {
                this.options.onError(
                    'This rotation ring is edge-on. Orbit the camera slightly to use it.'
                );
                return;
            }
            startPoint = hit.subtract(snapshot.pivot).normalize();
        } else if (singleAxis) {
            const parameter = dragAxisParameter(ray, snapshot.pivot, snapshot.axes[handle]);
            if (parameter === null) {
                this.options.onError(
                    'This axis points into the camera. Orbit slightly or use a plane handle.'
                );
                return;
            }
            startParameter = parameter;
        } else if (this.mode === 'translate') {
            if (handle !== 'screen' && handle !== 'uniform')
                normal
                    .copy(snapshot.axes[handle[0] as TransformAxis])
                    .cross(snapshot.axes[handle[1] as TransformAxis])
                    .normalize();
            const hit = dragPlanePoint(ray, snapshot.pivot, normal);
            if (!hit) return;
            startPoint = hit;
        }
        const transforms: Record<string, Transform> = {};
        for (const target of snapshot.targets)
            transforms[target.id] = cloneTransform(target.original);
        this.drag = {
            pointer: event.pointerId,
            button,
            handle,
            snapshot,
            mode: this.mode,
            startX: event.clientX,
            startY: event.clientY,
            size: this.size,
            normal,
            startPoint,
            startParameter,
            lastAngle: 0,
            angle: 0,
            transforms,
            changed: false,
            reportedError: ''
        };
        this.options.onActiveChange(true);
        button.setPointerCapture(event.pointerId);
        button.focus();
        this.update();
    }

    private readonly move = (event: PointerEvent): void => {
        const drag = this.drag;
        if (event.pointerId !== drag?.pointer) return;
        event.preventDefault();
        event.stopPropagation();
        const ray = this.ray(event);
        const snapping = this.snapping || event.ctrlKey || event.metaKey;
        const { handle, snapshot } = drag;
        const singleAxis = handle === 'x' || handle === 'y' || handle === 'z';
        let operation: TransformOperation;
        if (drag.mode === 'translate') {
            let offset: Vector3;
            if (singleAxis) {
                const parameter = dragAxisParameter(ray, snapshot.pivot, snapshot.axes[handle]);
                if (parameter === null) return;
                offset = snapshot.axes[handle]
                    .clone()
                    .scale(snapTransformValue(parameter - drag.startParameter, 0.5, snapping));
            } else {
                const point = dragPlanePoint(ray, snapshot.pivot, drag.normal);
                if (!point) return;
                offset = point.subtract(drag.startPoint);
                if (snapping) {
                    const axes =
                        handle === 'screen'
                            ? [
                                  new Vector3(1, 0, 0).transformQuat(
                                      this.options.camera.quaternion
                                  ),
                                  new Vector3(0, 1, 0).transformQuat(this.options.camera.quaternion)
                              ]
                            : [
                                  snapshot.axes[handle[0] as TransformAxis],
                                  snapshot.axes[handle[1] as TransformAxis]
                              ];
                    const snapped = new Vector3();
                    for (const axis of axes)
                        snapped.scaleAndAdd(snapTransformValue(offset.dot(axis), 0.5, true), axis);
                    offset = snapped;
                }
            }
            operation = { mode: 'translate', offset: components(offset) };
        } else if (drag.mode === 'rotate' && singleAxis) {
            const point = dragPlanePoint(ray, snapshot.pivot, drag.normal);
            if (!point) return;
            const current = point.subtract(snapshot.pivot).normalize();
            const raw = Math.atan2(
                drag.normal.dot(drag.startPoint.clone().cross(current)),
                drag.startPoint.dot(current)
            );
            let difference = raw - drag.lastAngle;
            if (difference > Math.PI) difference -= Math.PI * 2;
            if (difference < -Math.PI) difference += Math.PI * 2;
            drag.angle += difference;
            drag.lastAngle = raw;
            operation = {
                mode: 'rotate',
                axis: handle,
                angle: snapTransformValue(drag.angle, Math.PI / 12, snapping)
            };
        } else if (drag.mode === 'scale') {
            let factor: number;
            if (singleAxis) {
                const parameter = dragAxisParameter(ray, snapshot.pivot, snapshot.axes[handle]);
                if (parameter === null) return;
                factor = Math.max(0.001, 1 + (parameter - drag.startParameter) / drag.size);
            } else
                factor = Math.exp(
                    (event.clientX - drag.startX - (event.clientY - drag.startY)) / 120
                );
            factor = Math.max(0.001, snapTransformValue(factor, 0.1, snapping));
            operation = { mode: 'scale', axis: singleAxis ? handle : 'uniform', factor };
        } else return;
        try {
            const transforms = applyTransformOperation(snapshot, operation);
            drag.changed = snapshot.targets.some(
                target => JSON.stringify(transforms[target.id]) !== JSON.stringify(target.original)
            );
            drag.transforms = transforms;
            this.options.onTransform({ phase: 'preview', transforms });
        } catch (cause) {
            const text = cause instanceof Error ? cause.message : String(cause);
            if (text !== drag.reportedError) this.options.onError(text);
            drag.reportedError = text;
        }
    };

    private readonly end = (event: PointerEvent): void => {
        if (event.pointerId !== this.drag?.pointer) return;
        event.preventDefault();
        event.stopPropagation();
        this.finish(this.drag.changed ? 'commit' : 'cancel');
    };
    private readonly cancelPointer = (event: PointerEvent): void => {
        if (this.drag?.pointer === event.pointerId) this.cancel();
    };
    private readonly cancelOnBlur = (): void => {
        this.cancel();
    };
    private readonly keydown = (event: KeyboardEvent): void => {
        if (!this.drag) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cancel();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')
            this.cancel();
    };
    cancel(): void {
        if (this.drag) this.finish('cancel');
    }
    private finish(phase: 'commit' | 'cancel'): void {
        const drag = this.drag;
        if (!drag) return;
        this.drag = null;
        const transforms =
            phase === 'commit'
                ? drag.transforms
                : Object.fromEntries(
                      drag.snapshot.targets.map(target => [
                          target.id,
                          cloneTransform(target.original)
                      ])
                  );
        if (drag.button.hasPointerCapture(drag.pointer))
            drag.button.releasePointerCapture(drag.pointer);
        this.options.onActiveChange(false);
        this.options.onTransform({ phase, transforms });
        this.refresh();
    }
    destroy(): void {
        if (this.disposed) return;
        this.cancel();
        this.disposed = true;
        window.removeEventListener('keydown', this.keydown, true);
        window.removeEventListener('blur', this.cancelOnBlur);
        this.overlay.remove();
    }
}
