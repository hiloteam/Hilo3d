/**
 * Serialized into the CSP-restricted opaque iframe. Runtime references must stay function-local or
 * native globals so development transforms and production minification preserve isolated execution.
 */
export function installScriptFrame(scope: Window): void {
    let worker: Worker | undefined;
    let port: MessagePort | undefined;
    scope.addEventListener('pagehide', (event: PageTransitionEvent): void => {
        if (!event.persisted) worker?.terminate();
    });
    scope.addEventListener('message', (event: MessageEvent<unknown>): void => {
        const channel = event.ports[0];
        if (port || event.source !== scope.parent || !channel) return;
        port = channel;
        try {
            const data = event.data;
            if (!data || typeof data !== 'object')
                throw new Error('Script worker source is missing');
            const source: unknown = Reflect.get(data, 'source');
            if (typeof source !== 'string') throw new Error('Script worker source is missing');
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            const instance = new Worker(url);
            worker = instance;
            instance.onmessage = (message: MessageEvent<unknown>): void => {
                channel.postMessage(message.data);
            };
            instance.onerror = (error: ErrorEvent): void => {
                channel.postMessage({ id: 0, error: error.message || 'Script worker failed' });
            };
            channel.onmessage = (message: MessageEvent<unknown>): void => {
                const command = message.data;
                if (
                    command &&
                    typeof command === 'object' &&
                    Reflect.get(command, 'type') === 'terminate'
                ) {
                    instance.terminate();
                    URL.revokeObjectURL(url);
                    return;
                }
                instance.postMessage(command);
            };
            channel.postMessage({ ready: true });
        } catch (error) {
            channel.postMessage({ id: 0, error: String(error) });
        }
    });
}
