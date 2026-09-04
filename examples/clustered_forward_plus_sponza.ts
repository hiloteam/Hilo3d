import { startShowcase } from './shared/showcase';

await startShowcase({
    renderingProfile: 'high-end',
    count: 12,
    palette: [
        [1, 0.12, 0.2],
        [0.1, 0.55, 1],
        [0.1, 1, 0.5]
    ]
});
