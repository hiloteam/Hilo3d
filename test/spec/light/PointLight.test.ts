const PointLight = Hilo3d.PointLight;

describe('PointLight', () => {
    it('create', () => {
        const light = new PointLight();
        light.isPointLight.should.be.true();
        light.className.should.equal('PointLight');
        light.constantAttenuation.should.be.Number();
        light.linearAttenuation.should.be.Number();
        light.quadraticAttenuation.should.be.Number();
    });

    it('toInfoArray', () => {
        const light = new PointLight({
            constantAttenuation:0.1,
            linearAttenuation:0.2,
            quadraticAttenuation:0.3
        });

        const res = [];
        light.toInfoArray(res, 3);
        res[3].should.equal(light.constantAttenuation);
        res[4].should.equal(light.linearAttenuation);
        res[5].should.equal(light.quadraticAttenuation);
    });
});