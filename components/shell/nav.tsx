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
            'relative flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors lg:py-2',
            active ? 'bg-white/10 text-white' : 'text-navy-100 hover:bg-white/5 hover:text-white',
          )}
        >
          {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold-500" aria-hidden />}
          <Icon className="h-4 w-4 shrink-0 opacity-90" />
          {it.label}
        </Link>
      </li>
    );
  };

  const links = (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map((g) => (
        <div key={g.key}>
          {groups.length > 1 && <div className="mb-1.5 px-3 text-2xs font-semibold uppercase text-navy-300">{g.label}</div>}
          <ul className="flex flex-col gap-0.5">{g.items.map(link)}</ul>
        </div>
      ))}
      <ul className="flex flex-col gap-0.5 border-t border-white/10 pt-4">{link(HELP)}</ul>
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 pt-4">
      <div className="truncate text-sm font-semibold text-white">{name}</div>
      <div className="truncate text-xs text-navy-200">{email}</div>
      <form action="/auth/signout" method="post" className="mt-3">
        <button className="text-xs font-semibold text-gold-300 hover:text-gold-100">Sign out</button>
      </form>
    </div>
  );

  const brand = (
    <Link href="/" className="block">
      <div className="text-[17px] font-bold tracking-tight text-white">Leave Desk</div>
      <div className="text-2xs font-semibold uppercase text-gold-500">{programme}</div>
    </Link>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col justify-between bg-navy-800 px-3 py-5 lg:flex">
        <div className="flex min-h-0 flex-col gap-7">
          <div className="px-3">{brand}</div>
          <div className="min-h-0 overflow-y-auto">{links}</div>
        </div>
        <div className="px-3">{footer}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-800 px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded p-2 text-white hover:bg-white/10"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-[60px] bottom-0 z-20 flex flex-col justify-between overflow-y-auto bg-navy-800 px-3 pb-6 pt-2 lg:hidden">
          {links}
          <div className="mt-6 px-3">{footer}</div>
        </div>
      )}
    </>
  );
}
