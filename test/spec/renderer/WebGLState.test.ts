const WebGLState = Hilo3d.WebGLState;

describe('WebGLState', () => {
    it('create', () => {
        const state = new WebGLState;
        state.isWebGLState.should.be.true();
        state.className.should.equal('WebGLState');
    });

    let gl, state;

    beforeEach(() => {
        gl = testEnv.gl;
        state = new WebGLState(gl);
    });

    it('set1', () => {
        const enable = sinon.spy(gl, 'enable');

        state.set1('enable', 1);
        enable.callCount.should.equal(1);

        state.set1('enable', 1);
        enable.callCount.should.equal(1);

        state.set1('enable', 2);
        enable.callCount.should.equal(2);

        state.set1('enable', 1);
        enable.callCount.should.equal(3);

        enable.restore();
    });

    it('set2', () => {
        const depthRange = sinon.spy(gl, 'depthRange');
        
        state.set2('depthRange', 1, 2);
        depthRange.callCount.should.equal(1);

        state.set2('depthRange', 1, 2);
        depthRange.callCount.should.equal(1);

        state.set2('depthRange', 1, 3);
        depthRange.callCount.should.equal(2);

        state.set2('depthRange', 2, 3);
        depthRange.callCount.should.equal(3);

        depthRange.restore();
    });

    it('set3', () => {
        const stencilOp = sinon.spy(state.gl, 'stencilOp');

        state.set3('stencilOp', gl.KEEP, gl.KEEP, gl.KEEP);
        stencilOp.callCount.should.equal(1);
        
        state.set3('stencilOp', gl.KEEP, gl.KEEP, gl.KEEP);
        stencilOp.callCount.should.equal(1);
        
        state.set3('stencilOp', gl.KEEP, gl.REPLACE, gl.KEEP);
        stencilOp.callCount.should.equal(2);
        
        state.set3('stencilOp', gl.REPLACE, gl.REPLACE, gl.KEEP);
        stencilOp.callCount.should.equal(3);

        stencilOp.restore();
    });

    it('set4', () => {
        const viewport = sinon.spy(gl, 'viewport');

        state.set4('viewport', 1, 2, 3, 4);
        viewport.callCount.should.equal(1);

        state.set4('viewport', 1, 2, 3, 4);
        viewport.callCount.should.equal(1);

        state.set4('viewport', 1, 2, 4, 4);
        viewport.callCount.should.equal(2);

        state.set4('viewport', 1, 2, 3, 4);
        viewport.callCount.should.equal(3);

        viewport.restore();
    });

    it('enable & disable', () => {
        const enable = sinon.spy(gl, 'enable');
        const disable = sinon.spy(gl, 'disable');

        state.enable(1);
        enable.callCount.should.equal(1);

        state.enable(2);
        enable.callCount.should.equal(2);

        state.disable(1);
        disable.callCount.should.equal(1);

        state.disable(1);
        disable.callCount.should.equal(1);

        state.enable(1);
        enable.callCount.should.equal(3);

        enable.restore();
        disable.restore();
    });

    it('bindFramebuffer & bindSystemFramebuffer', () => {
        const bindFramebuffer = sinon.spy(gl, 'bindFramebuffer');

        const framebuffer1 = gl.createFramebuffer();
        const framebuffer2 = gl.createFramebuffer();
        const framebuffer3 = gl.createFramebuffer();

        state.bindFramebuffer(1, framebuffer1);
        bindFramebuffer.callCount.should.equal(1);

        state.bindFramebuffer(1, framebuffer1);
        bindFramebuffer.callCount.should.equal(1);

        state.bindFramebuffer(1, framebuffer2);
        bindFramebuffer.callCount.should.equal(2);
        state.preFramebuffer.should.equal(framebuffer1);

        state.bindFramebuffer(1, framebuffer3);
        bindFramebuffer.callCount.should.equal(3);
        state.preFramebuffer.should.equal(framebuffer2);

        state.bindSystemFramebuffer();
        bindFramebuffer.callCount.should.equal(4);
        state.preFramebuffer.should.equal(framebuffer3);

        bindFramebuffer.restore();
    });

    it('pixelStorei', () => {
        const pixelStorei = sinon.spy(gl, 'pixelStorei');

        state.pixelStorei('test1', 1);
        pixelStorei.callCount.should.equal(1);

        state.pixelStorei('test2', 1);
        pixelStorei.callCount.should.equal(2);

        state.pixelStorei('test1', 1);
        pixelStorei.callCount.should.equal(2);

        state.pixelStorei('test1', 2);
        pixelStorei.callCount.should.equal(3);

        state.pixelStorei('test2', 1);
        pixelStorei.callCount.should.equal(3);

        pixelStorei.restore();
    });

    it('activeTexture', () => {
        const activeTexture = sinon.spy(gl, 'activeTexture');

        state.activeTexture(gl.TEXTURE0);
        state.activeTextureIndex.should.equal(gl.TEXTURE0);
        activeTexture.callCount.should.equal(1);

        state.activeTexture(gl.TEXTURE1);
        activeTexture.callCount.should.equal(2);
        state.activeTextureIndex.should.equal(gl.TEXTURE1);

        state.activeTexture(gl.TEXTURE1);
        activeTexture.callCount.should.equal(2);
        state.activeTextureIndex.should.equal(gl.TEXTURE1);

        activeTexture.restore();
    });

    it('bindTexture & getActiveTextureUnit', () => {
        const texture = gl.createTexture();
        const bindTexture = sinon.spy(gl, 'bindTexture');

        state.activeTexture(gl.TEXTURE3);
        state.bindTexture(gl.TEXTURE_2D, texture);
        state.getActiveTextureUnit()[gl.TEXTURE_2D].should.equal(texture);
        bindTexture.callCount.should.equal(1);

        state.activeTexture(gl.TEXTURE3);
        state.bindTexture(gl.TEXTURE_2D, texture);
        state.getActiveTextureUnit()[gl.TEXTURE_2D].should.equal(texture);
        bindTexture.callCount.should.equal(1);

        state.activeTexture(gl.TEXTURE4);
        state.bindTexture(gl.TEXTURE_2D, texture);
        state.getActiveTextureUnit()[gl.TEXTURE_2D].should.equal(texture);
        bindTexture.callCount.should.equal(2);

        bindTexture.restore();
    });
});