import { describeRHIContract } from './RHIContract';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from './FakeRHIBackend';

describeRHIContract('Fake WebGL', () => {
    const backend = new FakeWebGLRHIBackend();
    return {
        backend,
        device: backend.createDevice(),
        executionMode: backend.executionMode
    };
});

describeRHIContract('Fake WebGPU', () => {
    const backend = new FakeWebGPURHIBackend();
    return {
        backend,
        device: backend.createDevice(),
        executionMode: backend.executionMode
    };
});
