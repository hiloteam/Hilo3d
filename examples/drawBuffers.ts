import { startShowcase } from './shared/showcase';

await startShowcase({
    count: 16,
    palette: [
        [1, 0.1, 0.1],
        [0.1, 1, 0.2],
        [0.1, 0.3, 1]
    ]
});
