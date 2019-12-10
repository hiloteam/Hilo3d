const Class = Hilo3d.Class;

describe('Class', function(){
    var A;
    it('new', function(){
        A = Class.create({
            id:'a',
            getId:function(){
                return this.id;
            }
        });

        var a = new A;
        a.should.instanceOf(A);
        a.id.should.equal('a');
        a.getId().should.equal('a');
    });

    it('Extends', function(){
        var B = Class.create({
            id:'b',
            Extends:A
        });

        var b = new B;
        b.should.instanceOf(A);
        b.should.instanceOf(B);
        B.superclass.should.equal(A.prototype);
        b.id.should.equal('b');
        b.getId().should.equal('b');
    });

    it('Mixes', function(){
        var C = Class.create({
            Mixes:[{
                    mixA:'mixA'
                },{
                    mixB:function(){
                        return 'mixB'
                    }
                }
            ]
        });

        var c = new C;
        c.mixA.should.equal('mixA');
        c.mixB().should.equal('mixB');
    });

    it('Statics', function(){
        var D = Class.create({
            Statics:{
                hello:function(){
                    return 'hello';
                }
            }
        });
        D.hello().should.equal('hello');
    });
});