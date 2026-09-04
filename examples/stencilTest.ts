import { startShowcase } from './shared/showcase';

await startShowcase({
    stencil: true,
    count: 8,
    palette: [
        [0.1, 0.85, 1],
        [1, 0.15, 0.55]
    ]
});
