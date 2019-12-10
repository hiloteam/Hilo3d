const Node = Hilo3d.Node;

describe('Node', function() {
    it('create', () => {
        const node = new Node();
        node.isNode.should.be.true();
        node.className.should.equal('Node');
        node.up.isVector3.should.be.true();
    });

    it('clone', () => {
        const node = new Node({
            name: 'parent',
            x: 2,
            y: 3,
            z: 1,
            jointName: 'head'
        });
        node.addChild(new Node({
            name: 'child0'
        }));

        const clonedNode = node.clone();
        clonedNode.name.should.equal(node.name);
        clonedNode.x.should.equal(node.x);
        clonedNode.y.should.equal(node.y);
        clonedNode.z.should.equal(node.z);
        clonedNode.jointName.should.equal(node.jointName);
        clonedNode.children[0].name.should.equal('child0');
    });

    it('getChildrenNameMap', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);

        const map = node.getChildrenNameMap();
        map.b1.should.equal(b1);
        map.b2.should.equal(b2);
        map.b3.should.equal(b3);
        should(map.a1).be.undefined();
    });

    it('getChild', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3',
            id: 'hhh'
        });

        const b4 = new Node({
            name: 'b4'
        });

        const b5 = new Node({
            name: 'b5'
        });

        const b6 = new Node({
            name: 'b6'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(b4);
        b4.addChild(b5);
        b5.addChild(b6);

        node.getChildByFn(child => child.name === 'b1').should.equal(b1);
        node.getChildByFn(child => child.name === 'b5').should.equal(b5);
        node.getChildByFnBFS(child => child.name === 'b1').should.equal(b1);
        node.getChildByFnBFS(child => child.name === 'b6').should.equal(b6);
        node.getChildrenByFn(child => child.name === 'b5')[0].should.equal(b5);
        node.getChildByName('b2').should.equal(b2);
        node.getChildrenByName('b2')[0].should.equal(b2);
        node.getChildById('hhh').should.equal(b3);
        node.getChildrenByClassName('Node')[0].should.equal(b1);
        node.getChildByNamePath(['b3']).should.equal(b3);
        node.getChildByNamePath(['b3', 'b5']).should.equal(b5);
        should(node.getChildByNamePath(['b3', 'b5', 'b2'])).be.null();
    });

    it('traverse_path', () => {
        const node = new Node({
            name: 'r'
        });

        const a = new Node({
            name: 'a'
        });

        const b = new Node({
            name: 'b'
        });

        const c = new Node({
            name: 'c'
        });

        const a0 = new Node({
            name: 'a0'
        });

        const b0 = new Node({
            name: 'b0'
        });

        const c0 = new Node({
            name: 'c0'
        });

        const a1 = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const c1 = new Node({
            name: 'c1'
        });

        node.addChild(a);
        node.addChild(b);
        node.addChild(c);
        a.addChild(a0);
        b.addChild(b0);
        c.addChild(c0);
        a0.addChild(a1);
        b0.addChild(b1);
        b0.addChild(b2);
        c0.addChild(c1);

        /**
        *         r
        *       / | \
        *      a  b  c
        *     /   |   \
        *   a0    b0   c0
        *   /    /  \   \
        *  a1   b1  b2   c1
        */

        let res = [];
        node.traverse((node) => {
            res.push(node.name);
        });
        res.join('-').should.equal('r-a-a0-a1-b-b0-b1-b2-c-c0-c1');

        res = [];
        node.traverse((node) => {
            res.push(node.name);
        }, true);
        res.join('-').should.equal('a-a0-a1-b-b0-b1-b2-c-c0-c1');

        res = [];
        node.traverse((node) => {
            res.push(node.name);
            return Node.TRAVERSE_STOP_NONE;
        }, true);
        res.join('-').should.equal('a-a0-a1-b-b0-b1-b2-c-c0-c1');

        res = [];
        node.traverse((node) => {
            res.push(node.name);
            if (node.name === 'b0') {
                return Node.TRAVERSE_STOP_ALL;
            }
        }, true);
        res.join('-').should.equal('a-a0-a1-b-b0');

        res = [];
        node.traverse((node) => {
            res.push(node.name);
            if (node.name === 'b0') {
                return Node.TRAVERSE_STOP_CHILDREN;
            }
        }, true);
        res.join('-').should.equal('a-a0-a1-b-b0-c-c0-c1');

        // traverseBFS
        res = [];
        node.traverseBFS((node) => {
            res.push(node.name);
        });
        res.join('-').should.equal('r-a-b-c-a0-b0-c0-a1-b1-b2-c1');

        res = [];
        node.traverseBFS((node) => {
            res.push(node.name);
        }, true);
        res.join('-').should.equal('a-b-c-a0-b0-c0-a1-b1-b2-c1');

        res = [];
        node.traverseBFS((node) => {
            res.push(node.name);
            return Node.TRAVERSE_STOP_NONE
        }, true);
        res.join('-').should.equal('a-b-c-a0-b0-c0-a1-b1-b2-c1');

        res = [];
        node.traverseBFS((node) => {
            res.push(node.name);
            if (node.name === 'b0'){
                return Node.TRAVERSE_STOP_ALL
            }
        }, true);
        res.join('-').should.equal('a-b-c-a0-b0');

        res = [];
        node.traverseBFS((node) => {
            res.push(node.name);
            if (node.name === 'b0'){
                return Node.TRAVERSE_STOP_CHILDREN
            }
        }, true);
        res.join('-').should.equal('a-b-c-a0-b0-c0-a1-c1');
    });

    it('traverse', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3',
            id: 'hhh'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(new Node());

        const callback = sinon.stub();
        node.traverse(callback);
        callback.should.have.callCount(5);

        callback.reset();
        callback.onCall(0).returns(true);
        node.traverse(callback);
        callback.should.have.callCount(1);

        callback.reset();
        callback.onCall(3).returns(true);
        node.traverse(callback);
        callback.should.have.callCount(4);
    });

    it('traverseBFS', () => {
        const node = new Node({
            name: 'a1'
        });

        const b1 = new Node({
            name: 'b1'
        });

        const b2 = new Node({
            name: 'b2'
        });

        const b3 = new Node({
            name: 'b3',
            id: 'hhh'
        });

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(new Node());

        const callback = sinon.stub();
        node.traverseBFS(callback);
        callback.should.have.callCount(5);

        callback.reset();
        callback.onCall(0).returns(true);
        node.traverseBFS(callback);
        callback.should.have.callCount(1);

        callback.reset();
        callback.onCall(3).returns(true);
        node.traverseBFS(callback);
        callback.should.have.callCount(4);
    });

    it('traverseUpdate', () => {
        const node = new Node();
        const b1 = new Node();
        const b2 = new Node();
        const b3 = new Node();
        const c1 = new Node();

        node.addChild(b1);
        node.addChild(b2);
        node.addChild(b3);
        b3.addChild(c1);

        let onUpdate = sinon.stub();

        node.onUpdate = onUpdate;
        b1.onUpdate = onUpdate;
        b2.onUpdate = onUpdate;
        b3.onUpdate = onUpdate;
        c1.onUpdate = onUpdate;

        node.traverseUpdate();
        onUpdate.should.have.callCount(5);

        onUpdate.reset();
        b3.needCallChildUpdate = false;
        node.traverseUpdate();
        onUpdate.should.have.callCount(4);

        onUpdate.reset();
        node.needCallChildUpdate = false;
        node.traverseUpdate();
        onUpdate.should.have.callCount(1);
    });
});