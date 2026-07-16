import { createSharedDrawPassTemplate, type SharedDrawPassParameters } from './SharedDrawPass';

export const ShadowPassTemplate = createSharedDrawPassTemplate('ShadowPass');
export const ShadowPass = ShadowPassTemplate;
export type ShadowPassParams = SharedDrawPassParameters;
