import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-preact';
import type { Verdict } from '../shared/types';
import { safeHttpUrl } from '../shared/text';
import { dismissToast, toasts } from './state';

type BtnProps = Omit<JSX.IntrinsicElements['button'], 'size' | 'type'> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  size?: 'sm' | 'md';
  icon?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

export function Button({ variant = 'default', size = 'md', icon, loading, disabled, children, class: cls, type = 'button', ...rest }: BtnProps) {
  const classes = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', icon ? 'icon' : '', String(cls ?? '')].filter(Boolean).join(' ');
  return (
    <button type={type} class={classes} disabled={disabled || loading} aria-busy={loading ? 'true' : undefined} {...rest}>
      {loading ? <LoaderCircle size={15} class="spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** External link that is guaranteed to be http(s) and never gets window.opener. */
export function ExtLink({ href, children, class: cls, title }: { href: string; children: ComponentChildren; class?: string; title?: string }) {
  const url = safeHttpUrl(href);
  if (!url) return <span class={cls}>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" class={cls} title={title}>
      {children}
    </a>
  );
}

export function ScoreRing({ score, verdict, size = 44, label }: { score: number; verdict: Verdict; size?: number; label?: string }) {
  const stroke = size >= 64 ? 6 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div class={`score ${verdict}`} style={{ width: size, height: size }} role="img" aria-label={label ?? `Match score ${score} out of 100`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle class="track" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} />
        <circle class="arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} stroke-linecap="round" stroke-dasharray={`${c * pct} ${c}`} />
      </svg>
      <span class="val" style={{ fontSize: size >= 64 ? 22 : size >= 44 ? 14 : 12 }}>
        {score}
      </span>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ComponentChildren; title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      {icon}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

/** Keeps focus inside a dialog, locks page scroll behind it, and restores both on close. */
function useFocusTrap(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((n) => !n.hasAttribute('disabled'));
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const list = focusables();
      if (!list.length) return;
      const a = list[0]!;
      const b = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        b.focus();
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault();
        a.focus();
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return (
    <>
      <div class="overlay" onClick={onClose} />
      <div class={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="modal-head">
          <h2>{title}</h2>
          <span class="spacer" />
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div class="modal-body">{children}</div>
        {footer ? <div class="modal-foot">{footer}</div> : null}
      </div>
    </>
  );
}

export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return (
    <>
      <div class="overlay" onClick={onClose} />
      <div class="drawer" role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {children}
      </div>
    </>
  );
}

export function Field({ label, hint, children, id }: { label: string; hint?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {hint ? <div class="hint">{hint}</div> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label class="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span>
        <span style={{ fontWeight: 550 }}>{label}</span>
        {hint ? <span class="muted small" style={{ display: 'block' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tag-style multi-value input with optional suggestions. Enter or comma adds. */
export function ChipsInput({ values, onChange, placeholder, suggestions = [], id, max = 40 }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[]; id?: string; max?: number }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const items = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const lower = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const it of items) if (!lower.has(it.toLowerCase()) && next.length < max) next.push(it.slice(0, 80));
    onChange(next);
    setDraft('');
  };
  const remaining = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()));
  const filtered = draft ? remaining.filter((s) => s.toLowerCase().includes(draft.toLowerCase())).slice(0, 8) : remaining.slice(0, 10);
  return (
    <div class="stack" style={{ gap: 8 }}>
      <div class="chips-input">
        {values.map((v) => (
          <span class="chip static">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X size={13} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length ? '' : placeholder}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            if (/[,;]$/.test(v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          onPaste={(e) => {
            const t = e.clipboardData?.getData('text') ?? '';
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              add(t);
            }
          }}
        />
      </div>
      {filtered.length ? (
        <div class="suggest">
          {filtered.map((s) => (
            <button type="button" class="chip" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div class={`meter ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}`} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'plain'; children: ComponentChildren }) {
  const Icon = kind === 'warn' || kind === 'error' ? TriangleAlert : Info;
  return (
    <div class={`callout ${kind === 'plain' ? '' : kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div class={`toast ${t.kind === 'error' ? 'error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'} key={t.id}>
          {t.kind === 'error' ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}
          <span class="grow">{t.text}</span>
          {t.action ? (
            <button
              type="button"
              style={{ fontWeight: 650, opacity: 1, textDecoration: 'underline' }}
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: number | string }) {
  return <div class="skel" style={{ height: h, width: w }} />;
}

/** Debounced autosave for text fields. */
export function useDebounced<T>(value: T, ms: number, onSettle: (v: T) => void) {
  const first = useRef(true);
  const cb = useRef(onSettle);
  cb.current = onSettle;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => cb.current(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
}
