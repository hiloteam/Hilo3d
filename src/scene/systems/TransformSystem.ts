import {
    WORLD_SYSTEM_API_VERSION,
    type WorldSystem,
    type WorldSystemRuntime
} from '../../ecs/System';
import {
    getHierarchyStore,
    getInterpolatedTransformStore,
    getTransformStore,
    Hierarchy,
    InterpolatedTransform,
    LocalTransform,
    WorldTransform,
    WorldTransformStore
} from '../components/Transform';

/** Stable identity used by animation, physics, and render extraction ordering. */
export const TRANSFORM_SYSTEM_ID = 'hilo3d/transform';

/** Create the allocation-stable hierarchy and world-matrix maintenance System. */
export function createTransformSystem(): WorldSystem {
    return {
        descriptor: {
            id: TRANSFORM_SYSTEM_ID,
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'transform',
            access: {
                reads: [Hierarchy, InterpolatedTransform],
                writes: [LocalTransform, WorldTransform]
            }
        },
        setup(context): WorldSystemRuntime {
            const transforms = getTransformStore(context.world);
            const interpolated = getInterpolatedTransformStore(context.world);
            const hierarchy = getHierarchyStore(context.world);
            context.world.registerDerivedStore(WorldTransform, new WorldTransformStore(transforms));
            return {
                execute(execution): void {
                    transforms.flushDetachedHierarchy(hierarchy);
                    hierarchy.applyChanges(execution.world, transforms);
                    interpolated.apply(transforms, execution.interpolationAlpha);
                    transforms.updateWorldMatrices();
                }
            };
        }
    };
}
