/**
 * The build artefacts: a static site that works under a strict Content Security
 * Policy, and a server bundle that runs on Supabase Edge Functions (Deno).
 */
import { describe, expect, it } from 'vitest';
import { buildClient, buildServer } from '../scripts/build.mjs';

const CONFIG = { supabaseUrl: 'https://abcd.supabase.co', anonKey: 'sb_publishable_x', appUrl: 'https://student.github.io/interniq/', operator: 'Test', contact: '' };

describe('web build', () => {
  it('has no inline scripts and a CSP that only allows this app and its Supabase project', async () => {
    const { html, files, config } = await buildClient({ config: CONFIG });
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]!) || m[2]!.trim());
    expect(inline).toEqual([]);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co");
    expect(csp).not.toContain('unsafe-eval');
    for (const name of Object.keys(files)) expect(html).toContain(name);
    expect(config).toMatchObject({ mode: 'hosted', apiUrl: 'https://abcd.supabase.co/functions/v1/api' });
  }, 60_000);

  it('builds the client against the dev server when asked', async () => {
    const { config, html } = await buildClient({ dev: true, config: CONFIG });
    expect(config).toMatchObject({ mode: 'dev', apiUrl: '/api' });
    expect(html).toContain("connect-src 'self'");
  }, 60_000);
});

describe('server build', () => {
  it('bundles everything except Node built-ins and leaves out the private seed when there is none', async () => {
    const { code } = await buildServer({ personal: null });
    const imports = [...code.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
    expect(imports.every((s) => s!.startsWith('node:'))).toBe(true);
    expect(code).toContain('Deno.serve');
    expect(code).not.toContain('Seed User');
  }, 60_000);

  it('compiles the private seed in only when given', async () => {
    const { code } = await buildServer({ personal: { version: 1, profile: { name: 'Seed User' } } });
    expect(code).toContain('Seed User');
  }, 60_000);
});
