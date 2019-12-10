#ifdef HILO_JOINT_COUNT
    mat4 skinMat = getJointMat(a_skinWeights, a_skinIndices);
    pos = skinMat * pos;

    #ifdef HILO_HAS_NORMAL
        normal = mat3(skinMat) * normal;
    #endif
#endif