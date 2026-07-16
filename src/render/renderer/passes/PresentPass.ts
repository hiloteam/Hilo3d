import { createSharedDrawPassTemplate, type SharedDrawPassParameters } from './SharedDrawPass';

/** Present is an observable graph root even when its target is imported rather than extracted. */
export const PresentPassTemplate = createSharedDrawPassTemplate('PresentPass', true);
export const PresentPass = PresentPassTemplate;
export type PresentPassParams = SharedDrawPassParameters;
