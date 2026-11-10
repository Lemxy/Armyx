import { useEffect, useState } from 'react'
import { getImg } from '../imgs'

/** A generated picture: `src` while it is still in memory, otherwise loaded from the image store by `id` (after a restart). Click to save. */
export default function StoredImg({ src, id, cls = 'rounded-xl border border-line', plain = false }: { src?: string; id?: string; cls?: string; plain?: boolean }) {
  const [data, setData] = useState(src)
  useEffect(() => {
    setData(src)
    if (!src && id) getImg(id).then(setData).catch(console.error)
  }, [src, id])
  if (!data) return null
  return plain ? <img src={data} className={cls} /> : <a href={data} download="nano-banana.png" title="Save"><img src={data} className={cls} /></a>
}
