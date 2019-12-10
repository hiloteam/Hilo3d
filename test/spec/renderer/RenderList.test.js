const RenderList = Hilo3d.RenderList;

describe('RenderList', () => {
    it('create', () => {
        const list = new RenderList;
        list.isRenderList.should.be.true();
        list.className.should.equal('RenderList');
    });

    let renderList;
    beforeEach(() => {
        list = new RenderList;
        const camera = testEnv.camera;
        
        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                transparent: true
            }),
            geometry: new Hilo3d.BoxGeometry()
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                transparent: false
            }),
            geometry: new Hilo3d.BoxGeometry()
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                id:'testRenderListMaterial1',
                transparent: false
            }),
            geometry: new Hilo3d.BoxGeometry({
                id:'testRenderListGeometry1',
            })
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                transparent: true
            }),
            geometry: new Hilo3d.BoxGeometry()
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                id:'testRenderListMaterial1',
                transparent: false
            }),
            geometry: new Hilo3d.BoxGeometry({
                id:'testRenderListGeometry1',
            })
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                id:'testRenderListMaterial1',
                transparent: false,
                renderOrder:1
            }),
            geometry: new Hilo3d.BoxGeometry({
                id:'testRenderListGeometry1',
            })
        }), camera);

        list.addMesh(new Hilo3d.Mesh({
            material: new Hilo3d.Material({
                id:'testRenderListMaterial1',
                transparent: false,
                renderOrder:-1
            }),
            geometry: new Hilo3d.BoxGeometry({
                id:'testRenderListGeometry1',
            })
        }), camera);
    });

    it("sort", () => {
        list.sort();
        list.opaqueList[0].material.renderOrder.should.equal(-1);
        list.opaqueList[list.opaqueList.length-1].material.renderOrder.should.equal(1);
    });

    it('addMesh', () => {
        list.transparentList.should.have.length(2);
        list.opaqueList.should.have.length(5);
    });

    it('traverse', () => {
        const callback = sinon.spy();
        list.traverse(callback);
        callback.callCount.should.equal(7);
    });

    it('reset', () => {
        list.reset();
        list.transparentList.should.have.length(0);
        list.opaqueList.should.have.length(0);
        list.instancedDict.should.have.size(0);
    });
});