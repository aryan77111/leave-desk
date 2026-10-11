'use client';
import clsx from 'clsx';
import { useFormStatus } from 'react-dom';
import type { ComponentProps } from 'react';
import { buttonVariants, type ButtonVariant } from './primitives';
import type { ActionResult } from '@/lib/types';

export function SubmitButton({ children, pendingText, variant = 'primary', className, disabled, ...props }: ComponentProps<'button'> & {
  pendingText?: string; variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-disabled={pending}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded px-3.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        buttonVariants[variant], className,
      )}
      {...props}
    >
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {pending ? pendingText ?? children : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionResult | null | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p role={state.error ? 'alert' : 'status'} className={clsx('text-sm font-medium', state.error ? 'text-bad-fg' : 'text-ok-fg')}>
      {state.error ?? state.ok}
    </p>
  );
}
