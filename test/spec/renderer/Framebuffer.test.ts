const Framebuffer = Hilo3d.Framebuffer;

describe('Framebuffer', () => {
    it('create', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.isFramebuffer.should.be.true();
        framebuffer.className.should.equal('Framebuffer');

        framebuffer.init();
        framebuffer.isComplete().should.be.true();
    });

    it('readPixels', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        framebuffer.readPixels(0, 0, 2, 2).should.deepEqual(new Uint8Array(16));
    });

    it('cache & destroy', () => {
        const framebuffer = new Framebuffer(testEnv.renderer);
        Framebuffer.cache.get(framebuffer.id).should.equal(framebuffer);
        framebuffer.destroy();
        should(Framebuffer.cache.get(framebuffer.id)).be.undefined();
        should(framebuffer.framebuffer).be.null();
        should(framebuffer.texture).be.null();
        should(framebuffer.renderbuffer).be.null();
    });
});