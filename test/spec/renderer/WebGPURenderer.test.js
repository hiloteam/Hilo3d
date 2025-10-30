const WebGPURenderer = Hilo3d.WebGPURenderer;
const WebGPUSupport = Hilo3d.WebGPUSupport;

describe('WebGPURenderer', () => {
    it('create', () => {
        const renderer = new WebGPURenderer();
        renderer.isWebGPURenderer.should.be.true();
        renderer.className.should.equal('WebGPURenderer');
    });

    it('should have required properties', () => {
        const renderer = new WebGPURenderer();
        renderer.should.have.property('device');
        renderer.should.have.property('adapter');
        renderer.should.have.property('context');
        renderer.should.have.property('width');
        renderer.should.have.property('height');
        renderer.should.have.property('pixelRatio');
        renderer.should.have.property('renderInfo');
        renderer.should.have.property('renderList');
        renderer.should.have.property('lightManager');
        renderer.should.have.property('resourceManager');
    });

    it('should initialize with default values', () => {
        const renderer = new WebGPURenderer();
        renderer.width.should.equal(0);
        renderer.height.should.equal(0);
        renderer.pixelRatio.should.equal(1);
        renderer.alpha.should.be.false();
        renderer.isInitFailed.should.be.false();
        renderer._isInit.should.be.false();
    });

    it('resize', () => {
        const canvas = document.createElement('canvas');
        const renderer = new WebGPURenderer({
            domElement: canvas,
            width: 100,
            height: 100
        });

        renderer.resize(200, 300);
        renderer.width.should.equal(200);
        renderer.height.should.equal(300);
        canvas.width.should.equal(200);
        canvas.height.should.equal(300);
    });

    if (WebGPUSupport.isAvailable()) {
        it('onInit (async)', (done) => {
            const renderer = new WebGPURenderer({
                domElement: document.createElement('canvas')
            });
            const onInit1 = sinon.stub();
            const onInit2 = sinon.stub();
            const onInit3 = sinon.stub();

            renderer.onInit(onInit1);
            renderer.on('init', onInit2);
            onInit1.should.have.callCount(0);
            onInit2.should.have.callCount(0);
            onInit3.should.have.callCount(0);

            // init context (async)
            renderer.initContext().then(() => {
                onInit1.should.have.callCount(1);
                onInit2.should.have.callCount(1);
                onInit3.should.have.callCount(0);

                renderer.onInit(onInit3);
                onInit1.should.have.callCount(1);
                onInit2.should.have.callCount(1);
                onInit3.should.have.callCount(1);

                renderer.fire('init');
                onInit1.should.have.callCount(1);
                onInit2.should.have.callCount(2);
                onInit3.should.have.callCount(1);

                done();
            }).catch(done);
        });

        it('should fail gracefully when WebGPU is not supported', async () => {
            // Mock navigator.gpu to return null
            const originalGpu = navigator.gpu;
            
            try {
                Object.defineProperty(navigator, 'gpu', {
                    value: undefined,
                    configurable: true
                });

                const renderer = new WebGPURenderer({
                    domElement: document.createElement('canvas')
                });

                try {
                    await renderer.initContext();
                    // Should not reach here
                    throw new Error('Expected initContext to throw an error');
                } catch (e) {
                    renderer.isInitFailed.should.be.true();
                    e.message.should.containEql('WebGPU');
                }
            } finally {
                // Restore
                Object.defineProperty(navigator, 'gpu', {
                    value: originalGpu,
                    configurable: true
                });
            }
        });
    } else {
        it('should fail when WebGPU is not available', async () => {
            const renderer = new WebGPURenderer({
                domElement: document.createElement('canvas')
            });

            let errorThrown = false;
            try {
                await renderer.initContext();
            } catch (e) {
                errorThrown = true;
                renderer.isInitFailed.should.be.true();
                e.message.should.containEql('WebGPU');
            }
            
            if (!errorThrown) {
                throw new Error('Expected initContext to throw an error');
            }
        });
    }
});
