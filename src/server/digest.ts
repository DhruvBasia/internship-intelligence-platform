/**
 * Daily email digest of new strong matches, sent with MailApp to the user's
 * own address only. Everything interpolated into the HTML is escaped and every
 * link is checked to be http(s): job titles come from the open web.
 */
import { APP_NAME } from '../shared/defaults';
import { escapeHtml, safeHttpUrl, truncate } from '../shared/text';
import type { JobSummary } from '../shared/types';

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

export interface UpcomingItem {
  /** YYYY-MM-DD or YYYY-MM-DDTHH:mm */
  when: string;
  title: string;
}

function whenLabel(when: string): string {
  const d = new Date(when.length === 10 ? when + 'T12:00:00' : when);
  if (Number.isNaN(d.getTime())) return when;
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return when.length > 10 ? `${day}, ${when.slice(11, 16)}` : day;
}

export function buildDigest(jobs: JobSummary[], opts: { name: string; threshold: number; appUrl: string; upcoming?: UpcomingItem[] }): Digest | null {
  const picks = jobs.slice(0, 12);
  const soon = (opts.upcoming ?? []).slice(0, 12);
  if (!picks.length && !soon.length) return null;
  const subject = picks.length
    ? `${picks.length} new internship match${picks.length === 1 ? '' : 'es'} (${opts.threshold}+)${soon.length ? ` · ${soon.length} due soon` : ''}`
    : `${soon.length} thing${soon.length === 1 ? '' : 's'} due in the next 2 days`;
  const app = safeHttpUrl(opts.appUrl);
  const greeting = opts.name ? `Hi ${opts.name.split(' ')[0]},` : 'Hi,';

  const text = [
    greeting,
    '',
    soon.length ? 'Due in the next 2 days:' : '',
    ...soon.map((u) => `• ${whenLabel(u.when)}: ${u.title}`),
    soon.length ? '' : '',
    picks.length ? `${APP_NAME} found ${picks.length} new posting${picks.length === 1 ? '' : 's'} scoring ${opts.threshold} or more:` : '',
    '',
    ...picks.map((j) => `• ${j.score} · ${j.role} at ${j.company}${j.location ? ' (' + j.location + ')' : ''}\n  ${safeHttpUrl(j.url) || ''}`),
    '',
    app ? `Open ${APP_NAME}: ${app}` : '',
    'You can turn these emails off in Settings → Automation.',
  ].join('\n');
  const soonHtml = soon.length
    ? `<h2 style="font-size:15px;margin:18px 0 6px">Due in the next 2 days</h2><table role="presentation" style="width:100%;border-collapse:collapse">${soon
        .map(
          (u) =>
            `<tr><td style="padding:6px 0;border-bottom:1px solid #eceef2;width:130px;color:#5b6472;font-size:13px">${escapeHtml(whenLabel(u.when))}</td><td style="padding:6px 0;border-bottom:1px solid #eceef2;font-size:14px">${escapeHtml(u.title)}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  const rows = picks
    .map((j) => {
      const url = safeHttpUrl(j.url);
      const summary = j.match?.summary ? `<div style="color:#5b6472;font-size:13px;line-height:1.45;margin-top:4px">${escapeHtml(truncate(j.match.summary, 180))}</div>` : '';
      const title = url
        ? `<a href="${escapeHtml(url)}" style="color:#1f3fbf;text-decoration:none;font-weight:600">${escapeHtml(j.role)}</a>`
        : `<span style="font-weight:600">${escapeHtml(j.role)}</span>`;
      return `<tr>
  <td style="padding:12px 0;border-bottom:1px solid #eceef2;vertical-align:top;width:52px">
    <div style="width:40px;height:40px;border-radius:20px;background:#eef2ff;color:#1f3fbf;font:600 14px/40px Arial,sans-serif;text-align:center">${escapeHtml(j.score)}</div>
  </td>
  <td style="padding:12px 0;border-bottom:1px solid #eceef2;font-family:Arial,sans-serif">
    ${title}
    <div style="color:#2b303a;font-size:13px;margin-top:2px">${escapeHtml(j.company)}${j.location ? ' · ' + escapeHtml(j.location) : ''}</div>
    ${summary}
  </td>
</tr>`;
    })
    .join('\n');

  const html = `<div style="background:#f6f7f9;padding:24px 12px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;font-family:Arial,sans-serif;color:#2b303a">
  <div style="font-size:13px;color:#5b6472;letter-spacing:.02em">${APP_NAME} · daily matches</div>
  <h1 style="font-size:20px;margin:6px 0 16px">${escapeHtml(subject)}</h1>
  <p style="margin:0 0 8px">${escapeHtml(greeting)}</p>
  ${soonHtml}
  ${picks.length ? `<h2 style="font-size:15px;margin:18px 0 6px">New matches</h2><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table>` : ''}
  ${app ? `<p style="margin:20px 0 0"><a href="${escapeHtml(app)}" style="display:inline-block;background:#1f3fbf;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open ${APP_NAME}</a></p>` : ''}
  <p style="font-size:12px;color:#8a93a3;margin:20px 0 0">You get this because daily digests are on in Settings → Automation.</p>
</div></div>`;

  return { subject, text, html };
}
