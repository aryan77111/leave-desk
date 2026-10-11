import { Nav } from '@/components/shell/nav';
import { getSettings, requireViewer } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { person, email } = await requireViewer();
  const settings = await getSettings();
  return (
    <div className="min-h-screen">
      <Nav roles={person.roles} name={person.full_name} email={email} programme={settings.programme_name} />
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}
