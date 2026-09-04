import { startShowcase } from './shared/showcase';

const initializingChrome = [...document.body.children].filter(
    (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        !child.hidden &&
        child.id !== 'container' &&
        child.tagName !== 'SCRIPT'
);
for (const element of initializingChrome) element.hidden = true;

await startShowcase({
    count: 4,
    clearColor: [0.002, 0.004, 0.016],
    palette: [
        [0.08, 0.85, 1],
        [1, 0.12, 0.65],
        [0.45, 0.18, 1]
    ]
});

for (const element of initializingChrome) {
    if (!element.classList.contains('loadingPanel')) element.hidden = false;
}
