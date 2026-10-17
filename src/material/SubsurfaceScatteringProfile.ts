/** Immutable RGB characteristic diffusion distances, expressed in scene world units. */
export interface SubsurfaceScatteringProfileOptions {
    /** Positive red, green and blue distances. Defaults to millimetre-scale skin in a metre scene. */
    readonly radius?: readonly [number, number, number];
}

/**
 * A separable diffusion profile shared by opaque or alpha-masked PBR surfaces.
 *
 * Radius is the standard deviation of each channel's bounded Gaussian diffusion kernel, in the
 * same units as mesh positions and camera distance. Equal radius triples are the same profile;
 * profile identity never depends on a process-global counter. Thickness limits each radius.
 */
export class SubsurfaceScatteringProfile {
    /** Immutable positive RGB diffusion distances in world units. */
    readonly radius: readonly [number, number, number];

    constructor(options: Readonly<SubsurfaceScatteringProfileOptions> = {}) {
        const radius = options.radius ?? [0.001, 0.00035, 0.0002];
        if (
            Array.from(radius).length !== 3 ||
            radius.some(value => !Number.isFinite(value) || value < 0.00001 || value > 10000)
        ) {
            throw new RangeError(
                'SubsurfaceScatteringProfile radius must contain three finite values from 0.00001 to 10000 world units'
            );
        }
        this.radius = Object.freeze([radius[0], radius[1], radius[2]]);
        Object.freeze(this);
    }
}
