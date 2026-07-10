const SpotLight = Hilo3d.SpotLight;

describe('SpotLight', () => {
    it('create', () => {
        const light = new SpotLight({
            cutoff:30,
            outerCutoff:45
        });
        light.isSpotLight.should.be.true();
        light.className.should.equal('SpotLight');
        light.direction.isVector3.should.be.true();
        light.constantAttenuation.should.be.Number();
        light.linearAttenuation.should.be.Number();
        light.quadraticAttenuation.should.be.Number();
        light.outerCutoff.should.be.Number();
        light.cutoff.should.be.Number();
        light._outerCutoffCos.should.equal(Math.cos(Hilo3d.math.degToRad(light.outerCutoff)));
        light._cutoffCos.should.equal(Math.cos(Hilo3d.math.degToRad(light.cutoff)));
    });

    it('toInfoArray', () => {
        const light = new SpotLight({
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

    it('createShadowMap', () => {
        const light = new SpotLight({
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
        const light = new SpotLight({
            direction:new Hilo3d.Vector3(0, 0.5, 0)
        });
        light.getWorldDirection().elements.should.deepEqual(new Float32Array([0, 1, 0]));
    });

    it('getViewDirection', () => {
        const camera = new Hilo3d.Camera({
            rotationX:180
        });
        camera.updateViewMatrix();

        const light = new SpotLight({
            direction:new Hilo3d.Vector3(0, 0.5, 0)
        });
        light.getViewDirection(camera).equals(new Hilo3d.Vector3(0, -1, 0)).should.be.true();
    });
});