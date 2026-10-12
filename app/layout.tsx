import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/source-sans-3/index.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import './globals.css';
import { ErrorReporter } from '@/components/shell/error-reporter';

export const metadata: Metadata = {
  title: { default: 'Leave Desk', template: '%s · Leave Desk' },
  description: 'Student leave applications, faculty acknowledgment and approvals for MBA-HRM.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#012340', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen font-sans">
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
