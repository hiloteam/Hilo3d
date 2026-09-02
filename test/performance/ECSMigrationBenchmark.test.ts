import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('ECS migration benchmark contract', () => {
    it('freezes the Node/Stage reference and performance-first merge gates', async () => {
        const manifest = JSON.parse(
            await readFile(resolve(repositoryRoot, 'benchmarks/ecs/manifest.json'), 'utf8')
        ) as Record<string, unknown>;
        expect(manifest).toEqual({
            schemaVersion: 1,
            suite: 'ecs-migration',
            baselineCommit: '2f72d916510db137b8e3cbb16161a1b38721c227',
            nodeVersion: '22.23.1',
            staticEntityCount: 100_000,
            dynamicEntityCount: 10_000,
            warmupFrames: 20,
            sampleFrames: 100,
            rounds: 3,
            minimumP95ImprovementFraction: 0.25,
            maximumCoreAllocationBytesPerFrame: 0
        });
    });

    it('keeps comparison fail-closed and profiles the actual Transform/extraction boundaries', async () => {
        const [comparison, candidate] = await Promise.all([
            readFile(
                resolve(repositoryRoot, 'scripts/performance/compare-ecs-migration.ts'),
                'utf8'
            ),
            readFile(
                resolve(repositoryRoot, 'test/performance/helpers/ecs-migration-world-worker.ts'),
                'utf8'
            )
        ]);
        expect(comparison).toContain('Candidate worktree must be clean and committed.');
        expect(comparison).toContain(
            'improvementFraction >= manifest.minimumP95ImprovementFraction'
        );
        expect(comparison).toContain(
            'maximumCoreAllocationBytes <= manifest.maximumCoreAllocationBytesPerFrame'
        );
        expect(candidate).toContain("callFrame.functionName === 'updateWorldMatrices'");
        expect(candidate).toContain('RenderExtractionSystem.ts');
        expect(candidate).toContain('maximumStaticCoreAllocationBytes');
        expect(candidate).toContain('maximumDynamicCoreAllocationBytes');
        expect(candidate).toContain('profiler/JIT setup');
        expect(candidate).toContain('consecutiveZeroProfiles === 3');
        expect(candidate).toContain('did not reach steady state');
    });
});
