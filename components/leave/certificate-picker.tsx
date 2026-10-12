'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, FileText, FileUp, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
// Photos are shrunk to this many pixels on the long side: still sharp enough to read, well under 5 MB.
const MAX_SIDE = 2200;
const SHRINK_ABOVE = 1.5 * 1024 * 1024;

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function toJpeg(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Could not save the photo.')); return; }
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.85);
  });
}

/** Phone photos are large and sometimes HEIC or WebP: turn any image into a JPEG that fits the limit. */
async function prepare(f: File): Promise<File> {
  if (!f.type.startsWith('image/')) return f;
  if (ALLOWED.includes(f.type) && f.size <= SHRINK_ABOVE) return f;
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const base = f.name.replace(/\.[^.]+$/, '') || 'certificate';
  return toJpeg(canvas, `${base}.jpg`);
}

/**
 * Choose a medical certificate: take a photo (the phone's camera, or the webcam in the page on a
 * computer) or pick a PDF / image file. Photos are shrunk before upload.
 */
export function CertificatePicker({ file, onChange, disabled }: {
  file: File | null;
  onChange: (f: File | null) => void;
  disabled?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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

  async function accept(f: File | null) {
    setError(null);
    if (!f) return;
    setWorking(true);
    try {
      const ready = await prepare(f);
      if (!ALLOWED.includes(ready.type)) setError('Upload a PDF, JPG or PNG file, or take a photo.');
      else if (ready.size > MAX_BYTES) setError('The file is larger than 5 MB. Take a photo instead, or scan at a lower resolution.');
      else onChange(ready);
    } catch {
      setError('This file could not be read. Upload a PDF, JPG or PNG, or take a photo.');
    } finally {
      setWorking(false);
    }
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
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    stopCamera();
    await accept(await toJpeg(canvas, 'certificate-photo.jpg'));
  }

  const inputs = (
    <>
      <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" data-picker="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*"
        onChange={(e) => { void accept(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      <input ref={cameraInput} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" data-picker="camera"
        accept="image/*" capture="environment"
        onChange={(e) => { void accept(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </>
  );

  if (live) {
    return (
      <div className="flex flex-col gap-3">
        <div className="overflow-hidden rounded border border-line bg-ink">
          <video ref={video} playsInline muted className="mx-auto block max-h-[50vh] w-full object-contain" />
        </div>
        <p className="text-xs text-ink-muted">Hold the certificate flat in good light so the whole page fills the frame.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" onClick={capture} className="h-11 sm:h-9"><Camera className="h-4 w-4" />Capture</Button>
          <Button type="button" variant="secondary" onClick={stopCamera} className="h-11 sm:h-9">Cancel</Button>
        </div>
      </div>
    );
  }

  if (file) {
    return (
      <div className="flex flex-col gap-3">
        {inputs}
        <div className="flex items-center gap-3 rounded border border-navy-700 bg-navy-50 p-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview of the certificate" className="h-20 w-16 shrink-0 rounded border border-line bg-white object-cover" />
          ) : (
            <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded border border-line bg-white"><FileText className="h-6 w-6 text-bronze-600" /></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
            <p className="text-xs text-ink-muted">{sizeLabel(file.size)}{preview ? ' · check that the text is readable' : ''}</p>
          </div>
          <button type="button" onClick={() => onChange(null)} disabled={disabled} aria-label="Remove this file"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-white hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" onClick={takePhoto} disabled={disabled} className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:underline">
            <RefreshCw className="h-3.5 w-3.5" />Take another photo
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled} className="text-sm font-semibold text-navy-700 hover:underline">
            Choose a different file
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-bad-fg">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {inputs}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={takePhoto} disabled={disabled || working}
          className="flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded border border-dashed border-bronze-600/60 bg-gold-100/50 px-3 py-4 text-center hover:bg-gold-100 disabled:opacity-60">
          <Camera className="h-5 w-5 text-bronze-600" />
          <span className="text-sm font-semibold text-ink">Take a photo</span>
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled || working}
          className="flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded border border-dashed border-bronze-600/60 bg-gold-100/50 px-3 py-4 text-center hover:bg-gold-100 disabled:opacity-60">
          <FileUp className="h-5 w-5 text-bronze-600" />
          <span className="text-sm font-semibold text-ink">Choose a file</span>
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        {working ? 'Preparing the photo…' : 'PDF, JPG or PNG, up to 5 MB. For a photo, lay the certificate flat in good light.'}
      </p>
      {error && <p role="alert" className="text-sm text-bad-fg">{error}</p>}
    </div>
  );
}
