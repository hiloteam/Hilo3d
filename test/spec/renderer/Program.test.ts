const Program = Hilo3d.Program;

describe('Program', () => {
    it('create', () => {
        const program = new Program({
            state:testEnv.state
        });
        program.isProgram.should.be.true();
        program.className.should.equal('Program');
    });

    it('getProgram & cache & destroy', () => {
        const shader = new Hilo3d.Shader();
        const program = Program.getProgram(shader, testEnv.state);
        Program.cache.get(shader.id).should.equal(program);

        program.destroy();
        should(Program.cache.get(shader.id)).be.undefined();
        should(program.program).be.null();
        should(program.gl).be.null();
        should(program.state).be.null();
        should(program.uniforms).be.null();
        should(program.attributes).be.null();
    });

    it('getBlankProgram', () => {
        const errorProgram = Program.getProgram(new Hilo3d.Shader, testEnv.state);
        errorProgram.should.equal(Program.getBlankProgram(testEnv.state));

        const successProgram = Program.getProgram(new Hilo3d.Shader({
            vs:'void main(){}',
            fs:'void main(){}'
        }), testEnv.state);
        successProgram.should.not.equal(Program.getBlankProgram(testEnv.state));
    });
});