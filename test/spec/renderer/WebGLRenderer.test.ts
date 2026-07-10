const WebGLRenderer = Hilo3d.WebGLRenderer;

describe('WebGLRenderer', () => {
    it('create', () => {
        const renderer = new WebGLRenderer;
        renderer.isWebGLRenderer.should.be.true();
        renderer.className.should.equal('WebGLRenderer');
    });

    it('onInit', () => {
        const renderer = new WebGLRenderer({
            domElement:document.createElement('canvas')
        });
        const onInit1 = sinon.stub();
        const onInit2 = sinon.stub();
        const onInit3 = sinon.stub();
        
        renderer.onInit(onInit1);
        renderer.on('init', onInit2);
        onInit1.callCount.should.equal(0);
        onInit2.callCount.should.equal(0);
        onInit3.callCount.should.equal(0);

        // init context
        renderer.initContext();
        onInit1.callCount.should.equal(1);
        onInit2.callCount.should.equal(1);
        onInit3.callCount.should.equal(0);

        renderer.onInit(onInit3);
        onInit1.callCount.should.equal(1);
        onInit2.callCount.should.equal(1);
        onInit3.callCount.should.equal(1);

        renderer.fire('init');
        onInit1.callCount.should.equal(1);
        onInit2.callCount.should.equal(2);
        onInit3.callCount.should.equal(1);
    });
});