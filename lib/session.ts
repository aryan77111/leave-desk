import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Delegation, Person, Role, Settings } from '@/lib/types';

export type Viewer = { userId: string; email: string; person: Person };

/** The signed-in user and their roster row (null when not on the roster). Cached per request. */
export const getSignedIn = cache(async (): Promise<{ userId: string; email: string; person: Person | null } | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc('claim_profile');
  const person = (data as Person | null)?.id ? (data as Person) : null;
  return { userId: user.id, email: user.email ?? '', person };
});

/** Use in pages and actions: signed in and on the roster, optionally with a role. */
export async function requireViewer(role?: Role): Promise<Viewer> {
  const s = await getSignedIn();
  if (!s) redirect('/login');
  if (!s.person) redirect('/no-access');
  if (role && !s.person.roles.includes(role)) redirect('/');
  return { userId: s.userId, email: s.email, person: s.person };
}

/** Signed in with any one of these roles. */
export async function requireOneOf(roles: Role[]): Promise<Viewer> {
  const v = await requireViewer();
  if (!roles.some((r) => v.person.roles.includes(r))) redirect('/');
  return v;
}

/** The signed-in person's current or next delegation to decide for the Dean. Cached per request. */
export const getDelegation = cache(async (): Promise<Delegation | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('my_delegation');
  return (data as Delegation | null) ?? null;
});

/** The Dean, or a colleague the Dean has named while away (today within their dates). */
export async function requireDecider(): Promise<Viewer & { delegate: boolean }> {
  const v = await requireViewer();
  if (v.person.roles.includes('approver')) return { ...v, delegate: false };
  const d = await getDelegation();
  if (d?.active) return { ...v, delegate: true };
  redirect('/');
}

/** People who can see every request: the Dean HRM Office, the Dean and an active delegate. */
export async function requireStaff(): Promise<Viewer & { delegate: boolean }> {
  const v = await requireViewer();
  if (v.person.roles.includes('office') || v.person.roles.includes('approver')) return { ...v, delegate: false };
  const d = await getDelegation();
  if (d?.active) return { ...v, delegate: true };
  redirect('/');
}

export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('Could not load settings.');
  return data as Settings;
});
