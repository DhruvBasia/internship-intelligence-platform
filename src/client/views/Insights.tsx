/**
 * Insights. Every chart here is single-series (one blue from the reference
 * palette), so no categorical palette is involved and no legend is needed: the
 * card title names the series. Each chart has hover/focus tooltips and a table view.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChartColumn, Table } from 'lucide-preact';
import type { JobSummary } from '../../shared/types';
import { jobs } from '../state';
import { Button, Empty } from '../ui';

interface Datum {
  label: string;
  value: number;
  detail?: string;
}

/** Integer tick step (1, 2, 5 × 10^k) so four steps cover the max: counts never get fractional ticks. */
function niceStep(max: number): number {
  const raw = Math.max(1, max / 4);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

/** Track an element's rendered width so charts draw at real pixel size (legible text at any card width). */
function useWidth(fallback: number): [{ current: HTMLDivElement | null }, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return [ref, w];
}

/** Column with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function ColumnChart({ data, title, unit }: { data: Datum[]; title: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(560);
  const H = 200;
  const pad = { l: 30, r: 6, t: 18, b: 24 };
  const step = niceStep(Math.max(1, ...data.map((d) => d.value)));
  const max = step * 4;
  const ticks = [0, step, step * 2, step * 3, max];
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / data.length;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const maxIdx = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const labelEvery = band < 30 ? 3 : band < 46 ? 2 : 1;
  const h = hover !== null ? data[hover] : null;
  return (
    <div class="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g>
            <line class={t === 0 ? 'baseline' : 'gridline'} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text class="tick" x={pad.l - 8} y={y(t) + 4} text-anchor="end">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          const top = y(d.value);
          const showLabel = d.value > 0 && (i === maxIdx || i === data.length - 1);
          return (
            <g>
              <rect
                class="hit"
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={plotH}
                tabIndex={0}
                aria-label={`${d.label}: ${d.value} ${unit}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              <path class="mark" d={columnPath(cx - barW / 2, top, barW, pad.t + plotH - top)} style={hover === i ? { fill: 'var(--accent-hover)' } : undefined} />
              {showLabel ? (
                <text class="label" x={cx} y={top - 6} text-anchor="middle">
                  {d.value}
                </text>
              ) : null}
              {(data.length - 1 - i) % labelEvery === 0 ? (
                <text class="tick" x={cx} y={H - 8} text-anchor="middle">
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h && hover !== null ? (
        <div class="chart-tip" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, top: `${(y(h.value) / H) * 100}%` }}>
          <strong>{h.value}</strong> {unit}
          <div style={{ opacity: 0.75 }}>{h.detail ?? h.label}</div>
        </div>
      ) : null}
    </div>
  );
}

function DataTable({ data, unit, labelHead }: { data: Datum[]; unit: string; labelHead: string }) {
  return (
    <table class="data">
      <thead>
        <tr>
          <th>{labelHead}</th>
          <th class="r">{unit}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr>
            <td>{d.detail ?? d.label}</td>
            <td class="r">{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartCard({ title, sub, data, unit, labelHead }: { title: string; sub: string; data: Datum[]; unit: string; labelHead: string }) {
  const [table, setTable] = useState(false);
  return (
    <section class="card">
      <div class="card-head">
        <div>
          <h2>{title}</h2>
          <div class="sub">{sub}</div>
        </div>
        <Button class="grow" variant="ghost" size="sm" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <ChartColumn size={14} /> : <Table size={14} />} {table ? 'Chart' : 'Table'}
        </Button>
      </div>
      <div class="card-pad">{table ? <DataTable data={data} unit={unit} labelHead={labelHead} /> : <ColumnChart data={data} title={title} unit={unit} />}</div>
    </section>
  );
}

function reached(j: JobSummary) {
  const applied = Boolean(j.appliedAt) || ['applied', 'interviewing', 'offer'].includes(j.stage);
  return {
    saved: j.stage !== 'discovered' && (j.stage !== 'archived' || applied),
    applied,
    interviewing: j.stage === 'interviewing' || j.stage === 'offer',
    offer: j.stage === 'offer',
  };
}

function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function Insights() {
  const all = jobs.value;
  const data = useMemo(() => {
    const funnel = { tracked: all.length, saved: 0, applied: 0, interviewing: 0, offer: 0 };
    for (const j of all) {
      const r = reached(j);
      if (r.saved) funnel.saved++;
      if (r.applied) funnel.applied++;
      if (r.interviewing) funnel.interviewing++;
      if (r.offer) funnel.offer++;
    }
    const thisWeek = weekStart(new Date());
    const weeks: Datum[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisWeek);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const n = all.filter((j) => j.appliedAt && Date.parse(j.appliedAt) >= start.getTime() && Date.parse(j.appliedAt) < end.getTime()).length;
      const label = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      weeks.push({ label, value: n, detail: `Week of ${label}` });
    }
    const buckets: Datum[] = Array.from({ length: 10 }, (_, i) => ({ label: String(i * 10), value: 0, detail: `Score ${i * 10}–${i === 9 ? 100 : i * 10 + 9}` }));
    for (const j of all) {
      if (j.stage === 'archived') continue;
      buckets[Math.min(9, Math.floor(j.score / 10))]!.value++;
    }
    const bySource = new Map<string, { n: number; sum: number; strong: number; applied: number; ai: number }>();
    for (const j of all) {
      const k = j.sourceLabel || j.source;
      const s = bySource.get(k) ?? { n: 0, sum: 0, strong: 0, applied: 0, ai: 0 };
      s.n++;
      s.sum += j.score;
      if (j.score >= 80) s.strong++;
      if (reached(j).applied) s.applied++;
      if (j.match?.method === 'ai') s.ai++;
      bySource.set(k, s);
    }
    const sources = Array.from(bySource.entries())
      .map(([label, s]) => ({ label, ...s, avg: Math.round(s.sum / s.n) }))
      .sort((a, b) => b.strong - a.strong || b.n - a.n);
    return { funnel, weeks, buckets, sources };
  }, [all]);

  if (!all.length) {
    return (
      <div class="card">
        <Empty icon={<ChartColumn size={30} />} title="Insights appear once you track some jobs">
          Refresh to pull postings, save a few, and mark the ones you apply to.
        </Empty>
      </div>
    );
  }

  const f = data.funnel;
  const steps = [
    { label: 'Tracked', value: f.tracked },
    { label: 'Saved', value: f.saved },
    { label: 'Applied', value: f.applied },
    { label: 'Interviewing', value: f.interviewing },
    { label: 'Offer', value: f.offer },
  ];
  const maxStep = Math.max(1, steps[0]!.value);

  return (
    <div class="stack" style={{ gap: 16 }}>
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Application funnel</h2>
            <div class="sub">jobs that reached each stage, and conversion from the stage before</div>
          </div>
        </div>
        <div class="card-pad funnel">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1]!.value : 0;
            const conv = i > 0 && prev > 0 ? Math.round((s.value / prev) * 100) : null;
            return (
              <div class="funnel-row">
                <span class="ink-2">{s.label}</span>
                <div class="funnel-bar" role="img" aria-label={`${s.label}: ${s.value}${conv !== null ? `, ${conv}% of previous stage` : ''}`}>
                  <div style={{ width: `${Math.max(0.4, (s.value / maxStep) * 100)}%`, opacity: s.value ? 1 : 0.3 }} />
                </div>
                <span class="num small">
                  <strong>{s.value.toLocaleString()}</strong>
                  <span class="muted">{conv !== null ? ` · ${conv}%` : ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div class="grid cols-2">
        <ChartCard title="Applications per week" sub="last 12 weeks, by date applied" data={data.weeks} unit="applications" labelHead="Week" />
        <ChartCard title="Match score distribution" sub="active jobs (archived excluded)" data={data.buckets} unit="jobs" labelHead="Score band" />
      </div>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Where good matches come from</h2>
            <div class="sub">per source: how many postings, how good, and how many you applied to</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table class="data">
            <thead>
              <tr>
                <th>Source</th>
                <th class="r">Postings</th>
                <th class="r">Avg score</th>
                <th class="r">Strong (80+)</th>
                <th class="r">AI analysed</th>
                <th class="r">Applied</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((s) => (
                <tr>
                  <td>{s.label}</td>
                  <td class="r">{s.n}</td>
                  <td class="r">{s.avg}</td>
                  <td class="r">{s.strong}</td>
                  <td class="r">{s.ai}</td>
                  <td class="r">{s.applied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
