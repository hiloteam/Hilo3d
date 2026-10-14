/** Bound response reads even if a server omits or misreports Content-Length. */
export async function readBoundedResponse(
    response: Response,
    maximum: number,
    signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(maximum) || maximum < 0)
        throw new RangeError('Response byte limit must be a non-negative safe integer');
    if (!response.body) throw new Error(`Response has no body (${String(response.status)})`);
    // Keep the original response for native consumption. Reading a fetch body only through a
    // JS reader can report ERR_ABORTED in Chromium after successful EOF. The clone audits bytes
    // first; its unopened sibling buffers only the audited payload plus transport lookahead.
    const audited = response.clone();
    // clone() replaces response.body with a tee branch; never cancel the now-locked pre-clone stream.
    const body = response.body;
    const reader = audited.body?.getReader();
    if (!reader) throw new Error('Response could not be cloned');
    let cancellation: Promise<void> | undefined;
    const cancel = (reason: unknown): Promise<void> => {
        // A tee branch's cancel waits for its sibling. Start both before awaiting either one.
        cancellation ??= Promise.allSettled([reader.cancel(reason), body.cancel(reason)]).then(
            () => undefined
        );
        return cancellation;
    };
    const abort = (): void => {
        void cancel(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    let size = 0;
    try {
        for (;;) {
            signal?.throwIfAborted();
            const part = await reader.read();
            signal?.throwIfAborted();
            if (part.done) break;
            if (part.value.byteLength > maximum - size)
                throw new Error('Response exceeds its byte limit');
            size += part.value.byteLength;
        }
        signal?.throwIfAborted();
        const bytes = await response.arrayBuffer();
        signal?.throwIfAborted();
        if (bytes.byteLength !== size) throw new Error('Response changed while reading');
        return new Uint8Array(bytes);
    } catch (error) {
        await cancel(error);
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}
