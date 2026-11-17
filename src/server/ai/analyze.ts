import { LIMITS } from '../../shared/defaults';
import { truncate } from '../../shared/text';
import type { CoverLetterOptions, MatchResult, Profile } from '../../shared/types';
import { AppError } from '../errors';
import type { AiClient } from './client';
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, LETTER_SYSTEM, analysisPrompt, letterPrompt, toMatchResults, type AnalysisInput } from './prompts';

export function analyzeBatch(client: AiClient, profile: Profile, profileHash: string, jobs: AnalysisInput[]): Map<string, MatchResult> {
  const prompt = analysisPrompt(profile, jobs, { schemaInPrompt: client.provider !== 'gemini' });
  const reply = client.json(ANALYSIS_SYSTEM, prompt, ANALYSIS_SCHEMA);
  const results = toMatchResults(reply, jobs, { model: client.model, profileHash });
  if (!results.size) throw new AppError('AI_FAILED', 'The AI reply could not be understood. Try again or pick another model.');
  return results;
}

export function writeCoverLetter(
  client: AiClient,
  profile: Profile,
  job: AnalysisInput,
  options: CoverLetterOptions,
  match: MatchResult | null,
): string {
  const text = client.text(LETTER_SYSTEM, letterPrompt(profile, job, options, match));
  // Models sometimes add a markdown fence or a subject line despite instructions.
  const cleaned = text
    .replace(/^```[a-z]*\n?|```$/g, '')
    .replace(/^\s*subject:.*\n+/i, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
  return truncate(cleaned, LIMITS.coverLetterChars);
}
