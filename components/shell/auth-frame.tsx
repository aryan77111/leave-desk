import type { ReactNode } from 'react';

/** Centred card used by sign-in, no-access and the faculty link page. */
export function AuthFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy-800">
        <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-4 py-4 sm:px-6">
          <span className="text-[17px] font-bold tracking-tight text-white">Leave Desk</span>
          <span className="text-2xs font-semibold uppercase text-gold-500">MBA-HRM</span>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-ink-faint">
        Leave Desk for the MBA-HRM programme. For help, contact the programme office.
      </footer>
    </div>
  );
}
