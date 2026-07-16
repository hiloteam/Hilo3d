import type Camera from '../../camera/Camera';
import type Material from '../../material/Material';

declare const cullingResultsHandleBrand: unique symbol;
declare const rendererListHandleBrand: unique symbol;

/** Opaque culling result valid only in the application frame that created it. */
export type CullingResultsHandle = number & {
    readonly [cullingResultsHandleBrand]: true;
};

/** Opaque renderer-list selection valid only in the application frame that created it. */
export type RendererListHandle = number & {
    readonly [rendererListHandleBrand]: true;
};

/** Structured culling options; per-Mesh callbacks are deliberately excluded. */
export interface CullingOptions {
    /** Camera used for culling; defaults to the invocation camera. */
    readonly camera?: Camera;
    /** Disable only geometric frustum rejection while retaining scene collection. */
    readonly frustumCulling?: boolean;
}

/** Material queue selected into a renderer list. */
export type RendererListQueue = 'opaque' | 'transparent' | 'all';
/**
 * Stable renderer-list sorting policy.
 *
 * `material-front-to-back` is valid for opaque/all queues and preserves camera ordering for the
 * transparent subqueue of `all`. `back-to-front` is valid for transparent queues. `none` retains
 * collection order within each draw class while explicit instancing may still group meshes.
 */
export type RendererListSorting = 'material-front-to-back' | 'back-to-front' | 'none';

/** Immutable selection used to prepare one or more scene draw ranges. */
export interface RendererListDescriptor {
    /** Current-frame culling results from which meshes are selected. */
    readonly cullingResults: CullingResultsHandle;
    /** Material queue included in the list. */
    readonly queue: RendererListQueue;
    /** Sorting policy applied before draw preparation. */
    readonly sorting: RendererListSorting;
    /** Optional material used for every selected mesh. */
    readonly overrideMaterial?: Material;
    /** Include only meshes whose effective material casts shadows. */
    readonly castShadowsOnly?: boolean;
}
