import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareSRPCaptures } from '../../benchmarks/srp/comparison';

const [before, after, output] = process.argv
    .slice(2)
    .filter(argument => argument !== '--diagnostic');
if (!before || !after || !output)
    throw new Error(
        'Usage: benchmark:srp:compare before.json after.json output.json [--diagnostic]'
    );
if (resolve(output).includes('/benchmarks/'))
    throw new Error('Comparison cannot overwrite benchmark baselines');
const diagnostic = process.argv.includes('--diagnostic');
const comparison = compareSRPCaptures(
    JSON.parse(await readFile(before, 'utf8')) as unknown,
    JSON.parse(await readFile(after, 'utf8')) as unknown,
    diagnostic
);
await writeFile(
    output,
    `${JSON.stringify(
        { evidence: diagnostic ? 'local-diagnostic' : 'unreviewed-comparison', comparison },
        null,
        2
    )}\n`,
    { flag: 'wx' }
);
process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
