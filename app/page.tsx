import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/format';
import { getSignedIn } from '@/lib/session';

export default async function Home() {
  const s = await getSignedIn();
  if (!s) redirect('/login');
  if (!s.person) redirect('/no-access');
  redirect(homeFor(s.person.roles));
}
