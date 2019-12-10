/* global HILO3D_VERSION */

import * as math from './math/';

Object.assign(math, {
    version: HILO3D_VERSION
});

if (typeof window !== 'undefined') {
    window.Hilo3dMath = math;
}

export default math;
