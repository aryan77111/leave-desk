'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, FileText, FileUp, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { CERT_MAX_PAGES, CertificateError, fileSizeLabel, frameToPage, preparePage } from '@/lib/certificate';

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith('image/')) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-16 w-12 shrink-0 rounded border border-line bg-white object-cover" />
  ) : (
    <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded border border-line bg-white"><FileText className="h-5 w-5 text-bronze-600" /></div>
  );
}

/**
 * Choose a medical certificate of one or more pages: take photos (the phone's camera, or the
 * webcam in the page on a computer) or pick PDF / image files. Photos are shrunk; several pages
 * are combined into one PDF when the certificate is uploaded (see combinePages).
 */
export function CertificatePicker({ files, onChange, disabled }: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [live, setLive] = useState(false);
  const room = CERT_MAX_PAGES - files.length;

  const stopCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLive(false);
  };
  useEffect(() => stopCamera, []);
  // Attach the webcam once the video element is on screen.
  useEffect(() => {
    if (live && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => undefined);
    }
  }, [live]);

  async function add(list: File[]) {
    setError(null);
    if (list.length === 0) return;
    if (list.length > room) setError(`You can add at most ${CERT_MAX_PAGES} photos or files. Only the first ${room} were added.`);
    setWorking(true);
    const added: File[] = [];
    try {
      for (const f of list.slice(0, Math.max(room, 0))) added.push(await preparePage(f));
    } catch (e) {
      setError(e instanceof CertificateError ? e.message : 'This file could not be read. Upload a PDF, JPG or PNG, or take a photo.');
    } finally {
      setWorking(false);
    }
    if (added.length) onChange([...files, ...added]);
  }

  async function takePhoto() {
    setError(null);
    // Phones and tablets: open the camera app directly.
    if (window.matchMedia('(pointer: coarse)').matches || !navigator.mediaDevices?.getUserMedia) {
      cameraInput.current?.click();
      return;
    }
    // Computers: show the webcam in the page.
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setLive(true);
    } catch (e) {
      stopCamera();
      setError((e as Error)?.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in your browser, or choose a file instead.'
        : 'No camera was found. Choose a file instead.');
    }
  }

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const page = await frameToPage(v);
    stopCamera();
    await add([page]);
  }

  const inputs = (
    <>
      <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-picker="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*"
        onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={cameraInput} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" data-picker="camera"
        accept="image/*" capture="environment"
        onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </>
  );

  if (live) {
    return (
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded border border-line bg-ink">
          <video ref={video} playsInline muted className="mx-auto block max-h-[50vh] w-full object-contain" />
        </div>
        <p className="text-xs text-ink-muted">
          {files.length ? `Photo ${files.length + 1}. ` : ''}Hold the page flat in good light so it fills the frame.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" onClick={capture} className="h-11 sm:h-9"><Camera className="h-4 w-4" />Capture</Button>
          <Button type="button" variant="secondary" onClick={stopCamera} className="h-11 sm:h-9">Cancel</Button>
        </div>
      </div>
    );
  }

  const bigButton = 'flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded border border-dashed border-bronze-600/60 bg-gold-100/50 px-3 py-4 text-center hover:bg-gold-100 disabled:opacity-60';
  const smallButton = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-line-strong bg-white px-3 text-sm font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-60';

  return (
    <div className="flex flex-col gap-3">
      {inputs}
      {files.length === 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={takePhoto} disabled={disabled || working} className={bigButton}>
              <Camera className="h-5 w-5 text-bronze-600" />
              <span className="text-sm font-semibold text-ink">Take a photo</span>
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled || working} className={bigButton}>
              <FileUp className="h-5 w-5 text-bronze-600" />
              <span className="text-sm font-semibold text-ink">Choose a file</span>
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            {working ? 'Preparing…' : `PDF, JPG or PNG. More than one page? Add them one after another, up to ${CERT_MAX_PAGES} photos or files.`}
          </p>
        </>
      ) : (
        <>
          <ol className="flex flex-col divide-y divide-line rounded border border-navy-700 bg-navy-50">
            {files.map((f, i) => (
              <li key={`${i}-${f.name}-${f.size}`} className="flex items-center gap-3 p-2.5">
                <Thumb file={f} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{files.length > 1 ? `${i + 1}. ${f.type === 'application/pdf' ? 'PDF' : 'Photo'}` : 'Certificate'}</p>
                  <p className="truncate text-xs text-ink-muted">{f.name} · {fileSizeLabel(f.size)}</p>
                </div>
                <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} disabled={disabled}
                  aria-label={files.length > 1 ? `Remove item ${i + 1}` : 'Remove the certificate'}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-white hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
          {room > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-sm text-ink-soft"><Plus className="h-3.5 w-3.5" />Another page:</span>
              <button type="button" onClick={takePhoto} disabled={disabled || working} className={smallButton}><Camera className="h-4 w-4" />Photo</button>
              <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled || working} className={smallButton}><FileUp className="h-4 w-4" />File</button>
            </div>
          ) : (
            <p className="text-xs text-ink-muted">That is the most one certificate can have.</p>
          )}
          <p className="text-xs text-ink-muted">
            {working ? 'Preparing…' : files.length > 1
              ? 'These are joined into one PDF, in this order, when you submit. Check each photo is readable.'
              : 'Check that the text is readable. If the certificate has more pages, add them.'}
          </p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-bad-fg">{error}</p>}
    </div>
  );
}
