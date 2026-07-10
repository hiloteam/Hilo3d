const AmbientLight = Hilo3d.AmbientLight;

describe('AmbientLight', () => {
    it('create', () => {
        const light = new AmbientLight();
        light.isAmbientLight.should.be.true();
        light.className.should.equal('AmbientLight');
        light.amount.should.be.Number();
    });
});