import { describe, expect, it } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import { SubsurfaceScatteringProfile } from '../../../src/material/SubsurfaceScatteringProfile';
import Color from '../../../src/math/Color';
import {
    bucketMaterialIssue,
    clusteredOpaqueMaterial,
    validateBucketMaterial
} from '../../../src/render/pipeline/internal/clusteredMaterialVariants';
import Texture from '../../../src/texture/Texture';

describe('Clustered MAT1 material admission', () => {
    it('keeps ordinary PBR eligible for compact GPU material records', () => {
        expect(bucketMaterialIssue(new PBRMaterial())).toBeNull();
    });

    it('routes every MAT1 topology through shared direct shading, including dormant layers', () => {
        const materials = [
            new PBRMaterial({ sheenColor: new Color(0, 0, 0) }),
            new PBRMaterial({ sheenColorMap: new Texture() }),
            new PBRMaterial({ sheenRoughnessMap: new Texture() }),
            new PBRMaterial({ diffuseTransmissionFactor: 0 }),
            new PBRMaterial({ diffuseTransmissionMap: new Texture() }),
            new PBRMaterial({ diffuseTransmissionColorMap: new Texture() }),
            new PBRMaterial({
                subsurfaceProfile: new SubsurfaceScatteringProfile(),
                subsurfaceFactor: 0
            })
        ];
        for (const material of materials) {
            const mesh = new Mesh({ geometry: new BoxGeometry(), material });
            expect(clusteredOpaqueMaterial(mesh)).toBe(material);
            expect(bucketMaterialIssue(material)).toMatch(/shared clustered direct path required/u);
            expect(() => {
                validateBucketMaterial(material, 2);
            }).toThrow(/GPU Scene bucket 2 material uses MAT1/u);
        }
    });
});
