// Pictures you attach for an agent. Stored in the image store (src/imgs.ts); the CLIs get them as files on disk.
import { getImg, imgId, putImg } from './imgs'
import { saveImage } from './vault'

/** A picked image file, scaled down (longest side 1600px) and re-encoded as JPEG: small enough for every API and cheaper in tokens. */
export async function readPic(file: File): Promise<{ id: string; data: string }> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const data = c.toDataURL('image/jpeg', 0.85)
  const id = imgId(); putImg(id, data)
  return { id, data }
}
/** The files of a drop or a paste that are images, read. A file that cannot be read is skipped. */
export const readPics = async (files: File[]) =>
  (await Promise.all(files.filter((f) => f.type.startsWith('image/')).map((f) => readPic(f).catch((e) => { console.error(e); return null })))).flatMap((p) => (p ? [p] : []))

/** The picture as a file on disk: the path to put in a prompt for a CLI agent (desktop only). */
export async function picPath(id: string): Promise<string> {
  const data = await getImg(id)
  if (!data) throw new Error('picture not found')
  return saveImage(id, 'jpg', Array.from(atob(data.split(',')[1]), (c) => c.charCodeAt(0)))
}
/** A prompt addition that points a CLI agent at the pictures. */
export const picNote = (paths: string[]) => `\n\n# Images\nLook at these image files:\n${paths.map((p) => `- ${p}`).join('\n')}`
