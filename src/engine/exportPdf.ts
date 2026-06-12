import type { SceneSource } from '../types'
import { renderSceneToCanvas } from './exportImage'

/**
 * Single-page PDF export: the map rendered @2x as a JPEG embedded in a
 * hand-rolled PDF (DCTDecode), no dependencies. This matches Miro's standard
 * raster PDF quality; a true vector PDF needs font embedding and is deferred
 * (DECISIONS.md). Page size = image size in points at 96dpi → 72dpi.
 */
export function exportPDF(scene: SceneSource): Blob | null {
  const rendered = renderSceneToCanvas(scene, { scale: 2, background: undefined })
  if (!rendered) return null
  const { canvas } = rendered
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const jpegBytes = dataUrlToBytes(dataUrl)
  if (!jpegBytes) return null

  // Display size in PDF points: canvas is 2x, so css px = width/2; pt = px * 72/96.
  const wPt = (canvas.width / 2) * 0.75
  const hPt = (canvas.height / 2) * 0.75

  const objects: Uint8Array[] = []
  const enc = new TextEncoder()
  const push = (s: string | Uint8Array): number => {
    objects.push(typeof s === 'string' ? enc.encode(s) : s)
    return objects.length
  }

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const emit = (chunk: Uint8Array): void => {
    chunks.push(chunk)
    length += chunk.length
  }

  emit(enc.encode('%PDF-1.4\n'))

  const body = (n: number, content: string | Uint8Array[]): void => {
    offsets[n] = length
    emit(enc.encode(`${n} 0 obj\n`))
    if (typeof content === 'string') emit(enc.encode(content))
    else for (const c of content) emit(c)
    emit(enc.encode('\nendobj\n'))
  }

  void push // (object table is implicit: 1..5)

  body(1, '<< /Type /Catalog /Pages 2 0 R >>')
  body(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  body(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  )
  body(4, [
    enc.encode(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
    ),
    jpegBytes,
    enc.encode('\nendstream'),
  ])
  const content = `q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q`
  body(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

  const xrefStart = length
  let xref = `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  emit(enc.encode(xref))

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

const num = (v: number): string => (Math.round(v * 100) / 100).toString()

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
