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
  max: 'Max',
  
  projNew: 'New project', projNewDesc: 'Creates a folder in Documents/DesoVault', projNewDescWeb: 'Stored in this browser', projOpen: 'Open existing folder…', projOpenDesc: 'Any folder with .deso notes',
  projName: 'Project name', projRemove: 'Remove from list', projRemoveWeb: 'Delete project', projBadName: 'Use a plain name: no slashes or special characters.', projEmpty: 'No projects yet.',
  projFilesStay: 'Files stay on disk.', cancel: 'Cancel', delete: 'Delete', deleteTitle: 'Delete note',
  noteName: 'note-name', noteBad: 'Use a-z, 0-9, - and _ only.', noteExists: 'A note with this name already exists.', noteCreate: 'Create',
  emptyTitle: 'Nothing here yet', emptySub: 'Create your first note to start the graph.', createFirst: 'Create first note',
  selectFamily: 'Select note + linked', onlyFamily: 'Show only this family', hideFamily: 'Hide linked notes', hideNote: 'Hide note',
  onlySelected: 'Show only selected ({n})', hideSelected: 'Hide selected ({n})', clearSel: 'Clear selection', showAll: 'Show all ({n} hidden)',
  legendOut: 'links to', legendIn: 'linked from', ctrlHint: 'Ctrl+click — select · drag — move', selected: 'selected', fitView: 'Fit to screen',
  markColor: 'Colour mark', clearMark: 'Remove mark', legendHint: 'Hover a note: each neighbour and its link share a colour. Arrow points to the linked note.',
  project: 'Project', theme: 'Theme', dark: 'Dark', light: 'Light', you: 'You', tokSaved: 'saved', notesTok: '{n} notes · {k} tokens',
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
  max: 'Макс',
  
  projNew: 'Новый проект', projNewDesc: 'Создаст папку в Документы/DesoVault', projNewDescWeb: 'Хранится в этом браузере', projOpen: 'Открыть существующую папку…', projOpenDesc: 'Любая папка с заметками .deso',
  projName: 'Название проекта', projRemove: 'Убрать из списка', projRemoveWeb: 'Удалить проект', projBadName: 'Простое имя: без слэшей и спецсимволов.', projEmpty: 'Проектов пока нет.',
  projFilesStay: 'Файлы остаются на диске.', cancel: 'Отмена', delete: 'Удалить', deleteTitle: 'Удалить заметку',
  noteName: 'имя-заметки', noteBad: 'Только a-z, 0-9, - и _.', noteExists: 'Заметка с таким именем уже есть.', noteCreate: 'Создать',
  emptyTitle: 'Здесь пока пусто', emptySub: 'Создайте первую заметку, чтобы начать граф.', createFirst: 'Создать первую заметку',
  selectFamily: 'Выделить заметку и связи', onlyFamily: 'Показать только семейство', hideFamily: 'Скрыть связанные', hideNote: 'Скрыть заметку',
  onlySelected: 'Показать только выделенные ({n})', hideSelected: 'Скрыть выделенные ({n})', clearSel: 'Снять выделение', showAll: 'Показать все (скрыто: {n})',
  legendOut: 'ссылается на', legendIn: 'ссылаются сюда', ctrlHint: 'Ctrl+клик — выделить · тянуть — двигать', selected: 'выделено', fitView: 'Вписать в экран',
  markColor: 'Цветная метка', clearMark: 'Убрать метку', legendHint: 'Наведите на заметку: каждый сосед и его связь окрашены одним цветом. Стрелка указывает на заметку, на которую ссылаются.',
  project: 'Проект', theme: 'Тема', dark: 'Тёмная', light: 'Светлая', you: 'Вы', tokSaved: 'экономия', notesTok: '{n} заметок · {k} токенов',
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
