#ifdef HILO_FIX_MAX_BUG
    float hilo_max(float a, float b){
        if (a > b) {
            return a;
        }
        return b;
    }
    #define HILO_MAX(a, b) hilo_max(a, b);
#else
    #define HILO_MAX(a, b) max(a, b);
#endif