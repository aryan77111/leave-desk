'use client';
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button, Card } from '@/components/ui/primitives';
import { createClient } from '@/lib/supabase/client';
import { fmtStamp } from '@/lib/format';
import { attachCertificate } from '../../actions';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export function CertificateUpload({ leaveId, leaveRef, userId, deadline }: { leaveId: string; leaveRef: string; userId: string; deadline: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | null) {
    setError(null);
    if (!f) { setFile(null); return; }
    if (!TYPES.includes(f.type)) { setError('Upload a PDF, JPG or PNG file.'); setFile(null); return; }
    if (f.size > MAX_BYTES) { setError('The file is larger than 5 MB. Scan at a lower resolution or upload a PDF.'); setFile(null); return; }
    setFile(f);
  }

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
    setBusy(false);
  }

  return (
    <Card title="Upload your medical certificate" description={`Due by ${fmtStamp(deadline)}`}>
      <div className="flex flex-col gap-4 px-5 py-4">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex flex-col items-center gap-2 rounded border border-dashed border-bronze-600/60 bg-gold-100/50 px-4 py-6 text-center hover:bg-gold-100"
        >
          <FileUp className="h-5 w-5 text-bronze-600" />
          <span className="text-sm font-semibold text-ink">{file ? file.name : 'Choose a file'}</span>
          <span className="text-xs text-ink-muted">PDF, JPG or PNG, up to 5 MB</span>
        </button>
        <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="sr-only"
          onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label="Medical certificate file" />
        <p className="text-xs text-ink-muted">Seen only by the approver and the Dean HRM Office. Faculty cannot see it.</p>
        {error && <p role="alert" className="text-sm text-bad-fg">{error}</p>}
        <Button onClick={upload} disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload certificate'}</Button>
      </div>
    </Card>
  );
}
