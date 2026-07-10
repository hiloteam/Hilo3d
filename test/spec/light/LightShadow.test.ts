const LightShadow = Hilo3d.LightShadow;

describe('LightShadow', () => {
    it('create', ()=>{
        const lightShadow = new LightShadow();
        lightShadow.isLightShadow.should.be.true();
        lightShadow.className.should.equal('LightShadow');
    });

    it('createFramebuffer', ()=>{
        const lightShadow = new LightShadow();
        lightShadow.createFramebuffer();
        lightShadow.framebuffer.isFramebuffer.should.be.true();
        lightShadow.framebuffer.width.should.equal(lightShadow.width);
        lightShadow.framebuffer.height.should.equal(lightShadow.height);
    });
});