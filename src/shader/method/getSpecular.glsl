float getSpecular(vec3 cameraPos, vec3 fragPos, vec3 lightDir, vec3 normal, float shininess){
    vec3 viewDir = normalize(cameraPos - fragPos);
    #ifdef LIGHT_TYPE_PHONG
        return pow(max(dot(viewDir, reflect(-lightDir, normal), 0.0), shininess);
    #else
        return pow(max(dot(normal, normalize(lightDir + viewDir)), 0.0), shininess);
    #endif
}

#pragma glslify: export(getSpecular)