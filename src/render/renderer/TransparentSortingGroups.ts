import type Camera from '../../camera/Camera';
import type Mesh from '../../core/Mesh';
import type Node from '../../core/Node';
import type Material from '../../material/MaterialInstance';
import Vector3 from '../../math/Vector3';

interface SortEntry {
    readonly groups: Node[];
    inputIndex: number;
    depth: number;
}

interface GroupEntry {
    epoch: number;
    inputIndex: number;
    depth: number;
}

/** Reusable transparent-only grouping layered over the existing ungrouped draw planner. */
export class TransparentSortingGroups {
    readonly #entries = new WeakMap<Mesh, SortEntry>();
    #groups = new WeakMap<Node, GroupEntry>();
    #epoch = 0;
    readonly #transparent: Mesh[] = [];
    readonly #position = new Vector3();
    #materialOverride: Material | null = null;
    #camera: Camera | null = null;
    active = false;

    readonly #compare = (a: Mesh, b: Mesh): number => {
        const aEntry = this.requireEntry(a);
        const bEntry = this.requireEntry(b);
        let common = 0;
        while (
            common < aEntry.groups.length &&
            common < bEntry.groups.length &&
            aEntry.groups[common] === bEntry.groups[common]
        )
            common++;
        const aGroup = aEntry.groups[common];
        const bGroup = bEntry.groups[common];
        const aUnit = aGroup ?? a;
        const bUnit = bGroup ?? b;
        if (aUnit.sortingLayer !== bUnit.sortingLayer)
            return aUnit.sortingLayer - bUnit.sortingLayer;
        if (aUnit.zIndex !== bUnit.zIndex) return aUnit.zIndex - bUnit.zIndex;
        const aOrder =
            aGroup !== undefined || Reflect.get(a, 'isSprite') === true ? 0 : a.renderOrder;
        const bOrder =
            bGroup !== undefined || Reflect.get(b, 'isSprite') === true ? 0 : b.renderOrder;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aKey = aGroup === undefined ? aEntry : this.requireGroup(aGroup);
        const bKey = bGroup === undefined ? bEntry : this.requireGroup(bGroup);
        if (aKey.depth !== bKey.depth) return aKey.depth - bKey.depth;
        return aKey.inputIndex - bKey.inputIndex;
    };

    prepare(
        meshes: readonly Mesh[],
        materialOverride: Material | null,
        camera: Camera | null
    ): void {
        this.reset();
        // No group arrays/entries are created unless a visible transparent input belongs to one.
        for (const mesh of meshes) {
            if ((materialOverride ?? mesh.material)?.forwardQueue !== 'transparent') continue;
            for (let ancestor: Node | null = mesh; ancestor !== null; ancestor = ancestor.parent) {
                if (ancestor.sortingGroup) {
                    this.active = true;
                    break;
                }
            }
            if (this.active) break;
        }
        if (!this.active) return;
        if (this.#epoch === Number.MAX_SAFE_INTEGER) {
            this.#groups = new WeakMap();
            this.#epoch = 0;
        }
        this.#epoch++;
        this.#materialOverride = materialOverride;
        this.#camera = camera;
        for (let index = 0; index < meshes.length; index++) {
            const mesh = meshes[index];
            if (
                mesh === undefined ||
                (materialOverride ?? mesh.material)?.forwardQueue !== 'transparent'
            )
                continue;
            let entry = this.#entries.get(mesh);
            if (entry === undefined) {
                entry = { groups: [], inputIndex: index, depth: 0 };
                this.#entries.set(mesh, entry);
            }
            entry.inputIndex = index;
            entry.depth = this.depth(mesh);
            entry.groups.length = 0;
            for (let ancestor: Node | null = mesh; ancestor !== null; ancestor = ancestor.parent) {
                if (!ancestor.sortingGroup) continue;
                entry.groups.push(ancestor);
                let group = this.#groups.get(ancestor);
                if (group === undefined) {
                    group = { epoch: -1, inputIndex: index, depth: 0 };
                    this.#groups.set(ancestor, group);
                }
                if (group.epoch !== this.#epoch) {
                    group.epoch = this.#epoch;
                    group.inputIndex = index;
                    group.depth = this.depth(ancestor);
                }
            }
            entry.groups.reverse();
            this.#transparent.push(mesh);
        }
    }

    sort(meshes: Mesh[]): void {
        if (!this.active) return;
        this.#transparent.sort(this.#compare);
        let transparentIndex = 0;
        for (let index = 0; index < meshes.length; index++) {
            const mesh = meshes[index];
            if (
                mesh === undefined ||
                (this.#materialOverride ?? mesh.material)?.forwardQueue !== 'transparent'
            )
                continue;
            const sorted = this.#transparent[transparentIndex++];
            if (sorted === undefined)
                throw new Error('Transparent sorting group input is incomplete');
            meshes[index] = sorted;
        }
    }

    group(mesh: Mesh): Node | null {
        if (!this.active) return null;
        return this.requireEntry(mesh).groups.at(-1) ?? null;
    }

    reset(): void {
        this.active = false;
        for (const mesh of this.#transparent) this.requireEntry(mesh).groups.length = 0;
        this.#transparent.length = 0;
        this.#materialOverride = null;
        this.#camera = null;
    }

    private requireEntry(mesh: Mesh): SortEntry {
        const entry = this.#entries.get(mesh);
        if (entry === undefined) throw new Error('Transparent sorting group entry is missing');
        return entry;
    }

    private requireGroup(node: Node): GroupEntry {
        const group = this.#groups.get(node);
        if (group?.epoch !== this.#epoch) {
            throw new Error('Transparent sorting group key is missing');
        }
        return group;
    }

    private depth(node: Node): number {
        if (this.#camera === null) return 0;
        node.worldMatrix.getTranslation(this.#position);
        this.#position.transformMat4(this.#camera.viewMatrix);
        return this.#position.z;
    }
}
