#ifdef HILO_JOINT_COUNT
    attribute vec4 a_skinIndices;
    attribute vec4 a_skinWeights;
    #ifdef HILO_JOINT_MAT_MAP
        uniform sampler2D u_jointMatTexture;
        uniform vec2 u_jointMatTextureSize;
        mat4 getJointMat(float index) {
            index *= 4.0;
            float x = float(mod(index, u_jointMatTextureSize.x));
            float y = float(floor(index / u_jointMatTextureSize.x));
            float dx = 1.0 / float(u_jointMatTextureSize.x);
            float dy = 1.0 / float(u_jointMatTextureSize.y);
            y = dy * (y + 0.5);
            vec4 v1 = texture2D(u_jointMatTexture, vec2(dx * (x + 0.5), y));
            vec4 v2 = texture2D(u_jointMatTexture, vec2(dx * (x + 1.5), y));
            vec4 v3 = texture2D(u_jointMatTexture, vec2(dx * (x + 2.5), y));
            vec4 v4 = texture2D(u_jointMatTexture, vec2(dx * (x + 3.5), y));
            mat4 mat = mat4(v1, v2, v3, v4);
            return mat;
        }

        mat4 getJointMat(vec4 weights, vec4 indices) {
            mat4 mat = weights.x * getJointMat(indices.x);
            mat += weights.y * getJointMat(indices.y);
            mat += weights.z * getJointMat(indices.z);
            mat += weights.w * getJointMat(indices.w);
            return mat;
        }
    #else
        uniform mat4 u_jointMat[HILO_JOINT_COUNT];
       
        mat4 getJointMat(vec4 weights, vec4 indices) {
            mat4 mat = weights.x * u_jointMat[int(indices.x)];
            mat += weights.y * u_jointMat[int(indices.y)];
            mat += weights.z * u_jointMat[int(indices.z)];
            mat += weights.w * u_jointMat[int(indices.w)];
            return mat;
        }
    #endif
#endif