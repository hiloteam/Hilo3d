import { createSRPFixture } from './srp-production';
const query = new URLSearchParams(location.search);
const backend = query.get('backend');
const workload = query.get('workload');
if (backend !== 'webgl2' && backend !== 'webgpu') throw new Error('Invalid SRP backend');
if (workload !== 'default' && workload !== 'postprocess' && workload !== 'custom')
    throw new Error('Invalid SRP workload');
window.__HILO3D_SRP_BENCHMARK__ = await createSRPFixture(backend, workload, query.has('native'));
