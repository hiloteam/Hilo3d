import { createSharedDrawPassTemplate, type SharedDrawPassParameters } from './SharedDrawPass';

export const TransparentPassTemplate = createSharedDrawPassTemplate('TransparentPass');
export const TransparentPass = TransparentPassTemplate;
export type TransparentPassParams = SharedDrawPassParameters;
