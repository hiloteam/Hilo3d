const WebGPUState = Hilo3d.WebGPUState;

describe('WebGPUState', () => {
    let mockDevice;

    beforeEach(() => {
        mockDevice = {};
    });

    it('create', () => {
        const state = new WebGPUState(mockDevice);
        state.isWebGPUState.should.be.true();
        state.className.should.equal('WebGPUState');
    });

    it('should initialize with device', () => {
        const state = new WebGPUState(mockDevice);
        state.device.should.equal(mockDevice);
    });

    it('should have default viewport state', () => {
        const state = new WebGPUState(mockDevice);
        state.viewportState.should.have.property('x', 0);
        state.viewportState.should.have.property('y', 0);
        state.viewportState.should.have.property('width', 0);
        state.viewportState.should.have.property('height', 0);
        state.viewportState.should.have.property('minDepth', 0);
        state.viewportState.should.have.property('maxDepth', 1);
    });

    it('should have default scissor state', () => {
        const state = new WebGPUState(mockDevice);
        state.scissorState.should.have.property('x', 0);
        state.scissorState.should.have.property('y', 0);
        state.scissorState.should.have.property('width', 0);
        state.scissorState.should.have.property('height', 0);
    });

    it('viewport', () => {
        const state = new WebGPUState(mockDevice);
        state.viewport(10, 20, 800, 600);
        state.viewportState.x.should.equal(10);
        state.viewportState.y.should.equal(20);
        state.viewportState.width.should.equal(800);
        state.viewportState.height.should.equal(600);
    });

    it('viewport with depth', () => {
        const state = new WebGPUState(mockDevice);
        state.viewport(0, 0, 800, 600, 0.1, 0.9);
        state.viewportState.minDepth.should.equal(0.1);
        state.viewportState.maxDepth.should.equal(0.9);
    });

    it('scissor', () => {
        const state = new WebGPUState(mockDevice);
        state.scissor(10, 20, 300, 400);
        state.scissorState.x.should.equal(10);
        state.scissorState.y.should.equal(20);
        state.scissorState.width.should.equal(300);
        state.scissorState.height.should.equal(400);
    });

    it('setPipeline', () => {
        const state = new WebGPUState(mockDevice);
        const mockPipeline = {};
        state.setPipeline(mockPipeline);
        state.currentPipeline.should.equal(mockPipeline);
    });

    it('setBindGroup', () => {
        const state = new WebGPUState(mockDevice);
        const mockBindGroup = {};
        state.setBindGroup(mockBindGroup);
        state.currentBindGroup.should.equal(mockBindGroup);
    });

    it('reset', () => {
        const state = new WebGPUState(mockDevice);
        state.viewport(10, 20, 800, 600);
        state.setPipeline({});

        state.reset();
        state.currentPipeline.should.equal(null);
        state.viewportState.x.should.equal(0);
        state.viewportState.y.should.equal(0);
    });
});
