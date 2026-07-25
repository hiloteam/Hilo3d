import OrthographicCamera, { type OrthographicCameraParameters } from './OrthographicCamera';

/** Default layer reserved for 2D sprites and canvas text. */
export const DEFAULT_2D_LAYER = 1 << 1;

export interface Camera2DParameters extends Omit<
    OrthographicCameraParameters,
    'left' | 'right' | 'top' | 'bottom' | 'near' | 'far'
> {
    /** Logical viewport width in CSS/game pixels. */
    width?: number;
    /** Logical viewport height in CSS/game pixels. */
    height?: number;
    /** Near plane used by the pixel-space orthographic projection. */
    near?: number;
    /** Far plane used by the pixel-space orthographic projection. */
    far?: number;
}

/**
 * Pixel-space orthographic camera for 2D scenes and UI overlays.
 *
 * The origin is the top-left corner, X grows right, and Y grows down. The camera defaults to the
 * dedicated 2D layer and preserves color from earlier cameras, so it can be appended directly
 * after a 3D camera on `Stage.cameras`.
 */
class Camera2D extends OrthographicCamera {
    static override readonly typeName: string = 'Camera2D';
    readonly isCamera2D = true;
    override className = 'Camera2D';
    private viewportWidth = 1;
    private viewportHeight = 1;

    constructor(params: Camera2DParameters = {}) {
        const width = params.width ?? 1;
        const height = params.height ?? 1;
        const near = params.near ?? 0.1;
        const far = params.far ?? 2000;
        const cameraParameters = { ...params };
        Reflect.deleteProperty(cameraParameters, 'width');
        Reflect.deleteProperty(cameraParameters, 'height');
        super({
            ...cameraParameters,
            left: 0,
            right: width,
            top: 0,
            bottom: height,
            near,
            far,
            visibility: params.visibility ?? DEFAULT_2D_LAYER,
            clearColor: params.clearColor ?? false,
            priority: params.priority ?? 100,
            x: params.x ?? 0,
            y: params.y ?? 0,
            z: params.z ?? 1000
        });
        this.resize(width, height);
    }

    /** Logical pixel-space width. */
    get width(): number {
        return this.viewportWidth;
    }

    /** Logical pixel-space height. */
    get height(): number {
        return this.viewportHeight;
    }

    /**
     * Update the pixel-space projection after the Stage size changes.
     * @param width - Positive logical width.
     * @param height - Positive logical height.
     */
    resize(width: number, height: number): this {
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new RangeError('Camera2D dimensions must be positive finite numbers.');
        }
        this.viewportWidth = width;
        this.viewportHeight = height;
        this.left = 0;
        this.right = width;
        this.top = 0;
        this.bottom = height;
        return this;
    }
}

export default Camera2D;
