const GeometryData = Hilo3d.GeometryData;

describe('GeometryData', () => {
    it('create', () => {
        const data = new GeometryData;
        data.isGeometryData.should.be.true();
        data.className.should.equal('GeometryData');
    });

    const testData = new GeometryData(new Float32Array([
        1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30
    ]), 3, {
        stride: 16,
        offset: 4
    });

    it('stride & strideSize', () => {
        testData.stride.should.equal(16);
        testData.strideSize.should.equal(4);
    });

    it('offset & offsetSize', () => {
        testData.offset.should.equal(4);
        testData.offsetSize.should.equal(1);
    });

    it('data', () => {
        testData.type.should.equal(Hilo3d.constants.FLOAT);
    });

    it('length & realLength & count', () => {
        testData.length.should.equal(16);
        testData.realLength.should.equal(12);
        testData.count.should.equal(4);
    });

    it('getOffset', () => {
        testData.getOffset(1).should.equal(5);
    });

    it('get & set', () => {
        testData.get(1).elements.should.deepEqual(new Float32Array([10, 12, 14]));
        testData.set(1, new Hilo3d.Vector3(55, 66, 77));
        testData.get(1).elements.should.deepEqual(new Float32Array([55, 66, 77]));
        testData.set(1, new Hilo3d.Vector3(10, 12, 14));
    });

    it('getByOffset & setByOffset', () => {
        testData.getByOffset(5).elements.should.deepEqual(new Float32Array([10, 12, 14]));
        testData.setByOffset(3, new Hilo3d.Vector3(55, 66, 77));
        testData.getByOffset(3).elements.should.deepEqual(new Float32Array([55, 66, 77]));
        testData.setByOffset(3, new Hilo3d.Vector3(6, 8, 10));
    });

    it('traverse & traverseByComponent', () => {
        let callback = sinon.spy((attribute, index, offset) => {
            offset.should.equal(index * 4 + 1);
            attribute.elements.should.deepEqual(new Float32Array([offset * 2, (offset + 1) * 2, (offset + 2) * 2]));
        });
        testData.traverse(callback);
        callback.callCount.should.equal(4);

        callback = sinon.spy((data, index, offset) => {
            data.should.equal(offset * 2);
            offset.should.equal(Math.floor(index/3) * 4 + index%3 + 1);
        });
        testData.traverseByComponent(callback);
        callback.callCount.should.equal(12);
    });
});