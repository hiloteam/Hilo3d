export function reportStartupFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const loading = document.querySelector<HTMLElement>('#loading');
    if (loading) {
        loading.setAttribute('role', 'alert');
        loading.textContent = `Unable to start the game: ${message}`;
    }
    console.error('Unable to start the Hilo3D game.', error);
}
