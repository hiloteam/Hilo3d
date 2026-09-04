import { startShowcase } from './shared/showcase';

await startShowcase({
    count: 96,
    floor: false,
    clearColor: [0.01, 0.015, 0.02],
    palette: [
        [0.1, 1, 0.45],
        [0.02, 0.2, 0.08]
    ]
});
