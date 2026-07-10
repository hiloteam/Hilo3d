const GeometryMaterial = Hilo3d.GeometryMaterial;

describe('GeometryMaterial', () => {
    it('create', () => {
        const material = new GeometryMaterial();
        material.isGeometryMaterial.should.be.true();
        material.className.should.equal('GeometryMaterial');
        material.vertexType.should.be.String();
        material.writeOriginData.should.be.Boolean();
        material.lightType.should.equal(Hilo3d.constants.NONE);
    });

    it('getRenderOption', () => {
        let material = new GeometryMaterial({
            vertexType:Hilo3d.constants.POSITION
        });
        let option = material.getRenderOption();
        option.VERTEX_TYPE_POSITION.should.equal(1);
        option.HAS_FRAG_POS.should.equal(1);

        material = new GeometryMaterial({
            vertexType:Hilo3d.constants.NORMAL
        });
        option = material.getRenderOption();
        option.VERTEX_TYPE_NORMAL.should.equal(1);
        option.HAS_NORMAL.should.equal(1);

        material = new GeometryMaterial({
            vertexType:Hilo3d.constants.DEPTH,
            writeOriginData:true
        });
        option = material.getRenderOption();
        option.VERTEX_TYPE_DEPTH.should.equal(1);
        option.WRITE_ORIGIN_DATA.should.equal(1);
    });
});