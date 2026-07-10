const MorphGeometry = Hilo3d.MorphGeometry;

describe('MorphGeometry', () => {
    it('create', () => {
        const geometry = new MorphGeometry;
        geometry.isMorphGeometry.should.be.true();
        geometry.className.should.equal('MorphGeometry');
    });
});