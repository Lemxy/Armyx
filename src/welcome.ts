// The first note of every new project: a short guide to building the graph/map and working with it.
// Written in the app's own note format; "@" + a non-latin word is deliberately not a link, so the guide creates no phantom edges.
const ru = `# welcome
?type: guide
?about: Как строить граф и карту проекта и работать с ними
#guide

## 1. Граф — это заметки и связи
Каждая заметка — узел графа. Связь — это знак @ и имя другой заметки прямо в тексте (стрелка ->@ делает её явной исходящей).
Новая заметка: кнопка «+» в боковой панели. Имя — латиница, цифры, - и _.
Вкладка «Граф» рисует все заметки и связи; правая кнопка по узлу — открыть, скопировать ссылку, цвет, удалить.

## 2. Что писать в заметке
\`?path:\` путь к файлу или раздел — попадёт в карту
\`?about:\` одна строка, что это и зачем
\`?exports: login, logout\` — главное, что отдаёт модуль
\`!ключ значение\` — таблица данных
\`+ сделано / - не сделано\` — чек-лист (знак сразу перед текстом, без пробела)
\`#тег\` — теги для поиска

## 3. Карта — то, что видит агент
Карта — компактный индекс всего графа: одна строка на заметку (путь — о чём — главное — связи). Она занимает несколько тысяч токенов вместо всего проекта.
Самые связанные заметки идут первыми, остальные сворачиваются в счётчик. Карта обновляется сама при любом изменении заметок.
Агент в правой панели всегда видит карту и просит конкретный файл, когда нужно содержимое.

## 4. Проект с кодом
Откройте папку с кодом как проект: файлы станут заметками, импорты — связями, а заметка project-map даст обзор. Ваши заметки сохраняются при повторном сканировании (кнопка обновления внизу боковой панели).

## 5. Оркестр
Вкладка «Оркестр»: правая кнопка по холсту добавляет модели (Claude или Antigravity) и блок правил. Потяните за точку справа у блока и отпустите над другим, чтобы связать.
Блок «Старт» — ведущий: только он получает карту и раздаёт задания агентам A, B, C… по связям. Писать можно ведущему (он снова раздаст задания всем) или отдельному агенту.
Панель справа показывает диалог агентов и кто чем занят; история сохраняется.

Ctrl+J открывает и закрывает чат с агентом.
`

const en = `# welcome
?type: guide
?about: How to build the project graph and map, and work with them
#guide

## 1. The graph is notes and links
Every note is a node. A link is an @ sign plus another note's name right in the text (->@ makes it an explicit outgoing one).
New note: the "+" button in the sidebar. Names use latin letters, digits, - and _.
The Graph tab draws every note and link; right-click a node to open it, copy its link, recolour or delete it.

## 2. What goes in a note
\`?path:\` file path or section, shown in the map
\`?about:\` one line on what it is and why
\`?exports: login, logout\` — the main things the module offers
\`!key value\` — a data table
\`+ done / - not done\` — a checklist (the sign sits right before the text, no space)
\`#tag\` — tags for search

## 3. The map is what the agent sees
The map is a compact index of the whole graph: one line per note (path — about — exports — links). It costs a few thousand tokens instead of the whole project.
The most connected notes go first, the rest collapse into a count. The map rebuilds itself whenever notes change.
The agent in the right panel always sees the map and asks for a specific file when it needs the contents.

## 4. A project with code
Open a code folder as a project: files become notes, imports become links, and a project-map note gives the overview. Your own notes survive a rescan (the refresh button at the bottom of the sidebar).

## 5. Orchestra
The Orchestra tab: right-click the canvas to add models (Claude or Antigravity) and a rules block. Drag from the dot on the right of a block and release over another one to link them.
The Start block is the lead: only it gets the map and briefs agents A, B, C… along the links. You can write to the lead (it briefs everyone again) or to a single agent.
The right panel shows the agents' dialogue and who is doing what; the history is saved.

Ctrl+J opens and closes the agent chat.
`

/** The guide in the language the app is set to. */
export const welcomeNote = () => ({ name: 'welcome', content: localStorage.getItem('deso_lang') === 'ru' ? ru : en })
