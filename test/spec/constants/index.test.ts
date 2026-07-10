const webgl = Hilo3d.constants.webgl;
const webglExtensions = Hilo3d.constants.webglExtensions;
const constants = Hilo3d.constants;

describe('constants/index', () => {
    it('webgl[name] === constants[name] ', () => {
        for(var name in webgl){
            webgl[name].should.equal(constants[name]);
        }
    });

    it('webglExtensions[name] === constants[name] ', () => {
        for(var name in webglExtensions){
            webglExtensions[name].should.equal(constants[name]);
        }
    });
});