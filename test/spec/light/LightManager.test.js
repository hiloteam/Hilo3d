const LightManager = Hilo3d.LightManager;

describe('LightManager', () => {
    it('create', () => {
        const ligthManager = new LightManager;
        ligthManager.isLightManager.should.be.true();
        ligthManager.className.should.equal('LightManager');

        ligthManager.ambientLights.should.be.Array();
        ligthManager.directionalLights.should.be.Array();
        ligthManager.pointLights.should.be.Array();
        ligthManager.spotLights.should.be.Array();
    });

    it('getShadowMapCount & reset', () => {
        const ligthManager = new LightManager;
        ligthManager.addLight(new Hilo3d.PointLight({
            shadow:{}
        }));
        ligthManager.addLight(new Hilo3d.PointLight());
        ligthManager.addLight(new Hilo3d.PointLight({
            shadow:{}
        }));

        ligthManager.getShadowMapCount('POINT_LIGHTS').should.equal(2);

        ligthManager.reset();
        ligthManager.getShadowMapCount('POINT_LIGHTS').should.equal(0);
    });

    it('getRenderOption', () => {
        const ligthManager = new LightManager();
        should(ligthManager.getRenderOption().HAS_LIGHT).be.Undefined();
        ligthManager.addLight(new Hilo3d.PointLight);
        ligthManager.addLight(new Hilo3d.PointLight);
        ligthManager.addLight(new Hilo3d.SpotLight);
        ligthManager.updateInfo(new Hilo3d.Camera);
        should(ligthManager.getRenderOption().POINT_LIGHTS).be.equal(2);
    });
});