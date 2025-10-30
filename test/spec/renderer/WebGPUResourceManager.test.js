const WebGPUResourceManager = Hilo3d.WebGPUResourceManager;

describe('WebGPUResourceManager', () => {
    it('create', () => {
        const manager = new WebGPUResourceManager();
        manager.isWebGPUResourceManager.should.be.true();
        manager.className.should.equal('WebGPUResourceManager');
    });

    it('should initialize with default values', () => {
        const manager = new WebGPUResourceManager();
        manager.hasNeedDestroyResource.should.be.false();
    });

    it('getMeshResources', () => {
        const manager = new WebGPUResourceManager();
        const mesh = { id: 'test-mesh-1' };
        const resources = manager.getMeshResources(mesh);
        resources.should.be.an.Array();
        resources.length.should.equal(0);
    });

    it('addMeshResource', () => {
        const manager = new WebGPUResourceManager();
        const mesh = { id: 'test-mesh-1' };
        const resource = { id: 'test-resource-1' };

        manager.addMeshResource(mesh, resource);
        const resources = manager.getMeshResources(mesh);
        resources.length.should.equal(1);
        resources[0].should.equal(resource);
    });

    it('should not add duplicate resources', () => {
        const manager = new WebGPUResourceManager();
        const mesh = { id: 'test-mesh-1' };
        const resource = { id: 'test-resource-1' };

        manager.addMeshResource(mesh, resource);
        manager.addMeshResource(mesh, resource);
        const resources = manager.getMeshResources(mesh);
        resources.length.should.equal(1);
    });

    it('addNeedDestroyResource', () => {
        const manager = new WebGPUResourceManager();
        const resource = { id: 'test-resource-1' };

        manager.hasNeedDestroyResource.should.be.false();
        manager.addNeedDestroyResource(resource);
        manager.hasNeedDestroyResource.should.be.true();
    });

    it('destroyResource', (done) => {
        const manager = new WebGPUResourceManager();
        const resource = { id: 'test-resource-1' };

        manager.on('destroyResource', (res) => {
            res.should.equal(resource);
            manager.hasNeedDestroyResource.should.be.false();
            done();
        });

        manager.addNeedDestroyResource(resource);
        manager.destroyResource();
    });

    it('setBuffer and getBuffer', () => {
        const manager = new WebGPUResourceManager();
        const key = { id: 'buffer-key' };
        const buffer = { mockBuffer: true };

        manager.setBuffer(key, buffer);
        const retrieved = manager.getBuffer(key);
        retrieved.should.equal(buffer);
    });

    it('setTexture and getTexture', () => {
        const manager = new WebGPUResourceManager();
        const key = { id: 'texture-key' };
        const texture = { mockTexture: true };

        manager.setTexture(key, texture);
        const retrieved = manager.getTexture(key);
        retrieved.should.equal(texture);
    });

    it('setPipeline and getPipeline', () => {
        const manager = new WebGPUResourceManager();
        const key = { id: 'pipeline-key' };
        const pipeline = { mockPipeline: true };

        manager.setPipeline(key, pipeline);
        const retrieved = manager.getPipeline(key);
        retrieved.should.equal(pipeline);
    });

    it('setBindGroup and getBindGroup', () => {
        const manager = new WebGPUResourceManager();
        const key = { id: 'bindgroup-key' };
        const bindGroup = { mockBindGroup: true };

        manager.setBindGroup(key, bindGroup);
        const retrieved = manager.getBindGroup(key);
        retrieved.should.equal(bindGroup);
    });

    it('destroyIfNoRef', () => {
        const manager = new WebGPUResourceManager();
        const mockDestroy = sinon.stub();
        const resource = {
            _gpuResource: {
                destroy: mockDestroy
            }
        };

        manager.destroyIfNoRef(resource);
        mockDestroy.should.have.callCount(1);
        (resource._gpuResource === null).should.be.true();
        manager.hasNeedDestroyResource.should.be.true();
    });
});
