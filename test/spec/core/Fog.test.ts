const Fog = Hilo3d.Fog;

describe('Fog', () => {
    it('create', () => {
        const fog = new Fog();
        fog.isFog.should.be.true();
        fog.className.should.be.equal('Fog');
        fog.color.isColor.should.be.true();
        fog.start.should.equal(5);
        fog.end.should.equal(10);
        fog.mode.should.be.equal('LINEAR');
    });

    it('getInfo', () => {
        const fog = new Fog({
            start: 2,
            end: 10,
            density:0.5
        });

        fog.getInfo().should.deepEqual(new Float32Array([fog.start, fog.end]));

        fog.mode = 'EXP';
        fog.getInfo().should.deepEqual(fog.density);

    });
});