// Logos of the model makers (Lobe Icons, from the npm package @lobehub/icons-static-svg), kept in src/assets/brands.
// The coloured ones go in as pictures; the one-colour ones are a mask, so they take the block's colour in every theme.
import claude from './assets/brands/claude-color.svg'
import gemini from './assets/brands/gemini-color.svg'
import deepseek from './assets/brands/deepseek-color.svg'
import openrouter from './assets/brands/openrouter.svg'
import openai from './assets/brands/openai.svg'
import nvidia from './assets/brands/nvidia-color.svg'

const LOGO = { claude: [claude, false], agy: [gemini, false], deepseek: [deepseek, false], openrouter: [openrouter, true], nvidia: [nvidia, false], codex: [openai, true] } as const

/** The logo of an agent kind; Nano Banana is a banana (Gemini's image models), anything unknown shows nothing. */
export function Brand({ agent, size = 16, color = 'currentColor' }: { agent: string; size?: number; color?: string }) {
  if (agent === 'nano') return <span style={{ fontSize: size * 0.85, lineHeight: 1 }} aria-hidden>🍌</span>
  const l = LOGO[agent as keyof typeof LOGO]
  if (!l) return null
  const [src, mono] = l
  return mono
    ? <span aria-hidden style={{ width: size, height: size, background: color, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`, WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' }} className="inline-block shrink-0" />
    : <img src={src} width={size} height={size} alt="" className="shrink-0" />
}
