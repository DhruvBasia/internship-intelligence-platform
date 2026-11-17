import type { Board } from './types';

/**
 * Public job boards that were live and listing internships when this list was
 * last checked (Nov 2026). Users can follow any other company too; these are
 * one-click suggestions.
 */
export const SUGGESTED_BOARDS: (Board & { group: string })[] = [
  { group: 'AI labs', ats: 'greenhouse', token: 'anthropic', name: 'Anthropic' },
  { group: 'AI labs', ats: 'ashby', token: 'openai', name: 'OpenAI' },
  { group: 'AI labs', ats: 'greenhouse', token: 'scaleai', name: 'Scale AI' },
  { group: 'AI labs', ats: 'ashby', token: 'cohere', name: 'Cohere' },
  { group: 'AI labs', ats: 'ashby', token: 'perplexity', name: 'Perplexity' },
  { group: 'AI labs', ats: 'ashby', token: 'modal', name: 'Modal' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'databricks', name: 'Databricks' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'stripe', name: 'Stripe' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'figma', name: 'Figma' },
  { group: 'Product & platform', ats: 'ashby', token: 'notion', name: 'Notion' },
  { group: 'Product & platform', ats: 'ashby', token: 'ramp', name: 'Ramp' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'airbnb', name: 'Airbnb' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'pinterest', name: 'Pinterest' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'datadog', name: 'Datadog' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'cloudflare', name: 'Cloudflare' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'mongodb', name: 'MongoDB' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'duolingo', name: 'Duolingo' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'roblox', name: 'Roblox' },
  { group: 'Product & platform', ats: 'greenhouse', token: 'lyft', name: 'Lyft' },
  { group: 'Fintech & quant', ats: 'greenhouse', token: 'coinbase', name: 'Coinbase' },
  { group: 'Fintech & quant', ats: 'greenhouse', token: 'robinhood', name: 'Robinhood' },
  { group: 'Fintech & quant', ats: 'greenhouse', token: 'jumptrading', name: 'Jump Trading' },
  { group: 'Fintech & quant', ats: 'greenhouse', token: 'imc', name: 'IMC Trading' },
  { group: 'Fintech & quant', ats: 'greenhouse', token: 'point72', name: 'Point72' },
  { group: 'Robotics & hardware', ats: 'greenhouse', token: 'waymo', name: 'Waymo' },
  { group: 'Robotics & hardware', ats: 'lever', token: 'zoox', name: 'Zoox' },
  { group: 'Robotics & hardware', ats: 'lever', token: 'palantir', name: 'Palantir' },
  { group: 'Robotics & hardware', ats: 'greenhouse', token: 'verkada', name: 'Verkada' },
];
