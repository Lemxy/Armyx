import { useEffect, useState } from 'react'

/** `v` after it has stopped changing for `ms`: keeps whole-project calculations off the typing path. */
export function useDebounced<T>(v: T, ms = 600): T {
  const [d, setD] = useState(v)
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id) }, [v, ms])
  return d
}
