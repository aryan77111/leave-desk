import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Person, Role, Settings } from '@/lib/types';

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

export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error || !data) throw new Error('Could not load settings.');
  return data as Settings;
});
