const SphereGeometry = Hilo3d.SphereGeometry;

describe('SphereGeometry', () => {
    it('create', () => {
        const geometry = new SphereGeometry;
        geometry.isSphereGeometry.should.be.true();
        geometry.className.should.equal('SphereGeometry');
    });
});