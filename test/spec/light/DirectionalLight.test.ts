const DirectionalLight = Hilo3d.DirectionalLight;

describe('DirectionalLight', () => {
    it('create', () => {
        const light = new DirectionalLight();
        light.isDirectionalLight.should.be.true();
        light.className.should.equal('DirectionalLight');
        light.direction.isVector3.should.be.true();
    });

    it('createShadowMap', () => {
        const light = new DirectionalLight({
            shadow:{
                minBias:0.01,
                maxBias:0.1
            }
        });

        const env = utils.createHilo3dEnv();
        light.createShadowMap(env.renderer, env.camera);
        light.lightShadow.isLightShadow.should.be.true();
    });

    it('getWorldDirection', () => {
        const light = new DirectionalLight({
            direction:new Hilo3d.Vector3(0, 0.5, 0)
        });
        light.getWorldDirection().elements.should.deepEqual(new Float32Array([0, 1, 0]));
    });

    it('getViewDirection', () => {
        const camera = new Hilo3d.Camera({
            rotationX:180
        });
        camera.updateViewMatrix();

        const light = new DirectionalLight({
            direction:new Hilo3d.Vector3(0, 0.5, 0)
        });
        light.getViewDirection(camera).equals(new Hilo3d.Vector3(0, -1, 0)).should.be.true();
    });
});