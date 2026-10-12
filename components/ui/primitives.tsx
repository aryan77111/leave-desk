import Link from 'next/link';
import clsx from 'clsx';
import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Tone } from '@/lib/format';

// Buttons answer the press: a short scale-down, colour that changes with a strong ease-out.
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded px-3.5 h-9 text-sm font-semibold whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out motion-safe:active:scale-[0.98] ' +
  'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100';
export const buttonVariants = {
  primary: 'bg-navy-700 text-white shadow-press hover:bg-navy-800',
  secondary: 'border border-line-strong bg-white text-ink hover:border-ink-faint/70 hover:bg-canvas',
  danger: 'border border-bad-line bg-white text-bad-fg hover:border-bad-fg/40 hover:bg-bad-bg',
  ghost: 'text-navy-700 hover:bg-navy-50',
};
export type ButtonVariant = keyof typeof buttonVariants;
export const buttonClass = (variant: ButtonVariant = 'primary', className?: string) => clsx(buttonBase, buttonVariants[variant], className);

export function Button({ variant = 'primary', className, ...props }: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = 'primary', className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
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
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-2 pr-2.5 text-xs font-semibold ring-1 ring-inset', toneClass[tone], className)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-75" aria-hidden />
      {children}
    </span>
  );
}

export function Card({ className, children, title, action, description }: {
  className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; description?: ReactNode;
}) {
  return (
    <section className={clsx('rounded-lg border border-line bg-white', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[1.0625rem] font-semibold leading-snug text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Page title. `eyebrow` is only for a way back (a link to the parent page); it renders as a back link.
 * Plain-text eyebrows are not shown: the title speaks for itself.
 */
export function PageHeader({ title, description, action, eyebrow }: {
  title: ReactNode; description?: ReactNode; action?: ReactNode; eyebrow?: ReactNode;
}) {
  const back = isValidElement(eyebrow) ? eyebrow : null;
  return (
    <div className="mb-7">
      {back && (
        <div className="mb-3 inline-flex items-center gap-0.5 text-sm font-semibold text-navy-700 [&_a:hover]:underline [&_a]:underline-offset-4">
          <ChevronLeft className="h-4 w-4" aria-hidden />{back}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.012em] text-navy-900 sm:text-[2rem]">{title}</h1>
          {description && <p className="mt-2 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-serif text-lg font-semibold text-navy-900">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const border: Record<Tone, string> = {
    ok: 'border-ok-line bg-ok-bg text-ok-fg', warn: 'border-warn-line bg-warn-bg text-warn-fg',
    bad: 'border-bad-line bg-bad-bg text-bad-fg', info: 'border-info-line bg-info-bg text-info-fg', quiet: 'border-line bg-white text-ink-soft',
  };
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={clsx('rounded-lg border px-4 py-3 text-sm animate-rise-in', border[tone], className)}>
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
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      {error && <p className="text-xs font-medium text-bad-fg">{error}</p>}
    </div>
  );
}

export function KeyValues({ items, className }: { items: { label: string; value: ReactNode; wide?: boolean }[]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3', className)}>
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

/** A count that leads somewhere. Tone colours the figure only when there is something to see. */
export function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: Tone }) {
  const hot = Number(value) > 0;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-ink-muted">{label}</span>
        {href && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-navy-700" aria-hidden />}
      </div>
      <div className={clsx('figure mt-2 text-[2rem] font-semibold leading-none',
        tone === 'bad' && hot ? 'text-bad-fg' : tone === 'warn' && hot ? 'text-bronze-600' : 'text-navy-900')}>
        {value}
      </div>
    </>
  );
  const cls = 'group block rounded-lg border border-line bg-white px-4 pb-4 pt-3.5';
  return href
    ? <Link href={href} className={clsx(cls, 'transition-colors duration-150 hover:border-navy-300 hover:bg-navy-50/30')}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}
