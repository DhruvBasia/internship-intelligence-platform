/**
 * Build-time and deployment flags.
 *
 * PERSONAL is the deployer's private seed (profile, roadmap tasks, programme
 * ratings) read from the git-ignored private/ folder at build time. It is only
 * ever applied to the account whose email matches INTERNIQ_OWNER_EMAIL.
 */
import type { Area, Features, Fit, Profile, ProgramStage } from '../shared/types';
import { ctx } from './platform/context';
import { gmailConfigured } from './platform/env';

export interface PersonalSeed {
  version: number;
  profile?: Partial<Profile>;
  ratings?: Record<string, { fit: Fit; note: string }>;
  programStages?: Record<string, ProgramStage>;
  tasks?: { title: string; due: string; area: Area; notes?: string }[];
}

declare const __IIP_PERSONAL__: PersonalSeed | null | undefined;

let personal: PersonalSeed | null = typeof __IIP_PERSONAL__ !== 'undefined' && __IIP_PERSONAL__ ? __IIP_PERSONAL__ : null;

export function getPersonalSeed(): PersonalSeed | null {
  return personal;
}

/** Tests only: the seed is otherwise fixed at build time. */
export function setPersonalSeedForTests(seed: PersonalSeed | null): void {
  personal = seed;
}

/** What this deployment can do, for the current request. */
export function features(): Features {
  return { mail: gmailConfigured(ctx().env) };
}
