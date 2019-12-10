const PlaneGeometry = Hilo3d.PlaneGeometry;

describe('PlaneGeometry', () => {
    it('create', () => {
        const geometry = new PlaneGeometry;
        geometry.isPlaneGeometry.should.be.true();
        geometry.className.should.equal('PlaneGeometry');
    });
});