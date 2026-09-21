import { Texture, constants } from 'hilo3d';

/** Motion reference for an application-owned Cubism Framework motion manager. */
export interface Live2DMotionReference {
    /** Absolute URL of the motion3 JSON resource. */
    readonly url: string;
    /** Optional absolute URL of the motion's associated audio resource. */
    readonly soundUrl?: string;
    /** Optional fade-in duration in seconds, as declared by the model3 manifest. */
    readonly fadeInTime?: number;
    /** Optional fade-out duration in seconds, as declared by the model3 manifest. */
    readonly fadeOutTime?: number;
}

/** Named expression reference for an application-owned Cubism Framework expression manager. */
export interface Live2DExpressionReference {
    /** Expression name declared by the model3 manifest. */
    readonly name: string;
    /** Absolute URL of the exp3 JSON resource. */
    readonly url: string;
}

/** Validated model3 metadata. Asset references are resolved relative to the model3 response URL. */
export interface Live2DModelSettings {
    /** Supported model3 manifest format version. */
    readonly version: 3;
    /** Absolute model3 response URL, including any followed redirect. */
    readonly modelUrl: string;
    /** Absolute URL of the model's moc3 binary. */
    readonly mocUrl: string;
    /** Absolute image URLs in drawable texture-slot order. */
    readonly textureUrls: readonly string[];
    /** Motion references indexed by the manifest's motion-group names. */
    readonly motions: Readonly<Record<string, readonly Live2DMotionReference[]>>;
    /** Named expression references in manifest order. */
    readonly expressions: readonly Live2DExpressionReference[];
    /** Optional absolute URL of the physics3 JSON resource. */
    readonly physicsUrl?: string;
    /** Optional absolute URL of the pose3 JSON resource. */
    readonly poseUrl?: string;
    /** Optional absolute URL of the display-information JSON resource. */
    readonly displayInfoUrl?: string;
    /** Numeric layout properties passed through from the manifest. */
    readonly layout: Readonly<Record<string, number>>;
    /** Hit-area metadata for application-owned interaction handling. */
    readonly hitAreas: readonly {
        /** Drawable identifier associated with the hit area. */
        readonly id: string;
        /** Application-facing name of the hit area. */
        readonly name: string;
    }[];
    /** Named parameter or part groups, such as EyeBlink and LipSync. */
    readonly groups: readonly {
        /** Kind of model object addressed by the group. */
        readonly target: string;
        /** Group name declared by the manifest. */
        readonly name: string;
        /** Model-local member identifiers in manifest order. */
        readonly ids: readonly string[];
    }[];
}

/** Cancellation for a model3/moc3/image load. */
export interface Live2DAssetLoadOptions {
    /** Abort pending requests and release resources already allocated by this load. */
    readonly signal?: AbortSignal;
    /** Explicit deployment version added as hilo_v to the manifest and every referenced asset. */
    readonly assetVersion?: string;
}

/** Owned input assets; Core model and motion resources are managed separately by the application. */
export interface Live2DAssets {
    /** Validated model metadata with resolved absolute asset references. */
    readonly settings: Live2DModelSettings;
    /** Original model3 JSON bytes, suitable for CubismModelSettingJson. */
    readonly model3: ArrayBuffer;
    /** Original moc3 bytes for constructing the application's Core model. */
    readonly moc: ArrayBuffer;
    /** Straight-alpha images in engine top-left texture coordinates. */
    readonly textures: readonly Texture[];
    /** Release all loaded texture resources and image bitmaps. Safe to call repeatedly. */
    destroy(): void;
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Live2D model3 ${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`Live2D model3 ${label} must be an array`);
    return value as readonly unknown[];
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Live2D model3 ${label} must be a non-empty string`);
    }
    return value;
}

function number(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Live2D model3 ${label} must be finite`);
    }
    return value;
}

function versionedURL(url: URL, assetVersion: string | undefined): string {
    if (assetVersion !== undefined) url.searchParams.set('hilo_v', assetVersion);
    return url.href;
}

function parseSettings(
    bytes: ArrayBuffer,
    modelUrl: string,
    assetVersion: string | undefined
): Live2DModelSettings {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const root = record(json, 'root');
    if (root['Version'] !== 3) throw new Error('Live2D model3 Version must be 3');
    const files = record(root['FileReferences'], 'FileReferences');
    const resolve = (value: unknown, label: string): string =>
        versionedURL(new URL(string(value, label), modelUrl), assetVersion);
    const motions: Record<string, readonly Live2DMotionReference[]> = Object.create(null) as Record<
        string,
        readonly Live2DMotionReference[]
    >;
    if (files['Motions'] !== undefined) {
        for (const [name, value] of Object.entries(record(files['Motions'], 'Motions'))) {
            motions[name] = array(value, `Motions.${name}`).map(entry => {
                const motion = record(entry, `Motions.${name} entry`);
                return {
                    url: resolve(motion['File'], 'motion File'),
                    ...(motion['Sound'] === undefined
                        ? {}
                        : { soundUrl: resolve(motion['Sound'], 'motion Sound') }),
                    ...(motion['FadeInTime'] === undefined
                        ? {}
                        : { fadeInTime: number(motion['FadeInTime'], 'motion FadeInTime') }),
                    ...(motion['FadeOutTime'] === undefined
                        ? {}
                        : { fadeOutTime: number(motion['FadeOutTime'], 'motion FadeOutTime') })
                };
            });
        }
    }
    const layout: Record<string, number> = {};
    if (root['Layout'] !== undefined) {
        for (const [key, value] of Object.entries(record(root['Layout'], 'Layout'))) {
            Object.defineProperty(layout, key, {
                value: number(value, `Layout.${key}`),
                enumerable: true
            });
        }
    }
    return {
        version: 3,
        modelUrl,
        mocUrl: resolve(files['Moc'], 'Moc'),
        textureUrls: array(files['Textures'], 'Textures').map(value => resolve(value, 'texture')),
        motions,
        expressions: array(files['Expressions'] ?? [], 'Expressions').map(entry => {
            const expression = record(entry, 'expression');
            return {
                name: string(expression['Name'], 'expression Name'),
                url: resolve(expression['File'], 'expression File')
            };
        }),
        ...(files['Physics'] === undefined
            ? {}
            : { physicsUrl: resolve(files['Physics'], 'Physics') }),
        ...(files['Pose'] === undefined ? {} : { poseUrl: resolve(files['Pose'], 'Pose') }),
        ...(files['DisplayInfo'] === undefined
            ? {}
            : { displayInfoUrl: resolve(files['DisplayInfo'], 'DisplayInfo') }),
        layout,
        hitAreas: array(root['HitAreas'] ?? [], 'HitAreas').map(entry => {
            const area = record(entry, 'hit area');
            return {
                id: string(area['Id'], 'hit area Id'),
                name: string(area['Name'], 'hit area Name')
            };
        }),
        groups: array(root['Groups'] ?? [], 'Groups').map(entry => {
            const group = record(entry, 'group');
            return {
                target: string(group['Target'], 'group Target'),
                name: string(group['Name'], 'group Name'),
                ids: array(group['Ids'], 'group Ids').map(value => string(value, 'group ID'))
            };
        })
    };
}

async function request(url: string, signal: AbortSignal | undefined): Promise<Response> {
    signal?.throwIfAborted();
    const response = await fetch(url, signal === undefined ? {} : { signal });
    if (!response.ok)
        throw new Error(`Live2D asset request failed (${String(response.status)}): ${url}`);
    signal?.throwIfAborted();
    return response;
}

/**
 * Load a model3 manifest, moc3 bytes and straight-alpha textures without executing SDK code.
 * Motion, expression, physics and pose references are returned for the application's Framework
 * integration. Cancelling or failing a load destroys every texture already created. Successful
 * assets retain their image sources for renderer device recovery until `destroy()` is called.
 */
export async function loadLive2DAssets(
    model3Url: string | URL,
    options: Live2DAssetLoadOptions = {}
): Promise<Live2DAssets> {
    const { signal, assetVersion } = options;
    if (
        assetVersion !== undefined &&
        (typeof assetVersion !== 'string' || assetVersion.trim().length === 0)
    ) {
        throw new TypeError('Live2D assetVersion must be a non-empty string.');
    }
    const url = versionedURL(
        new URL(model3Url, typeof document === 'undefined' ? undefined : document.baseURI),
        assetVersion
    );
    const response = await request(url, signal);
    const model3 = await response.arrayBuffer();
    signal?.throwIfAborted();
    const settings = parseSettings(
        model3,
        versionedURL(new URL(response.url || url), assetVersion),
        assetVersion
    );
    const moc = await (await request(settings.mocUrl, signal)).arrayBuffer();
    signal?.throwIfAborted();
    const textures: Texture<ImageBitmap>[] = [];
    let destroyed = false;
    const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        const failures: unknown[] = [];
        for (const texture of textures) {
            try {
                texture.destroy();
            } catch (error: unknown) {
                failures.push(error);
            } finally {
                texture.image?.close();
            }
        }
        if (failures.length !== 0)
            throw new AggregateError(failures, 'Live2D texture cleanup failed');
    };
    try {
        for (const textureUrl of settings.textureUrls) {
            const blob = await (await request(textureUrl, signal)).blob();
            signal?.throwIfAborted();
            const image = await createImageBitmap(blob, {
                premultiplyAlpha: 'none',
                imageOrientation: 'none',
                colorSpaceConversion: 'none'
            });
            try {
                signal?.throwIfAborted();
                textures.push(
                    new Texture<ImageBitmap>({
                        name: textureUrl,
                        image,
                        isImageCanRelease: false,
                        premultiplyAlpha: false,
                        flipY: false,
                        wrapS: constants.CLAMP_TO_EDGE,
                        wrapT: constants.CLAMP_TO_EDGE,
                        minFilter: constants.LINEAR,
                        magFilter: constants.LINEAR
                    })
                );
            } catch (error: unknown) {
                image.close();
                throw error;
            }
        }
        signal?.throwIfAborted();
        return { settings, model3, moc, textures, destroy };
    } catch (error: unknown) {
        try {
            destroy();
        } catch (cleanupError: unknown) {
            throw new AggregateError(
                [error, cleanupError],
                'Live2D asset load and cleanup failed',
                { cause: cleanupError }
            );
        }
        throw error;
    }
}
