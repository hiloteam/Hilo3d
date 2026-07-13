#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"

in vec2 v_texcoord0;
uniform sampler2D u_diffuse;

void main(void) {  
    hilo_FragColor = texture(u_diffuse, v_texcoord0);
}