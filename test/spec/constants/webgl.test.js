const webgl = Hilo3d.constants.webgl;

describe('constants/webgl', () => {
    it('webgl constants value should equal webgl value', () => {
        const gl = document.createElement('canvas').getContext('webgl');
        for (var name in webgl) {
            if(gl[name] !== undefined){
                webgl[name].should.equal(gl[name]);
            }
        }
    });
});