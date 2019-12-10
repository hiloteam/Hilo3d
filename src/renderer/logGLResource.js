import log from '../utils/log';
import Shader from '../shader/Shader';
import Texture from '../texture/Texture';
import Buffer from './Buffer';
import VertexArrayObject from './VertexArrayObject';
import Program from './Program';

const resourceList = [Shader, Program, Buffer, VertexArrayObject, Texture];
const logGLResource = function() {
    let msg = '';
    resourceList.forEach((ResourceClass) => {
        msg += `${ResourceClass.prototype.className}:${Object.keys(ResourceClass.cache._cache).length} `;
    });
    log.log(msg);
};

export default logGLResource;
