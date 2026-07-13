#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"

varying vec2 v_texcoord0;
uniform sampler2D u_diffuse;

void main(void) {  
    gl_FragColor = texture2D(u_diffuse, v_texcoord0);
}