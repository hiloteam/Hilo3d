import type Light from '../../../../light/Light';
import type LightManager from '../../../../light/LightManager';
import type LightShadow from './LightShadow';

const managerShadows = new WeakMap<LightManager, Map<Light, LightShadow>>();

/** Internal WebGL shadow runtime; deliberately absent from the public light declarations. */
export function getLightShadow(manager: LightManager, light: Light): LightShadow | null {
    return managerShadows.get(manager)?.get(light) ?? null;
}

/** Associate a backend-internal shadow renderer with its public light owner. */
export function setLightShadow(manager: LightManager, light: Light, shadow: LightShadow): void {
    let shadows = managerShadows.get(manager);
    if (!shadows) {
        shadows = new Map();
        managerShadows.set(manager, shadows);
    }
    shadows.set(light, shadow);
}

/** Release runtimes whose lights no longer participate in this renderer's shadow pass. */
export function pruneLightShadows(manager: LightManager, activeLights: ReadonlySet<Light>): void {
    const shadows = managerShadows.get(manager);
    if (!shadows) return;
    for (const [light, shadow] of shadows) {
        if (activeLights.has(light)) continue;
        shadow.destroy();
        shadows.delete(light);
    }
    if (shadows.size === 0) managerShadows.delete(manager);
}

/** Release every WebGL shadow runtime owned by one renderer-local light manager. */
export function clearLightShadows(manager: LightManager): void {
    const shadows = managerShadows.get(manager);
    if (!shadows) return;
    for (const shadow of shadows.values()) shadow.destroy();
    managerShadows.delete(manager);
}
