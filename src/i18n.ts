import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'ru'

const en = {
  editor: 'Editor', graph: 'Graph', tokensTab: 'Token Inspector',
  search: 'Search…', newNote: 'New note', notes: 'notes',
  openEditor: 'Open in Editor', copyLink: 'Copy @link', deleteNote: 'Delete note', focusNeighbors: 'Focus & Highlight neighbors',
  newNoteHere: '+ New note here', resetView: 'Reset view and zoom', deleteConfirm: 'Delete note "{n}"?', 
  graphSearch: 'Search notes by title, content or tag…', connections: 'connections',
  tokens: 'tokens', settings: 'Settings', agentsTitle: 'Agents (Ctrl J)', close: 'Close',
  language: 'Language', smooth: 'Smooth animations', smoothDesc: 'Transitions, fades and graph glide. Turn off for reduced motion.',
  projTitle: 'Projects', projects: 'Projects', create: 'Create',
  
  agents: 'Agents', 
  
  model: 'Model', reasoning: 'Reasoning Effort', low: 'Low', medium: 'Medium', high: 'High', 
  promptPh: 'Message the agent…', insert: 'Insert reply into note', 
  online: 'Online', ready: 'Ready', simBrowser: 'CLI needs the desktop app', simKey: 'API key required', tokIn: 'tok in', tokOut: 'tok out',
  
  chatNew: 'New chat', history: 'History', historyEmpty: 'No saved chats in this project yet.', chatEmpty: 'Ask anything about this project. The agent always sees the graph map: {n} notes, ~{k} tokens.',
  thinking: 'Thinking…', copy: 'Copy', send: 'Send', sendHint: 'Enter to send · Shift+Enter for a new line',
  mapBadge: 'map ~{m} tok instead of ~{s} tok of source', mapTip: 'Agent context: the graph map vs. a rough estimate (size/4) of the scanned source files',
  rescan: 'Rescan project files (keeps your own notes)',
  modeCli: 'Local CLI', modeApi: 'API key', effortInName: 'Antigravity CLI sets effort through the model name — pick a …-low / …-medium / …-high variant above.',
 orchNoInput: 'This block has nothing to send: add a task, context, a note or a link.', orchStop: 'Stop', orchUsage: 'Spent', orchWho: 'Who', orchTotal: 'Total', orchSame: 'unchanged · answer reused', orchRunTip: 'Blocks whose input has not changed reuse their last answer. Shift+click: rerun all.', orchUseTip: 'tokens: ↑ new input · ⟳ read from cache · ↓ output',
 orchLeadDefault: 'Work from the project map.', orchLead: 'Lead', orchUser: 'You', orchLog: 'Agent dialogue', orchLogEmpty: 'Run the orchestra to watch the agents talk and see who works on what.',
 orchThinking: 'thinking', orchClear: 'Clear history', orchIso: 'Isolate', orchFinal: 'final answer', orchCap: 'Run stopped: it reached ${n} (blocks not started stay idle).', orchIsoTip: 'Agents work in a separate git worktree; your project changes only when you press Apply', orchIsoFail: 'Cannot isolate the run (turn Isolate off to work in the project itself).', orchDiff: 'Changes', orchApply: 'Apply', orchDiscard: 'Discard', orchDiscardAsk: 'Throw away everything the agents changed?', orchApplied: 'Applied to the project (not committed).', orchDiscarded: 'Discarded.', orchNoChanges: 'No changes.', orchTo: 'To', orchMsgPh: 'Write to the lead or to one agent…',
 orchMapCtx: 'Context: project map · {n} notes · ~{k} tok',  orchestra: 'Orchestra', blockRules: 'Rules', orchNew: 'New orchestra', orchName: 'Orchestra name', orchEffort: 'Effort', dsKey: 'DeepSeek API key (stored locally)', orchNamePh: 'Block name…', dsNoKey: 'Add the DeepSeek API key in Settings first.', gemKey: 'Gemini API key (Antigravity chat, Nano Banana)', gemNoKey: 'Add the Gemini API key in Settings first.', orchRun: 'Run', openFolder: 'Open project folder', orchPar: 'Parallel', orchQueue: 'Queue', orchParTip: 'Parallel: blocks start as soon as their inputs are ready. Click for queue.', orchQueueTip: 'Queue: one block at a time. Click for parallel.', orchRunning: 'Running…', orchEmpty: 'Right-click to add a model or a rules block', orchCycle: 'These blocks form a loop — remove a link.', orchUnlink: 'Click to remove link', orchIn: 'Input', orchOut: 'Drag onto a block to link it', blockStart: 'Start', orchStartPh: 'Starting input for the chain…', orchRulesPh: 'Rules for connected models…', orchCtxPh: 'Context for this model…', orchEmbed: '+ Embed a note',
  max: 'Max',
  usage: 'Plan limits', usage5h: '5-hour window', usage7d: 'Weekly window', resets: 'resets', desktopOnly: 'Available in the desktop app.',
  
  projNew: 'New project', projNewDesc: 'Creates a folder in Documents/Taurium', projNewDescWeb: 'Stored in this browser', projOpen: 'Open existing folder…', projOpenDesc: 'Any folder with .deso notes',
  projName: 'Project name', projRemove: 'Remove from list', projRemoveWeb: 'Delete project', projBadName: 'Use a plain name: no slashes or special characters.', projEmpty: 'No projects yet.',
  projFilesStay: 'Files stay on disk.', cancel: 'Cancel', delete: 'Delete', deleteTitle: 'Delete note',
  noteName: 'note-name', noteBad: 'Use a-z, 0-9, - and _ only.', noteExists: 'A note with this name already exists.', noteCreate: 'Create',
  emptyTitle: 'Nothing here yet', emptySub: 'Create your first note to start the graph.', createFirst: 'Create first note',
  selectFamily: 'Select note + linked', onlyFamily: 'Show only this family', hideFamily: 'Hide linked notes', hideNote: 'Hide note',
  onlySelected: 'Show only selected ({n})', hideSelected: 'Hide selected ({n})', clearSel: 'Clear selection', showAll: 'Show all ({n} hidden)',
  legendOut: 'links to', legendIn: 'linked from', ctrlHint: 'Ctrl+click — select · drag — move', selected: 'selected', fitView: 'Fit to screen',
  markColor: 'Colour mark', clearMark: 'Remove mark', legendHint: 'Hover a note: each neighbour and its link share a colour. Arrow points to the linked note.',
  project: 'Project', theme: 'Theme', steel: 'Steel', dark: 'Dark', light: 'Light', you: 'You', tokSaved: 'saved', notesTok: '{n} notes · {k} tokens',
  focusZoom: 'Zoom to this family',
  savedCol: 'Saved', tiSaved: 'tokens saved', tiEstimate: 'Token counts are a heuristic estimate, not an exact model tokenizer.', tiConstruct: 'Construct',
}

const ru: Record<keyof typeof en, string> = {
  editor: 'Редактор', graph: 'Граф', tokensTab: 'Инспектор токенов',
  search: 'Поиск…', newNote: 'Новая заметка', notes: 'заметок',
  openEditor: 'Открыть в редакторе', copyLink: 'Копировать @ссылку', deleteNote: 'Удалить заметку', focusNeighbors: 'Выделить соседей',
  newNoteHere: '+ Новая заметка здесь', resetView: 'Сбросить вид и масштаб', deleteConfirm: 'Удалить заметку «{n}»?', 
  graphSearch: 'Поиск по названию, тексту или тегу…', connections: 'связей',
  tokens: 'токенов', settings: 'Настройки', agentsTitle: 'Агенты (Ctrl J)', close: 'Закрыть',
  language: 'Язык', smooth: 'Плавные анимации', smoothDesc: 'Переходы, затухания и инерция графа. Отключите для уменьшения движения.',
  projTitle: 'Проекты', projects: 'Проекты', create: 'Создать',
  
  agents: 'Агенты', 
  
  model: 'Модель', reasoning: 'Уровень рассуждений', low: 'Низкий', medium: 'Средний', high: 'Высокий', 
  promptPh: 'Сообщение агенту…', insert: 'Вставить ответ в заметку', 
  online: 'Онлайн', ready: 'Готов', simBrowser: 'CLI доступен только в приложении', simKey: 'Нужен API-ключ', tokIn: 'ток. вх.', tokOut: 'ток. исх.',
  
  chatNew: 'Новый чат', history: 'История', historyEmpty: 'В этом проекте пока нет сохранённых чатов.', chatEmpty: 'Спросите что угодно о проекте. Агент всегда видит карту графа: {n} заметок, ~{k} токенов.',
  thinking: 'Думает…', copy: 'Копировать', send: 'Отправить', sendHint: 'Enter — отправить · Shift+Enter — новая строка',
  mapBadge: 'карта ~{m} ток. вместо ~{s} ток. исходников', mapTip: 'Контекст агента: карта графа против грубой оценки (размер/4) просканированных исходников',
  rescan: 'Пересканировать файлы проекта (ваши заметки сохранятся)',
  modeCli: 'Локальный CLI', modeApi: 'API-ключ', effortInName: 'Antigravity CLI задаёт усилие через имя модели — выберите вариант …-low / …-medium / …-high выше.',
 orchNoInput: 'У блока нечего отправлять: добавьте задачу, контекст, заметку или связь.', orchStop: 'Стоп', orchUsage: 'Расход', orchWho: 'Кто', orchTotal: 'Итого', orchSame: 'без изменений · ответ взят из прошлого запуска', orchRunTip: 'Блоки, у которых вход не изменился, берут прошлый ответ. Shift+клик — перезапустить все.', orchUseTip: 'токены: ↑ новый вход · ⟳ из кэша · ↓ выход',
 orchLeadDefault: 'Работать по карте проекта.', orchLead: 'Ведущий', orchUser: 'Вы', orchLog: 'Диалог агентов', orchLogEmpty: 'Запустите оркестр, чтобы увидеть общение агентов и кто чем занят.',
 orchThinking: 'думает', orchClear: 'Очистить историю', orchIso: 'Изоляция', orchFinal: 'итоговый ответ', orchCap: 'Запуск остановлен: достигнут лимит ${n} (не начатые блоки остались без дела).', orchIsoTip: 'Агенты работают в отдельном git worktree; проект меняется только после «Применить»', orchIsoFail: 'Не удалось изолировать запуск (выключите «Изоляцию», чтобы работать прямо в проекте).', orchDiff: 'Изменения', orchApply: 'Применить', orchDiscard: 'Отбросить', orchDiscardAsk: 'Отбросить всё, что изменили агенты?', orchApplied: 'Применено к проекту (без коммита).', orchDiscarded: 'Отброшено.', orchNoChanges: 'Изменений нет.', orchTo: 'Кому', orchMsgPh: 'Напишите ведущему или отдельному агенту…',
 orchMapCtx: 'Контекст: карта проекта · {n} заметок · ~{k} ток.',  orchestra: 'Оркестр', blockRules: 'Правила', orchNew: 'Новый оркестр', orchName: 'Название оркестра', orchEffort: 'Усилие', dsKey: 'API-ключ DeepSeek (хранится локально)', orchNamePh: 'Название блока…', dsNoKey: 'Сначала добавьте API-ключ DeepSeek в настройках.', gemKey: 'API-ключ Gemini (чат Antigravity, Nano Banana)', gemNoKey: 'Сначала добавьте API-ключ Gemini в настройках.', orchRun: 'Запустить', openFolder: 'Открыть папку проекта', orchPar: 'Параллельно', orchQueue: 'По очереди', orchParTip: 'Параллельно: блок стартует, как только готовы его входы. Клик — по очереди.', orchQueueTip: 'По очереди: по одному блоку. Клик — параллельно.', orchRunning: 'Выполняется…', orchEmpty: 'Правая кнопка мыши — добавить модель или блок правил', orchCycle: 'Блоки образуют цикл — удалите связь.', orchUnlink: 'Клик — удалить связь', orchIn: 'Вход', orchOut: 'Потяните на блок, чтобы связать', blockStart: 'Старт', orchStartPh: 'Исходные данные для цепочки…', orchRulesPh: 'Правила для подключённых моделей…', orchCtxPh: 'Контекст для этой модели…', orchEmbed: '+ Вшить заметку',
  max: 'Макс',
  usage: 'Лимиты плана', usage5h: 'Окно 5 часов', usage7d: 'Окно недели', resets: 'сброс', desktopOnly: 'Доступно в десктопном приложении.',
  
  projNew: 'Новый проект', projNewDesc: 'Создаст папку в Документы/Taurium', projNewDescWeb: 'Хранится в этом браузере', projOpen: 'Открыть существующую папку…', projOpenDesc: 'Любая папка с заметками .deso',
  projName: 'Название проекта', projRemove: 'Убрать из списка', projRemoveWeb: 'Удалить проект', projBadName: 'Простое имя: без слэшей и спецсимволов.', projEmpty: 'Проектов пока нет.',
  projFilesStay: 'Файлы остаются на диске.', cancel: 'Отмена', delete: 'Удалить', deleteTitle: 'Удалить заметку',
  noteName: 'имя-заметки', noteBad: 'Только a-z, 0-9, - и _.', noteExists: 'Заметка с таким именем уже есть.', noteCreate: 'Создать',
  emptyTitle: 'Здесь пока пусто', emptySub: 'Создайте первую заметку, чтобы начать граф.', createFirst: 'Создать первую заметку',
  selectFamily: 'Выделить заметку и связи', onlyFamily: 'Показать только семейство', hideFamily: 'Скрыть связанные', hideNote: 'Скрыть заметку',
  onlySelected: 'Показать только выделенные ({n})', hideSelected: 'Скрыть выделенные ({n})', clearSel: 'Снять выделение', showAll: 'Показать все (скрыто: {n})',
  legendOut: 'ссылается на', legendIn: 'ссылаются сюда', ctrlHint: 'Ctrl+клик — выделить · тянуть — двигать', selected: 'выделено', fitView: 'Вписать в экран',
  markColor: 'Цветная метка', clearMark: 'Убрать метку', legendHint: 'Наведите на заметку: каждый сосед и его связь окрашены одним цветом. Стрелка указывает на заметку, на которую ссылаются.',
  project: 'Проект', theme: 'Тема', steel: 'Сталь', dark: 'Тёмная', light: 'Светлая', you: 'Вы', tokSaved: 'экономия', notesTok: '{n} заметок · {k} токенов',
  focusZoom: 'Приблизить семейство',
  savedCol: 'Экономия', tiSaved: 'токенов сэкономлено', tiEstimate: 'Подсчёт токенов — эвристическая оценка, а не точный токенизатор модели.', tiConstruct: 'Конструкция',
}

export type Key = keyof typeof en
const dict = { en, ru }

const read = <T extends string>(k: string, ok: T[], d: T) => { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d }
let state = { lang: read<Lang>('deso_lang', ['en', 'ru'], 'en'), smooth: localStorage.getItem('deso_smooth') !== '0' }
const subs = new Set<() => void>()
const apply = () => { document.documentElement.dataset.motion = state.smooth ? 'on' : 'off'; document.documentElement.lang = state.lang }
apply()

const set = (p: Partial<typeof state>) => {
  state = { ...state, ...p }
  localStorage.setItem('deso_lang', state.lang); localStorage.setItem('deso_smooth', state.smooth ? '1' : '0')
  apply(); subs.forEach((f) => f())
}
export const isSmooth = () => state.smooth

export function useI18n() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)
  const t = (k: Key, v?: Record<string, string | number>) =>
    dict[s.lang][k].replace(/\{(\w+)\}/g, (_, x) => String(v?.[x] ?? ''))
  return { t, lang: s.lang, smooth: s.smooth, setLang: (lang: Lang) => set({ lang }), setSmooth: (smooth: boolean) => set({ smooth }) }
}
