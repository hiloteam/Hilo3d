import type Mesh from '../../core/Mesh';
import SkinnedMesh from '../../core/SkinnedMesh';
import type Geometry from '../../geometry/Geometry';
import type GeometryData from '../../geometry/GeometryData';
import MorphGeometry from '../../geometry/MorphGeometry';

const BASE_STREAMS = ['vertices', 'normals', 'indices', 'skinIndices', 'skinWeights'] as const;
const MORPH_STREAMS = ['vertices', 'normals', 'tangents'] as const;

class NumericSnapshot {
    readonly values: number[] = [];

    update(source: ArrayLike<number> | null, length = source?.length ?? 0): boolean {
        let changed = this.values.length !== length;
        this.values.length = length;
        for (let index = 0; index < length; index++) {
            const value = Math.fround(source?.[index] ?? 0);
            changed ||= this.values[index] !== value;
            this.values[index] = value;
        }
        return changed;
    }
}

class StreamSnapshot {
    source: GeometryData | null = null;
    revision = -1;
    size = 0;
    stride = 0;
    offset = 0;
    type = 0;
    normalized = false;

    update(source: GeometryData | null | undefined): boolean {
        const current = source ?? null;
        let changed = this.source !== current;
        this.source = current;
        if (current === null) return changed;
        changed ||=
            this.revision !== current.revision ||
            this.size !== current.size ||
            this.stride !== current.stride ||
            this.offset !== current.offset ||
            this.type !== current.type ||
            this.normalized !== current.normalized;
        this.revision = current.revision;
        this.size = current.size;
        this.stride = current.stride;
        this.offset = current.offset;
        this.type = current.type;
        this.normalized = current.normalized;
        return changed;
    }
}

/**
 * @internal Reusable CPU identity for the pose that samples a world-space decal.
 * Versions describe observed content only; each renderer commits the version independently with
 * its existing motion participation transaction. No geometry-sized vertex copy is required.
 */
export class DecalReceiverPose {
    readonly #world = new NumericSnapshot();
    readonly #joints = new NumericSnapshot();
    readonly #weights = new NumericSnapshot();
    readonly #positionDecode = new NumericSnapshot();
    readonly #normalDecode = new NumericSnapshot();
    readonly #streams = Array.from(
        { length: BASE_STREAMS.length + 1 + MORPH_STREAMS.length * 8 },
        () => new StreamSnapshot()
    );
    #geometry: Geometry | null = null;
    #geometryRevision = -1;
    #revision = 0;

    observe(mesh: Mesh): number {
        const geometry = mesh.geometry;
        let changed = this.#world.update(mesh.worldMatrix.elements);
        const jointsChanged = this.#joints.update(
            mesh instanceof SkinnedMesh ? mesh.getJointMat() : null
        );
        changed ||= jointsChanged;
        changed ||= this.#geometry !== geometry;
        this.#geometry = geometry;
        const positionDecodeChanged = this.#positionDecode.update(
            geometry?.positionDecodeMat ?? null
        );
        const normalDecodeChanged = this.#normalDecode.update(geometry?.normalDecodeMat ?? null);
        changed ||= positionDecodeChanged || normalDecodeChanged;
        let slot = 0;
        for (const name of BASE_STREAMS) {
            const streamChanged = this.stream(slot++).update(geometry?.[name]);
            changed ||= streamChanged;
        }
        // Do not materialize unused tangent streams: their lazy getters require UVs and can
        // allocate geometry. Select the same active tangent basis as the built-in PBR semantic.
        const material = mesh.material;
        const needsTangent = material?.definition.staticFeatures['HAS_TANGENT'] === 1;
        const normalSlot = needsTangent
            ? (material.getTextureSlot('normal') ?? material.getTextureSlot('clearcoatNormal'))
            : null;
        const tangent =
            geometry !== null && needsTangent
                ? normalSlot?.uvSet === 1
                    ? geometry.tangents1
                    : geometry.tangents
                : null;
        const tangentChanged = this.stream(slot++).update(tangent);
        changed ||= tangentChanged;
        const morph = geometry instanceof MorphGeometry ? geometry : null;
        // Match MorphGeometry.getRenderOption's bounded active slot count without creating an
        // option object or Object.entries arrays on each material/skin/morph history query.
        let targetKinds = 0;
        let lastTargetCount = 0;
        if (morph?.targets) {
            for (const name in morph.targets) {
                if (!Object.hasOwn(morph.targets, name)) continue;
                targetKinds++;
                lastTargetCount = morph.targets[name]?.length ?? 0;
            }
        }
        const count =
            targetKinds === 0 ? 0 : Math.min(lastTargetCount, Math.floor(8 / targetKinds));
        const weightsChanged = this.#weights.update(morph?.weights ?? null, count);
        changed ||= weightsChanged;
        for (const name of MORPH_STREAMS) {
            for (let index = 0; index < 8; index++) {
                const streamChanged = this.stream(slot++).update(
                    index < count ? morph?.getMorphTarget(name, index) : null
                );
                changed ||= streamChanged;
            }
        }
        // Lazy canonical normals/tangents above may finalize a geometry recipe on first use.
        changed ||= this.#geometryRevision !== (geometry?.revision ?? -1);
        this.#geometryRevision = geometry?.revision ?? -1;
        if (changed) this.#revision++;
        return this.#revision;
    }

    private stream(index: number): StreamSnapshot {
        const stream = this.#streams[index];
        if (stream === undefined) throw new Error('Missing decal receiver stream snapshot');
        return stream;
    }
}
