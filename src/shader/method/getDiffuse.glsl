float getDiffuse(vec3 normal, vec3 lightDir){
    return max(dot(normal, lightDir), 0.0);
}

#pragma glslify: export(getDiffuse)