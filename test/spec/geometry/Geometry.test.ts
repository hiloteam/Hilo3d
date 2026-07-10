const Geometry = Hilo3d.Geometry;

describe('Geometry', () => {
    it('create', () => {
        const geometry = new Geometry;
        geometry.isGeometry.should.be.true();
        geometry.className.should.equal('Geometry');
    });
});