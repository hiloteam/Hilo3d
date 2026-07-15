import { createSharedDrawPassTemplate, type SharedDrawPassParameters } from './SharedDrawPass';

export const MainPassTemplate = createSharedDrawPassTemplate('MainPass');
export const MainPass = MainPassTemplate;
export type MainPassParams = SharedDrawPassParameters;
