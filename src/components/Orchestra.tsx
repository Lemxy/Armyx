import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDebounced } from '../debounce'
import { ArrowUp, Play, Settings2, Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, FileText, FolderOpen, GitBranch, History, Magnet, MoreHorizontal, Paperclip, Plus, RotateCcw, Scan, Sparkles, Square, Trash2, TriangleAlert, Workflow, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useI18n } from '../i18n'
import { Brand } from '../brands'
import { agyModels, filesStamp, inTauri, openRoot, readSource, runAgent, saveImage, stopAgents, worktreeApply, worktreeCreate, worktreeDiff, worktreeDiscard, worktreeStamp, type Answer } from '../vault'
import Markdown from './Markdown'
import StoredImg from './StoredImg'
import { MODELS } from './AgentSidebar'
import { SHEET_PROMPT, STYLE_PROMPT } from '../style'
import { graphMap, sliceFor, subMap, tokens, type Note } from '../deso'
import { coRead, mapOpts, recordRead } from '../mapmem'
import type { MenuItem } from './ContextMenu'
import { getKey } from '../keys'
import { dsChat, nvChat, orChat } from '../deepseek'
import { dsUsage } from '../dsprice'
import { nanoAgy, nanoImage } from '../nano'
import { getImg, imgId, putImg } from '../imgs'
import { picNote, picPath, readPics } from '../pics'
import { BRIEF, BUDGET, clip, coldWait, ownCost, fromTemplate, leadChat, LOG_MAX, NOTE_MAX, READ_ONLY, runOrchestra, save, workerEffort, MAX_TURNS, type Agent, type Deps, type Entry, type Node, type Opts, type Orch, type Reply, type Row, type Template, type Use } from '../orchestra'

const DEEPSEEK = MODELS.deepseek
const OPENROUTER = MODELS.openrouter
const NVIDIA = MODELS.nvidia
const HAIKU = MODELS.claude.find((m) => m[0].includes('haiku'))![0]
const sessionCost = new Map<string, number>() // claude session → the total cost it last reported (see ownCost)
const warm = new Map<string, number>() // model + tools → when a claude call last started cold (see coldWait)
const EFFORTS = ['low', 'medium', 'high', 'max'] as const
const NANO = MODELS.nano
const CODEX = [['', 'Codex (default model)']] as const // model comes from the user's Codex config
const NAMES = { claude: 'Claude', agy: 'Antigravity', codex: 'Codex', deepseek: 'DeepSeek', openrouter: 'OpenRouter (free)', nvidia: 'NVIDIA', nano: 'Nano Banana' } as const
// images in a paste: clipboard items first, files as the fallback
const pastedPics = (cd: DataTransfer) => {
  const f = [...cd.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((x): x is File => !!x)
  return f.length ? f : [...cd.files].filter((x) => x.type.startsWith('image/'))
}
// Recommended model per role, shown first in every model picker. agy takes its effort from the model name (...-low / ...-high).
// think = Claude effort the block gets from this preset; tools = the only tools it may use (read-only for search).
type Preset = { ru: string; en: string; agent: Agent; model?: string; effort?: string; think?: string; tools?: string }
const PRESETS: readonly Preset[] = [
  { ru: 'Ведущий', en: 'Lead', agent: 'agy', effort: 'low' },
  { ru: 'Планирование задач', en: 'Task planning', agent: 'agy', effort: 'high' },
  { ru: 'Кодинг', en: 'Coding', agent: 'claude', model: 'claude-sonnet-5-5', think: 'medium' },
  { ru: 'Кодинг (сложный)', en: 'Hard coding', agent: 'claude', model: 'claude-opus-5-5', think: 'high' },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'claude', model: 'claude-haiku-5-5', tools: READ_ONLY },
  { ru: 'Поиск по карте и файлам', en: 'Search map & files', agent: 'deepseek', model: 'deepseek-v4-flash' },
  { ru: 'Картинки', en: 'Images', agent: 'nano', model: NANO[0][0] },
]
// Roles, picked with the + next to the model: the text fills the block's context (editable), review/tools are set with it.
// A reviewer sends its work back to the blocks feeding it, up to `review` times, until it answers OK.
type Role = { ru: string; en: string; ruText: string; enText: string; review?: number; tools?: string }
const ROLES: readonly Role[] = [
  { ru: 'Кодер', en: 'Coder', ruText: 'Ты кодер. Решай задачу, а не изображай работу. Меняй только нужные файлы, минимальный diff, проверь, что код запускается. Отвечай коротко.',
    enText: 'You are the coder. Solve the task, do not pretend. Touch only the files you need, keep the diff minimal, check the code runs. Answer briefly.' },
  { ru: 'Ревьюер', en: 'Reviewer', review: 2, tools: READ_ONLY, ruText: 'Ты ревьюер. Проверь результат предыдущего агента по задаче: баги, пропущенные случаи, сломанные вызовы. Сам код не переписывай.',
    enText: 'You are the reviewer. Check the previous agent\'s result against the task: bugs, missed cases, broken callers. Do not rewrite the code yourself.' },
  { ru: 'Исследователь', en: 'Researcher', tools: READ_ONLY, ruText: 'Ты исследователь. Найди в карте и файлах то, что нужно для задачи, ничего не меняй. В ответе только факты: пути, имена, строки.',
    enText: 'You are the researcher. Find what the task needs in the map and files, change nothing. Answer with facts only: paths, names, lines.' },
  { ru: 'Планировщик', en: 'Planner', tools: READ_ONLY, ruText: 'Ты планировщик. Разбей задачу на короткие шаги по файлам, без кода. Укажи порядок и риски.',
    enText: 'You are the planner. Split the task into short steps by file, no code. Give the order and the risks.' },
  { ru: 'Тестировщик', en: 'Tester', ruText: 'Ты тестировщик. Запусти тесты и сборку; при падении назови причину и файл. Код не чини.',
    enText: 'You are the tester. Run the tests and the build; on a failure name the cause and the file. Do not fix the code.' },
]
// Ready-made orchestras (the blocks are filled from the roles above) and your own, saved from the current one.
const builtin = (lang: 'ru' | 'en', agyLow: string, agyHigh: string): Template[] => {
  const S = MODELS.claude[0][0], H = 'claude-haiku-5-5'
  const [coder, reviewer, researcher, , tester] = ROLES
  const lead: Node = { id: 'l', x: 40, y: 40, kind: 'start', agent: 'claude', model: S, text: '', notes: [] }
  const role = (id: string, x: number, r: Role, model: string): Node => ({ id, x, y: 40, kind: 'model', agent: 'claude', model, role: r[lang], text: r[lang === 'ru' ? 'ruText' : 'enText'], notes: [], review: r.review, tools: r.tools })
  // shortcut: the pipeline lives in one fixed folder on this machine; make it a setting when someone else uses the template
  const SMS = 'C:/Users/lemxy/Desktop/SmartModelSystem'
  const home = lang === 'ru' ? 'Конвейер 3D лежит в ' + SMS + '. Все пути «из корня проекта» ниже (docs/, scripts/, tools/, references/, ReadyModels/) относятся к этой папке, а не к текущему проекту: начинай каждую команду с cd "' + SMS + '" &&, документы читай оттуда.' + "\n\n" : 'The 3D pipeline lives in ' + SMS + '. Every path "from the project root" below (docs/, scripts/, tools/, references/, ReadyModels/) is relative to that folder, not to the current project: start every command with cd "' + SMS + '" &&, read the docs from there.' + "\n\n"
  const mv = lang === 'ru' ? 'image_to_3d.py запускай с флагом --mv: модель читает Front, Side и Back, а не один вид. Если он сообщит, что на листе меньше трёх видов, повтори без --mv.\n\n' : 'Run image_to_3d.py with the --mv flag: the model reads Front, Side and Back, not one view. If it says the sheet has fewer than three views, rerun without --mv.\n\n'
  // Request -> turnaround sheet -> mesh -> checked GLB. The steps themselves live in the project's docs/02_zero_manual_pipeline.md (SmartModelSystem).
  const three: Template = { name: lang === 'ru' ? '3D-ассет: запрос → GLB' : '3D asset: request → GLB', nodes: [
      // The sheet standard is spelled out word for word from SmartModelSystem (docs/01, docs/04), so the brief does not depend on the lead opening the files.
      { ...lead, text: lang === 'ru'
        ? 'Агенту A дай готовый промпт для Nano Banana на английском: дословно по шаблону ниже (docs/04_prompt_templates.md, раздел 1). Подставь значения вместо {...}, остальной текст не меняй и не сокращай. {CHARACTER DESCRIPTION} и {WEAPON / PROP} бери из задачи. Если в задаче описана атака, Attack Animation Pose рисуй по ней. Цвета в Color Palette бери из задачи, если их там нет — выбери сам один раз: hex для каждой части, без раздела Color Palette промпт считается неполным. Для предмета (не персонажа) оставь только четыре вида в ряд, Style, Outlines, Color Palette (части самого предмета), Consistency и Background: Animation Breakdown, позы Idle и Attack и строку Pose убери. Нужна A-поза с руками в стороны от тела (рига нужна стоящая фигура с разведёнными руками).\n\nШаблон:\n' + SHEET_PROMPT + '\n\n' +
          'Агенту B дай: имя ассета латиницей в snake_case; тип (персонаж или предмет); высоту в метрах (персонаж ~1.8, меч ~1.0); бюджет треугольников (предмет ~1500, персонаж ~6000); описание атаки из задачи дословно или «атака по умолчанию». Ещё hex-коды раздела Color Palette из промпта листа: список через запятую, без #000000. Агенту D напиши одно слово: «прогрев», агенту E — «покажи модель».'
        : 'Give agent A a finished English prompt for Nano Banana: word for word from the template below (docs/04_prompt_templates.md, section 1). Fill the values in place of {...}, do not change or shorten the rest. Take {CHARACTER DESCRIPTION} and {WEAPON / PROP} from the task. If the task describes an attack, draw the Attack Animation Pose from it. Take the Color Palette colors from the task; if it has none, pick them yourself once: a hex for every part, a prompt without a Color Palette section is incomplete. For an object (not a character) keep only the four views in a row, Style, Outlines, Color Palette (the parts of the object itself), Consistency and Background: drop the Animation Breakdown, the Idle and Attack poses and the Pose line. Use an A-pose with the arms away from the body (the rig needs a standing figure with spread arms).\n\nTemplate:\n' + SHEET_PROMPT + '\n\n' +
          'Give agent B: the asset name in snake_case; the type (character or prop); the height in meters (character ~1.8, sword ~1.0); the triangle budget (prop ~1500, character ~6000); the attack from the task word for word, or "default attack". Also the hex codes of the sheet prompt\'s Color Palette: a comma-separated list, without #000000. To agent D write one word: "warm-up", to agent E: "show the model".' },
      { id: 'n', x: 360, y: 40, kind: 'model', agent: 'nano', model: 'gemini-3-pro-image-preview', text: '', notes: [] },
      { id: 'b', x: 680, y: 40, kind: 'model', agent: 'claude', model: S, notes: [], text: home + mv + (lang === 'ru'
        ? 'Ты сборщик 3D. Выполни конвейер из docs/02_zero_manual_pipeline.md (раздел «Image → 3D») для картинки из «Image file:»: скопируй её в references/<имя>.png, запусти image_to_3d.py (если в ответе меньше 4 видов или форма мусорная — повтори с --rembg), затем finish_model.py (если лид передал hex палитры, добавь --palette "hex,hex,..."; если нет, палитра извлечётся с листа сама). Для персонажа — auto_rig.py; если атака описана, сначала посмотри Attack Pose на листе, переведи описание в references/<имя>_attack.json по docs/03 (раздел «Своя атака») и передай --attack. Blender запускай с --python-exit-code 1, команды — с таймаутом 600000 мс. Если ревьюер вернул замечания — исправь только названное. Ответь: пути к GLB, превью и кадрам атаки, строки EXPORTED и описание атаки дословно.'
        : 'You are the 3D builder. Run the pipeline in docs/02_zero_manual_pipeline.md (section "Image → 3D") for the picture from "Image file:": copy it into references/<name>.png, run image_to_3d.py (if it reports fewer than 4 views or the shape is junk, rerun with --rembg), then finish_model.py (if the lead gave palette hexes, add --palette "hex,hex,..."; otherwise the palette is extracted from the sheet itself). For a character run auto_rig.py; if an attack is described, first look at the Attack Pose on the sheet, turn the description into references/<name>_attack.json per docs/03 (section "Своя атака") and pass --attack. Run Blender with --python-exit-code 1 and the commands with a 600000 ms timeout. If the reviewer sent remarks, fix only those. Answer: the GLB, preview and attack-frame paths, the EXPORTED lines and the attack description word for word.') },
      { id: 'c', x: 1000, y: 40, kind: 'model', agent: 'claude', model: S, notes: [], review: 2, tools: READ_ONLY, text: lang === 'ru'
        ? 'Ты ревьюер 3D. Сначала открой референс-лист и сверь его с чек-листом docs/01_turnaround_standards.md (раздел 4): форма читается из простых объёмов; грани чётко различимы; контур единой толщины, чистый, без разрывов; заливка плоская или cel-shading, минимум цветовых переходов; пропорции, силуэт, цвета и детали совпадают на всех четырёх видах; у персонажа есть Idle Pose и Attack Pose и они сохраняют пропорции, силуэт и цвета; полигонаж достижим для Low-Poly Indie Game; фон однотонный, без лишних объектов. Затем открой превью: силуэт, пропорции, цвета, бюджет треугольников. У персонажа открой кадры атаки (*_attack_f*.png) и сверь с описанием атаки: какая рука, направление удара, ноги. Если годится — OK, иначе конкретно что поправить: --seed/--faces/--height или какие поля attack.json в каких кадрах и на сколько градусов.'
        : 'You are the 3D reviewer. First open the reference sheet and check it against the checklist of docs/01_turnaround_standards.md (section 4): the form reads from simple volumes; the faceted planes are clearly distinct; the outline is one clean thickness without breaks; flat fill or cel-shading, few color transitions; proportions, silhouette, colors and details match on all four views; a character has the Idle Pose and the Attack Pose and they keep the proportions, silhouette and colors; the polygon count is reachable for a Low-Poly Indie Game; the background is plain, with no extra objects. Then open the preview: silhouette, proportions, colors, triangle budget. For a character open the attack frames (*_attack_f*.png) and check them against the attack description: which hand, the strike direction, the legs. If fine, OK; otherwise exactly what to change: --seed/--faces/--height, or which attack.json fields in which frames and by how many degrees.' },
      // Starts the Hunyuan server while Nano draws (~1 min to load the model), so the builder finds it ready. Haiku: it only runs one command.
      { id: 'w', x: 360, y: 300, kind: 'model', agent: 'claude', model: H, tools: 'Bash', notes: [], name: lang === 'ru' ? 'Прогрев Hunyuan' : 'Hunyuan warm-up', text: home + (lang === 'ru'
        ? 'Выполни ровно одну команду из корня проекта и ничего больше: tools/hunyuan3d/.venv/Scripts/python scripts/image_to_3d.py --warmup. Ответь её выводом одной строкой.'
        : 'Run exactly one command from the project root and nothing else: tools/hunyuan3d/.venv/Scripts/python scripts/image_to_3d.py --warmup. Answer with its output as one line.') },
      // The end: opens the finished model in Blender for you. After the reviewer, so it opens once, with whatever the review loop ended on.
      { id: 's', x: 1320, y: 40, kind: 'model', agent: 'claude', model: H, tools: 'Bash', notes: [], name: lang === 'ru' ? 'Показ в Blender' : 'Show in Blender', text: home + (lang === 'ru'
        ? 'Возьми из ответа сборщика путь к итоговому GLB (у персонажа — *_animated.glb, у предмета — ReadyModels/<имя>.glb) и выполни ровно одну команду из корня проекта: tools/hunyuan3d/.venv/Scripts/python scripts/open_model.py <путь>. Ответь её выводом одной строкой.'
        : 'Take the final GLB path from the builder answer (a character: *_animated.glb, a prop: ReadyModels/<name>.glb) and run exactly one command from the project root: tools/hunyuan3d/.venv/Scripts/python scripts/open_model.py <path>. Answer with its output as one line.') },
    ], edges: [['l', 'n'], ['l', 'b'], ['n', 'b'], ['b', 'c'], ['l', 'w'], ['b', 's'], ['c', 's']] }
  return [
    { name: lang === 'ru' ? 'Код + ревью' : 'Code + review', nodes: [lead, role('a', 360, researcher, H), role('b', 680, coder, S), role('c', 1000, reviewer, S)], edges: [['l', 'a'], ['a', 'b'], ['b', 'c']] },
    { name: lang === 'ru' ? 'Код + тесты + ревью' : 'Code + tests + review', nodes: [lead, role('b', 360, coder, S), role('t', 680, tester, S), role('c', 1000, reviewer, S)], edges: [['l', 'b'], ['b', 't'], ['t', 'c']] },
    three,
    // Coder base: the lead splits the work by files, two coders write in parallel with full rights (no `tools` limit = no permission prompts), tester fixes, reviewer reads only.
    (() => {
      const ru = lang === 'ru'
      const split = ru ? ' Работай только в файлах, названных лидом, чужие не трогай.' : ' Work only in the files the lead named, do not touch the others.'
      const w = (id: string, y: number, r: Role, model: string, o: Partial<Node> = {}): Node => ({ ...role('c' + id, 680, r, model), id, y, text: r[ru ? 'ruText' : 'enText'] + split, ...o })
      return {
        name: ru ? 'База кодеров' : 'Coders base',
        nodes: [
          { ...lead, agent: 'agy', model: agyHigh, text: ru ? 'Разбей задачу по файлам на две независимые части без пересечений: агенту B — обычная часть, агенту C — самая сложная. Назови каждому файлы, которые он правит. Агенту D (тестировщик) дай команду проверки проекта.' : 'Split the task by files into two independent parts with no overlap: agent B gets the regular part, agent C the hardest one. Name the files each of them edits. Give agent D (tester) the project check command.' },
          role('a', 360, researcher, H),
          w('b', 40, coder, S, { effort: 'medium' }),
          w('c', 300, coder, S, { effort: 'high', role: ru ? 'Кодер (сложный)' : 'Hard coder' }),
          { ...role('t', 1000, tester, S), tools: undefined, text: tester[ru ? 'ruText' : 'enText'] + (ru ? ' Если падает по очевидной причине, исправь минимальным diff и повтори (до 3 раз).' : ' If it fails for an obvious cause, fix it with a minimal diff and rerun (up to 3 times).') },
          role('r', 1320, reviewer, S),
        ],
        edges: [['l', 'a'], ['a', 'b'], ['a', 'c'], ['l', 'b'], ['l', 'c'], ['l', 't'], ['b', 't'], ['c', 't'], ['t', 'r']],
      } satisfies Template
    })(),
    // Debate arena: five mid-to-strong models from different makers answer the same question on their own; the judge (a reviewer with 4 rounds)
    // answers OK with the common conclusion once their positions agree, otherwise it relays each side's arguments and the debaters answer them again.
    // The debaters cannot see each other (a link between them would be a cycle), so the judge carries the arguments across. Letters: A-E debaters, J judge.
    (() => {
      const ru = lang === 'ru'
      const debate = ru
        ? 'Ты участник арены мнений. Дай свою независимую позицию по вопросу: вывод в первой строке, затем три самых сильных довода и что могло бы изменить твоё мнение. До 200 слов. Если пришла обратная связь судьи с доводами других, ответь по существу: признай, в чём они правы, возрази там, где они неправы, и назови обновлённую позицию. Не упрямься и не поддакивай. Файлы не меняй.'
        : 'You are a debater on an opinion arena. Give your own independent position on the question: the conclusion on the first line, then your three strongest arguments and what would change your mind. Up to 200 words. If the judge sends feedback with the others\' arguments, answer them on the merits: concede where they are right, object where they are wrong, and state your updated position. Do not be stubborn and do not just agree. Do not change files.'
      const d = (id: string, y: number, agent: Agent, model: string, name: string, o: Partial<Node> = {}): Node =>
        ({ id, x: 360, y, kind: 'model', agent, model, name, role: ru ? 'Дебатёр' : 'Debater', text: debate, notes: [], ...o })
      return {
        name: ru ? 'Арена мнений' : 'Debate arena',
        nodes: [
          { ...lead, text: ru
            ? 'Каждому агенту A, B, C, D, E дай один и тот же полный вопрос пользователя дословно (они не видят задачу) и попроси независимую позицию. Ничего не решай сам.'
            : 'Give every agent A, B, C, D, E the same full user question verbatim (they cannot see the task) and ask for an independent position. Decide nothing yourself.' },
          d('a', 40, 'claude', S, 'Claude Sonnet', { effort: 'medium', tools: READ_ONLY }),
          d('b', 300, 'agy', agyHigh, 'Gemini Flash', { tools: READ_ONLY }), // READ_ONLY keeps it from counting as a writer: a writer would be rerun alone and skip the others' round
          d('c', 560, 'nvidia', 'poolside/laguna-xs-2.1', 'Laguna XS 2.1'),
          d('d', 820, 'nvidia', 'nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron Super 120B'),
          d('e', 1080, 'nvidia', 'mistralai/mistral-large-4-1t-a52b', 'Mistral Large 4'),
          { id: 'j', x: 720, y: 560, kind: 'model', agent: 'claude', model: S, effort: 'medium', tools: READ_ONLY, review: 4, name: ru ? 'Судья' : 'Judge', role: ru ? 'Судья' : 'Judge', notes: [], text: ru
            ? 'Ты судья арены мнений. Прочти позиции всех участников. Они пришли к единому мнению, если у них один и тот же главный вывод, а различаются лишь второстепенные детали. Тогда ответь OK в первой строке, а ниже напиши общий вывод, главные доводы и остаточные разногласия, если они есть. Если согласия нет: на каждого участника одной-двумя строками дай его позицию и сильнейший довод, затем назови, в чём именно они расходятся и на что каждый должен ответить. Участники не видят друг друга, поэтому приводи доводы других прямо в тексте. Не принимай чью-то сторону и не выдумывай согласия.'
            : 'You are the judge of an opinion arena. Read every debater\'s position. They have reached a common view when they share the same main conclusion and differ only in minor details. Then answer OK on the first line and below it write the common conclusion, the main arguments and any remaining disagreement. If they do not agree: for each debater give its position and strongest argument in a line or two, then name exactly where they differ and what each must answer. The debaters cannot see each other, so quote the others\' arguments in the text. Do not take a side and do not invent agreement.' },
        ],
        edges: [['l', 'a'], ['l', 'b'], ['l', 'c'], ['l', 'd'], ['l', 'e'], ['a', 'j'], ['b', 'j'], ['c', 'j'], ['d', 'j'], ['e', 'j']],
      } satisfies Template
    })(),
    // Who does what: Gemini leads and designs (long context, cheap), Nano Banana Pro draws, DeepSeek writes bulk text and balance tables,
    // Sonnet writes the gameplay code, Opus reviews it (read-only, so it stays cheap). Letters: A designer, B artist, C writer, D coder, E tester, F reviewer.
    (() => {
      const ru = lang === 'ru', m =(id: string, x: number, y: number, agent: Agent, model: string, text: string, o: Partial<Node> = {}): Node => ({ id, x, y, kind: 'model', agent, model, text, notes: [], ...o })
      // shortcut: the Unity project lives in one fixed folder on this machine; make it a setting when someone else uses the template
      const UNITY = 'C:/Users/lemxy/My project'
      const unity = ru
        ? 'Игра на Unity лежит в ' + UNITY + ' (читай ROADMAP.md оттуда). Проверка без редактора: cd "' + UNITY + '" && cmd /c Check.bat: компилирует код и пересобирает сцену Stage1, ошибки (error CS, Exception, Stage1Setup:) печатает, код выхода 0 = ок; ошибка импорта skeleton_archer_animated.glb известна, капсула-заглушка нормальна. Если Check.bat пишет, что редактор открыт, остановись и скажи об этом. Полный доступ: правь любые файлы проекта, включая Assets/Scripts/Editor/Stage1Setup.cs. Нашёл ошибку: исправь причину и повтори Check.bat (до 3 раз). Запуск для человека: Play.bat, сам его не запускай.\n\n'
        : 'The Unity game lives in ' + UNITY + ' (read ROADMAP.md there). Check without the editor: cd "' + UNITY + '" && cmd /c Check.bat: it compiles the code and rebuilds the Stage1 scene, prints the errors (error CS, Exception, Stage1Setup:), exit code 0 = ok; the skeleton_archer_animated.glb import error is known, the capsule placeholder is fine. If Check.bat says the editor is open, stop and say so. Full access: edit any file of the project, including Assets/Scripts/Editor/Stage1Setup.cs. Found a bug: fix the cause and rerun Check.bat (up to 3 times). Play.bat is for the human, do not run it.\n\n'
      return {
        name: ru ? 'Геймдев' : 'Gamedev',
        nodes: [
          { ...lead, agent: 'agy', model: agyLow, text: ru
            ? 'Если задаче нужна 3D-модель (персонаж или предмет): агенту B вместо спрайта дай готовый английский промпт листа дословно по шаблону ниже, подставь значения вместо {...}, остальное не меняй; для предмета оставь только четыре вида в ряд, Style, Outlines, Color Palette, Consistency и Background; нужна A-поза. Агенту G дай: имя ассета латиницей в snake_case; тип (персонаж или предмет); высоту в метрах; бюджет треугольников (предмет ~1500, персонаж ~6000); описание атаки из задачи или «атака по умолчанию». Ещё hex-коды раздела Color Palette из промпта листа: список через запятую, без #000000. Агенту I напиши одно слово: «прогрев». Если 3D не нужна, агентам G и I напиши одно слово: «пропусти».\n\nШаблон листа:\n' + SHEET_PROMPT
            : 'If the task needs a 3D model (a character or a prop): give agent B, instead of a sprite, a finished English sheet prompt word for word from the template below, fill the values in place of {...}, change nothing else; for a prop keep only the four views in a row, Style, Outlines, Color Palette, Consistency and Background; use an A-pose. Give agent G: the asset name in snake_case; the type (character or prop); the height in meters; the triangle budget (prop ~1500, character ~6000); the attack from the task, or "default attack". Also the hex codes of the sheet prompt\'s Color Palette: a comma-separated list, without #000000. To agent I write one word: "warm-up". If no 3D is needed, write agents G and I one word: "skip".\n\nSheet template:\n' + SHEET_PROMPT },
          m('g', 360, 40, 'agy', agyHigh, ru ? 'Ты геймдизайнер. Опиши механику по задаче: цикл игры, правила, числа с разумными значениями, крайние случаи и как проверить в игре. Без кода. В конце списком: какие ассеты нарисовать и какие тексты нужны. Арт-стиль проекта: Low-poly cartoon, faceted planes, плоские цвета с cel-shading, жирные чёрные контуры.' : 'You are the game designer. Describe the mechanic for the task: the game loop, rules, numbers with sensible values, edge cases and how to check it in the game. No code. End with lists: which assets to draw and which texts are needed. The art style of the project: Low-poly cartoon, faceted planes, flat colors with cel-shading, bold black outlines.', { role: ru ? 'Геймдизайнер' : 'Game designer' }),
          m('n', 360, 300, 'nano', 'gemini-3-pro-image-preview', (ru ? 'Ты художник. Нарисуй один ассет из задачи (спрайт, иконка, элемент интерфейса или концепт) строго в стиле проекта, он задан ниже. В Color Palette укажи hex каждой части ассета, контуры #000000; цвета фиксируются один раз и неизменны.' : 'You are the artist. Draw one asset from the task (a sprite, an icon, a UI element or a concept) strictly in the project style given below. In the Color Palette give a hex for every part of the asset, outlines #000000; the colors are fixed once and do not change.') + '\n\n' + STYLE_PROMPT, { role: ru ? 'Художник' : 'Artist' }),
          m('w', 680, 300, 'deepseek', 'deepseek-v4-flash', ru ? 'Ты автор контента. Напиши тексты и данные для игры: диалоги, названия и описания предметов, таблицу баланса компактным JSON или CSV. Не выдумывай механики, держись плана геймдизайнера.' : 'You are the content writer. Write the texts and data for the game: dialogue, item names and descriptions, a balance table as compact JSON or CSV. Do not invent mechanics, stick to the designer\'s plan.', { role: ru ? 'Автор контента' : 'Content writer' }),
          m('b', 1000, 40, 'claude', S, unity + (ru ? 'Ты геймплей-программист. Реализуй механику по плану геймдизайнера: меняй только нужные файлы, минимальный diff; числа (скорость, урон, кулдауны) выноси в константы или конфиг; тексты и данные бери из ответа автора контента. Проверь, что проект собирается. Если ревьюер вернул замечания, исправь только названное. Отвечай коротко: что изменено и где.' : 'You are the gameplay programmer. Implement the mechanic from the designer\'s plan: touch only the files you need, keep the diff minimal; put numbers (speed, damage, cooldowns) in constants or config; take texts and data from the content writer. Check the project builds. If the reviewer sent remarks, fix only those. Answer briefly: what changed and where.'), { role: ru ? 'Кодер' : 'Coder', effort: 'medium' }),
          m('t', 1320, 40, 'claude', S, unity + (ru ? 'Ты тестировщик. Запусти Check.bat. При ошибках сам исправь причину минимальным diff и повтори до зелёного (до 3 раз). Ответь: что падало, что поправил, итог последнего запуска.' : 'You are the tester. Run Check.bat. On errors fix the cause yourself with a minimal diff and rerun until green (up to 3 times). Answer: what failed, what you fixed, the result of the last run.'), { role: tester[lang] }),
          m('c', 1640, 40, 'claude', 'claude-opus-5-5', ru ? 'Ты ревьюер игры. Проверь код против плана: механика работает как описано, нет магических чисел, нет тяжёлой логики и аллокаций в каждом кадре, нет сломанных ссылок на ассеты. Если годится — OK, иначе конкретно что поправить. Код не переписывай.' : 'You are the game reviewer. Check the code against the plan: the mechanic works as described, no magic numbers, no heavy logic or allocations every frame, no broken asset references. If fine, OK; otherwise exactly what to change. Do not rewrite the code.', { role: reviewer[lang], review: 2, tools: READ_ONLY, effort: 'medium' }),
          // The 3D blocks are the ones of the 3D template. Letters: G builds the GLB, H opens it in Blender (the lead does not brief H), I warms up Hunyuan while the artist draws.
          { ...three.nodes.find((x) => x.id === 'b')!, id: 'p', x: 1000, y: 300, role: ru ? 'Сборщик 3D' : '3D builder', text: (ru ? 'Если лид написал «пропусти», ответь «пропуск» и ничего не запускай.\n\n' : 'If the lead wrote "skip", answer "skipped" and run nothing.\n\n') + (ru ? 'В конце скопируй готовый GLB в Assets/Models/ текущего проекта (создай папку) и назови оба пути.' : 'At the end copy the finished GLB into Assets/Models/ of the current project (create the folder) and give both paths.') + "\n\n" + three.nodes.find((x) => x.id === 'b')!.text },
          { ...three.nodes.find((x) => x.id === 's')!, id: 'v', x: 1320, y: 300, text: (ru ? 'Если сборщик пропустил, ответь «нечего показывать» и ничего не запускай.\n\n' : 'If the builder skipped, answer "nothing to show" and run nothing.\n\n') + three.nodes.find((x) => x.id === 's')!.text },
          { ...three.nodes.find((x) => x.id === 'w')!, id: 'k', x: 680, y: 560, text: (ru ? 'Если лид написал «пропусти», ответь «пропуск» и ничего не запускай.\n\n' : 'If the lead wrote "skip", answer "skipped" and run nothing.\n\n') + three.nodes.find((x) => x.id === 'w')!.text },
        ],
        edges: [['l', 'g'], ['l', 'n'], ['l', 'w'], ['l', 'b'], ['g', 'w'], ['g', 'b'], ['n', 'b'], ['w', 'b'], ['b', 't'], ['t', 'c'], ['l', 'p'], ['n', 'p'], ['p', 'v'], ['l', 'k']],
      } satisfies Template
    })(),
  ]
}
const TPL = 'desovault.orchestra.templates' // global: shared by every project
const loadTpl = (): Template[] => { try { return JSON.parse(localStorage.getItem(TPL) ?? '[]') } catch { return [] } }
const RUNS_KEPT = 5
const SLOW = 120 // seconds a block may run before its timer turns to a warning
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

const GRID = 24, CW = 3000, CH = 2000, MM = 0.06 // snap step, canvas size, minimap scale
const HUE = { claude: 'var(--m6)', agy: 'var(--m3)', deepseek: 'var(--m4)', openrouter: 'var(--m4)', nvidia: 'var(--m2)', nano: 'var(--m5)', codex: 'var(--m7)' } as const
const hue = (n: Node) => (n.kind === 'rules' ? 'var(--mut)' : HUE[n.agent ?? 'claude'])
const W = 272, HEAD = 20 // node width; y of the link handles, measured from the node's top
const uid = () => Math.random().toString(36).slice(2, 9)
const fresh = (n: number): Orch => ({ id: uid(), name: `Orchestra ${n}`, task: '', nodes: [], edges: [], iso: inTauri })
// Older saves may hold more than one start block; keep the first.
const dedupe = (o: Orch): Orch => { const keep = o.nodes.filter((n, i) => n.kind !== 'start' || i === o.nodes.findIndex((x) => x.kind === 'start')); return { ...o, nodes: keep, edges: o.edges.filter((e) => e.every((id) => keep.some((n) => n.id === id))) } }
const load = (k: string): Orch[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? ''); if (v.length) return (v as Orch[]).map((o) => dedupe({ ...o, nodes: o.nodes.map((n) => (n.state === 'run' ? { ...n, state: undefined } : n)) })) } catch { /* first run */ } return [fresh(1)] }
const tb = 'btn-press p-1.5 rounded-lg text-dim hover:text-fg hover:bg-panel'
const field = 'px-3 py-1.5 rounded-lg bg-field border border-line focus:border-accent outline-none text-xs placeholder:text-dim'

export default function Orchestra({ notes, project, onMenu }: { notes: Note[]; project: string; onMenu: (e: React.MouseEvent, items: MenuItem[]) => void }) {
  const { t, lang, hideOut, smooth } = useI18n()
  const KEY = `desovault.orchestra.${project}`
  const [orchs, setOrchs] = useState(() => load(KEY))
  const [aid, setAid] = useState(orchs[0].id)
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null) // link being dragged
  const [running, setRunning] = useState(false)
  const [showRuns, setShowRuns] = useState(false)
  const [cfgFor, setCfgFor] = useState('') // block whose CLI settings (gear) are open
  const [askFocus, setAskFocus] = useState<{ id: string; n: number }>() // "ask this agent only" from a block's right-click menu: the dialogue box switches to it
  const [saved, setSaved] = useState<Template[]>(loadTpl)
  const stopped = useRef(false) // Stop was pressed: blocks not started yet stay idle
  const [agy, setAgy] = useState<readonly (readonly [string, string])[]>(MODELS.agy)
  const canvas = useRef<HTMLDivElement>(null)
  const [z, setZ] = useState(1) // canvas zoom
  const zRef = useRef(1)
  const anchor = useRef<[number, number] | null>(null) // scroll to apply once the zoomed canvas has its new size
  const [snap, setSnap] = useState(true)
  const [wireTo, setWireTo] = useState('') // block under the link being dragged
  const saveWarned = useRef(false) // warn about a failed save once, not on every render
  useEffect(() => {
    const r = save(KEY, orchs)
    if (r === 'failed' && !saveWarned.current) { saveWarned.current = true; addLog({ from: '', to: '', kind: 'error', text: t('orchSaveFail') }) }
    if (r !== 'failed') saveWarned.current = false
  }, [orchs, KEY])
  useEffect(() => { if (inTauri) agyModels().then((l) => l.length && setAgy(l)).catch(console.error) }, [])

  const o = orchs.find((x) => x.id === aid) ?? orchs[0]
  // Every orchestra always has its start block: the lead agent. It has a single (output) handle and cannot be deleted. Its context is always the project map.
  useEffect(() => { if (!o.nodes.some((n) => n.kind === 'start')) setOrchs((os) => os.map((x) => (x.id !== o.id || x.nodes.some((n) => n.kind === 'start') ? x : { ...x, nodes: [{ id: uid(), x: 40, y: 40, kind: 'start', agent: 'claude', model: MODELS.claude[0][0], text: '', notes: [] }, ...x.nodes] }))) }, [o.id, o.nodes])
  const upd = (f: (o: Orch) => Orch) => setOrchs((os) => os.map((x) => (x.id === o.id ? f(x) : x)))
  const log = o.log ?? []
  const addLog = (e: Omit<Entry, 'at'>) => {
    if (e.img) { e = { ...e, imgId: imgId() }; putImg(e.imgId!, e.img!) } // the picture goes to the image store, the log keeps its id
    upd((c) => ({ ...c, log: [...(c.log ?? []), { ...e, at: Date.now() }].slice(-LOG_MAX) }))
  }
  const newFromTemplate = (v: string) => {
    const tpl = (v[0] === 'b' ? tpls() : saved)[+v.slice(1)]
    if (!tpl) return
    const c: Orch = { ...fresh(orchs.length + 1), name: tpl.name, ...fromTemplate(tpl, uid) }
    setOrchs([...orchs, c]); setAid(c.id)
  }
  const saveTemplate = () => {
    const tpl: Template = { name: o.name, edges: o.edges, cond: o.cond, nodes: o.nodes.map(({ out, img, state, use, sid, sum, final, finalSum, mapSum, since, ...n }) => n) }
    const next = [...saved.filter((x) => x.name !== o.name), tpl]
    setSaved(next)
    try { localStorage.setItem(TPL, JSON.stringify(next)) } catch (e) { console.error(e) }
  }
  const deleteTemplate = (i: number) => {
    const next = saved.filter((_, j) => j !== i)
    setSaved(next)
    try { localStorage.setItem(TPL, JSON.stringify(next)) } catch (e) { console.error(e) }
  }
  // Pictures go onto a block: only that block's agent sees them.
  const attach = async (id: string, files: File[]) => {
    const got = await readPics(files)
    if (got.length) upd((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, images: [...(n.images ?? []), ...got.map((p) => p.id)] } : n)) }))
  }
  const applyRole = (n: Node, r: Role | null) => {
    if (!r) return patch(n.id, { role: undefined, review: undefined, tools: undefined })
    const old = ROLES.flatMap((x) => [x.ruText, x.enText]).reduce((s, x) => s.replace(x, ''), n.text).trim() // swapping roles drops the previous role's text, keeps yours
    const text = r[lang === 'ru' ? 'ruText' : 'enText']
    patch(n.id, { role: r[lang], review: r.review, tools: r.tools, text: old ? `${text}\n\n${old}` : text })
  }
  const patch = (id: string, p: Partial<Node>) => upd((c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) }))
  const slowNotes = useDebounced(notes) // mounted even when hidden: don't rebuild the map on every keystroke elsewhere
  const map = useMemo(() => graphMap(slowNotes, undefined, '', mapOpts(slowNotes)), [slowNotes])
  const mapTok = useMemo(() => tokens(map), [map])
  const models = (a: Agent): readonly (readonly [string, string])[] => (a === 'claude' ? MODELS.claude : a === 'deepseek' ? DEEPSEEK : a === 'openrouter' ? OPENROUTER : a === 'nvidia' ? NVIDIA : a === 'codex' ? CODEX : a === 'nano' ? NANO : agy)
  // An embedded note in full, or, if large, a pointer the agent reads itself (agents run in the project folder with file tools).
  const embed = (names: string[]) => names.map((x) => { const c = notes.find((k) => k.name === x)?.content ?? ''
    return `## @${x}\n${c.length > NOTE_MAX ? `(large note, ~${tokens(c)} tok: read the file \`${x}.deso\` in the project folder or its \`.desovault\` folder)` : c}` }).join('\n\n')
  const resolve = (p: (typeof PRESETS)[number]): Partial<Node> => {
    if (p.agent !== 'agy') return { agent: p.agent, model: p.model, effort: p.think, tools: p.tools }
    const f = agy.filter(([m]) => m.includes('3.8') && m.includes('flash'))
    return { agent: 'agy', model: (f.find(([m]) => m.endsWith(`-${p.effort}`)) ?? f[0] ?? agy[0])[0], effort: undefined, tools: undefined }
  }
  const tpls = () => builtin(lang, resolve(PRESETS[0]).model!, resolve(PRESETS[1]).model!) // the Lead and Task-planning presets
  const presetLabel =(p: (typeof PRESETS)[number]) => { const m = resolve(p); return `${p[lang]} — ${models(p.agent).find((x) => x[0] === m.model)?.[1] ?? m.model}` }
  const label = (n: Node) => n.kind === 'rules' ? t('blockRules') : `${NAMES[n.agent ?? 'claude']} · ${models(n.agent ?? 'claude').find((m) => m[0] === n.model)?.[1] ?? n.model}`

  const letter = (id: string) => String.fromCharCode(65 + o.nodes.filter((n) => n.kind === 'model').findIndex((n) => n.id === id))
  const who = (n: Node) => `${n.kind === 'start' ? t('orchLead') : letter(n.id)} · ${n.name ? `${n.name} (${label(n)})` : label(n)}`

  const add = (x: number, y: number, n: Partial<Node>) => upd((c) => ({ ...c, nodes: [...c.nodes, { id: uid(), x, y, kind: 'model', text: '', notes: [], ...n }] }))
  const remove = (id: string) => o.nodes.find((n) => n.id === id)?.kind !== 'start' && upd((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== id), edges: c.edges.filter((e) => !e.includes(id)) }))
  const connect = (from: string, to: string) =>
    upd((c) => (from === to || c.nodes.find((n) => n.id === to)?.kind !== 'model' || c.edges.some((e) => e[0] === from && e[1] === to) ? c : { ...c, edges: [...c.edges, [from, to]] }))

  useLayoutEffect(() => { if (anchor.current) { canvas.current!.scrollLeft = anchor.current[0]; canvas.current!.scrollTop = anchor.current[1]; anchor.current = null } }, [z])
  const view = (nz: number, sl: number, st: number) => {
    if (nz === zRef.current) { canvas.current!.scrollLeft = sl; canvas.current!.scrollTop = st; return }
    anchor.current = [sl, st]; zRef.current = nz; setZ(nz)
  }
  // Zoom around a point of the viewport (its centre by default), so what is under the cursor stays put.
  const zoomTo = (to: number, cx = canvas.current!.clientWidth / 2, cy = canvas.current!.clientHeight / 2) => {
    const c = canvas.current!, p = zRef.current, nz = Math.min(2, Math.max(0.3, Math.round(to * 100) / 100))
    const [l, tp] = anchor.current ?? [c.scrollLeft, c.scrollTop]
    view(nz, (l + cx) / p * nz - cx, (tp + cy) / p * nz - cy)
  }
  const zt = useRef(zoomTo); zt.current = zoomTo
  useEffect(() => { // Ctrl + wheel (or a trackpad pinch) zooms
    const c = canvas.current!
    const f = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = c.getBoundingClientRect(); zt.current(zRef.current * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top) }
    c.addEventListener('wheel', f, { passive: false }); return () => c.removeEventListener('wheel', f)
  }, [])
  const fit = () => {
    const c = canvas.current!, els = [...c.querySelectorAll<HTMLElement>('[data-node]')]
    if (!els.length) return
    const x0 = Math.min(...els.map((e) => e.offsetLeft)), y0 = Math.min(...els.map((e) => e.offsetTop))
    const x1 = Math.max(...els.map((e) => e.offsetLeft + e.offsetWidth)), y1 = Math.max(...els.map((e) => e.offsetTop + e.offsetHeight)), pad = 60
    const nz = Math.round(Math.min(1, Math.max(0.3, Math.min(c.clientWidth / (x1 - x0 + pad * 2), c.clientHeight / (y1 - y0 + pad * 2)))) * 100) / 100
    view(nz, (x0 + x1) / 2 * nz - c.clientWidth / 2, (y0 + y1) / 2 * nz - c.clientHeight / 2)
  }
  // Layers left to right by link depth; blocks of a layer stack top to bottom. shortcut: keeps the creation order inside a layer, no crossing minimisation.
  const layout = () => {
    const h = (id: string) => canvas.current!.querySelector<HTMLElement>(`[data-node="${id}"]`)?.offsetHeight ?? 200
    const depth: Record<string, number> = {}
    o.nodes.forEach((n) => { depth[n.id] = 0 })
    for (let i = 0; i < o.nodes.length; i++) o.edges.forEach(([a, b]) => { depth[b] = Math.min(o.nodes.length, Math.max(depth[b], depth[a] + 1)) }) // bounded, so a loop cannot spin
    const ys: Record<number, number> = {}, pos: Record<string, [number, number]> = {}
    o.nodes.forEach((n) => { const d = depth[n.id], y = ys[d] ?? GRID * 2; pos[n.id] = [GRID * 2 + d * (W + GRID * 4), y]; ys[d] = y + h(n.id) + GRID * 2 })
    upd((c) => ({ ...c, nodes: c.nodes.map((n) => ({ ...n, x: pos[n.id][0], y: pos[n.id][1] })) }))
    requestAnimationFrame(fit)
  }

  // Drag from an output handle and release over another block to link them.
  const startWire = (from: string, e: React.PointerEvent) => {
    e.preventDefault()
    const at = (m: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { from, x: (m.clientX - r.left + canvas.current!.scrollLeft) / z, y: (m.clientY - r.top + canvas.current!.scrollTop) / z } }
    const hit = (m: PointerEvent) => document.elementsFromPoint(m.clientX, m.clientY).map((el) => (el as HTMLElement).dataset.node).find(Boolean)
    const move = (m: PointerEvent) => { setWire(at(m)); const id = hit(m); setWireTo(id && id !== from ? id : '') }
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setWire(null); setWireTo('')
      const to = hit(m)
      if (to) connect(from, to)
    }
    setWire(at(e))
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const canvasMenu = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const x = (e.clientX - r.left + canvas.current!.scrollLeft) / z, y = (e.clientY - r.top + canvas.current!.scrollTop) / z
    const items: MenuItem[] = [
      { label: `★ ${lang === 'ru' ? 'Рекомендуемые' : 'Recommended'}`, children: PRESETS.map((p) => ({ label: presetLabel(p), onClick: () => add(x, y, { ...resolve(p), role: p[lang] }) })) },
      { label: 'Claude', children: MODELS.claude.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'claude', model: m }) })) },
      { label: 'Antigravity', children: agy.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'agy', model: m }) })) },
      { label: 'Codex — Coming soon', disabled: true },
      { label: 'DeepSeek', children: DEEPSEEK.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'deepseek', model: m }) })) },
      { label: 'OpenRouter (free)', children: OPENROUTER.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'openrouter', model: m }) })) },
      { label: 'NVIDIA', children: NVIDIA.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'nvidia', model: m }) })) },
      { label: 'Nano Banana', children: NANO.map(([m, l]) => ({ label: l, onClick: () => add(x, y, { agent: 'nano', model: m }) })) },
      { label: t('blockRules'), sep: true, onClick: () => add(x, y, { kind: 'rules' }) },
    ]
    onMenu(e, items)
  }

  // Hold the left button on empty canvas and drag to move around (scrolls the canvas).
  const pan = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-node],button,path')) return
    const c = canvas.current!, sx = e.clientX + c.scrollLeft, sy = e.clientY + c.scrollTop
    c.style.cursor = 'grabbing'
    const move = (m: PointerEvent) => { c.scrollLeft = sx - m.clientX; c.scrollTop = sy - m.clientY }
    const up = () => { c.style.cursor = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const drag = (n: Node, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,select,input')) return
    const el = e.currentTarget as HTMLElement, sx = e.clientX / z - n.x, sy = e.clientY / z - n.y
    const g = (v: number, free: boolean) => Math.max(0, snap && !free ? Math.round(v / GRID) * GRID : v)
    el.setPointerCapture(e.pointerId)
    el.onpointermove = (m) => patch(n.id, { x: g(m.clientX / z - sx, m.altKey), y: g(m.clientY / z - sy, m.altKey) })
    el.onpointerup = () => { el.onpointermove = null; el.onpointerup = null }
  }

  // Isolated: every agent works in the orchestra's git worktree. A failure stops the run: never fall back to the real project.
  const isolate = async () => {
    if (!o.iso || !inTauri) return true
    try { await worktreeCreate(o.id); if (!o.wt) upd((c) => ({ ...c, wt: true })); return true }
    catch (e) { addLog({ from: 'git', to: '', text: `${t('orchIsoFail')}
${String(e)}`, kind: 'error' }); return false }
  }
  const review = async (what: 'diff' | 'apply' | 'discard') => {
    try {
      if (what === 'diff') { const d = await worktreeDiff(o.id); addLog({ from: 'git', to: '', kind: 'reply', text: d.trim() ? `\`\`\`diff
${clip(d)}
\`\`\`` : t('orchNoChanges') }); return }
      if (what === 'discard' && !window.confirm(t('orchDiscardAsk'))) return
      const changed = what === 'apply' ? await worktreeApply(o.id) : (await worktreeDiscard(o.id), false)
      upd((c) => ({ ...c, wt: false, nodes: c.nodes.map((n) => ({ ...n, sid: undefined, sum: undefined, readSum: undefined })) })) // sessions and cached answers belonged to the worktree
      addLog({ from: 'git', to: '', kind: 'reply', text: what === 'apply' ? t(changed ? 'orchApplied' : 'orchNoChanges') : t('orchDiscarded') })
    } catch (e) { addLog({ from: 'git', to: '', text: String(e), kind: 'error' }) }
  }

  // What the engine needs from the screen: the same calls the old inline run() made.
  const deps = (): Deps => ({
    exec, patch, addLog, history, embed, label, who, t,
    stamp: () => (inTauri ? worktreeStamp(o.iso ? o.id : undefined) : Promise.resolve('')),
    stopped: () => stopped.current,
    leadMap: (query) => graphMap(notes, undefined, query, mapOpts(notes)),
    subMap: (text) => subMap(notes, text, coRead()),
    filesStamp: (paths) => (inTauri ? filesStamp(paths, o.iso ? o.id : undefined) : Promise.resolve('')),
    // shortcut: isolated runs get no slices (readSource reads the project, the agents see the worktree) and only isolated runs get a diff
    // (the worktree is the one place where "what the agents changed" is known); add a worktree-aware read / a project diff if that matters.
    slice: (text) => (inTauri && !o.iso ? sliceFor(notes, text, readSource) : Promise.resolve('')),
    diff: () => (inTauri && o.iso ? worktreeDiff(o.id) : Promise.resolve('')),
    // The final answer only merges reports, with no tools: DeepSeek Flash when there is a key, else Haiku for a Claude lead.
    // shortcut: no switch for it; add one if the lead's own model is wanted for the final answer.
    cheap: (n) => (getKey('deepseek') ? { ...n, agent: 'deepseek', model: DEEPSEEK[0][0], images: undefined } : (n.agent ?? 'claude') === 'claude' ? { ...n, model: HAIKU } : n),
  })
  // `msg` = something you wrote to the lead: the lead takes it as a new instruction and briefs every agent again.
  // force (Shift+click on Run): rerun every block, even one whose input has not changed.
  // only = a block id: that block and what follows it run again, the rest comes from the cache.
  const run = async (msg?: string, force = false, only?: string) => {
    if (running || !(await isolate())) return
    stopped.current = false
    setRunning(true)
    try {
      const info = await runOrchestra(o, deps(), { msg, force, only })
      if (info) upd((c) => ({ ...c, runs: [...(c.runs ?? []), { at: Date.now(), ...info }].slice(-RUNS_KEPT) }))
    } finally { setRunning(false) }
  }

  // The saved dialogue as one agent saw it: what it was asked and what it answered.
  const history = (id: string) => log.filter((e) => (e.toId === id || e.fromId === id) && e.kind !== 'error').slice(-12)
    .map((e) => `${e.kind === 'reply' ? 'Assistant' : 'User'}: ${e.text}`).join('\n\n')

  // keep: continue the block's claude session (--resume) instead of resending the dialogue. agy gets the full prompt every time:
  // its --conversation resume was ~8x slower than a fresh call when tried.
  const exec = async (n: Node, build: (resumed: boolean) => string, { keep, tools, effort = '', maxTurns, session, resume }: Opts = {}): Promise<Reply> => {
    if (n.agent === 'nano') return nano(n.model ?? NANO[0][0], build(false), n.images)
    if ((n.agent === 'deepseek' || n.agent === 'openrouter' || n.agent === 'nvidia') && n.images?.length) throw new Error(t('noImagesDs'))
    if (n.agent === 'deepseek') return deepseek(n.model ?? DEEPSEEK[0][0], build(false))
    if (n.agent === 'openrouter') return deepseek(n.model ?? OPENROUTER[0][0], build(false), 'openrouter')
    if (n.agent === 'nvidia') return deepseek(n.model ?? NVIDIA[0][0], build(false), 'nvidia')
    if (!inTauri) throw new Error(t('desktopOnly'))
    const cli = n.agent === 'agy' || n.agent === 'codex' ? n.agent : 'claude'
    const go = async (resumed: boolean, session?: string) => {
      const base = build(resumed)
      if (!base.trim()) throw new Error(t('orchNoInput'))
      const prompt = base + (n.images?.length ? picNote(await Promise.all(n.images.map(picPath))) : '') // the CLIs read pictures by path
      // Blocks starting together would each pay to write the same prompt cache: the ones behind the first wait a moment and read it.
      const wait = cli === 'claude' ? coldWait(warm, `${n.model}\0${tools}`) : 0
      if (wait) await new Promise((r) => setTimeout(r, wait))
      const a = await runAgent(cli, prompt, n.model ?? MODELS.claude[0][0], cli !== 'claude' ? '' : effort, { session, resume: resumed, tools, system: BRIEF, budget: n.cli?.budget || BUDGET, maxTurns: n.cli?.turns || maxTurns, worktree: o.iso ? o.id : undefined, skipPerms: n.cli?.skipPerms, extra: n.cli?.flags?.trim() ? n.cli.flags.trim().split(/\s+/) : undefined })
      recordRead(a.files) // the map learns which files agents really open
      if (!session) return { ...a, text: a.text.trim() }
      const cost = ownCost(sessionCost, session, a.cost, resumed && session === n.sid ? n.sidCost : 0)
      if (keep) patch(n.id, { sidCost: a.cost })
      return { ...a, cost, text: a.text.trim() }
    }
    if (cli !== 'claude' || !(keep || session)) return go(false)
    if (session) { // the engine's session for this run: a review round continues it
      try { return await go(!!resume, session) } catch (e) { if (!resume || !/No conversation found/i.test(String(e))) throw e }
      return go(false)
    }
    if (n.sid) {
      try { return await go(true, n.sid) } catch (e) { if (!/No conversation found/i.test(String(e))) throw e } // session gone (cleaned up, other folder): start a new one
    }
    const sid = crypto.randomUUID()
    const out = await go(false, sid)
    patch(n.id, { sid })
    return out
  }

  // DeepSeek has no CLI: a plain API call (stateless, so the dialogue is replayed in the prompt like agy).
  const deepseek = async (model: string, prompt: string, via: 'deepseek' | 'openrouter' | 'nvidia' = 'deepseek'): Promise<Answer> => { // via: the same plain call to another OpenAI-compatible gateway
    const key = getKey(via)
    if (!key) throw new Error(t(via === 'openrouter' ? 'orNoKey' : via === 'nvidia' ? 'nvNoKey' : 'dsNoKey'))
    if (!prompt.trim()) throw new Error(t('orchNoInput'))
    const j = await ({ deepseek: dsChat, openrouter: orChat, nvidia: nvChat })[via](key, { model, messages: [{ role: 'system', content: BRIEF }, { role: 'user', content: prompt }] })
    return { text: String(j.choices?.[0]?.message?.content ?? '').trim(), ...dsUsage(model, j.usage) }
  }

  // Nano Banana (Gemini image models): the answer is text plus an inline image, shown in the block and the dialogue.
  const nano = async (model: string, prompt: string, images: string[] = []): Promise<Answer & { img?: string }> => {
    const key = getKey('agy') // the Gemini API key, shared with the chat sidebar; without one the Antigravity CLI draws
    if (!key && !inTauri) throw new Error(t('gemNoKey'))
    if (!prompt.trim()) throw new Error(t('orchNoInput'))
    const imgs = (await Promise.all(images.map((i) => getImg(i)))).flatMap((d) => d ?? [])
    const r = key ? { ...(await nanoImage(key, model, [{ role: 'user', text: prompt, imgs }])), cached: 0, cost: 0 } : await nanoAgy(prompt, imgs)
    if (!inTauri) return r
    // The next blocks get the picture as a file they can open, not the generator's chatter (the CLI's text is often "Waiting for…").
    const file = await saveImage(imgId(), r.img.slice(11, r.img.indexOf(';')), Array.from(atob(r.img.split(',')[1]), (c) => c.charCodeAt(0)))
    return { ...r, text: `Image file: ${file}${key ? `\n${r.text}` : ''}` }
  }

  // A message from you to one agent (the lead or any block): it answers with its own context plus its share of the saved dialogue.
  const ask = async (id: string, text: string) => {
    const n = o.nodes.find((x) => x.id === id)
    if (!n || running) return
    if (n.kind === 'start' && !o.leadChat) return run(text) // by default the lead never just answers: it briefs everyone again
    if (n.kind === 'start') { // "just answer": no tools, so no worktree is needed either
      stopped.current = false; setRunning(true)
      try { await leadChat(o, deps(), text) } finally { setRunning(false) }
      return
    }
    if (!(await isolate())) return
    setRunning(true)
    addLog({ from: t('orchUser'), to: who(n), toId: id, text, kind: 'user' })
    patch(id, { state: 'run' })
    try {
      const rules = o.edges.filter((e) => e[1] === id).map((e) => o.nodes.find((x) => x.id === e[0])!).filter((f) => f.kind === 'rules').map((f) => f.text).join('\n')
      const embedded = embed(n.notes)
      const own = history(id)
      // A resumed session already has its rules, notes and dialogue: send only the new message.
      const build = (resumed: boolean) => resumed ? text : [rules && `# Rules\n${rules}`, n.text && `# Context\n${n.text}`, embedded && `# Notes\n${embedded}`, own && `# Conversation so far\n${own.slice(-20000)}`, `# User message\n${text}`]
        .filter(Boolean).join('\n\n')
      const { text: out, img, ...use } = await exec(n, build, { keep: true, effort: workerEffort(n), tools: n.tools, maxTurns: MAX_TURNS })
      patch(id, { state: 'ok', out, img, use, sum: undefined }); addLog({ from: who(n), fromId: id, to: t('orchUser'), text: out, kind: 'reply', img })
      addLog({ from: '', to: '', text: '', kind: 'usage', rows: [{ who: who(n), use }] })
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      patch(id, { state: 'err', out: msg }); addLog({ from: who(n), fromId: id, to: '', text: msg, kind: 'error' })
    } finally { setRunning(false) }
  }

  // Who spent the most over the kept runs, biggest first: where a saving is worth looking for.
  const byWho = [...(o.runs ?? []).flatMap((r) => r.rows ?? []).reduce((m, { who, use }) => { const a = m.get(who) ?? { tok: 0, cost: 0 }; return m.set(who, { tok: a.tok + use.input + use.output, cost: a.cost + use.cost }) }, new Map<string, { tok: number; cost: number }>())]
    .sort((a, b) => b[1].cost - a[1].cost || b[1].tok - a[1].tok)
  const spent = o.nodes.reduce((a, n) => (n.use && !n.use.same ? { n: a.n + 1, input: a.input + n.use.input, cached: a.cached + n.use.cached, output: a.output + n.use.output, cost: a.cost + n.use.cost } : a), { n: 0, input: 0, cached: 0, output: 0, cost: 0 })
  // Input tokens only: the task, each block's context and notes, and the project map for the lead. The answers come on top.
  const est = o.nodes.reduce((a, n) => n.kind === 'rules' ? a : a + tokens(`${o.task} ${n.text}`) + (n.kind === 'start' ? mapTok : n.notes.reduce((s, x) => { const c = notes.find((q) => q.name === x)?.content ?? ''; return s + (c.length > NOTE_MAX ? 50 : tokens(c)) }, 0)), 0)
  const pos = (id: string, side: 'in' | 'out') => { const n = o.nodes.find((x) => x.id === id)!; return [n.x + (side === 'out' ? W : 0), n.y + HEAD] }
  const dot = 'port absolute top-[14px] w-3 h-3 rounded-full border-2 bg-surface'

  return (
    <div className="h-full flex">
    <div className="flex-1 min-w-0 flex flex-col relative">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-line bg-surface">
        <input value={o.name} onChange={(e) => upd((c) => ({ ...c, name: e.target.value }))} placeholder={t('orchName')} spellCheck={false} title={t('orchName')}
          className="min-w-[6rem] flex-1 max-w-[16rem] bg-transparent font-serif text-lg font-semibold outline-none placeholder:text-dim focus:text-accent" />
        {orchs.length > 1 && <select value={o.id} onChange={(e) => setAid(e.target.value)} className="min-w-0 max-w-[8rem] px-2 py-1 rounded-full bg-field border border-line text-xs text-mut outline-none focus:border-accent">{orchs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <button title={t('orchNew')} onClick={() => { const c = fresh(orchs.length + 1); setOrchs([...orchs, c]); setAid(c.id) }} className={tb}><Plus size={15} /></button>
        <button title={t('orchIsoTip')} onClick={() => upd((c) => ({ ...c, iso: !c.iso }))} disabled={running || !inTauri} className={`${tb} disabled:opacity-40 ${o.iso ? 'text-accent bg-accent-dim' : ''}`}><GitBranch size={15} /></button>
        {o.iso && o.wt && !running && <div className="flex rounded-lg border border-line overflow-hidden text-xs divide-x divide-line">{(['diff', 'apply', 'discard'] as const).map((w) => <button key={w} onClick={() => review(w)} className={`px-2.5 py-1 hover:bg-panel ${w === 'discard' ? 'text-dim hover:text-status-err' : 'text-fg'}`}>{t(w === 'diff' ? 'orchDiff' : w === 'apply' ? 'orchApply' : 'orchDiscard')}</button>)}</div>}
        <span className="ml-auto" />
        {!running && est > 0 && <span title={t('orchEstTip')} className="hidden xl:inline text-micro text-dim tabular-nums shrink-0">≈ ↑{k(est)}</span>}
        {spent.n > 0 && <span title={t('orchUseTip')} className="hidden xl:inline text-micro text-dim tabular-nums shrink-0">↑{k(spent.input)} ⟳{k(spent.cached)} ↓{k(spent.output)}{spent.cost > 0 && ` · $${spent.cost.toFixed(2)}`}</span>}
        <button onClick={(e) => (running ? (stopped.current = true, stopAgents().catch(console.error)) : run(undefined, e.shiftKey))} title={running ? t('orchStop') : t('orchRerun')}
          className={`btn-press flex items-center gap-1.5 pl-3 pr-4 h-9 rounded-xl text-sm font-medium hover:opacity-90 ${running ? 'bg-panel text-fg border border-line' : 'bg-accent text-bg'}`}>
          {running ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}{running ? t('orchStop') : t('orchRunAll')}</button>
        <button title={t('orchRuns')} onClick={() => setShowRuns((v) => !v)} className={`${tb} ${showRuns ? 'text-fg bg-panel' : ''}`}><History size={15} /></button>
        <button onClick={(e) => onMenu(e, [
          { label: t('orchTpl'), children: [...tpls().map((x, i) => ({ label: x.name, onClick: () => newFromTemplate(`b${i}`) })), ...saved.map((x, i) => ({ label: x.name, sep: i === 0, onClick: () => newFromTemplate(`s${i}`) }))] },
          { label: t('orchTplSave'), onClick: saveTemplate },
          ...(saved.length ? [{ label: t('orchTplDel'), danger: true, children: saved.map((x, i) => ({ label: x.name, danger: true, onClick: () => deleteTemplate(i) })) }] : []),
          // the last orchestra can go too: an empty one takes its place
          { label: t('delete'), danger: true, sep: true, disabled: running, onClick: () => { const rest = orchs.filter((x) => x !== o); const next = rest.length ? rest : [fresh(1)]; setOrchs(next); setAid(next[0].id) } }])} className={tb}><MoreHorizontal size={15} /></button>
      </div>
      {showRuns && <div className="anim-fade absolute right-4 top-12 z-20 w-96 max-h-80 overflow-auto rounded-xl bg-surface border border-line shadow-float p-3 flex flex-col gap-2 text-xs">
        {byWho.length > 0 && <div className="pb-2 border-b border-line">{byWho.map(([who, u]) => <div key={who} className="flex gap-2 text-micro tabular-nums"><span className="flex-1 truncate">{who}</span><span>{k(u.tok)} tok{u.cost > 0 && ` · $${u.cost.toFixed(2)}`}</span></div>)}</div>}
        {(o.runs ?? []).length === 0 ? <p className="text-dim">{t('orchRunsEmpty')}</p> : [...(o.runs ?? [])].reverse().map((r) => (
          <details key={r.at}><summary className="cursor-pointer tabular-nums">{hm(r.at)} · {k(r.tokens)} tok{r.cost > 0 && ` · $${r.cost.toFixed(2)}`}{r.failed.length > 0 && <span className="text-status-err"> · ✕ {r.failed.join(', ')}</span>}</summary>
            {r.rows?.map((x, i) => <div key={i} className="mt-1 flex gap-2 text-micro text-dim tabular-nums"><span className="flex-1 truncate">{x.who}</span><span>↑{k(x.use.input)} ⟳{k(x.use.cached)} ↓{k(x.use.output)}{x.use.cost > 0 && ` · $${x.use.cost.toFixed(2)}`}</span></div>)}
            {r.final && <pre className="mt-1 whitespace-pre-wrap text-micro text-mut">{r.final}</pre>}</details>))}
      </div>}
      <div className="flex-1 min-h-0 relative">
      <div ref={canvas} onPointerDown={pan} onContextMenu={canvasMenu} className="absolute inset-0 overflow-auto cursor-grab">
        <div style={{ width: CW * z, height: CH * z }}>
        <div className="relative origin-top-left" style={{ width: CW, height: CH, transform: `scale(${z})`, backgroundImage: 'radial-gradient(circle, var(--line2) 1.2px, transparent 1.5px)', backgroundSize: `${GRID}px ${GRID}px`, backgroundPosition: `-${GRID / 2}px -${GRID / 2}px` }}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs><filter id="eglow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" /></filter></defs>
            {o.edges.map(([a, b]) => {
              const A = o.nodes.find((x) => x.id === a)!, B = o.nodes.find((x) => x.id === b)!
              const [x1, y1] = pos(a, 'out'), [x2, y2] = pos(b, 'in'), dx = Math.max(50, Math.abs(x2 - x1) / 2)
              const d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
              const ck = `${a}>${b}`, cond = o.cond?.[ck], next = { undefined: 'ok', ok: 'bad', bad: undefined }[String(cond) as 'undefined' | 'ok' | 'bad'] as 'ok' | 'bad' | undefined
              const err = B.state === 'err', live = A.state === 'run' || B.state === 'run', gid = `eg-${a}-${b}`
              const stroke = err ? 'var(--status-err)' : `url(#${gid})`, op = live ? 1 : A.state === 'ok' && B.state === 'ok' ? 0.95 : 0.6
              const label = cond ? t(cond === 'ok' ? 'orchEdgeOk' : 'orchEdgeBad') : '', lw = label.length * 6.4 + 16, mx = (x1 + x2) / 2, my = (y1 + y2) / 2
              return <g key={a + b} className="edge">
                <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2 === x1 ? x2 + 1 : x2} y2={y2}><stop offset="0" stopColor={hue(A)} /><stop offset="1" stopColor={hue(B)} /></linearGradient>
                <path d={d} fill="none" stroke={stroke} strokeWidth="6" opacity={live ? 0.4 : 0.14} filter="url(#eglow)" />
                <path d={d} fill="none" stroke={stroke} strokeWidth="2" opacity={op} strokeDasharray={cond ? '6 4' : undefined} pathLength={cond ? undefined : 1} className={`line${cond ? '' : ' draw'}`} />
                {live && !err && <path d={d} fill="none" stroke="var(--fg)" strokeWidth="2" strokeOpacity=".65" strokeDasharray="6 18" className="pulse" />}
                {live && !err && smooth && <circle r="3.5" fill="var(--fg)" style={{ filter: 'drop-shadow(0 0 4px var(--fg))' }}><animateMotion dur="1.8s" repeatCount="indefinite" path={d} /></circle>}
                <polygon points={`${x2 - 15},${y2 - 4.5} ${x2 - 7},${y2} ${x2 - 15},${y2 + 4.5}`} fill={err ? 'var(--status-err)' : hue(B)} opacity={op} />
                {cond && <g className="pointer-events-none"><rect x={mx - lw / 2} y={my - 10} width={lw} height="20" rx="10" fill="var(--surface)" stroke="var(--accent)" /><text x={mx} y={my + 4} textAnchor="middle" fontSize="11" fill="var(--accent)">{label}</text></g>}
                <path d={d} fill="none" stroke="transparent" strokeWidth="14" className="pointer-events-auto cursor-pointer"
                  onClick={() => upd((c) => { const { [ck]: _, ...rest } = c.cond ?? {}; return { ...c, cond: next ? { ...rest, [ck]: next } : rest } })}
                  onContextMenu={(e) => onMenu(e, [{ label: t('orchUnlink'), danger: true, onClick: () => upd((c) => ({ ...c, edges: c.edges.filter((x) => !(x[0] === a && x[1] === b)) })) }])}><title>{t('orchEdgeTip')}</title></path></g>
            })}
            {wire && (() => { const [x1, y1] = pos(wire.from, 'out'), c = hue(o.nodes.find((x) => x.id === wire.from)!); return <path d={`M${x1} ${y1} L${wire.x} ${wire.y}`} stroke={c} strokeWidth="2.5" strokeDasharray={wireTo ? undefined : '5 4'} fill="none" style={{ filter: `drop-shadow(0 0 5px ${c})` }} /> })()}
          </svg>
          <p className="absolute left-[340px] top-12 text-dim pointer-events-none">{t('orchEmpty')}</p>
          {o.nodes.map((n) => (
            <div key={n.id} data-node={n.id} onContextMenu={(e) => onMenu(e, n.kind === 'rules' ? [{ label: t('delete'), danger: true, onClick: () => remove(n.id) }] : [
              // a private question to this agent only: it answers from its own context and dialogue, nobody else is briefed or rerun
              { label: t('orchAskHere'), onClick: () => setAskFocus({ id: n.id, n: Date.now() }) },
              { label: t('orchRerun'), disabled: running, onClick: () => run(undefined, false, n.id) },
              ...(n.kind === 'start' ? [] : [{ label: t('delete'), danger: true, sep: true, onClick: () => remove(n.id) }])])}
              style={{ left: n.x, top: n.y, width: W }} className={`group card-in absolute rounded-2xl bg-surface border shadow-float flex flex-col ${n.state === 'err' ? 'border-status-err node-err' : n.state === 'run' ? 'border-accent node-run' : wireTo === n.id && n.kind === 'model' ? 'border-accent ring-2 ring-accent' : 'border-line'}`}>
              <div onPointerDown={(e) => drag(n, e)} style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${hue(n)} 16%, transparent), transparent 70%)` }} className="flex items-center gap-1.5 pl-5 pr-3 h-11 rounded-t-2xl cursor-grab active:cursor-grabbing select-none border-b border-line">
                {n.kind === 'rules' ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hue(n), boxShadow: `0 0 8px ${hue(n)}` }} /> : <span style={{ background: tint(hue(n), 18), borderColor: tint(hue(n), 45) }} className="grid place-items-center w-7 h-7 -ml-1.5 rounded-full border shrink-0"><Brand agent={n.agent ?? 'claude'} size={15} color={hue(n)} /></span>}
                {n.kind === 'rules' ? <span className="text-xs truncate">{label(n)}</span>
                  : <>
                    {n.kind === 'start' ? <span className="text-micro font-semibold text-accent shrink-0 px-1.5 rounded bg-accent-dim">{t('blockStart')}</span> : <span className="text-micro font-semibold text-accent shrink-0 px-1.5 rounded bg-accent-dim">{String.fromCharCode(65 + o.nodes.filter((x) => x.kind === 'model').findIndex((x) => x.id === n.id))}</span>}
                    <input value={n.name ?? ''} onChange={(e) => patch(n.id, { name: e.target.value })} placeholder={t('orchNamePh')} spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-dim placeholder:font-normal" />
                  </>}
                <span className="ml-auto flex items-center gap-0.5 shrink-0">
                  {n.state && <span className={`w-2 h-2 mr-1 rounded-full ${DOT[n.state]}`} />}
                  <button title={t('orchCompact')} onClick={() => patch(n.id, { compact: !n.compact })} className="p-1 rounded text-dim hover:text-fg opacity-0 group-hover:opacity-100">{n.compact ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}</button>
                  <button title={t('orchRerun')} disabled={running} onClick={() => run(undefined, false, n.id)} className="p-1 rounded text-dim hover:text-accent disabled:opacity-30 opacity-0 group-hover:opacity-100"><RotateCcw size={12} /></button>
                  {n.kind !== 'start' && <button title={t('delete')} onClick={() => remove(n.id)} className="p-1 rounded text-dim hover:text-status-err opacity-0 group-hover:opacity-100"><X size={12} /></button>}
                </span>
              </div>
              {n.kind !== 'rules' && <div className="flex items-center gap-1.5 px-5 py-1.5 border-b border-line min-w-0">
                  <select value={`${n.agent ?? 'claude'}:${n.model ?? MODELS.claude[0][0]}`} onChange={(e) => { if (e.target.value.startsWith('preset:')) return patch(n.id, { ...resolve(PRESETS[+e.target.value.slice(7)]), role: PRESETS[+e.target.value.slice(7)][lang], review: undefined }); const [agent, model] = e.target.value.split(':') as [Agent, string]; patch(n.id, { agent, model, role: undefined, tools: undefined, review: undefined, ...(agent !== 'claude' && { effort: undefined }) }) }}
                    className="min-w-0 bg-transparent text-micro outline-none text-mut">
                    <optgroup label={`★ ${lang === 'ru' ? 'Рекомендуемые' : 'Recommended'}`}>{PRESETS.map((p, i) => <option key={i} value={`preset:${i}`} className="bg-panel">{presetLabel(p)}</option>)}</optgroup>
                    {(['claude', 'agy', 'codex', 'deepseek', 'openrouter', 'nvidia', 'nano'] as const).map((a) => <optgroup key={a} label={NAMES[a]}>
                      {models(a).map(([v, l]) => <option key={v} value={`${a}:${v}`} disabled={a === 'codex'} className="bg-panel">{a === 'codex' ? 'Codex — Coming soon' : l}</option>)}</optgroup>)}
                  </select>
                {n.role && <span className="text-micro text-accent truncate shrink-0 max-w-[45%]">· {n.role}{n.review ? ` ↻${n.review}` : ''}</span>}
                {n.kind === 'model' && <button title={t('orchRole')} onClick={(e) => onMenu(e, [
                  ...ROLES.map((r) => ({ label: r[lang], onClick: () => applyRole(n, r) })),
                  { label: t('orchNoRole'), sep: true, onClick: () => applyRole(n, null) }])} className="btn-press ml-auto p-0.5 rounded text-dim hover:text-accent shrink-0"><Plus size={13} /></button>}
                {['claude', 'agy', 'codex'].includes(n.agent ?? 'claude') && <button title={t('orchCfg')} onClick={() => setCfgFor(cfgFor === n.id ? '' : n.id)}
                  className={`btn-press p-0.5 rounded shrink-0 ${n.kind === 'start' ? 'ml-auto' : ''} ${n.cli ? 'text-accent' : 'text-dim hover:text-accent'}`}><Settings2 size={13} /></button>}
              </div>}
              {cfgFor === n.id && <CliSettings n={n} onChange={(cli) => patch(n.id, { cli })} onClose={() => setCfgFor('')} />}
              {n.kind === 'model' && <span title={t('orchIn')} style={{ borderColor: hue(n), color: hue(n) }} className={`${dot} -left-1.5 pointer-events-none`} />}
              <button title={t('orchOut')} onPointerDown={(e) => startWire(n.id, e)} style={{ borderColor: hue(n), color: hue(n) }} className={`${dot} -right-1.5 cursor-crosshair`} />
              {n.compact ? <div className="px-5 py-2.5 flex items-center gap-2 text-micro text-dim min-w-0">
                <span className="truncate flex-1">{n.text.split(/\r?\n/)[0] || '—'}</span>
                {n.state === 'run' && n.since && <Elapsed since={n.since} />}
                {n.use && <span className="tabular-nums shrink-0">{n.use.same ? t('orchSame') : `↑${k(n.use.input)} ↓${k(n.use.output)}`}</span>}
              </div> : <div className="p-3 flex flex-col gap-2">
                <textarea value={n.text} onChange={(e) => patch(n.id, { text: e.target.value })} rows={3} spellCheck={false}
                  onPaste={(e) => { if (n.kind === 'rules') return; const f = pastedPics(e.clipboardData); if (f.length) { e.preventDefault(); attach(n.id, f) } }}
                  placeholder={n.kind === 'rules' ? t('orchRulesPh') : n.kind === 'start' ? t('orchStartPh') : t('orchCtxPh')} className={`${field} resize-none`} />
                {n.kind !== 'rules' && <div className="flex items-center gap-1.5 min-w-0">
                  {(n.agent ?? 'claude') === 'claude' && <select value={n.effort ?? (n.kind === 'start' ? 'low' : '')} onChange={(e) => patch(n.id, { effort: e.target.value || undefined })} title={t('orchEffort')} className={`${field} min-w-0 flex-1`}>
                    {n.kind !== 'start' && <option value="">{t('orchEffort')}: auto</option>}{EFFORTS.map((x) => <option key={x} value={x}>{t('orchEffort')}: {x}</option>)}</select>}
                  {n.kind === 'model' && <select value="" onChange={(e) => e.target.value && patch(n.id, { notes: [...n.notes, e.target.value] })} className={`${field} min-w-0 flex-1`}>
                    <option value="">{t('orchEmbed')}</option>
                    {notes.filter((x) => !n.notes.includes(x.name)).map((x) => <option key={x.name} value={x.name}>@{x.name}</option>)}
                  </select>}
                </div>}
                {n.images && n.images.length > 0 && <div className="flex flex-wrap gap-1.5">{n.images.map((id) => <span key={id} className="relative"><StoredImg id={id} plain cls="h-10 w-10 object-cover rounded-md border border-line" />
                  <button onClick={() => patch(n.id, { images: n.images!.length > 1 ? n.images!.filter((x) => x !== id) : undefined })} className="absolute -top-1 -right-1 p-0.5 rounded-full bg-surface border border-line text-dim hover:text-status-err"><X size={9} /></button></span>)}</div>}
                {n.kind === 'start' && <span className="text-micro text-dim">{t('orchMapCtx', { n: notes.length, k: mapTok })}</span>}
                {n.state === 'run' && n.since && <Elapsed since={n.since} />}
                {n.use && <span title={t('orchUseTip')} className="text-micro text-dim tabular-nums">{n.use.same ? t('orchSame') : `↑${k(n.use.input)} ⟳${k(n.use.cached)} ↓${k(n.use.output)}${n.use.cost > 0 ? ` · $${n.use.cost.toFixed(3)}` : ''}`}</span>}
                {n.kind === 'start' && n.out && (!hideOut || n.state === 'err') && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-field ${n.state === 'err' ? 'text-status-err' : 'text-mut'}`}>{n.out}</pre>}
                {n.kind === 'start' && n.final && <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-accent-dim text-fg">{n.final}</pre>}
                {n.kind === 'model' && <>
                  {n.notes.length > 0 && <div className="flex flex-wrap gap-1">{n.notes.map((x) => (
                    <button key={x} title={t('delete')} onClick={() => patch(n.id, { notes: n.notes.filter((k) => k !== x) })} className="px-2 py-0.5 rounded-full bg-accent-dim text-accent text-micro">@{x} ×</button>))}</div>}
                  {n.img && <a href={n.img} download="nano-banana.png" title="Save"><img src={n.img} className="rounded-lg w-full" /></a>}
                  {n.out && (!hideOut || n.state === 'err') && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap text-micro p-2 rounded-lg bg-field ${n.state === 'err' ? 'text-status-err' : 'text-mut'}`}>{n.out}</pre>}
                </>}
              </div>}
            </div>
          ))}
        </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_110px_var(--bg)]" />
      <div className="absolute left-4 bottom-4 flex items-center gap-0.5 p-1 rounded-xl bg-surface/85 backdrop-blur border border-line shadow-float">
        <button title={t('orchZoomOut')} onClick={() => zoomTo(z - 0.1)} className={tb}><ZoomOut size={15} /></button>
        <button title="100%" onClick={() => zoomTo(1)} className="w-10 text-micro tabular-nums text-dim hover:text-fg">{Math.round(z * 100)}%</button>
        <button title={t('orchZoomIn')} onClick={() => zoomTo(z + 0.1)} className={tb}><ZoomIn size={15} /></button>
        <span className="w-px h-4 mx-0.5 bg-line" />
        <button title={t('orchFit')} onClick={fit} className={tb}><Scan size={15} /></button>
        <button title={t('orchLayout')} onClick={layout} className={tb}><Workflow size={15} /></button>
        <button title={t('orchSnap')} onClick={() => setSnap(!snap)} className={`${tb} ${snap ? 'text-accent bg-accent-dim' : ''}`}><Magnet size={15} /></button>
      </div>
      <MiniMap c={canvas} z={z} nodes={o.nodes} />
      </div>
    </div>
    <Dialogue focus={askFocus} log={log} busy={running} onStop={() => { stopped.current = true; stopAgents().catch(console.error) }} queue={!!o.queue} onQueue={() => upd((c) => ({ ...c, queue: !c.queue }))} leadChat={!!o.leadChat} onLeadChat={() => upd((c) => ({ ...c, leadChat: !c.leadChat }))} onAttach={attach} onSend={ask} onClear={() => upd((c) => ({ ...c, log: [], nodes: c.nodes.map((n) => ({ ...n, sid: undefined, mapSum: undefined, sum: undefined })) }))}
      agents={o.nodes.filter((n) => n.kind !== 'rules').map((n) => ({ id: n.id, agent: n.agent ?? 'claude', hue: hue(n), name: who(n), role: n.role ?? (n.kind === 'model' ? n.text.split(/\r?\n/)[0].slice(0, 60) : undefined), state: n.state, task: [...log].reverse().find((e) => e.kind === 'task' && e.toId === n.id)?.text }))} />
    </div>
  )
}

/** The whole canvas at a glance: blocks as coloured tiles and the visible part as a frame; click or drag to jump. */
function MiniMap({ c, z, nodes }: { c: React.RefObject<HTMLDivElement>; z: number; nodes: Node[] }) {
  const [v, setV] = useState({ l: 0, t: 0, w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = c.current!, f = () => setV({ l: el.scrollLeft, t: el.scrollTop, w: el.clientWidth, h: el.clientHeight })
    f(); el.addEventListener('scroll', f); window.addEventListener('resize', f)
    return () => { el.removeEventListener('scroll', f); window.removeEventListener('resize', f) }
  }, [c, z])
  const go = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); c.current!.scrollLeft = (e.clientX - r.left) / MM * z - v.w / 2; c.current!.scrollTop = (e.clientY - r.top) / MM * z - v.h / 2 }
  return (
    <div onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); go(e) }} onPointerMove={(e) => e.buttons && go(e)}
      className="absolute right-4 bottom-4 rounded-xl bg-surface/85 backdrop-blur border border-line shadow-float overflow-hidden cursor-pointer" style={{ width: CW * MM, height: CH * MM }}>
      {nodes.map((n) => <span key={n.id} className="absolute rounded-sm opacity-80" style={{ left: n.x * MM, top: n.y * MM, width: W * MM, height: (n.compact ? 70 : 200) * MM, background: hue(n) }} />)}
      <span className="absolute rounded-sm border border-accent bg-accent-dim pointer-events-none" style={{ left: v.l / z * MM, top: v.t / z * MM, width: v.w / z * MM, height: v.h / z * MM }} />
    </div>
  )
}

/** The gear of a CLI block: permission prompts, step and money limits, and your own CLI flags. Applies to this block only; empty = default. */
function CliSettings({ n, onChange, onClose }: { n: Node; onChange: (c: Node['cli']) => void; onClose: () => void }) {
  const { t } = useI18n()
  const c = n.cli ?? {}
  const set = (p: NonNullable<Node['cli']>) => { const clean = Object.fromEntries(Object.entries({ ...c, ...p }).filter(([, v]) => v !== undefined && v !== '')); onChange(Object.keys(clean).length ? clean : undefined) }
  const skip = c.skipPerms !== false, claude = (n.agent ?? 'claude') === 'claude'
  const num = 'w-20 px-2 py-1 rounded-lg bg-field border border-line focus:border-accent outline-none text-xs text-right tabular-nums placeholder:text-dim'
  return (
    <div className="anim-rise absolute left-3 right-3 top-[92px] z-30 rounded-2xl bg-surface border border-line shadow-float p-3.5 flex flex-col gap-3.5 text-xs cursor-default">
      <div className="flex items-center"><span className="font-medium text-sm">{t('orchCfg')}</span><button onClick={onClose} className="ml-auto p-0.5 text-dim hover:text-fg"><X size={13} /></button></div>
      <button role="switch" aria-checked={skip} title={t('orchSkipTip')} onClick={() => set({ skipPerms: skip ? false : undefined })} className="flex items-center gap-3 text-left">
        <span className="flex-1 min-w-0"><span className="block">{t('orchSkip')}</span><span className="block text-micro text-dim font-mono truncate">--dangerously-skip-permissions</span></span>
        <span className={`relative w-9 h-5 rounded-full shrink-0 border ${skip ? 'border-accent bg-accent-dim' : 'border-line bg-field'}`}>
          <span data-ease className={`absolute top-[2px] left-[2px] w-3.5 h-3.5 rounded-full ${skip ? 'translate-x-4 bg-accent' : 'bg-dim'}`} /></span>
      </button>
      {claude && <>
        <label className="flex items-center gap-3"><span className="flex-1">{t('orchTurns')}</span>
          <input type="number" min={1} value={c.turns ?? ''} placeholder={String(MAX_TURNS)} onChange={(e) => set({ turns: e.target.value ? Math.max(1, Math.round(+e.target.value)) : undefined })} className={num} /></label>
        <label className="flex items-center gap-3"><span className="flex-1">{t('orchBudgetUsd')}</span>
          <input type="number" min={0.1} step={0.5} value={c.budget ?? ''} placeholder={String(BUDGET)} onChange={(e) => set({ budget: e.target.value ? Math.max(0.1, +e.target.value) : undefined })} className={num} /></label>
      </>}
      <label className="flex flex-col gap-1.5"><span>{t('orchFlags')}</span>
        <input value={c.flags ?? ''} onChange={(e) => set({ flags: e.target.value })} placeholder={t('orchFlagsPh')} spellCheck={false} autoComplete="off"
          className="px-2.5 py-1.5 rounded-lg bg-field border border-line focus:border-accent outline-none font-mono text-xs placeholder:text-dim" /></label>
      <p className="text-micro text-dim">{t('orchCfgNote')}</p>
    </div>
  )
}

/** How long the block's current call has been running; turns to a warning past SLOW seconds. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return <span className={`text-micro tabular-nums ${s > SLOW ? 'text-status-err' : 'text-dim'}`}>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

const DOT = { run: 'bg-accent animate-pulse', ok: 'bg-status-ok', err: 'bg-status-err' } as const
const hm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const FINAL_BG = 'color-mix(in srgb, var(--accent) 14%, var(--surface))' // solid, so the fold's fade matches it
type AgentRow = { id: string; agent: string; name: string; role?: string; state?: Node['state']; task?: string; hue: string }
const short = (name: string) => name.split(' · ')[0] // "A", or the lead's title
const detail = (name: string) => name.split(' · ').slice(1).join(' · ') // agent and model
const tint = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`

/** A round badge in the agent's colour with its maker's logo; a small crown marks the lead. */
function Avatar({ a, lead, size = 28 }: { a?: AgentRow; lead?: boolean; size?: number }) {
  const c = a?.hue ?? 'var(--mut)'
  return <span style={{ width: size, height: size, color: c, background: tint(c, 18), borderColor: tint(c, 45) }} className="relative grid place-items-center shrink-0 rounded-full border text-xs font-semibold select-none">
    {a ? <Brand agent={a.agent} size={size * 0.55} color={c} /> : '·'}
    {lead && <span className="absolute -top-1 -right-1 grid place-items-center rounded-full bg-surface border border-line text-accent" style={{ width: size * 0.45, height: size * 0.45 }}><Crown size={size * 0.28} /></span>}</span>
}

/** A long answer is cut to a few lines with a "show more" button, so one wall of text does not push the whole dialogue away. */
function Fold({ long, children }: { long: boolean; children: React.ReactNode }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!long) return <>{children}</>
  return <div className="flex flex-col gap-2">
    <div className={`relative ${open ? '' : 'max-h-64 overflow-hidden'}`}>{children}
      {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--fold)] to-transparent" />}</div>
    <button onClick={() => setOpen(!open)} className="self-start text-micro text-accent hover:underline">{t(open ? 'orchLess' : 'orchMore')}</button>
  </div>
}

/** Replaces the chat sidebar on this tab: who is doing what, the saved dialogue between agents, and a box to write to any of them. */
function Dialogue({ focus, log, agents, busy, onStop, queue, onQueue, leadChat, onLeadChat, onAttach, onSend, onClear }: {
  focus?: { id: string; n: number }; log: Entry[]; busy: boolean; onStop: () => void; queue: boolean; onQueue: () => void; leadChat: boolean; onLeadChat: () => void; onAttach: (id: string, files: File[]) => void; onSend: (id: string, text: string) => void; onClear: () => void
  agents: AgentRow[]
}) {
  const { t } = useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true) // follow new messages only while the reader is at the bottom: scrolling up to read must not be undone
  const [to, setTo] = useState('') // '' = the lead, which is always first
  const [text, setText] = useState('')
  const [briefs, setBriefs] = useState(true)
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (focus) { setTo(focus.id); box.current?.focus() } }, [focus])
  const running = agents.filter((a) => a.state === 'run').length
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [log.length, running])
  const target = agents.some((a) => a.id === to) ? to : agents[0]?.id
  const find = (id?: string) => agents.find((a) => a.id === id)
  const send = () => { const m = text.trim(); if (m === '/clear' && !busy) { onClear(); setText(''); return } if (m && !busy && target) { onSend(target, m); setText('') } }
  const done = agents.filter((a) => a.state === 'ok').length, failed = agents.filter((a) => a.state === 'err').length
  const lead = agents[0]?.id
  return (
    <aside className="anim-slide w-[28rem] max-w-[46vw] shrink-0 border-l border-line bg-surface flex flex-col text-sm" style={{ ['--fold' as string]: 'var(--panel)' }}>
      <div className="flex items-center gap-1 pl-5 pr-3 h-14 border-b border-line">
        <span className="font-serif text-lg font-semibold">{t('orchLog')}</span>
        <span title={t('orchProgress')} className={`ml-2 px-2 py-0.5 rounded-full text-micro tabular-nums border ${failed ? 'border-status-err text-status-err' : 'border-line text-dim'}`}>{done}/{agents.length}{failed > 0 && ` · ✕${failed}`}</span>
        <span className="ml-auto" />
        <button title={t('orchBriefs')} aria-pressed={briefs} onClick={() => setBriefs(!briefs)} className={`btn-press p-1.5 rounded-lg ${briefs ? 'text-accent bg-accent-dim' : 'text-dim hover:text-fg'}`}><FileText size={15} /></button>
        <button title={t('openFolder')} onClick={() => openRoot().catch(console.error)} className="btn-press p-1.5 rounded-lg text-dim hover:text-fg"><FolderOpen size={15} /></button>
        <button title={t('orchClear')} onClick={onClear} disabled={!log.length} className="btn-press p-1.5 rounded-lg text-dim hover:text-status-err disabled:opacity-30"><Trash2 size={15} /></button>
      </div>
      <div className="h-0.5 bg-field"><div className="h-full bg-accent transition-all" style={{ width: `${(done / Math.max(1, agents.length)) * 100}%`, transitionDuration: '.5s' }} /></div>
      <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-line max-h-28 overflow-auto">
        {agents.map((a) => (
          <button key={a.id} onClick={() => setTo(a.id)} title={[a.name, a.role, a.task].filter(Boolean).join('\n')}
            className={`btn-press flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs max-w-full ${a.id === target ? 'border-accent bg-accent-dim' : 'border-line hover:border-accent'}`}>
            <Avatar a={a} lead={a.id === lead} size={20} />
            <span className="truncate">{short(a.name)}</span>
            {a.state === 'ok' ? <Check size={12} className="text-status-ok shrink-0" /> : a.state === 'err' ? <X size={12} className="text-status-err shrink-0" /> : a.state === 'run' ? <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT.run}`} /> : null}
          </button>
        ))}
      </div>
      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }} className="flex-1 overflow-auto px-4 pt-4 pb-3 flex flex-col gap-4">
        {log.length === 0 && <p className="m-auto text-center text-dim max-w-[17rem] leading-relaxed">{t('orchLogEmpty')}</p>}
        {log.filter((e) => !e.quiet).map((e, i) => {
          if (e.kind === 'usage') return <UsageTable key={i} rows={e.rows ?? []} />
          if (e.kind === 'run') return <div key={i} className="flex items-center gap-2 text-micro text-dim"><span className="flex-1 h-px bg-line" />▶ {hm(e.at)}<span className="flex-1 h-px bg-line" /></div>
          if (e.kind === 'user') return (
            <div key={i} className="anim-rise self-end max-w-[85%] flex flex-col items-end gap-1">
              <p className="whitespace-pre-wrap break-words px-4 py-2.5 rounded-2xl rounded-br-md bg-accent text-bg">{e.text}</p>
              <span className="text-micro text-dim">{e.from} → {e.to} · {hm(e.at)}</span>
            </div>)
          if (e.kind === 'task') {
            const a = find(e.toId)
            if (!briefs) return null
            return (
              <details key={i} className="anim-rise group rounded-xl border border-dashed border-line px-3 py-2 text-xs">
                <summary className="flex items-center gap-2 cursor-pointer list-none text-dim hover:text-fg min-w-0">
                  <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
                  <Avatar a={a} lead={a?.id === lead} size={18} />
                  <span className="shrink-0">{t('orchTaskLbl')} · {a ? short(a.name) : e.to}</span>
                  <span className="truncate flex-1 text-mut">{e.text.replace(/\s+/g, ' ').slice(0, 90)}</span>
                  <span className="shrink-0">{hm(e.at)}</span>
                </summary>
                <p className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-mut">{e.text}</p>
              </details>)
          }
          const a = find(e.fromId), fin = e.kind === 'reply' && e.from.endsWith(t('orchFinal')), err = e.kind === 'error'
          return (
            <div key={i} className="anim-rise flex gap-3">
              <Avatar a={a} lead={a?.id === lead} />
              <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-medium truncate">{short(a?.name ?? e.from)}</span>
                  <span className="text-micro text-dim truncate">{detail(a?.name ?? e.from)}</span>
                  {fin && <span className="shrink-0 inline-flex items-center gap-1 px-1.5 rounded-full bg-accent text-bg text-micro"><Sparkles size={10} />{t('orchFinalBadge')}</span>}
                  <span className="ml-auto shrink-0 text-micro text-dim">{hm(e.at)}</span>
                </div>
                {err ? <div style={{ borderColor: tint('var(--status-err)', 40), background: tint('var(--status-err)', 10) }} className="flex gap-2 items-start rounded-xl border px-3 py-2 text-xs text-status-err">
                    <TriangleAlert size={14} className="mt-px shrink-0" /><p className="whitespace-pre-wrap break-words min-w-0">{e.text}</p></div>
                  : <div className={`rounded-2xl rounded-tl-md border px-4 py-3 min-w-0 ${fin ? 'border-accent' : 'border-line bg-panel'}`} style={fin ? { background: FINAL_BG, ['--fold' as string]: FINAL_BG } : undefined}>
                    <Fold long={e.text.length > 900}><Markdown text={e.text} /><StoredImg src={e.img} id={e.imgId} /></Fold></div>}
              </div>
            </div>)
        })}
        {agents.filter((a) => a.state === 'run').map((a) => (
          <div key={a.id} className="anim-fade flex items-center gap-3 text-xs text-dim">
            <Avatar a={a} lead={a.id === lead} />
            <span className="flex gap-0.5">{[0, 1, 2].map((d) => <span key={d} className="w-1 h-1 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />)}</span>
            <span className="truncate">{short(a.name)}{a.role && ` · ${a.role}`} — {t('orchThinking')}</span>
          </div>
        ))}
      </div>
      <div className="px-4 pt-3 pb-3 flex flex-col gap-2 border-t border-line">
        <div className="flex items-center gap-1.5">
          <select value={target} onChange={(e) => setTo(e.target.value)} title={t('orchTo')}
            className="min-w-0 flex-1 px-3 py-1 rounded-full bg-field border border-line focus:border-accent outline-none text-xs">
            {agents.map((a) => <option key={a.id} value={a.id}>{t('orchTo')}: {a.name}</option>)}
          </select>
          <button title={t(queue ? 'orchQueueTip' : 'orchParTip')} onClick={onQueue} className="btn-press px-2.5 py-1 rounded-full border border-line text-xs text-dim hover:text-fg">{t(queue ? 'orchQueue' : 'orchPar')}</button>
          {target === lead && <button title={t(leadChat ? 'orchChatTip' : 'orchRebriefTip')} onClick={onLeadChat} className="btn-press px-2.5 py-1 rounded-full border border-line text-xs text-dim hover:text-fg">{t(leadChat ? 'orchChatOnly' : 'orchRebrief')}</button>}
        </div>
        <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-2xl bg-field border border-line focus-within:border-accent focus-within:shadow-float">
          <label title={t('orchAttachTip')} className="btn-press p-1.5 rounded-lg text-dim hover:text-accent cursor-pointer self-center"><Paperclip size={15} />
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { if (target) onAttach(target, [...(e.target.files ?? [])]); e.target.value = '' }} /></label>
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={2} spellCheck={false} placeholder={t('orchMsgPh')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            onPaste={(e) => { const f = pastedPics(e.clipboardData); if (f.length) { e.preventDefault(); if (target) onAttach(target, f) } }}
            className="flex-1 min-w-0 py-1 bg-transparent outline-none resize-none text-sm placeholder:text-dim max-h-40" />
          {busy
            ? <button onClick={onStop} title={t('orchStop')} className="btn-press p-2 rounded-full bg-accent text-bg hover:opacity-90"><Square size={15} fill="currentColor" /></button>
            : <button onClick={send} disabled={!text.trim()} title={t('send')} className="btn-press p-2 rounded-full bg-accent text-bg hover:opacity-90 disabled:opacity-25"><ArrowUp size={15} /></button>}
        </div>
      </div>
    </aside>
  )
}

/** Who spent what in one run (or one answer): one line with the total, the table opens on click. */
function UsageTable({ rows }: { rows: Row[] }) {
  const { t } = useI18n()
  const total = rows.reduce((a, r) => ({ input: a.input + r.use.input, cached: a.cached + r.use.cached, output: a.output + r.use.output, cost: a.cost + r.use.cost }), { input: 0, cached: 0, output: 0, cost: 0 })
  const paid = total.cost > 0
  const cells = (u: Omit<Use, 'same'>) => <><td className="px-2 py-1 text-right">{k(u.input)}</td><td className="px-2 py-1 text-right">{k(u.cached)}</td><td className="px-2 py-1 text-right">{k(u.output)}</td>{paid && <td className="px-2 py-1 text-right">${u.cost.toFixed(3)}</td>}</>
  return (
    <details className="anim-rise group rounded-xl border border-line text-micro tabular-nums">
      <summary title={t('orchUseTip')} className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none text-dim hover:text-fg">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
        <span className="text-accent">{t('orchUsage')}</span>
        <span className="ml-auto">↑{k(total.input)} ⟳{k(total.cached)} ↓{k(total.output)}{paid && ` · $${total.cost.toFixed(3)}`}</span>
      </summary>
      <table className="w-full border-t border-line">
        <thead className="bg-panel text-dim"><tr><th className="px-2 py-1 text-left font-normal">{t('orchWho')}</th><th className="px-2 py-1 text-right font-normal">↑</th><th className="px-2 py-1 text-right font-normal">⟳</th><th className="px-2 py-1 text-right font-normal">↓</th>{paid && <th className="px-2 py-1 text-right font-normal">$</th>}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-line text-mut"><td className="px-2 py-1 truncate max-w-[10rem]" title={r.who}>{r.who}</td>
            {r.use.same ? <td colSpan={paid ? 4 : 3} className="px-2 py-1 text-right text-dim">{t('orchSame')}</td> : cells(r.use)}</tr>)}
          {rows.length > 1 && <tr className="border-t border-line text-fg font-medium"><td className="px-2 py-1">{t('orchTotal')}</td>{cells(total)}</tr>}
        </tbody>
      </table>
    </details>
  )
}
