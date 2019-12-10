const Plane = Hilo3d.Plane;

describe('Plane', () => {
    var planeA, identity;
    beforeEach(() => {
        planeA = new Plane(new Hilo3d.Vector3(1, 2, 3), 4);
        identity = new Plane();
    });

    it('create', () => {
        planeA.isPlane.should.be.true();
        planeA.className.should.equal('Plane');
        planeA.normal.elements.should.equalishValues(1, 2, 3);
        planeA.distance.should.equal(4);
    });

    it('copy', () => {
        identity.copy(planeA);
        identity.normal.equals(planeA.normal).should.be.true();
        identity.distance.should.equal(planeA.distance);
    });

    it('clone', () => {
        var plane = planeA.clone();
        plane.normal.equals(planeA.normal).should.be.true();
        plane.distance.should.equal(planeA.distance);
    });

    it('set', () => {
        var plane = new Plane();
        plane.set(1, 2, 3, 4);
        plane.normal.elements.should.equalishValues(1, 2, 3, 4);
        plane.distance.should.equal(4);
    });

    it('normalize', () => {
        planeA.set(3, 4, 0, 2).normalize();
        planeA.distance.should.equalish(0.4);
        planeA.normal.length().should.equalish(1);
    });

    it('distanceToPoint', () => {
        planeA.distanceToPoint(new Hilo3d.Vector3(0, 0, 0)).should.equal(4);
    });

    it('projectPoint', () => {
        planeA.projectPoint(new Hilo3d.Vector3(0, 0, 0)).elements.should.equalishValues(-4, -8, -12);
    });
});