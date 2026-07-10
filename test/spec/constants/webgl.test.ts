const webgl = Hilo3d.constants.webgl;
const webgl2 = Hilo3d.constants.webgl2;

describe('constants/webgl', () => {
    it('webgl constants value should equal webgl value', () => {
        const gl = document.createElement('canvas').getContext('webgl');
        for (var name in webgl) {
            if(gl[name] !== undefined){
                webgl[name].should.equal(gl[name]);
            }
        }
    });

    it('webgl2 copy buffer binding constants should equal WebGL2 values', () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return;

        webgl2.COPY_READ_BUFFER_BINDING.should.equal(gl.COPY_READ_BUFFER_BINDING);
        webgl2.COPY_WRITE_BUFFER_BINDING.should.equal(gl.COPY_WRITE_BUFFER_BINDING);
    });
});
