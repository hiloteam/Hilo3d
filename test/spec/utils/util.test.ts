const util = Hilo3d.util;

describe('util', function () {

    function asc(a, b) {
        return a - b;
    }

    function dest(a, b) {
        return b - a;
    }

    describe('getIndexFromSortedArray', function() {
        it('undefined', function () {
            const indexArr = util.getIndexFromSortedArray(undefined, 1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);
        });
        it('should be 0, 0', function() {
            const indexArr = util.getIndexFromSortedArray([], 1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);
        });
        it('single item asc same', function () {
            const indexArr = util.getIndexFromSortedArray([1], 1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);
        });
        it('single item asc higher', function() {
            const indexArr = util.getIndexFromSortedArray([1], 2, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 1]);
        });
        it('single item asc lower', function() {
            const indexArr = util.getIndexFromSortedArray([1], 0, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);
        });

        it('single item dest same', function () {
            const indexArr = util.getIndexFromSortedArray([1], 1, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);
        });
        it('single item dest higher', function() {
            const indexArr = util.getIndexFromSortedArray([1], 2, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);
        });
        it('single item dest lower', function() {
            const indexArr = util.getIndexFromSortedArray([1], 0, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 1]);
        });
        
        it('two items asc same', function() {
            let indexArr = util.getIndexFromSortedArray([1, 3], 1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);

            indexArr = util.getIndexFromSortedArray([1, 3], 3, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([1, 1]);
        });
        it('two items asc higher', function() {
            const indexArr = util.getIndexFromSortedArray([1, 3], 5, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([1, 2]);
        });
        it('two items asc middle', function() {
            const indexArr = util.getIndexFromSortedArray([1, 3], 2, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 1]);
        });
        it('two items asc lower', function() {
            const indexArr = util.getIndexFromSortedArray([1, 3], 0, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);
        });

        it('two items dest same', function() {
            let indexArr = util.getIndexFromSortedArray([3, 1], 1, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([1, 1]);

            indexArr = util.getIndexFromSortedArray([3, 1], 3, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 0]);
        });
        it('two items dest higher', function() {
            const indexArr = util.getIndexFromSortedArray([3, 1], 5, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);
        });
        it('two items dest middle', function() {
            const indexArr = util.getIndexFromSortedArray([3, 1], 2, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([0, 1]);
        });
        it('two items dest lower', function() {
            const indexArr = util.getIndexFromSortedArray([3, 1], 0, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([1, 2]);
        });

        function randomArray(arr) {
            let m = arr.length, t, i;
            while (m) {
                i = Math.floor(Math.random() * m--);
                t = arr[m];
                arr[m] = arr[i];
                arr[i] = t;
            }
        }
        it('complex asc', function () {
            const arr = [];
            const count = Math.floor(Math.random() * 20) + 10;
            for (var i = 0; i < count; i++) {
                arr.push(i);
            }

            for (var i = 0; i < count; i++) {
                let value = Math.floor(Math.random() * count);
                let indexArr = util.getIndexFromSortedArray(arr, value, asc);
                indexArr.length.should.equal(2);
                indexArr.should.eql([value, value]);

                indexArr = util.getIndexFromSortedArray(arr, value + .5, asc);
                indexArr.length.should.equal(2);
                indexArr.should.eql([value, value + 1]);
            }

            let indexArr = util.getIndexFromSortedArray(arr, -1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);

            indexArr = util.getIndexFromSortedArray(arr, count + 1, asc);
            indexArr.length.should.equal(2);
            indexArr.should.eql([count - 1, count]);
        });
        it('complex dest', function () {
            const arr = [];
            const count = Math.floor(Math.random() * 20) + 10;
            for (var i = 0; i < count; i++) {
                arr.push(i);
            }
            arr.reverse();

            for (var i = 0; i < count; i++) {
                let value = Math.floor(Math.random() * count);
                let indexArr = util.getIndexFromSortedArray(arr, value, dest);
                indexArr.length.should.equal(2);
                indexArr.should.eql([count - 1 - value, count - 1 - value]);

                indexArr = util.getIndexFromSortedArray(arr, value + .5, dest);
                indexArr.length.should.equal(2);
                indexArr.should.eql([count - 1 - value - 1, count - 1 - value]);
            }

            let indexArr = util.getIndexFromSortedArray(arr, -1, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([count - 1, count]);

            indexArr = util.getIndexFromSortedArray(arr, count + 1, dest);
            indexArr.length.should.equal(2);
            indexArr.should.eql([-1, 0]);
        });
    });
});