import type { CameraDepthMode } from '../../camera/Camera';
import type { RHICompareFunction } from '../rhi/core';

export function depthClearValue(mode: CameraDepthMode): 0 | 1 {
    return mode === 'reversed' ? 0 : 1;
}

export function depthComparison(mode: CameraDepthMode): 'greater-equal' | 'less-equal' {
    return mode === 'reversed' ? 'greater-equal' : 'less-equal';
}

export function applyDepthModeToComparison(
    comparison: RHICompareFunction,
    mode: CameraDepthMode
): RHICompareFunction {
    if (mode !== 'reversed') return comparison;
    switch (comparison) {
        case 'less':
            return 'greater';
        case 'less-equal':
            return 'greater-equal';
        case 'greater':
            return 'less';
        case 'greater-equal':
            return 'less-equal';
        default:
            return comparison;
    }
}
