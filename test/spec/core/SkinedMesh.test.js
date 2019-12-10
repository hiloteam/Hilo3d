const SkinedMesh = Hilo3d.SkinedMesh;

describe('SkinedMesh', () => {
    it('create', () => {
        const mesh = new SkinedMesh;
        mesh.isSkinedMesh.should.be.true();
        mesh.className.should.equal('SkinedMesh');
    })
});