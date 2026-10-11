import Link from 'next/link';
import clsx from 'clsx';
import type { ComponentProps, ReactNode } from 'react';
import type { Tone } from '@/lib/format';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded px-3.5 h-9 text-sm font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60';
export const buttonVariants = {
  primary: 'bg-navy-700 text-white hover:bg-navy-800',
  secondary: 'border border-line-strong bg-white text-ink hover:border-ink-faint hover:bg-canvas',
  danger: 'border border-bad-line bg-white text-bad-fg hover:bg-bad-bg',
  ghost: 'text-navy-700 hover:bg-navy-50',
};
export type ButtonVariant = keyof typeof buttonVariants;

export function Button({ variant = 'primary', className, ...props }: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={clsx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function LinkButton({ variant = 'primary', className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={clsx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

const toneClass: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok-fg ring-ok-line',
  warn: 'bg-warn-bg text-warn-fg ring-warn-line',
  bad: 'bg-bad-bg text-bad-fg ring-bad-line',
  info: 'bg-info-bg text-info-fg ring-info-line',
  quiet: 'bg-quiet-bg text-quiet-fg ring-quiet-line',
};

export function Badge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap', toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, title, action, description }: {
  className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; description?: ReactNode;
}) {
  return (
    <section className={clsx('rounded-md border border-line bg-white shadow-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, action, eyebrow }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-ink-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const border: Record<Tone, string> = {
    ok: 'border-ok-line bg-ok-bg text-ok-fg', warn: 'border-warn-line bg-warn-bg text-warn-fg',
    bad: 'border-bad-line bg-bad-bg text-bad-fg', info: 'border-info-line bg-info-bg text-info-fg', quiet: 'border-line bg-canvas text-ink-soft',
  };
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={clsx('rounded-md border px-4 py-3 text-sm', border[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children, className }: {
  label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink-soft">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      {error && <p className="text-xs font-medium text-bad-fg">{error}</p>}
    </div>
  );
}

export function KeyValues({ items, className }: { items: { label: string; value: ReactNode; wide?: boolean }[]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((it) => (
        <div key={it.label} className={clsx('min-w-0', it.wide && 'sm:col-span-2 lg:col-span-3')}>
          <dt className="label-caps">{it.label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: Tone }) {
  const inner = (
    <>
      <div className="label-caps min-h-[2rem]">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'bad' && Number(value) > 0 ? 'text-bad-fg' : tone === 'warn' && Number(value) > 0 ? 'text-warn-fg' : 'text-ink')}>
        {value}
      </div>
    </>
  );
  const cls = 'block rounded-md border border-line bg-white px-4 py-3.5 shadow-card';
  return href ? <Link href={href} className={clsx(cls, 'hover:border-navy-300')}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
