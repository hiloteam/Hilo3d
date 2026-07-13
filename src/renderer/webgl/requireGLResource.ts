/** Convert nullable WebGL allocation results into explicit allocation failures. */
export default function requireGLResource<Resource>(
    resource: Resource | null,
    resourceName: string
): Resource {
    if (resource === null) throw new Error(`WebGL failed to allocate ${resourceName}`);
    return resource;
}
