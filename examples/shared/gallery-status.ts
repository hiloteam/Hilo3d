/** Surface initialization failures in the embedding gallery without suppressing browser errors. */
function reportGalleryError(message: string): void {
    if (window.parent === window) return;
    window.parent.postMessage(
        { type: 'hilo3d:example-error', url: location.href, message },
        location.origin
    );
}

window.addEventListener('error', event => {
    reportGalleryError(event.message || 'The example could not initialize.');
});
window.addEventListener('unhandledrejection', event => {
    const reason: unknown = event.reason;
    reportGalleryError(reason instanceof Error ? reason.message : String(reason));
});
