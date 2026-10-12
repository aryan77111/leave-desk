import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/format';
import { getDelegation, getSignedIn } from '@/lib/session';

export default async function Home() {
  const s = await getSignedIn();
  if (!s) redirect('/login');
  if (!s.person) redirect('/no-access');
  const roles = s.person.roles;
  if (!roles.includes('office') && !roles.includes('approver')) {
    const d = await getDelegation();
    if (d?.active) redirect('/approve');
  }
  redirect(homeFor(roles));
}
