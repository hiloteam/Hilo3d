const Light = Hilo3d.Light;

describe('Light', () => {
    it('create', () => {
        const light = new Light();
        light.isLight.should.be.true();
        light.className.should.equal('Light');
        light.color.isColor.should.be.true();
    });
});