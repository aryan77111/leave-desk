import Link from 'next/link';
import type { ReactNode } from 'react';

/** Page frame for screens outside the app shell: no access, and the faculty one-time link page. */
export function AuthFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="on-navy bg-navy-900">
        <div className={`mx-auto flex items-baseline gap-3 px-4 py-4 sm:px-6 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
          <span className="font-serif text-[1.25rem] font-semibold leading-none tracking-[-0.01em] text-white">Leave Desk</span>
          <span className="text-xs font-semibold text-gold-300">MBA-HRM · XIM University</span>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:py-14">
        <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-ink-faint">
        Leave Desk for the MBA-HRM programme. <Link href="/help" className="font-semibold text-navy-700 underline-offset-4 hover:underline">Help and rules</Link>
      </footer>
    </div>
  );
}
