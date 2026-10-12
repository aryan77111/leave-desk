// Preparing a medical certificate in the browser before upload.
// A certificate can have several pages (photos or files). One page is uploaded as it is;
// several are combined into a single PDF, so the office and the Dean open one file.

export const CERT_MAX_BYTES = 5 * 1024 * 1024;
export const CERT_MAX_PAGES = 5;
export const CERT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Photos are shrunk to this many pixels on the long side: sharp enough to read, well under the limit.
const MAX_SIDE = 2200;
const SHRINK_ABOVE = 1.5 * 1024 * 1024;

export class CertificateError extends Error {}

function canvasToJpeg(canvas: HTMLCanvasElement, name: string, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new CertificateError('Could not save the photo.')); return; }
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', quality);
  });
}

async function shrinkImage(f: File, maxSide: number, quality: number): Promise<File> {
  const bmp = await createImageBitmap(f);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvasToJpeg(canvas, `${f.name.replace(/\.[^.]+$/, '') || 'page'}.jpg`, quality);
}

/** Turn any image (large, HEIC, WebP) into a JPEG that fits; PDFs and small JPEG/PNG pass through. */
export async function preparePage(f: File): Promise<File> {
  let out = f;
  if (f.type.startsWith('image/') && !(CERT_TYPES.includes(f.type) && f.size <= SHRINK_ABOVE)) {
    try {
      out = await shrinkImage(f, MAX_SIDE, 0.85);
    } catch {
      throw new CertificateError('This photo could not be read. Upload a PDF, JPG or PNG, or take a photo.');
    }
  }
  if (!CERT_TYPES.includes(out.type)) throw new CertificateError('Upload a PDF, JPG or PNG file, or take a photo.');
  if (out.size > CERT_MAX_BYTES) throw new CertificateError('This file is larger than 5 MB. Take a photo instead, or scan at a lower resolution.');
  return out;
}

/** Take a webcam frame as a JPEG page. */
export function frameToPage(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return canvasToJpeg(canvas, 'certificate-photo.jpg');
}

async function toPdf(pages: File[]): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const A4: [number, number] = [595.28, 841.89];
  const margin = 18;
  for (const p of pages) {
    const bytes = new Uint8Array(await p.arrayBuffer());
    if (p.type === 'application/pdf') {
      let src;
      try {
        src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      } catch {
        throw new CertificateError(`"${p.name}" could not be read as a PDF. Take photos of its pages instead.`);
      }
      for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
    } else {
      const img = p.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const landscape = img.width > img.height;
      const [w, h] = landscape ? [A4[1], A4[0]] : A4;
      const scale = Math.min((w - 2 * margin) / img.width, (h - 2 * margin) / img.height);
      const page = doc.addPage([w, h]);
      page.drawImage(img, {
        x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2,
        width: img.width * scale, height: img.height * scale,
      });
    }
  }
  const out = await doc.save();
  return new File([out as BlobPart], 'certificate.pdf', { type: 'application/pdf' });
}

/** One file to upload: the single page as it is, or all pages combined into one PDF. */
export async function combinePages(pages: File[]): Promise<File> {
  if (pages.length === 0) throw new CertificateError('Attach your medical certificate.');
  if (pages.length === 1) return pages[0];
  let pdf = await toPdf(pages);
  if (pdf.size > CERT_MAX_BYTES) {
    // Too big together: shrink the photos further and try once more.
    const smaller = await Promise.all(pages.map((p) => (p.type.startsWith('image/') ? shrinkImage(p, 1600, 0.72) : p)));
    pdf = await toPdf(smaller);
  }
  if (pdf.size > CERT_MAX_BYTES) {
    throw new CertificateError('Together these pages are larger than 5 MB. Remove a page, or use photos instead of large scanned PDFs.');
  }
  return pdf;
}

export function fileSizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
