const requestedBackend = new URLSearchParams(location.search).get('backend');
if (requestedBackend === 'webgpu') {
    await import('./particle_gpu_nebula');
} else {
    await import('./particles');
}
