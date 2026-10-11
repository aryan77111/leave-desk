import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/montserrat/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Leave Desk', template: '%s · Leave Desk' },
  description: 'Student leave applications, faculty acknowledgment and approvals for MBA-HRM.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#003C6F', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
