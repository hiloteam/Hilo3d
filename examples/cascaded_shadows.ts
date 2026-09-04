import { startShowcase } from './shared/showcase';

await startShowcase({
    antialias: true,
    count: 24,
    palette: [
        [1, 0.4, 0.25],
        [0.35, 0.75, 1],
        [0.85, 0.65, 0.3]
    ]
});
