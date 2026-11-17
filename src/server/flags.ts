/**
 * Build-time flags (see scripts/build.mjs). The public build has no personal
 * data and no Gmail access; a personal build reads private/config.json and
 * private/seed.json from the deployer's machine (git-ignored).
 */
import type { Area, Features, Fit, Profile, ProgramStage } from '../shared/types';

export interface PersonalSeed {
  version: number;
  profile?: Partial<Profile>;
  ratings?: Record<string, { fit: Fit; note: string }>;
  programStages?: Record<string, ProgramStage>;
  tasks?: { title: string; due: string; area: Area; notes?: string }[];
}

declare const __IIP_FEATURES__: Features | undefined;
declare const __IIP_PERSONAL__: PersonalSeed | null | undefined;

export const FEATURES: Features = typeof __IIP_FEATURES__ !== 'undefined' && __IIP_FEATURES__ ? __IIP_FEATURES__ : { mail: false };
export const PERSONAL: PersonalSeed | null = typeof __IIP_PERSONAL__ !== 'undefined' && __IIP_PERSONAL__ ? __IIP_PERSONAL__ : null;
