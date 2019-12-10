const glType = Hilo3d.glType;

describe('glType', () => {
    it('get', () => {
        const info = glType.get(Hilo3d.constants.FLOAT_VEC3);
        info.name.should.equal('FLOAT_VEC3');
        info.glValue.should.equal(Hilo3d.constants.FLOAT_VEC3);
    });
});