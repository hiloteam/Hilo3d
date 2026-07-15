import Camera from '../../camera/Camera';
import OrthographicCamera from '../../camera/OrthographicCamera';
import PerspectiveCamera from '../../camera/PerspectiveCamera';
import type { Bounds } from '../../geometry/Geometry';
import DirectionalLight from '../../light/DirectionalLight';
import type { LightShadowOptions, ShadowCameraParameters } from '../../light/Light';
import LightManager from '../../light/LightManager';
import PointLight from '../../light/PointLight';
import {
    POINT_SHADOW_DIRECTIONS,
    POINT_SHADOW_UPS,
    resolvePointShadowCameraPlanes
} from '../../light/PointShadowCamera';
import SpotLight from '../../light/SpotLight';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import type { RHICapabilities, RHIViewport } from '../rhi/core';
import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from '../ubo/BuiltInUniformBlocks';
import {
    ShadowAtlasPlanner,
    type ShadowAtlasLightKind,
    type ShadowAtlasLightRequest,
    type ShadowAtlasPlan,
    type ShadowAtlasPlannerOptions,
    type ShadowAtlasRequests,
    type ShadowAtlasUVRect
} from './ShadowAtlasPlanner';

export type ShadowAtlasSceneLight = DirectionalLight | SpotLight | PointLight;

export interface ShadowAtlasScenePrepareOptions {
    /** Default planar shadow-map width. */
    readonly width: number;
    /** Default planar shadow-map height. Point lights use the smaller dimension. */
    readonly height: number;
}

/** Fixed-capacity arrays ready for the canonical LightBlock writer. */
export interface ShadowAtlasLightBlockState {
    readonly directionalShadowCount: number;
    readonly spotShadowCount: number;
    readonly pointShadowCount: number;
    readonly atlasSize: Float32Array;
    readonly atlasRects: Float32Array;
    readonly directionalMapSizes: Float32Array;
    readonly directionalBiases: Float32Array;
    readonly directionalMatrices: Float32Array;
    readonly spotMapSizes: Float32Array;
    readonly spotBiases: Float32Array;
    readonly spotMatrices: Float32Array;
    readonly pointBiases: Float32Array;
    readonly pointCameraPlanes: Float32Array;
    readonly pointMatrices: Float32Array;
}

export interface ShadowAtlasSceneSlice {
    readonly light: ShadowAtlasSceneLight;
    readonly kind: ShadowAtlasLightKind;
    /** Dense shadow-light index within this kind. */
    readonly lightIndex: number;
    readonly face: number | null;
    readonly sliceIndex: number;
    readonly physicalIndex: number;
    readonly viewport: Readonly<RHIViewport>;
    readonly uvRect: Readonly<ShadowAtlasUVRect>;
    readonly camera: Camera;
    readonly viewProjectionMatrix: Matrix4;
    /** Shadow projection from the main camera's view space. */
    readonly lightSpaceMatrix: Matrix4;
    readonly minBias: number;
    readonly maxBias: number;
    readonly near: number;
    readonly far: number;
    /** `[scaleX, scaleY, offsetX, offsetY]`; Y is flipped into the top-left atlas. */
    readonly atlasRect: Float32Array;
}

/** Reused result. Its arrays and records are updated in place by the next successful prepare. */
export interface ShadowAtlasScenePlan {
    readonly atlas: Readonly<ShadowAtlasPlan<ShadowAtlasSceneLight>>;
    readonly requests: Readonly<ShadowAtlasRequests<ShadowAtlasSceneLight>>;
    readonly slices: readonly Readonly<ShadowAtlasSceneSlice>[];
    readonly lightBlock: Readonly<ShadowAtlasLightBlockState>;
}

export interface ShadowAtlasSceneAdapterDiagnostics {
    readonly activeLightCount: number;
    readonly activeCameraCount: number;
    readonly activeSliceCount: number;
    readonly retainedLightCapacity: number;
    readonly retainedSliceCapacity: number;
}

interface MutableRequest extends ShadowAtlasLightRequest<ShadowAtlasSceneLight> {
    owner: ShadowAtlasSceneLight;
    width: number;
    height: number;
}

interface StagedPlanarLight<
    LightType extends DirectionalLight | SpotLight,
    CameraType extends Camera
> {
    light: LightType | null;
    readonly request: MutableRequest;
    readonly camera: CameraType;
    readonly lightSpaceMatrix: Matrix4;
    minBias: number;
    maxBias: number;
}

interface StagedPointLight {
    light: PointLight | null;
    readonly request: MutableRequest;
    readonly cameras: readonly PerspectiveCamera[];
    readonly lightSpaceMatrices: readonly Matrix4[];
    minBias: number;
    maxBias: number;
}

interface CommittedLightRecord {
    light: ShadowAtlasSceneLight | null;
    kind: ShadowAtlasLightKind;
    readonly cameras: Camera[];
    readonly lightSpaceMatrices: Matrix4[];
    epoch: number;
}

interface MutableSceneSlice {
    light: ShadowAtlasSceneLight | null;
    kind: ShadowAtlasLightKind;
    lightIndex: number;
    face: number | null;
    sliceIndex: number;
    physicalIndex: number;
    viewport: Readonly<RHIViewport> | null;
    uvRect: Readonly<ShadowAtlasUVRect> | null;
    camera: Camera | null;
    viewProjectionMatrix: Matrix4 | null;
    lightSpaceMatrix: Matrix4 | null;
    minBias: number;
    maxBias: number;
    near: number;
    far: number;
    readonly atlasRect: Float32Array;
}

interface MutableLightBlockState {
    directionalShadowCount: number;
    spotShadowCount: number;
    pointShadowCount: number;
    readonly atlasSize: Float32Array;
    readonly atlasRects: Float32Array;
    readonly directionalMapSizes: Float32Array;
    readonly directionalBiases: Float32Array;
    readonly directionalMatrices: Float32Array;
    readonly spotMapSizes: Float32Array;
    readonly spotBiases: Float32Array;
    readonly spotMatrices: Float32Array;
    readonly pointBiases: Float32Array;
    readonly pointCameraPlanes: Float32Array;
    readonly pointMatrices: Float32Array;
}

const tempMatrix = new Matrix4();
const tempTarget = new Vector3();
const tempBounds: Bounds = {
    x: 0,
    y: 0,
    z: 0,
    width: 0,
    height: 0,
    depth: 0,
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity
};
const SHADOW_CAMERA_INFO_FIELDS = new Set([
    'near',
    'far',
    'aspect',
    'fov',
    'left',
    'right',
    'top',
    'bottom',
    'x',
    'y',
    'z',
    'rotationX',
    'rotationY',
    'rotationZ'
]);

function createLightBlockState(): MutableLightBlockState {
    return {
        directionalShadowCount: 0,
        spotShadowCount: 0,
        pointShadowCount: 0,
        atlasSize: new Float32Array(4),
        atlasRects: new Float32Array(MAX_SHADOW_ATLAS_SLICES * 4),
        directionalMapSizes: new Float32Array(MAX_DIRECTIONAL_LIGHTS * 2),
        directionalBiases: new Float32Array(MAX_DIRECTIONAL_LIGHTS * 2),
        directionalMatrices: new Float32Array(MAX_DIRECTIONAL_LIGHTS * 16),
        spotMapSizes: new Float32Array(MAX_SPOT_LIGHTS * 2),
        spotBiases: new Float32Array(MAX_SPOT_LIGHTS * 2),
        spotMatrices: new Float32Array(MAX_SPOT_LIGHTS * 16),
        pointBiases: new Float32Array(MAX_POINT_LIGHTS * 2),
        pointCameraPlanes: new Float32Array(MAX_POINT_LIGHTS * 2),
        pointMatrices: new Float32Array(MAX_POINT_LIGHTS * 6 * 16)
    };
}

function clearLightBlockState(state: MutableLightBlockState): void {
    state.directionalShadowCount = 0;
    state.spotShadowCount = 0;
    state.pointShadowCount = 0;
    state.atlasSize.fill(0);
    state.atlasRects.fill(0);
    state.directionalMapSizes.fill(0);
    state.directionalBiases.fill(0);
    state.directionalMatrices.fill(0);
    state.spotMapSizes.fill(0);
    state.spotBiases.fill(0);
    state.spotMatrices.fill(0);
    state.pointBiases.fill(0);
    state.pointCameraPlanes.fill(0);
    state.pointMatrices.fill(0);
}

function copyLightBlockState(source: MutableLightBlockState, target: MutableLightBlockState): void {
    target.directionalShadowCount = source.directionalShadowCount;
    target.spotShadowCount = source.spotShadowCount;
    target.pointShadowCount = source.pointShadowCount;
    target.atlasSize.set(source.atlasSize);
    target.atlasRects.set(source.atlasRects);
    target.directionalMapSizes.set(source.directionalMapSizes);
    target.directionalBiases.set(source.directionalBiases);
    target.directionalMatrices.set(source.directionalMatrices);
    target.spotMapSizes.set(source.spotMapSizes);
    target.spotBiases.set(source.spotBiases);
    target.spotMatrices.set(source.spotMatrices);
    target.pointBiases.set(source.pointBiases);
    target.pointCameraPlanes.set(source.pointCameraPlanes);
    target.pointMatrices.set(source.pointMatrices);
}

function positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
    return value;
}

function finiteNumber(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be finite`);
    }
    return value;
}

function finiteMatrix(matrix: Matrix4, name: string): void {
    for (let index = 0; index < matrix.elements.length; index += 1) {
        if (!Number.isFinite(matrix.elements[index])) {
            throw new TypeError(`${name}[${String(index)}] must be finite`);
        }
    }
}

function finiteDirection(light: DirectionalLight | SpotLight): void {
    const { x, y, z } = light.direction;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new TypeError(`${light.className}.direction must be finite`);
    }
    if (x === 0 && y === 0 && z === 0) {
        throw new RangeError(`${light.className}.direction must be non-zero`);
    }
}

function writeShadowBias(
    shadow: LightShadowOptions,
    staged: { minBias: number; maxBias: number }
): void {
    const minBias = shadow.minBias ?? 0.005;
    const maxBias = shadow.maxBias ?? 0.05;
    finiteNumber(minBias, 'shadow.minBias');
    finiteNumber(maxBias, 'shadow.maxBias');
    if (minBias < 0 || maxBias < 0) {
        throw new RangeError('Shadow bias values must be non-negative');
    }
    staged.minBias = minBias;
    staged.maxBias = maxBias;
}

function validateCameraInfo(info: ShadowCameraParameters | undefined, label: string): void {
    if (info === undefined) return;
    for (const key of Reflect.ownKeys(info)) {
        if (typeof key !== 'string' || !SHADOW_CAMERA_INFO_FIELDS.has(key)) {
            throw new TypeError(`${label}.${String(key)} is not a supported shadow camera field`);
        }
        finiteNumber(Reflect.get(info, key), `${label}.${key}`);
    }
    if (info.aspect !== undefined && info.aspect <= 0) {
        throw new RangeError(`${label}.aspect must be positive`);
    }
    if (info.fov !== undefined && (info.fov <= 0 || info.fov >= 180)) {
        throw new RangeError(`${label}.fov must be between 0 and 180 degrees`);
    }
    if (info.near !== undefined && info.far !== undefined && info.far <= info.near) {
        throw new RangeError(`${label}.far must be greater than near`);
    }
    if (info.left !== undefined && info.right !== undefined && info.right === info.left) {
        throw new RangeError(`${label}.right and left must differ`);
    }
    if (info.bottom !== undefined && info.top !== undefined && info.top === info.bottom) {
        throw new RangeError(`${label}.top and bottom must differ`);
    }
}

function cameraFar(camera: Camera): number {
    const near = finiteNumber(Reflect.get(camera, 'near'), 'Active camera near plane');
    const rawFar: unknown = Reflect.get(camera, 'far');
    const far = rawFar === null ? near * 1000 : finiteNumber(rawFar, 'Active camera far plane');
    if (far <= near) throw new RangeError('Active camera far plane must be greater than near');
    return far;
}

function resetCameraTransform(camera: Camera): void {
    camera.removeFromParent();
    camera.setPosition(0, 0, 0);
    camera.setScale(1, 1, 1);
    camera.setPivot(0, 0, 0);
    camera.setRotation(0, 0, 0);
    camera.up.set(0, 1, 0);
}

/** Convert the planar camera's light-local transform into a standalone world transform. */
function makePlanarCameraWorld(camera: Camera, light: DirectionalLight | SpotLight): void {
    camera.updateMatrix();
    tempMatrix.multiply(light.worldMatrix, camera.matrix);
    camera.matrix.copy(tempMatrix);
    camera.updateTransform();
    camera.updateViewProjectionMatrix();
}

function stageDirectionalCamera(
    camera: OrthographicCamera,
    light: DirectionalLight,
    mainCamera: Camera
): void {
    resetCameraTransform(camera);
    camera.left = -1;
    camera.right = 1;
    camera.bottom = -1;
    camera.top = 1;
    camera.near = 0.1;
    camera.far = 1;
    camera.lookAt(light.direction);
    const info = light.shadow?.cameraInfo;
    if (info) {
        Object.assign(camera, info);
        if (info.near === undefined)
            camera.near = finiteNumber(Reflect.get(mainCamera, 'near'), 'Active camera near plane');
        if (info.far === undefined) camera.far = cameraFar(mainCamera);
        if (camera.far <= camera.near) {
            throw new RangeError('Directional shadow far plane must be greater than near');
        }
        makePlanarCameraWorld(camera, light);
    } else {
        makePlanarCameraWorld(camera, light);
        tempMatrix.multiply(camera.viewMatrix, mainCamera.worldMatrix);
        tempBounds.xMin = tempBounds.yMin = tempBounds.zMin = Infinity;
        tempBounds.xMax = tempBounds.yMax = tempBounds.zMax = -Infinity;
        const bounds = mainCamera.getGeometry().getBounds(tempMatrix, tempBounds);
        if (
            !Number.isFinite(bounds.xMin) ||
            !Number.isFinite(bounds.xMax) ||
            !Number.isFinite(bounds.yMin) ||
            !Number.isFinite(bounds.yMax) ||
            !Number.isFinite(bounds.zMin) ||
            !Number.isFinite(bounds.zMax)
        ) {
            throw new TypeError('Directional shadow frustum bounds must be finite');
        }
        camera.near = -bounds.zMax;
        camera.far = -bounds.zMin;
        camera.left = bounds.xMin;
        camera.right = bounds.xMax;
        camera.bottom = bounds.yMin;
        camera.top = bounds.yMax;
        if (
            camera.far <= camera.near ||
            camera.right <= camera.left ||
            camera.top <= camera.bottom
        ) {
            throw new RangeError('Directional shadow frustum is degenerate');
        }
        camera.updateViewProjectionMatrix();
    }
    finiteMatrix(camera.viewProjectionMatrix, 'Directional shadow viewProjectionMatrix');
}

function stageSpotCamera(
    camera: PerspectiveCamera,
    light: SpotLight,
    mainCamera: Camera,
    tileAspect: number
): void {
    resetCameraTransform(camera);
    camera.fov = 50;
    camera.near = 0.1;
    camera.far = 1;
    camera.aspect = 1;
    camera.lookAt(light.direction);
    const info = light.shadow?.cameraInfo;
    if (info) {
        Object.assign(camera, info);
        if (info.near === undefined) {
            camera.near = finiteNumber(Reflect.get(mainCamera, 'near'), 'Active camera near plane');
        }
        if (info.far === undefined) camera.far = cameraFar(mainCamera);
    } else {
        const fov = light.outerCutoff * 2;
        if (!Number.isFinite(fov) || fov <= 0 || fov >= 180) {
            throw new RangeError('Spot shadow field of view must be between 0 and 180 degrees');
        }
        camera.fov = fov;
        camera.near = 0.01;
        camera.far = cameraFar(mainCamera);
        camera.aspect = tileAspect;
    }
    if (camera.near <= 0 || camera.far <= camera.near || camera.aspect <= 0) {
        throw new RangeError('Spot shadow camera clipping and aspect must be valid');
    }
    makePlanarCameraWorld(camera, light);
    finiteMatrix(camera.viewProjectionMatrix, 'Spot shadow viewProjectionMatrix');
}

function stagePointCamera(
    camera: PerspectiveCamera,
    light: PointLight,
    face: number,
    near: number,
    far: number
): void {
    resetCameraTransform(camera);
    light.worldMatrix.getTranslation(camera.position);
    const up = POINT_SHADOW_UPS[face];
    const direction = POINT_SHADOW_DIRECTIONS[face];
    if (up === undefined || direction === undefined) {
        throw new RangeError(`Point shadow face ${String(face)} is outside the canonical cube`);
    }
    camera.up.fromArray(up);
    tempTarget.set(
        camera.position.x + direction[0],
        camera.position.y + direction[1],
        camera.position.z + direction[2]
    );
    camera.lookAt(tempTarget);
    camera.fov = 90;
    camera.aspect = 1;
    camera.near = near;
    camera.far = far;
    camera.updateViewProjectionMatrix();
    finiteMatrix(
        camera.viewProjectionMatrix,
        `Point shadow face ${String(face)} viewProjectionMatrix`
    );
}

function copyCamera(source: Camera, destination: Camera): void {
    resetCameraTransform(destination);
    destination.up.copy(source.up);
    destination.matrix.copy(source.worldMatrix);
    destination.updateTransform();
    if (source instanceof OrthographicCamera && destination instanceof OrthographicCamera) {
        destination.left = source.left;
        destination.right = source.right;
        destination.bottom = source.bottom;
        destination.top = source.top;
        destination.near = source.near;
        destination.far = source.far;
    } else if (source instanceof PerspectiveCamera && destination instanceof PerspectiveCamera) {
        destination.fov = source.fov;
        destination.aspect = source.aspect;
        destination.near = source.near;
        destination.far = source.far;
    } else {
        throw new TypeError('Shadow camera staging type does not match its committed camera');
    }
    destination.updateViewProjectionMatrix();
    destination.viewMatrix.copy(source.viewMatrix);
    destination.projectionMatrix.copy(source.projectionMatrix);
    destination.viewProjectionMatrix.copy(source.viewProjectionMatrix);
    destination.worldMatrix.copy(source.worldMatrix);
}

function createMutableRequest(): MutableRequest {
    return { owner: null as unknown as ShadowAtlasSceneLight, width: 1, height: 1 };
}

function createMutableSceneSlice(): MutableSceneSlice {
    return {
        light: null,
        kind: 'directional',
        lightIndex: 0,
        face: null,
        sliceIndex: 0,
        physicalIndex: 0,
        viewport: null,
        uvRect: null,
        camera: null,
        viewProjectionMatrix: null,
        lightSpaceMatrix: null,
        minBias: 0,
        maxBias: 0,
        near: 0,
        far: 0,
        atlasRect: new Float32Array(4)
    };
}

function releaseSceneSlice(slice: MutableSceneSlice): void {
    slice.light = null;
    slice.camera = null;
    slice.viewProjectionMatrix = null;
    slice.lightSpaceMatrix = null;
    slice.viewport = null;
    slice.uvRect = null;
    slice.atlasRect.fill(0);
}

/** Backend-neutral Scene/Light -> shared shadow-atlas production adapter. */
export class ShadowAtlasSceneAdapter {
    readonly planner: ShadowAtlasPlanner<ShadowAtlasSceneLight>;
    readonly #stageDirectional: StagedPlanarLight<DirectionalLight, OrthographicCamera>[] = [];
    readonly #stageSpot: StagedPlanarLight<SpotLight, PerspectiveCamera>[] = [];
    readonly #stagePoint: StagedPointLight[] = [];
    readonly #stageDirectionalRequests: MutableRequest[] = [];
    readonly #stageSpotRequests: MutableRequest[] = [];
    readonly #stagePointRequests: MutableRequest[] = [];
    readonly #stageRequests: Readonly<ShadowAtlasRequests<ShadowAtlasSceneLight>>;
    readonly #seenLights = new Set<ShadowAtlasSceneLight>();
    readonly #requestsDirectional: MutableRequest[] = [];
    readonly #requestsSpot: MutableRequest[] = [];
    readonly #requestsPoint: MutableRequest[] = [];
    readonly #requestPools: Record<ShadowAtlasLightKind, MutableRequest[]> = {
        directional: [],
        spot: [],
        point: []
    };
    readonly #requests: Readonly<ShadowAtlasRequests<ShadowAtlasSceneLight>>;
    readonly #stageLightBlock = createLightBlockState();
    readonly #lightBlock = createLightBlockState();
    readonly #lightBlockPublic: Readonly<ShadowAtlasLightBlockState>;
    readonly #records = new Map<ShadowAtlasSceneLight, CommittedLightRecord>();
    readonly #recordPools: Record<ShadowAtlasLightKind, CommittedLightRecord[]> = {
        directional: [],
        spot: [],
        point: []
    };
    readonly #activeSlices: MutableSceneSlice[] = [];
    readonly #slicePool: MutableSceneSlice[] = [];
    readonly #slicePublic: readonly Readonly<ShadowAtlasSceneSlice>[];
    #result: Readonly<ShadowAtlasScenePlan> | null = null;
    #epoch = 0;
    #retainedLightCapacity = 0;
    #retainedSliceCapacity = 0;
    #destroyed = false;

    constructor(options: ShadowAtlasPlannerOptions = {}) {
        this.planner = new ShadowAtlasPlanner<ShadowAtlasSceneLight>(options);
        this.#stageRequests = Object.freeze({
            directional: this.#stageDirectionalRequests,
            spot: this.#stageSpotRequests,
            point: this.#stagePointRequests
        });
        this.#requests = Object.freeze({
            directional: this.#requestsDirectional,
            spot: this.#requestsSpot,
            point: this.#requestsPoint
        });
        const state = this.#lightBlock;
        this.#lightBlockPublic = Object.freeze({
            get directionalShadowCount() {
                return state.directionalShadowCount;
            },
            get spotShadowCount() {
                return state.spotShadowCount;
            },
            get pointShadowCount() {
                return state.pointShadowCount;
            },
            atlasSize: state.atlasSize,
            atlasRects: state.atlasRects,
            directionalMapSizes: state.directionalMapSizes,
            directionalBiases: state.directionalBiases,
            directionalMatrices: state.directionalMatrices,
            spotMapSizes: state.spotMapSizes,
            spotBiases: state.spotBiases,
            spotMatrices: state.spotMatrices,
            pointBiases: state.pointBiases,
            pointCameraPlanes: state.pointCameraPlanes,
            pointMatrices: state.pointMatrices
        });
        this.#slicePublic = this.#activeSlices as readonly Readonly<ShadowAtlasSceneSlice>[];
    }

    prepare(
        manager: LightManager,
        mainCamera: Camera,
        capabilities: RHICapabilities,
        options: Readonly<ShadowAtlasScenePrepareOptions>
    ): Readonly<ShadowAtlasScenePlan> {
        this.assertAlive();
        if (!(manager instanceof LightManager)) {
            throw new TypeError('Shadow atlas scene preparation requires a real LightManager');
        }
        if (!(mainCamera instanceof Camera)) {
            throw new TypeError('Shadow atlas scene preparation requires a real Camera');
        }
        const defaultWidth = positiveSafeInteger(options.width, 'Shadow atlas default width');
        const defaultHeight = positiveSafeInteger(options.height, 'Shadow atlas default height');
        mainCamera.updateViewProjectionMatrix();
        finiteMatrix(mainCamera.worldMatrix, 'Active camera worldMatrix');
        finiteMatrix(mainCamera.viewProjectionMatrix, 'Active camera viewProjectionMatrix');

        this.collectRequests(manager, defaultWidth, defaultHeight);
        this.validateCounts();
        const tileAspect = this.stageTileAspect(defaultWidth, defaultHeight);
        // Keep every fallible scene/camera calculation before build(): the planner mutates its
        // reusable public plan only after its own validation succeeds.
        this.stageCameras(mainCamera, tileAspect);

        const atlas = this.planner.build(this.#stageRequests, capabilities);
        this.finishStagedLightBlock(atlas);
        this.commit(atlas);
        if (this.#result === null) {
            this.#result = Object.freeze({
                atlas,
                requests: this.#requests,
                slices: this.#slicePublic,
                lightBlock: this.#lightBlockPublic
            });
        }
        return this.#result;
    }

    hasLight(light: ShadowAtlasSceneLight): boolean {
        this.assertAlive();
        return this.#records.has(light);
    }

    diagnostics(): Readonly<ShadowAtlasSceneAdapterDiagnostics> {
        this.assertAlive();
        let activeCameraCount = 0;
        for (const record of this.#records.values()) activeCameraCount += record.cameras.length;
        return Object.freeze({
            activeLightCount: this.#records.size,
            activeCameraCount,
            activeSliceCount: this.#activeSlices.length,
            retainedLightCapacity: this.#retainedLightCapacity,
            retainedSliceCapacity: this.#retainedSliceCapacity
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records.values()) this.releaseRecord(record, false);
        this.#records.clear();
        for (const kind of ['directional', 'spot', 'point'] as const) {
            for (const record of this.#recordPools[kind]) this.releaseRecord(record, false);
            this.#recordPools[kind].length = 0;
        }
        for (const slice of this.#activeSlices) releaseSceneSlice(slice);
        for (const slice of this.#slicePool) releaseSceneSlice(slice);
        this.#activeSlices.length = 0;
        this.#slicePool.length = 0;
        this.#requestsDirectional.length = 0;
        this.#requestsSpot.length = 0;
        this.#requestsPoint.length = 0;
        this.#requestPools.directional.length = 0;
        this.#requestPools.spot.length = 0;
        this.#requestPools.point.length = 0;
        this.#seenLights.clear();
        clearLightBlockState(this.#lightBlock);
        clearLightBlockState(this.#stageLightBlock);
        this.planner.destroy();
        this.#result = null;
        this.#destroyed = true;
    }

    private collectRequests(manager: LightManager, width: number, height: number): void {
        this.#stageDirectionalRequests.length = 0;
        this.#stageSpotRequests.length = 0;
        this.#stagePointRequests.length = 0;
        if (!manager.shadowEnabled) return;
        this.#seenLights.clear();
        try {
            this.collectDirectional(manager.directionalLights, width, height);
            this.collectSpot(manager.spotLights, width, height);
            this.collectPoint(manager.pointLights, width, height);
        } finally {
            this.#seenLights.clear();
        }
    }

    private collectDirectional(
        lights: readonly DirectionalLight[],
        width: number,
        height: number
    ): void {
        for (const light of lights) {
            if (!(light instanceof DirectionalLight)) {
                throw new TypeError(
                    'Directional shadow lists must contain DirectionalLight values'
                );
            }
            if (!light.enabled || light.shadow === null) continue;
            const index = this.#stageDirectionalRequests.length;
            if (index >= MAX_DIRECTIONAL_LIGHTS) {
                throw new RangeError(
                    `Directional shadow count ${String(index + 1)} exceeds ${String(MAX_DIRECTIONAL_LIGHTS)}`
                );
            }
            const staged = this.directionalStageAt(index);
            this.stageRequest(staged, light, light.shadow, width, height, false);
            finiteDirection(light);
            validateCameraInfo(light.shadow.cameraInfo, 'Directional shadow cameraInfo');
            this.#stageDirectionalRequests.push(staged.request);
        }
    }

    private collectSpot(lights: readonly SpotLight[], width: number, height: number): void {
        for (const light of lights) {
            if (!(light instanceof SpotLight)) {
                throw new TypeError('Spot shadow lists must contain SpotLight values');
            }
            if (!light.enabled || light.shadow === null) continue;
            const index = this.#stageSpotRequests.length;
            if (index >= MAX_SPOT_LIGHTS) {
                throw new RangeError(
                    `Spot shadow count ${String(index + 1)} exceeds ${String(MAX_SPOT_LIGHTS)}`
                );
            }
            const staged = this.spotStageAt(index);
            this.stageRequest(staged, light, light.shadow, width, height, false);
            finiteDirection(light);
            validateCameraInfo(light.shadow.cameraInfo, 'Spot shadow cameraInfo');
            this.#stageSpotRequests.push(staged.request);
        }
    }

    private collectPoint(lights: readonly PointLight[], width: number, height: number): void {
        for (const light of lights) {
            if (!(light instanceof PointLight)) {
                throw new TypeError('Point shadow lists must contain PointLight values');
            }
            if (!light.enabled || light.shadow === null) continue;
            const index = this.#stagePointRequests.length;
            if (index >= MAX_POINT_LIGHTS) {
                throw new RangeError(
                    `Point shadow count ${String(index + 1)} exceeds ${String(MAX_POINT_LIGHTS)}`
                );
            }
            const staged = this.pointStageAt(index);
            this.stageRequest(staged, light, light.shadow, width, height, true);
            validateCameraInfo(light.shadow.cameraInfo, 'Point shadow cameraInfo');
            this.#stagePointRequests.push(staged.request);
        }
    }

    private stageRequest(
        staged: {
            light: ShadowAtlasSceneLight | null;
            request: MutableRequest;
            minBias: number;
            maxBias: number;
        },
        light: ShadowAtlasSceneLight,
        shadow: LightShadowOptions,
        defaultWidth: number,
        defaultHeight: number,
        square: boolean
    ): void {
        if (this.#seenLights.has(light)) {
            throw new TypeError('A shadow-casting light may appear only once per scene plan');
        }
        this.#seenLights.add(light);
        let width: number;
        let height: number;
        if (square) {
            if (
                shadow.width !== undefined &&
                shadow.height !== undefined &&
                shadow.width !== shadow.height
            ) {
                throw new RangeError('Point-light atlas shadows require equal width and height');
            }
            const size = shadow.width ?? shadow.height ?? Math.min(defaultWidth, defaultHeight);
            width = height = positiveSafeInteger(size, 'Point shadow size');
        } else {
            width = positiveSafeInteger(shadow.width ?? defaultWidth, 'Shadow width');
            height = positiveSafeInteger(shadow.height ?? defaultHeight, 'Shadow height');
        }
        staged.light = light;
        staged.request.owner = light;
        staged.request.width = width;
        staged.request.height = height;
        writeShadowBias(shadow, staged);
    }

    private validateCounts(): void {
        const directional = this.#stageDirectionalRequests.length;
        const spot = this.#stageSpotRequests.length;
        const point = this.#stagePointRequests.length;
        if (directional > MAX_DIRECTIONAL_LIGHTS) {
            throw new RangeError(
                `Directional shadow count ${String(directional)} exceeds ${String(MAX_DIRECTIONAL_LIGHTS)}`
            );
        }
        if (spot > MAX_SPOT_LIGHTS) {
            throw new RangeError(
                `Spot shadow count ${String(spot)} exceeds ${String(MAX_SPOT_LIGHTS)}`
            );
        }
        if (point > MAX_POINT_LIGHTS) {
            throw new RangeError(
                `Point shadow count ${String(point)} exceeds ${String(MAX_POINT_LIGHTS)}`
            );
        }
        const slices = directional + spot + point * 6;
        if (slices > this.planner.maxSlices) {
            throw new RangeError(
                `Shadow atlas requires ${String(slices)} slices, exceeding maxSlices ${String(this.planner.maxSlices)}`
            );
        }
    }

    private stageTileAspect(defaultWidth: number, defaultHeight: number): number {
        let width = this.totalRequestCount() === 0 ? defaultWidth : 1;
        let height = this.totalRequestCount() === 0 ? defaultHeight : 1;
        for (const request of this.#stageDirectionalRequests) {
            if (request.width > width) width = request.width;
            if (request.height > height) height = request.height;
        }
        for (const request of this.#stageSpotRequests) {
            if (request.width > width) width = request.width;
            if (request.height > height) height = request.height;
        }
        for (const request of this.#stagePointRequests) {
            if (request.width > width) width = request.width;
            if (request.height > height) height = request.height;
        }
        return width / height;
    }

    private stageCameras(mainCamera: Camera, tileAspect: number): void {
        clearLightBlockState(this.#stageLightBlock);
        this.#stageLightBlock.directionalShadowCount = this.#stageDirectionalRequests.length;
        this.#stageLightBlock.spotShadowCount = this.#stageSpotRequests.length;
        this.#stageLightBlock.pointShadowCount = this.#stagePointRequests.length;
        for (let index = 0; index < this.#stageDirectionalRequests.length; index += 1) {
            const staged = this.#stageDirectional[index];
            const light = staged?.light;
            if (!staged || !(light instanceof DirectionalLight)) {
                throw new Error('Directional shadow staging is incomplete');
            }
            light.updateMatrixWorld(true);
            stageDirectionalCamera(staged.camera, light, mainCamera);
            staged.lightSpaceMatrix.multiply(
                staged.camera.viewProjectionMatrix,
                mainCamera.worldMatrix
            );
            finiteMatrix(staged.lightSpaceMatrix, 'Directional shadow lightSpaceMatrix');
            this.#stageLightBlock.directionalBiases[index * 2] = staged.minBias;
            this.#stageLightBlock.directionalBiases[index * 2 + 1] = staged.maxBias;
            this.#stageLightBlock.directionalMatrices.set(
                staged.lightSpaceMatrix.elements,
                index * 16
            );
        }
        for (let index = 0; index < this.#stageSpotRequests.length; index += 1) {
            const staged = this.#stageSpot[index];
            const light = staged?.light;
            if (!staged || !(light instanceof SpotLight)) {
                throw new Error('Spot shadow staging is incomplete');
            }
            light.updateMatrixWorld(true);
            stageSpotCamera(staged.camera, light, mainCamera, tileAspect);
            staged.lightSpaceMatrix.multiply(
                staged.camera.viewProjectionMatrix,
                mainCamera.worldMatrix
            );
            finiteMatrix(staged.lightSpaceMatrix, 'Spot shadow lightSpaceMatrix');
            this.#stageLightBlock.spotBiases[index * 2] = staged.minBias;
            this.#stageLightBlock.spotBiases[index * 2 + 1] = staged.maxBias;
            this.#stageLightBlock.spotMatrices.set(staged.lightSpaceMatrix.elements, index * 16);
        }
        for (let index = 0; index < this.#stagePointRequests.length; index += 1) {
            const staged = this.#stagePoint[index];
            const light = staged?.light;
            if (!staged || !(light instanceof PointLight)) {
                throw new Error('Point shadow staging is incomplete');
            }
            light.updateMatrixWorld(true);
            const planes = resolvePointShadowCameraPlanes(light, mainCamera);
            this.#stageLightBlock.pointBiases[index * 2] = staged.minBias;
            this.#stageLightBlock.pointBiases[index * 2 + 1] = staged.maxBias;
            this.#stageLightBlock.pointCameraPlanes[index * 2] = planes.near;
            this.#stageLightBlock.pointCameraPlanes[index * 2 + 1] = planes.far;
            for (let face = 0; face < 6; face += 1) {
                const camera = staged.cameras[face];
                const matrix = staged.lightSpaceMatrices[face];
                if (!camera || !matrix) throw new Error('Point shadow face staging is incomplete');
                stagePointCamera(camera, light, face, planes.near, planes.far);
                matrix.multiply(camera.viewProjectionMatrix, mainCamera.worldMatrix);
                finiteMatrix(matrix, `Point shadow face ${String(face)} lightSpaceMatrix`);
                this.#stageLightBlock.pointMatrices.set(matrix.elements, (index * 6 + face) * 16);
            }
        }
    }

    private finishStagedLightBlock(atlas: Readonly<ShadowAtlasPlan<ShadowAtlasSceneLight>>): void {
        if (atlas.sliceCount === 0) return;
        this.#stageLightBlock.atlasSize[0] = atlas.width;
        this.#stageLightBlock.atlasSize[1] = atlas.height;
        this.#stageLightBlock.atlasSize[2] = 1 / atlas.width;
        this.#stageLightBlock.atlasSize[3] = 1 / atlas.height;
        for (let index = 0; index < this.#stageDirectionalRequests.length; index += 1) {
            this.#stageLightBlock.directionalMapSizes[index * 2] = atlas.tileWidth;
            this.#stageLightBlock.directionalMapSizes[index * 2 + 1] = atlas.tileHeight;
        }
        for (let index = 0; index < this.#stageSpotRequests.length; index += 1) {
            this.#stageLightBlock.spotMapSizes[index * 2] = atlas.tileWidth;
            this.#stageLightBlock.spotMapSizes[index * 2 + 1] = atlas.tileHeight;
        }
        for (const slice of atlas.slices) {
            const offset = slice.sliceIndex * 4;
            this.#stageLightBlock.atlasRects[offset] = slice.uvRect.width;
            this.#stageLightBlock.atlasRects[offset + 1] = -slice.uvRect.height;
            this.#stageLightBlock.atlasRects[offset + 2] = slice.uvRect.x;
            this.#stageLightBlock.atlasRects[offset + 3] = slice.uvRect.y + slice.uvRect.height;
        }
    }

    private commit(atlas: Readonly<ShadowAtlasPlan<ShadowAtlasSceneLight>>): void {
        this.advanceEpoch();
        this.commitDirectionalRecords();
        this.commitSpotRecords();
        this.commitPointRecords();
        this.pruneRecords();
        this.commitRequests(
            this.#stageDirectionalRequests,
            this.#requestsDirectional,
            this.#requestPools.directional
        );
        this.commitRequests(this.#stageSpotRequests, this.#requestsSpot, this.#requestPools.spot);
        this.commitRequests(
            this.#stagePointRequests,
            this.#requestsPoint,
            this.#requestPools.point
        );
        copyLightBlockState(this.#stageLightBlock, this.#lightBlock);
        this.resizeSlices(atlas.sliceCount);
        for (let index = 0; index < atlas.slices.length; index += 1) {
            const atlasSlice = atlas.slices[index];
            const sceneSlice = this.#activeSlices[index];
            if (!atlasSlice || !sceneSlice) continue;
            const record = this.#records.get(atlasSlice.owner);
            if (!record) continue;
            const lightIndex = this.lightIndex(atlasSlice.kind, atlasSlice.sliceIndex);
            const face = atlasSlice.face ?? 0;
            const camera = record.cameras[face];
            const lightSpaceMatrix = record.lightSpaceMatrices[face];
            if (!camera || !lightSpaceMatrix) continue;
            const biasOffset = lightIndex * 2;
            const biases =
                atlasSlice.kind === 'directional'
                    ? this.#lightBlock.directionalBiases
                    : atlasSlice.kind === 'spot'
                      ? this.#lightBlock.spotBiases
                      : this.#lightBlock.pointBiases;
            sceneSlice.light = atlasSlice.owner;
            sceneSlice.kind = atlasSlice.kind;
            sceneSlice.lightIndex = lightIndex;
            sceneSlice.face = atlasSlice.face;
            sceneSlice.sliceIndex = atlasSlice.sliceIndex;
            sceneSlice.physicalIndex = atlasSlice.physicalIndex;
            sceneSlice.viewport = atlasSlice.viewport;
            sceneSlice.uvRect = atlasSlice.uvRect;
            sceneSlice.camera = camera;
            sceneSlice.viewProjectionMatrix = camera.viewProjectionMatrix;
            sceneSlice.lightSpaceMatrix = lightSpaceMatrix;
            sceneSlice.minBias = biases[biasOffset] ?? 0;
            sceneSlice.maxBias = biases[biasOffset + 1] ?? 0;
            sceneSlice.near = Reflect.get(camera, 'near') as number;
            sceneSlice.far = Reflect.get(camera, 'far') as number;
            const rectOffset = atlasSlice.sliceIndex * 4;
            sceneSlice.atlasRect[0] = this.#lightBlock.atlasRects[rectOffset] ?? 0;
            sceneSlice.atlasRect[1] = this.#lightBlock.atlasRects[rectOffset + 1] ?? 0;
            sceneSlice.atlasRect[2] = this.#lightBlock.atlasRects[rectOffset + 2] ?? 0;
            sceneSlice.atlasRect[3] = this.#lightBlock.atlasRects[rectOffset + 3] ?? 0;
        }
    }

    private commitDirectionalRecords(): void {
        for (let index = 0; index < this.#stageDirectionalRequests.length; index += 1) {
            const staged = this.#stageDirectional[index];
            const light = staged?.light;
            if (!staged || !light) continue;
            const record = this.recordFor(light, 'directional');
            const camera = record.cameras[0];
            const matrix = record.lightSpaceMatrices[0];
            if (camera) copyCamera(staged.camera, camera);
            matrix?.copy(staged.lightSpaceMatrix);
        }
    }

    private commitSpotRecords(): void {
        for (let index = 0; index < this.#stageSpotRequests.length; index += 1) {
            const staged = this.#stageSpot[index];
            const light = staged?.light;
            if (!staged || !light) continue;
            const record = this.recordFor(light, 'spot');
            const camera = record.cameras[0];
            const matrix = record.lightSpaceMatrices[0];
            if (camera) copyCamera(staged.camera, camera);
            matrix?.copy(staged.lightSpaceMatrix);
        }
    }

    private commitPointRecords(): void {
        for (let index = 0; index < this.#stagePointRequests.length; index += 1) {
            const staged = this.#stagePoint[index];
            const light = staged?.light;
            if (!staged || !light) continue;
            const record = this.recordFor(light, 'point');
            for (let face = 0; face < 6; face += 1) {
                const sourceCamera = staged.cameras[face];
                const camera = record.cameras[face];
                const sourceMatrix = staged.lightSpaceMatrices[face];
                const matrix = record.lightSpaceMatrices[face];
                if (sourceCamera && camera) copyCamera(sourceCamera, camera);
                if (sourceMatrix && matrix) matrix.copy(sourceMatrix);
            }
        }
    }

    private recordFor(
        light: ShadowAtlasSceneLight,
        kind: ShadowAtlasLightKind
    ): CommittedLightRecord {
        let record = this.#records.get(light);
        if (!record) {
            record = this.#recordPools[kind].pop() ?? this.createRecord(kind);
            record.light = light;
            record.kind = kind;
            this.#records.set(light, record);
            const retained = this.#records.size + this.totalPooledRecords();
            if (retained > this.#retainedLightCapacity) this.#retainedLightCapacity = retained;
        }
        record.epoch = this.#epoch;
        return record;
    }

    private createRecord(kind: ShadowAtlasLightKind): CommittedLightRecord {
        const cameraCount = kind === 'point' ? 6 : 1;
        const cameras: Camera[] = [];
        const lightSpaceMatrices: Matrix4[] = [];
        for (let index = 0; index < cameraCount; index += 1) {
            cameras.push(
                kind === 'directional' ? new OrthographicCamera() : new PerspectiveCamera()
            );
            lightSpaceMatrices.push(new Matrix4());
        }
        return { light: null, kind, cameras, lightSpaceMatrices, epoch: 0 };
    }

    private pruneRecords(): void {
        for (const [light, record] of this.#records) {
            if (record.epoch === this.#epoch) continue;
            this.#records.delete(light);
            this.releaseRecord(record, true);
        }
    }

    private releaseRecord(record: CommittedLightRecord, pool: boolean): void {
        record.light = null;
        record.epoch = 0;
        for (const camera of record.cameras) {
            camera.removeFromParent();
            camera.off();
        }
        if (pool) this.#recordPools[record.kind].push(record);
    }

    private commitRequests(
        staged: readonly MutableRequest[],
        committed: MutableRequest[],
        pool: MutableRequest[]
    ): void {
        while (committed.length > staged.length) {
            const request = committed.pop();
            if (request) pool.push(request);
        }
        while (committed.length < staged.length) {
            committed.push(pool.pop() ?? createMutableRequest());
        }
        for (let index = 0; index < staged.length; index += 1) {
            const source = staged[index];
            const target = committed[index];
            if (!source || !target) continue;
            target.owner = source.owner;
            target.width = source.width;
            target.height = source.height;
        }
    }

    private resizeSlices(count: number): void {
        while (this.#activeSlices.length > count) {
            const slice = this.#activeSlices.pop();
            if (!slice) break;
            releaseSceneSlice(slice);
            this.#slicePool.push(slice);
        }
        while (this.#activeSlices.length < count) {
            this.#activeSlices.push(this.#slicePool.pop() ?? createMutableSceneSlice());
            if (this.#activeSlices.length > this.#retainedSliceCapacity) {
                this.#retainedSliceCapacity = this.#activeSlices.length;
            }
        }
    }

    private directionalStageAt(
        index: number
    ): StagedPlanarLight<DirectionalLight, OrthographicCamera> {
        let staged = this.#stageDirectional[index];
        if (!staged) {
            staged = {
                light: null,
                request: createMutableRequest(),
                camera: new OrthographicCamera(),
                lightSpaceMatrix: new Matrix4(),
                minBias: 0,
                maxBias: 0
            };
            this.#stageDirectional[index] = staged;
        }
        return staged;
    }

    private spotStageAt(index: number): StagedPlanarLight<SpotLight, PerspectiveCamera> {
        let staged = this.#stageSpot[index];
        if (!staged) {
            staged = {
                light: null,
                request: createMutableRequest(),
                camera: new PerspectiveCamera(),
                lightSpaceMatrix: new Matrix4(),
                minBias: 0,
                maxBias: 0
            };
            this.#stageSpot[index] = staged;
        }
        return staged;
    }

    private pointStageAt(index: number): StagedPointLight {
        let staged = this.#stagePoint[index];
        if (!staged) {
            staged = {
                light: null,
                request: createMutableRequest(),
                cameras: Array.from({ length: 6 }, () => new PerspectiveCamera()),
                lightSpaceMatrices: Array.from({ length: 6 }, () => new Matrix4()),
                minBias: 0,
                maxBias: 0
            };
            this.#stagePoint[index] = staged;
        }
        return staged;
    }

    private lightIndex(kind: ShadowAtlasLightKind, sliceIndex: number): number {
        if (kind === 'directional') return sliceIndex;
        if (kind === 'spot') return sliceIndex - MAX_DIRECTIONAL_LIGHTS;
        return Math.floor((sliceIndex - MAX_DIRECTIONAL_LIGHTS - MAX_SPOT_LIGHTS) / 6);
    }

    private totalRequestCount(): number {
        return (
            this.#stageDirectionalRequests.length +
            this.#stageSpotRequests.length +
            this.#stagePointRequests.length
        );
    }

    private totalPooledRecords(): number {
        return (
            this.#recordPools.directional.length +
            this.#recordPools.spot.length +
            this.#recordPools.point.length
        );
    }

    private advanceEpoch(): void {
        if (this.#epoch === Number.MAX_SAFE_INTEGER) {
            for (const record of this.#records.values()) record.epoch = 0;
            this.#epoch = 1;
        } else {
            this.#epoch++;
        }
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasSceneAdapter is destroyed');
    }
}
