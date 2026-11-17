/**
 * The built page as Apps Script will serve it. HtmlService rewrites inline scripts and drops
 * anything that looks like a "//" line comment, so a minified bundle (one long line full of
 * URLs and regexes) gets silently truncated. The page must carry no "//" inside any script.
 */
import { describe, expect, it } from 'vitest';
import { buildClient } from '../scripts/build.mjs';

describe('client page', () => {
  it('has no double slash inside any inline script or style', async () => {
    const { html } = await buildClient();
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThanOrEqual(4);
    expect(styles.length).toBeGreaterThanOrEqual(1);
    for (const body of [...scripts, ...styles]) expect(body).not.toContain('//');
  }, 60_000);

  it('ships the bundle as base64url that decodes to valid JavaScript', async () => {
    const { html } = await buildClient();
    const raw = /id="iip-bundle">([^<]*)<\/script>/.exec(html)![1]!;
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const js = Buffer.from(raw, 'base64url').toString('utf8');
    expect(js.length).toBeGreaterThan(50_000);
    expect(() => new Function(js)).not.toThrow();
  }, 60_000);
});
