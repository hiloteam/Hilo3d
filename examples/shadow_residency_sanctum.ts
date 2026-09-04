import { startShowcase } from './shared/showcase';

await startShowcase({
    renderingProfile: 'high-end',
    count: 42,
    clearColor: [0.002, 0.003, 0.012],
    palette: [
        [0.16, 0.36, 1],
        [0.7, 0.75, 1]
    ]
});
