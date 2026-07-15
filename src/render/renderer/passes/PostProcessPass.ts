import { createSharedDrawPassTemplate, type SharedDrawPassParameters } from './SharedDrawPass';

export const PostProcessPassTemplate = createSharedDrawPassTemplate('PostProcessPass');
export const PostProcessPass = PostProcessPassTemplate;
export type PostProcessPassParams = SharedDrawPassParameters;
