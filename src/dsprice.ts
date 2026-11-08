// DeepSeek price per 1M tokens (USD) for the models in MODELS.deepseek (AgentSidebar). Pure, so the orchestra tests can import it.
// Source: https://api-docs.deepseek.com/quick_start/pricing (checked 2026-11-08). The page has peak and off-peak columns; the PEAK ones are used,
// so the run cap errs on the safe side. deepseek-v4-flash is a legacy alias billed at the Flash price.
// shortcut: deepseek-chat and deepseek-reasoner are not on the current price page, so their cost stays 0; add rows when DeepSeek lists them.
const PRICE = { flash: { hit: 0.006, miss: 0.3, out: 1.2 }, pro: { hit: 0.044, miss: 1.32, out: 3.96 } }
const priceOf = (model: string) => (/v4-pro/i.test(model) ? PRICE.pro : /flash/i.test(model) ? PRICE.flash : undefined)

type Usage = { prompt_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; completion_tokens?: number }

/** The orchestra's token counts and cost for one DeepSeek response. */
export function dsUsage(model: string, u: Usage = {}) {
  const cached = u.prompt_cache_hit_tokens ?? 0
  const input = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - cached)
  const output = u.completion_tokens ?? 0
  const p = priceOf(model)
  return { input, cached, output, cost: p ? (cached * p.hit + input * p.miss + output * p.out) / 1e6 : 0 }
}
