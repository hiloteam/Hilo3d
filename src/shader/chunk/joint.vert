#ifdef HILO_JOINT_COUNT
    in vec4 a_skinIndices;
    in vec4 a_skinWeights;
    mat4 getJointMat(vec4 weights, vec4 indices) {
        mat4 mat = weights.x * u_jointMat[int(indices.x)];
        mat += weights.y * u_jointMat[int(indices.y)];
        mat += weights.z * u_jointMat[int(indices.z)];
        mat += weights.w * u_jointMat[int(indices.w)];
        return mat;
    }
#endif
