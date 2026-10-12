'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  Activity, BarChart3, CalendarDays, CalendarPlus, ClipboardCheck, FilePlus2, FileSpreadsheet, Gauge, HelpCircle, History, Inbox,
  ListChecks, Mail, Menu, MessageSquare, Plane, Settings, Table2, Users, X, FileText,
} from 'lucide-react';
import type { Role } from '@/lib/types';

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
type GroupKey = Role | 'delegate';
type Group = { key: GroupKey; label: string; items: Item[] };

const GROUPS: Group[] = [
  { key: 'student', label: 'Student', items: [
    { href: '/student', label: 'My leave', icon: FileText, exact: true },
    { href: '/student/new', label: 'Apply for leave', icon: CalendarPlus },
  ] },
  { key: 'faculty', label: 'Faculty', items: [
    { href: '/faculty', label: 'Leave notices', icon: Inbox, exact: true },
    { href: '/faculty/history', label: 'My responses', icon: History },
  ] },
  { key: 'approver', label: 'Dean', items: [
    { href: '/approve', label: 'Approval queue', icon: ClipboardCheck },
    { href: '/calendar', label: 'Leave calendar', icon: CalendarDays },
    { href: '/results', label: 'Pilot results', icon: BarChart3 },
    { href: '/away', label: 'Out of office', icon: Plane },
  ] },
  { key: 'delegate', label: 'Deciding for the Dean', items: [
    { href: '/approve', label: 'Approval queue', icon: ClipboardCheck },
    { href: '/calendar', label: 'Leave calendar', icon: CalendarDays },
  ] },
  { key: 'office', label: 'Dean HRM Office', items: [
    { href: '/office', label: 'Overview', icon: Gauge, exact: true },
    { href: '/office/leave', label: 'All leave', icon: ListChecks },
    { href: '/office/leave/new', label: 'File leave for a student', icon: FilePlus2 },
    { href: '/calendar', label: 'Leave calendar', icon: CalendarDays },
    { href: '/office/people', label: 'People', icon: Users },
    { href: '/office/timetable', label: 'Timetable', icon: Table2 },
    { href: '/office/export', label: 'Attendance export', icon: FileSpreadsheet },
    { href: '/results', label: 'Pilot results', icon: BarChart3 },
    { href: '/office/feedback', label: 'Feedback', icon: MessageSquare },
    { href: '/away', label: "Dean's delegates", icon: Plane },
    { href: '/office/emails', label: 'Emails sent', icon: Mail },
    { href: '/office/health', label: 'System health', icon: Activity },
    { href: '/office/settings', label: 'Rules and settings', icon: Settings },
  ] },
];

const HELP: Item = { href: '/help', label: 'Help and rules', icon: HelpCircle };

export function Nav({ roles, delegate = false, name, email, programme }: {
  roles: Role[]; delegate?: boolean; name: string; email: string; programme: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  // Each page appears once, under the first group that lists it.
  const seen = new Set<string>();
  const groups = GROUPS
    .filter((g) => (g.key === 'delegate' ? delegate && !roles.includes('approver') : roles.includes(g.key)))
    .map((g) => ({ ...g, items: g.items.filter((it) => (seen.has(it.href) ? false : (seen.add(it.href), true))) }))
    .filter((g) => g.items.length > 0);

  // The most specific matching link is the active one (so "File leave" wins over "All leave").
  const all = [...groups.flatMap((g) => g.items), HELP];
  const matches = (it: Item) => (it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`));
  const activeHref = all.filter(matches).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const link = (it: Item) => {
    const active = it.href === activeHref;
    const Icon = it.icon;
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          aria-current={active ? 'page' : undefined}
          className={clsx(
            'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] transition-colors duration-150 ease-out lg:py-[0.4375rem]',
            active ? 'bg-white/[0.09] font-semibold text-white' : 'font-medium text-navy-100/85 hover:bg-white/[0.05] hover:text-white',
          )}
        >
          {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gold-500" aria-hidden />}
          <Icon className={clsx('h-[1.05rem] w-[1.05rem] shrink-0', active ? 'text-gold-300' : 'opacity-80')} aria-hidden />
          {it.label}
        </Link>
      </li>
    );
  };

  const links = (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.key}>
          {groups.length > 1 && <div className="mb-1 px-3 text-xs font-semibold text-navy-300">{g.label}</div>}
          <ul className="flex flex-col gap-px">{g.items.map(link)}</ul>
        </div>
      ))}
      <ul className="flex flex-col gap-px border-t border-white/10 pt-4">{link(HELP)}</ul>
    </nav>
  );

  const footer = (
    <div className="flex items-center gap-3 border-t border-white/10 pt-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/15 font-serif text-sm font-semibold text-gold-300 ring-1 ring-inset ring-gold-500/30" aria-hidden>
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{name}</div>
        <div className="truncate text-xs text-navy-200/80">{email}</div>
      </div>
      <form action="/auth/signout" method="post">
        <button className="rounded px-2 py-1.5 text-xs font-semibold text-gold-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-gold-100">Sign out</button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/" className="block rounded">
      <div className="font-serif text-[1.3125rem] font-semibold leading-none tracking-[-0.01em] text-white">Leave Desk</div>
      <div className="mt-1.5 text-xs font-semibold text-gold-300">{programme} · XIM University</div>
    </Link>
  );

  return (
    <>
      {/* Desktop sidebar: brand, a scrolling list of pages, and the signed-in person fixed at the bottom */}
      <aside className="on-navy fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-900 lg:flex">
        <div className="px-6 pb-5 pt-6">{brand}</div>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">{links}</div>
        <div className="px-4 pb-4">{footer}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="on-navy sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="-mr-1 flex h-11 w-11 items-center justify-center rounded-md text-white transition-colors duration-150 hover:bg-white/10"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
      </header>
      <div
        id="mobile-nav"
        inert={!open}
        className={clsx(
          'on-navy fixed inset-x-0 bottom-0 top-[68px] z-20 flex flex-col justify-between overflow-y-auto overscroll-contain bg-navy-900 px-3 pb-6 pt-2 lg:hidden',
          'transition-[opacity,transform] duration-200 ease-out',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
      >
        {links}
        <div className="mt-6 px-1">{footer}</div>
      </div>
    </>
  );
}

function initials(name: string) {
  const parts = name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
