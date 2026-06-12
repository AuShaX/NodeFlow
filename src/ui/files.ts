/** Browser file save/open helpers for the I/O menus. */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // give the click a tick before revoking (Safari)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadText = (filename: string, mime: string, text: string): void =>
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }))

export function downloadCanvasPng(filename: string, canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(filename, blob)
  }, 'image/png')
}

export function downloadCanvasJpg(filename: string, canvas: HTMLCanvasElement): void {
  canvas.toBlob(
    (blob) => {
      if (blob) downloadBlob(filename, blob)
    },
    'image/jpeg',
    0.92,
  )
}

/** Open the system file picker; resolves null when the user cancels. */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      resolve({ name: file.name, text: await file.text() })
    }
    // cancel detection (fires without a change event)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Safe cross-platform filename from a board name. */
export const fileSlug = (name: string): string =>
  (
    name
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'board'
  ).slice(0, 64)
