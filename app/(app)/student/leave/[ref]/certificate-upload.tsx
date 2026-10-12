'use client';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CertificatePicker } from '@/components/leave/certificate-picker';
import { Button, Card } from '@/components/ui/primitives';
import { createClient } from '@/lib/supabase/client';
import { fmtStamp } from '@/lib/format';
import { attachCertificate } from '../../actions';

/**
 * needed   — the certificate did not arrive with the request
 * returned — the Dean HRM Office asked for a new one (returnNote says why)
 * replace  — a certificate is waiting for the office; the student may swap a wrong file
 */
export function CertificateUpload({ leaveId, leaveRef, userId, deadline, variant, returnNote, uploadedAt, viewUrl }: {
  leaveId: string;
  leaveRef: string;
  userId: string;
  deadline: string | null;
  variant: 'needed' | 'returned' | 'replace';
  returnNote?: string | null;
  uploadedAt?: string | null;
  viewUrl?: string | null;
}) {
  const [open, setOpen] = useState(variant !== 'replace');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'certificate';
    const path = `${userId}/${leaveId}/${Date.now()}-${safe}`;
    const supabase = createClient();
    const { error: upErr } = await supabase.storage.from('certificates').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setError('The upload did not go through. Check your connection and try again.');
      setBusy(false);
      return;
    }
    const res = await attachCertificate(leaveId, path, leaveRef);
    if (res.error) setError(res.error);
    else { setDone(res.ok ?? 'Certificate uploaded.'); setFile(null); if (variant === 'replace') setOpen(false); }
    setBusy(false);
  }

  const title = variant === 'returned' ? 'Upload a new certificate' : variant === 'replace' ? 'Certificate with the Dean HRM Office' : 'Upload your medical certificate';
  const description = variant === 'replace'
    ? (uploadedAt ? `Uploaded ${fmtStamp(uploadedAt)}` : undefined)
    : deadline ? `Needed by ${fmtStamp(deadline)}` : undefined;

  return (
    <Card title={title} description={description}>
      <div className="flex flex-col gap-4 px-5 py-4">
        {variant === 'returned' && returnNote && (
          <div className="rounded border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
            <p className="font-semibold">The Dean HRM Office returned your certificate</p>
            <p className="mt-1 whitespace-pre-line">{returnNote}</p>
          </div>
        )}
        {variant === 'needed' && (
          <p className="text-sm text-ink-soft">The Dean HRM Office checks it, then the request goes to the Dean. Without it, the request is cancelled at the deadline.</p>
        )}
        {variant === 'replace' && (
          <p className="text-sm text-ink-soft">The office checks it, then the request goes to the Dean.</p>
        )}
        {viewUrl && (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 self-start text-sm font-semibold text-navy-700 hover:underline">
            View what you uploaded <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {done && <p role="status" className="text-sm font-medium text-ok-fg">{done}</p>}

        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-semibold text-navy-700 hover:underline">
            Uploaded the wrong file? Replace it
          </button>
        ) : (
          <>
            <CertificatePicker file={file} onChange={(f) => { setFile(f); setError(null); }} disabled={busy} />
            <p className="text-xs text-ink-muted">Seen only by the Dean HRM Office and the Dean. Faculty cannot see it.</p>
            {error && <p role="alert" className="text-sm text-bad-fg">{error}</p>}
            <Button onClick={upload} disabled={!file || busy}>{busy ? 'Uploading…' : variant === 'replace' ? 'Replace certificate' : 'Upload certificate'}</Button>
          </>
        )}
      </div>
    </Card>
  );
}
