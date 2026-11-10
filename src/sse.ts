/** Reads a server-sent-event response and calls `on` with the JSON of every `data:` line, as it arrives. */
export async function sse(r: Response, on: (j: any) => void) {
  const rd = r.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { done, value } = await rd.read()
    if (done) break
    buf += value
    const lines = buf.split('\n')
    buf = lines.pop()! // a line cut by the network waits for its other half
    for (const l of lines) {
      if (!l.startsWith('data:')) continue
      let j
      try { j = JSON.parse(l.slice(5)) } catch { continue } // "[DONE]" and keep-alives
      on(j)
    }
  }
}
