const RENDERABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
// Receipts are text documents — 2000px on the long edge is plenty for both the
// AI reader and zooming in, keeps uploads fast on shop wifi, and stays far
// under the vision API's 5MB/8000px limits (48MP phone photos exceed both).
const MAX_EDGE = 2000
const MAX_BYTES = 2_500_000

/**
 * Normalize a picked file for storage + AI reading. PDFs pass through
 * (Claude reads them natively). Photos are downscaled on-device when large,
 * and iPhone HEIC converts to JPEG — Safari can decode its own HEIC — so they
 * render everywhere and the extractor accepts them. If the browser can't
 * decode the format, the original uploads as-is (still viewable, entry manual).
 */
export async function prepareUpload(
  file: File,
): Promise<{ file: File; kind: 'image' | 'pdf' | 'file' }> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { file, kind: 'pdf' }
  const renderable = RENDERABLE.includes(file.type)
  try {
    const bitmap = await createImageBitmap(file)
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (renderable && longEdge <= MAX_EDGE && file.size <= MAX_BYTES) {
      return { file, kind: 'image' } // already small — keep original bytes
    }
    const scale = Math.min(1, MAX_EDGE / longEdge)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.87))
    if (!blob) throw new Error('conversion produced no data')
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return { file: new File([blob], name, { type: 'image/jpeg' }), kind: 'image' }
  } catch {
    return { file, kind: renderable ? 'image' : 'file' }
  }
}
