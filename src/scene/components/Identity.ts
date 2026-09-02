import { defineComponent } from '../../ecs/Component';

/** Optional authoring/debug name kept out of the base Entity record. */
export interface NameValue {
    readonly value: string;
}

/** Cold identity metadata. Entity identity itself remains an opaque numeric handle. */
export const Name = defineComponent<NameValue>('hilo3d/name');
