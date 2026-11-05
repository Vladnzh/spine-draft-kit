# План: командний сервер Spine Draft Kit

Статус: етапи 1 і 2 реалізовано (2026-11-05, не закомічено), етапи 3–4 — ні. Що вже є — розділ 16.

Мета: розгорнути кит на корпоративному сервері. Кожен підключається через MCP, робить драфти й компоненти. Усе зберігається на сервері, усі бачать зміни наживо, а історію видно, як у Фігмі. Безпечно і просто.

## 0. Для сесії, яка виконує план

- Папка кита: `/Users/vladnzh/Documents/Lucky/TwinWin/workshop/spine-draft-kit/`. Спершу прочитай цей план повністю, потім `README.md`, `server/bridge.mjs`, `mcp.mjs`, `src/link.js`, `src/store.js`, а в `src/ui.js` — місця з розділу 1.
- Працюй етапами (розділ 12). Після кожного етапу коротко звітуй користувачу українською: що зроблено, як перевірити самому, що не перевірено. Наступний етап починай лише після «так», «давай» чи «роби». «Хай буде» означає «не чіпай» — перепитай.
- Правила коду користувача:
  - жодних npm-залежностей, лише Node ≥ 22: `node:http`, `node:crypto`, `node:fs`, `node:zlib`, `node:child_process`, глобальні `fetch` і `WebSocket`;
  - без нових пояснювальних коментарів у коді (пояснення — у чат або в `docs/`);
  - `async`/`await`, без нових ланцюжків `.then()`;
  - текст інтерфейсу українською й коротко; тема «Графіт», пласко (без тіней і світіння), кожен `<select>` обгортається `dropdown()`.
- Інші сесії можуть паралельно правити `src/`. Існуючі файли міняй лише точковими правками (exact-match), перечитуй місце перед правкою, ніколи не переписуй існуючий файл цілком. Новий код пиши в нових файлах (`server/*.mjs`, `src/sync.js`, `src/patch.js`).
- Не чіпай робочий кит користувача: сервер на `:5180`, папку `projects/`, його браузер. Не викликай MCP-інструмент `open_kit`, бо він відкриває браузер користувача. Порт `9361` займає `check/check-browser.mjs`. Для тестів бери окремі порти (наприклад 5197 і Chrome 9397) та окремі папки даних у scratchpad.
- Не публікуй артефакт і не комітить без прохання користувача; наприкінці етапу спитай, чи комітити. У репо багато незакомічених змін (`src/layouts.js`, історія, експорт…), тож окремий git worktree стартував би зі старого коду. Працюй у цій папці.
- Велику роботу (OAuth, рушій, інтерфейс історії) можна віддавати фоновим субагентам з повним брифом: абсолютні шляхи, факти, обмеження, формат звіту. Результат перевіряй сам.
- Пастки:
  - у `ui.js` `art(key)` — це геттер картинок; не створюй змінну `art` на рівні модуля (так усі проекти вже відкривались порожніми);
  - логіку спіну (`src/spin.js`) не чіпай: вона мусить поводитись точно як Pandora.

## 1. Як влаштовано зараз і чому це не перемикач

- **Рушій — відкрита вкладка.** MCP-інструменти реалізовані в `src/link.js` (`TOOLS`) і працюють зі станом сторінки (`App.state`). Stdio-сервер `mcp.mjs` лише передає виклик через `server/bridge.mjs` одній сторінці по SSE (`/api/bridge/page`, подія `call`, відповідь на `/api/bridge/result`). Нова вкладка витісняє стару (подія `replaced`).
- **Тільки цей компʼютер.** `bridge.mjs` пускає лише loopback із `Host: localhost:<port>` (`allowed()`).
- **Сховище — браузер.** `src/store.js` — це IndexedDB з методами `list/get/put/remove/persistent`; у `ui.js` воно підключається як `var Store = window.SpineKitStore;` (рядок 4). Папка `projects/<slug>--<id>/` на диску — лише копія (`Link.backup`), без історії.
- **Збереження.** Будь-яка правка викликає `changed(opts)`, а той запускає:
  - `scheduleSave()`: через 400 мс `saveNow()` робить `Store.put(rec)` і `Link.backup(rec)`, через 1,2 с — запис в історію;
  - `renderComponents()`;
  - `rebuild()` через 140 мс.

  `flush()` = `saveNow()` при автозбереженні. `commit()` у `link.js` викликає `App.flush()`.
- **Історія локальна.** Лежить у `rec.history` того самого запису IndexedDB: записи `{id, t, scope: 'drafts'|'layouts', label, snap}`, до 50 на scope. Назви записів дають `draftDiff`/`layDiff` через `histDiff`, відкат — `histRestore` → `histApply`, ⌘Z/⇧⌘Z — `histStep`. Авторів немає.
- **Картинки.** `state.blobs[key]` — Blob, `state.images[key]` — `{canvas, w, h, fileName, win?}`. Ставить `setImage(key, blob, fileName)`, прибирає `forgetImage(key)`. Ключі: `sym:<name>`, `blur:<name>`, `c:<compId>`, `p:<compId>:<part>`, `frame_under`, `frame_above`.
- **Проекти.** `openProject(id)`, `createProject(settings, images)`, `removeProject(id)`, `duplicateProject()`, `exportProject()`, `importFile(f)`. `projectMeta(rec)` читає `rec.settings.game/reels/rows/components[].on`. `init()` відкриває останній проект із `localStorage`, а при першому запуску без проектів створює example-slot.
- **MCP читає диск.** `mcp.mjs` сам читає картинки, лейаути й `.component.json`, заливає їх у bridge як блоби (`PUT /api/bridge/blobs`) і пише zip на диск. Сторінка бере блоби з `/api/bridge/blobs/<id>` (`link.js`).
- **CDN.** У `ui.js` `SPINE_URL` (spine-player 4.1.55 з jsdelivr) і `ZIP_URL` (JSZip 3.10.1 з cdnjs).
- **Збірка.** `build.mjs` вставляє `src/*.js` у `src/page.html` за токенами `/*@CORE@*/` … `/*@UI@*/` і пише два файли: `dist/spine-draft-kit.html` (артефакт) і `Spine-Draft-Kit.html` (окремий файл, його ж віддає `dev.mjs`).

## 2. Що має вийти

- Кит живе на `https://<домен>` у внутрішній мережі, вхід — корпоративним акаунтом (SSO).
- Усі проекти, картинки й історія зберігаються на сервері; браузер лише показує проект.
- Кілька людей і кілька Claude працюють в одному проекті одночасно. Правки полів видно всім за ≤ 1 с, і видно, хто зараз у проекті.
- Історія як у Фігмі:
  - хто зробив зміну (людина чи «Claude · <людина>»), коли і що саме;
  - іменовані версії, перегляд, відкат без втрат, копія з версії;
  - ⌘Z скасовує лише твої зміни.
- Claude Code підключається однією командою й входить через той самий SSO. Він працює, навіть коли в людини кит не відкритий.
- Локальний режим працює як раніше: `npm run dev`, Connect, stdio `mcp.mjs`, `Spine-Draft-Kit.html`, артефакт.

## 3. Архітектура

```
 Браузери людей ─── HTTPS: сторінка, /api, SSE ───┐
 Claude Code (у кожного) ─── HTTPS /mcp + OAuth ──┤
                                                  ▼
                 serve.mjs (Node ≥ 22, без залежностей)
                 ├─ auth      вхід OIDC, сесії, ролі
                 ├─ oauth     сервер авторизації для MCP, персональні токени
                 ├─ mcp-http  MCP-сесії та інструменти
                 ├─ hub       версії, патчі, SSE, присутність, історія
                 ├─ data      DATA_DIR: проекти, картинки за sha256, знімки
                 └─ engine    headless Chromium (pipe) ─► 127.0.0.1:ENGINE_PORT
                              вкладка на проект = та сама сторінка кита в режимі рушія
```

| Новий файл | Що робить |
|---|---|
| `serve.mjs` | точка входу серверного режиму: `npm start`; `node serve.mjs --dev` для локальних тестів; `node serve.mjs import <шлях>` для перенесення проектів |
| `server/http.mjs` | маршрути, ліміти тіла, заголовки безпеки, CSP, віддача сторінки й `/vendor` |
| `server/data.mjs` | сховище в `DATA_DIR`: проекти, картинки за sha256, історія, знімки |
| `server/hub.mjs` | живе редагування: версії, патчі, SSE, присутність, групування історії, відкат |
| `server/auth.mjs` | вхід OIDC, сесії, ролі |
| `server/oauth.mjs` | сервер авторизації для MCP (OAuth 2.1) і персональні токени |
| `server/mcp-http.mjs` | MCP через Streamable HTTP |
| `server/tools.mjs` | спільні описи інструментів для stdio й HTTP |
| `server/engine.mjs` | headless Chromium, вкладка-рушій на кожен проект |
| `server/files.mjs` | одноразові посилання для завантаження й вивантаження, перевірка файлів |
| `server/log.mjs` | JSON-логи й аудит |
| `src/patch.js` | diff, apply й invert патчів; UMD, як `core.js`, тож працює і в браузері, і в Node |
| `src/sync.js` | клієнт серверного режиму: серверний Store, живі зміни, присутність, історія, ⌘Z, Connect |
| `vendor.mjs` | завантажує spine-player і JSZip у `vendor/` з перевіркою sha256 |
| `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `docs/deploy.md` | розгортання |
| `check/check-patch.mjs`, `check/check-server.mjs`, `check/mock-oidc.mjs`, `check/check-mcp-http.mjs` | перевірки |

`package.json`: додати `"start": "node serve.mjs"`, `"serve:dev": "node serve.mjs --dev"`, `"vendor": "node vendor.mjs"`. `.gitignore`: додати `server-data/` і `vendor/`.

**Як сторінка дізнається, що вона на сервері.** Віддаючи сторінку, `serve.mjs` вставляє одразу після `<meta charset="utf-8">` тег `<meta name="spine-kit-mode" content="server">` (у рушії — `content="engine"`, у перегляді версії — `content="view"`). Новий токен `/*@SYNC@*/` стоїть після `/*@STORE@*/` у `page.html` і `build.mjs`. `src/sync.js` синхронно читає meta і, якщо вона є, підміняє `window.SpineKitStore` серверним сховищем ще до того, як `ui.js` виконає `var Store = window.SpineKitStore`. Без meta (dev, артефакт, окремий файл, `file://`) `sync.js` нічого не робить.

## 4. Дані на сервері

```
DATA_DIR/
  .lock                            pid сервера
  projects/<id>/doc.json           поточний стан
  projects/<id>/history.jsonl      записи історії, по одному в рядку
  projects/<id>/snaps/<v>.json.gz  знімок стану на версії v (для кожного закритого запису)
  blobs/<sha[0..1]>/<sha256>       байти картинок і файлів (за вмістом, без дублікатів)
  auth/sessions.json, auth/clients.json, auth/tokens.json   лише хеші
  users.json                       {email, name, role, first, last}
  audit.jsonl                      вхід і вихід, токени, видалення, відновлення, відкати
```

- `doc.json`: `{ kit: 'spine-draft-kit/server@1', id, v, created, createdBy, updated, updatedBy, deleted?: {t, by}, settings, images: { <key>: { sha, name, type, w, h } } }`.
  - `settings` — рівно те, що зараз `state.s`. Сервер його не розуміє й не валідує, лише зберігає; нормалізує сторінка через `normalize()`.
- id проекту — як зараз (`newId()` з `ui.js`). Папка без slug, тож перейменування не чіпає диск.
- Файли пишуться атомарно (tmp + rename), не частіше разу на 500 мс на проект, і скидаються на SIGTERM. Усі зміни одного проекту йдуть через одну чергу (ланцюжок промісів).
- Видалення мʼяке (`deleted`): адмін бачить «Кошик» і відновлює. Фізичне видалення й прибирання непотрібних блобів — пізніше.
- `node serve.mjs import <папка projects/ | файл .spine-kit.json>` створює серверні проекти; історія починається записом «Імпорт». Поки сервер працює, `import` відмовляється (`DATA_DIR/.lock`). Тестуй на копії `projects/`.

## 5. Живе редагування

### 5.1 Патчі (`src/patch.js`)

- Документ має вигляд `{ settings, images }`.
- Шлях — масив сегментів: рядок (ключ обʼєкта) або `{id: …}` / `{name: …}` (елемент масиву за ключем).
- Масив вважається «з ключами», якщо всі елементи — обʼєкти з унікальним непорожнім `id`, а якщо ні — з унікальним `name`. Інакше масив атомарний і міняється цілком. На практиці:
  - `components` — за `id`;
  - `symbols`, `anims`, `parts`, `layouts.list`, `bones` — за `name`;
  - масиви ключових кадрів у `keys` — атомарні.
- Операції:
  - `{p, v}` записує значення (ключ обʼєкта або елемент масиву). Якщо елемента немає, він вставляється після `after` — ключа попереднього елемента; `null` означає «на початок». Якщо такого ключа немає — у кінець.
  - `{p, d: 1}` видаляє ключ або елемент.
  - `{p, o: [ключі]}` задає порядок масиву з ключами: перелічені йдуть у цьому порядку, решта — після них у поточному порядку.
- `diff(a, b)` повертає операції:
  - обʼєкти порівнюються по ключах;
  - масиви з ключами — теж по ключах: видалення, вставки з `after`, рекурсія у спільні елементи і один `o`, якщо змінився порядок;
  - решта — за значенням (через `JSON.stringify`);
  - якщо масив змінив вид (з ключами ↔ атомарний), записується цілком.
- `apply(doc, ops)` застосовує операції по черзі. Операція, чий батьківський шлях уже зник (хтось видалив), пропускається. Функція повертає реально застосовані операції.
- `invert(doc, ops)` повертає обернені операції для ⌘Z: попереднє значення, видалення, вставку з `after` або попередній порядок.
- `get(doc, path)` — значення за шляхом.
- Конфлікти вирішуються як у Фігмі: сервер ставить зміни в одну чергу; на одному полі перемагає пізніша, різні поля одне одному не заважають.

### 5.2 Протокол

- `POST /api/projects/:id/ops` з тілом `{client, seq, ops, parts?}`:
  - сервер валідує: корінь шляху лише `settings` чи `images`; кожен `images.*` має вигляд `{sha: 64 hex, name ≤ 200, type png|jpeg|webp, w, h}`, і блоб уже є; тіло ≤ 2 МБ, ≤ 2000 операцій, документ ≤ 20 МБ;
  - далі застосовує операції, робить `v += 1`, зберігає, додає в історію і розсилає;
  - повтор того самого `(client, seq)` удруге не застосовується;
  - відповідь — `{v}`.
- `GET /api/events?project=<id>&since=<v>` — SSE з кукою сесії:
  - події: `hello {v, me, presence}`; `ops {v, by, client, seq, ops, t}` (лише реально застосовані операції); `presence {list}`; `history {entry}`; `projects {list}` (зміни списку, для всіх); `deleted`;
  - `: ping` кожні 20 с, заголовок `X-Accel-Buffering: no`;
  - сервер тримає останні ~500 пачок на проект. За `since` він досилає пропущене з буфера, а якщо його там уже немає, клієнт перечитує документ.
- `HEAD`/`GET`/`PUT /api/blobs/:sha` — картинки за вмістом:
  - `PUT` перевіряє, що sha збігається з байтами, і визначає тип за magic bytes;
  - `GET` віддає з `Cache-Control: private, max-age=31536000, immutable` і `X-Content-Type-Options: nosniff`.
- `GET /api/projects` повертає для кожного проекту `{id, created, updated, updatedBy, settings: {game, reels, rows, components: [{on}]}}` — рівно те, що читає `projectMeta`. `POST /api/projects` створює проект `{settings, images}`. `GET /api/projects/:id` віддає документ, `DELETE` видаляє мʼяко.

### 5.3 Клієнт (`src/sync.js`)

- **Стан.** `confirmed` — документ на останній версії сервера, `pending` — мої пачки без підтвердження, `shadow` = `confirmed` + `pending`.
- **Збереження** (серверний `Store.put(rec)`):
  1. документ збирається з `rec.settings` і `rec.images`: sha кожного Blob рахує `crypto.subtle.digest` (кеш у `WeakMap`), назви й розміри беруться з `App.state.images`;
  2. `ops = diff(shadow, doc)`; якщо змін немає, нічого не відправляється;
  3. відсутні блоби заливаються, пачка відправляється, `shadow = doc`.

  Проміс `put` завершується після підтвердження сервером, тому `commit()` у `link.js` чекає, поки зміну отримають усі.
- **Нормалізація не відправляється.** Після `openProject` і `applyRemote` `shadow` береться з уже нормалізованого стану, інакше кожен глядач писав би в історію «Зміни».
- **Чужа пачка.**
  1. Спершу відправити свої ще не надіслані правки.
  2. `confirmed = apply(confirmed, ops)`.
  3. `shadow = apply(clone(confirmed), pending)`.
  4. Якщо стан змінився — викликати `App.applyRemote(...)`, а потім знову взяти `shadow` з нормалізованого стану.
- **Своя пачка** (той самий `client` і `seq`): `confirmed = apply(confirmed, ops)`, прибрати її з `pending`, перерахувати `shadow`.
- **Пропущена версія** (`v` > останньої + 1): перечитати документ, `confirmed = doc`, `shadow = apply(clone(doc), pending)`, викликати `applyRemote`.
- **Немає звʼязку.** Показати банер «Немає звʼязку з сервером — зміни зачекають». Пачки лишаються в `pending` і йдуть після відновлення. `beforeunload` питає лише тоді, коли `pending` не порожній.
- **401.** Показати банер «Сесія завершилась» з кнопкою «Увійти» (`/auth/login?next=…` у новій вкладці); `pending` при цьому не губиться.
- **⌘Z / ⇧⌘Z** у серверному режимі замість `histStep`:
  - працюють зі стеком моїх пачок: для кожної операції зберігаються значення, яке я поставив, і обернена операція (`invert`);
  - скасування йде новою пачкою з назвою «Скасовано: …» і чіпає лише ті поля, які після мене ніхто не міняв (`get` дорівнює моєму значенню);
  - стек на 100 кроків, очищається при зміні проекту.
- `scheduleSave` у серверному режимі спрацьовує через 200 мс замість 400.
- Серверний `Store.get(id)` повертає картинки як `File` з назвою. В `openProject` треба передавати `rec.images[k].name` третім аргументом `setImage` (у Blob назви немає, тож локальний режим не зміниться).

### 5.4 Хуки в `ui.js` (точкові правки й нові функції в `App`)

- **`App.applyRemote(settings, images)`:**
  - `state.s = normalize(settings)`;
  - для змінених ключів — `setImage(key, blob, name)` (blob з `/api/blobs/<sha>`, кеш у `sync.js`), для зниклих — `forgetImage(key)`;
  - далі `renderGame()`, `renderComponents()`, `renderProjects()`, а `rebuild()` — через той самий таймер, що й у `changed()` (140 мс);
  - поки йде спін (`App.spinning()`), `rebuild()` відкладається до його кінця, бо інакше чужа правка обірве спін;
  - **без** `scheduleSave` і без локальної історії;
  - якщо людина саме друкує (фокус в `input`/`textarea` усередині `#c-list` чи картки гри, остання клавіша < 1,5 с тому), перемальовування карток відкладається до паузи або `blur`, хоча стан уже оновлений;
  - `renderComponents()` уже повертає фокус за `aria-label` — додати збереження `selectionStart/End`.
- **`App.histParts(scope, a, b)`** повертає масив частин назви з `draftDiff`/`layDiff`, без `slice`/`join`. Знімки мають такі самі форми, як у `histSnap`: `drafts` = `{s: settings без layouts, blobs: {key: sha}}`, `layouts` = `{layouts}`.
- **Прапорець серверного режиму** (`SpineKitSync.mode()`):
  - автозбереження завжди ввімкнене: перемикач і «Зберегти» сховані, ⌘S показує тост «Зберігається автоматично»;
  - `leaveOk()` лише чекає відправки;
  - `scheduleSave` не запускає `histCommit`, локальна `rec.history` не ведеться;
  - панель історії показує серверні записи (розділ 6): `renderHist()` у серверному режимі передає малювання `#hist-dlg` у `sync.js`.
- **Живий список і видалення.** Додати в `App` `setProjects(list)`: `state.projects = list.map(projectMeta)` і `renderProjects()`. Він викликається на подію `projects`. На подію `deleted` для відкритого проекту — тост «Проект видалив <хто>» і `clearProject()`.
- **`init()` у серверному режимі:**
  - на початку викликати `SpineKitSync.start(App)`;
  - проекти брати з сервера; example-slot не створювати, legacy localStorage не мігрувати; без проектів показувати порожній стан;
  - адреса `/p/<id>` відкриває проект; при перемиканні проекту — `history.replaceState` на `/p/<id>`, щоб посиланням можна було поділитися;
  - у режимі рушія відкривати лише проект з адреси, а на `/` — жодного (не останній і не перший зі списку).
- **`link.js`:** у серверному режимі `renderPop()`/`status()` передають малювання діалогу Connect у `SpineKitSync` (розділ 8.2). `Link.restore`/`Link.backup` поза localhost і так нічого не роблять.

### 5.5 Присутність

- Сервер знає, хто тримає SSE на проекті: `{kind: 'human', email, name}`. Сюди ж додаються активні MCP-сесії на цьому проекті (остання дія < 10 хв): `{kind: 'claude', email, name: 'Claude · <імʼя>', busy: 'символи' | null}`. Підписи для `busy` беруться з `LABELS` у `link.js`. Вкладки рушія людьми не показуються.
- У шапці — кружечки з ініціалами: колір від хешу email, до 5 штук + «+N», підказка «Імʼя · email». Claude показується окремим чіпом, який пульсує, поки він працює.

## 6. Історія

- **Групування на сервері.** Запис — це зміни однієї людини (або одного Claude) в одному scope поспіль. Scope = `layouts`, якщо шлях починається з `settings.layouts`, інакше `drafts`. Запис закривається:
  - після 20 с тиші;
  - через 5 хв від початку;
  - коли той самий scope чіпає хтось інший;
  - перед відкатом та іменованою версією.

  Пачка, що чіпає обидва scope, дає два записи, як зараз.
- **Назва.** Разом із пачкою клієнт шле `parts: {drafts: [...], layouts: [...]}` з `App.histParts`; рушій теж, бо це той самий `ui.js`. Сервер обʼєднує частини групи без повторів і показує їх як `histDiff`: перші три через кому + «+N». Без частин — «Зміни».
- **Рядок `history.jsonl`:** `{id, v, t0, t, scope, by: {kind: 'user'|'claude', email, name, client?}, label, named?, restoreOf?}`. Знімок стану на версії `v` лежить у `snaps/<v>.json.gz`. Перший запис — «Створено», «Імпорт» або «Копія з …».
- Зберігається вся історія; іменовані версії не видаляються ніколи. Картинки лежать за вмістом, тому знімки малі.
- **API:**
  - `GET /api/projects/:id/history?scope=&before=` — сторінками по 100;
  - `GET /api/projects/:id/history/:entry` — знімок;
  - `POST /api/projects/:id/restore {entry, scope}` — сервер рахує `diff(поточний scope, scope знімка)` і застосовує як пачку того, хто відкочує, з назвою «Відкат до <час> · <назва>». Нічого не зникає: сам відкат теж лишається в історії;
  - `POST /api/projects/:id/versions {label}` — дати назву поточному стану;
  - `POST /api/projects/:id/copy {entry?}` — новий проект зі знімка.
- **Панель історії** (`#hist-dlg`, жовта кнопка):
  - записи з аватаркою автора, назвою й часом;
  - вкладки «Чернетки | Лейаути», як зараз;
  - дії «Відновити», «Переглянути», «Копія»; угорі «Назвати версію»;
  - іменовані версії виділені.
- **«Переглянути»** відкриває `/p/<id>?v=<entry>` у новій вкладці (meta `view`). Це та сама сторінка зі знімка, лише для читання: сховище нічого не пише, SSE немає. Угорі банер «Версія від … · Відновити · Закрити».

## 7. Вхід і безпека

### 7.1 Вхід (OIDC)

- Підходить будь-який OIDC-провайдер: Google Workspace, Microsoft Entra ID, Okta, Keycloak, GitLab.
  - Конфіг: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (або `OIDC_CLIENT_SECRET_FILE`), `OIDC_SCOPES` (типово `openid email profile`), `OIDC_GROUPS_CLAIM` (типово `groups`).
  - Redirect URI для реєстрації в провайдера: `<PUBLIC_URL>/auth/callback`.
- **Потік:**
  1. Discovery: `/.well-known/openid-configuration`, кеш на 1 год.
  2. `/auth/login?next=`: state, nonce і PKCE S256; verifier зберігається в памʼяті сервера на 10 хв.
  3. Вхід у провайдера.
  4. `/auth/callback`: перевірка state, обмін коду, перевірка ID token:
     - підпис за JWKS через `crypto.createPublicKey({key, format: 'jwk'})` + `crypto.verify`, RS256 і ES256 (`dsaEncoding: 'ieee-p1363'`);
     - `iss`, `aud`, `exp`, `nonce`.
  5. Email береться з `email` або `preferred_username`; якщо `email_verified === false` — відмова.
  6. Доступ: `ALLOWED_EMAIL_DOMAINS` і/або `ALLOWED_GROUPS`.
  7. Сесія і редирект на `next` (лише відносний шлях).
- **Сесія:**
  - id — випадкові 32 байти, на сервері зберігається лише хеш;
  - кука `__Host-kit_sid`: Secure, HttpOnly, SameSite=Lax, Path=/ (у `--dev` — `kit_sid` без Secure);
  - живе до 12 год без дій, але не довше 7 днів;
  - вихід — `POST /auth/logout`; `GET /api/session` повертає `{user, role, csrf, mcpUrl}`.
- Без доступу людина бачить просту сторінку «Немає доступу: <email>» з кнопкою «Вийти».
- `--dev` (`AUTH=dev`): форма «Імʼя + email» без пароля. Вона працює, лише коли сервер слухає loopback; на іншій адресі сервер відмовляється стартувати.

### 7.2 Ролі

- `editor` — усі, хто пройшов вхід: бачать і правлять усі проекти, як спільна команда у Фігмі.
- `admin` — адреси з `ADMIN_EMAILS`: «Кошик» і відновлення, аудит, відкликання чужих токенів.
- Закриті проекти й роль «лише перегляд» — пізніше, якщо користувач попросить.

### 7.3 Захист

- **Хто як входить.** Сторінка й `/api/*` — лише кука сесії. `/mcp` — лише Bearer-токен. `/u/*` і `/d/*` — одноразові посилання. Внутрішній слухач рушія — лише кука рушія.
- **Адреса.** `PUBLIC_URL` — єдина правильна адреса. Запити з іншим `Host` отримують 421 (захист від DNS rebinding); виняток — `/healthz`.
- **CSRF.** Запити з кукою, що щось міняють (усі, крім GET і HEAD), мають мати `Origin` == `PUBLIC_URL` і заголовок `X-Kit-Csrf` з токеном з `/api/session`. CORS не вмикається взагалі.
- **Заголовки:**
  - `Content-Security-Policy: default-src 'self'; script-src 'self' <хеші inline-скриптів>; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` — хеші рахуються при старті з готового HTML;
  - `Strict-Transport-Security`, коли адреса https;
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Без CDN.** `vendor.mjs` качає `@esotericsoftware/spine-player@4.1.55/dist/iife/spine-player.min.js` і JSZip 3.10.1 з тих самих адрес, звіряє зашиті sha256 і кладе файли у `vendor/`. Сервер віддає `/vendor/*`, а в HTML, який віддає, замінює рівно `SPINE_URL` і `ZIP_URL` на `/vendor/...`. Якщо Docker-збірка не має інтернету, файли треба покласти у `vendor/` заздалегідь. Перевірити: у консолі немає порушень CSP і немає жодного запиту на зовнішні хости.
- **Файли:**
  - картинки — лише PNG, JPEG і WebP за magic bytes (SVG і GIF — ні);
  - картинка ≤ `MAX_IMAGE_MB` (типово 64) і ≤ 8192×8192; розмір читається із заголовка, як `imageSize()` у `mcp.mjs`;
  - JSON лейаутів ≤ 32 МБ, `.component.json` ≤ 200 МБ; обидва перевіряються парсингом.
- **XSS між колегами.** Перевірити всі місця з `innerHTML`/`insertAdjacentHTML` у `src/` (зараз ~16): туди мають потрапляти лише сталі іконки, а не дані проекту. Назви, підписи й імена людей показувати тільки через `textContent` і атрибути.
- **Ліміти частоти** (у памʼяті), при перевищенні — 429:
  - правки — 30/с, пачки до 120;
  - MCP — 10/с;
  - `/auth/*` — 10/хв з IP;
  - реєстрація MCP-клієнтів — 10/год з IP;
  - завантаження — 300 файлів за 10 хв на людину.
- **Логи** — JSON у stdout: час, id запиту, користувач, маршрут, статус, мс. Ніколи не логувати куки, токени, коди й одноразові посилання (шляхи `/u/…` і `/d/…` пишуться без хвоста).
- **Аудит:** вхід, вихід і відмова; видача й відкликання токенів; створення, видалення й відновлення проектів; відкати.
- **Секрети** — лише з env або файлів `*_FILE`. Токени й сесії зберігаються тільки як хеші SHA-256.

## 8. MCP по мережі

### 8.1 Транспорт

- `POST /mcp` — Streamable HTTP, версії протоколу `2025-11-25`, `2025-06-18`, `2025-03-26`.
  - `initialize` створює сесію й повертає `Mcp-Session-Id`; невідома сесія отримує 404, і клієнт перепідключається;
  - `notifications/*` отримують 202 без тіла; `GET /mcp` — 405; `DELETE /mcp` закриває сесію;
  - заголовок `MCP-Protocol-Version` приймається; якщо його немає, береться `2025-03-26`.
- MCP-сесії живуть у памʼяті. Після перезапуску сервера клієнт перепідключається, а проект треба відкрити знову — `kit_status` про це скаже.
- Сесія привʼязана до власника токена: той самий `Mcp-Session-Id` з чужим токеном отримує 404.
- `Origin`, якщо він є, має дорівнювати `PUBLIC_URL` (вимога специфікації проти DNS rebinding). CLI-клієнти `Origin` не шлють.
- `tools/call` відповідає `text/event-stream`: коментар-пінг кожні 15 с, потім одна подія з відповіддю. Так довгі виклики (експорт до 5 хв) не рвуться на проксі. Решта методів відповідає `application/json`.
- Без `Authorization: Bearer` або з поганим токеном — 401 і `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource"`; для простроченого ще `error="invalid_token"`. Токени в query не приймаються.

### 8.2 Авторизація для Claude Code (OAuth 2.1, кит сам видає токени)

- **`GET /.well-known/oauth-protected-resource`** і `/.well-known/oauth-protected-resource/mcp` (RFC 9728): `{resource: '<PUBLIC_URL>/mcp', authorization_servers: ['<PUBLIC_URL>'], bearer_methods_supported: ['header'], scopes_supported: ['kit']}`.
- **`GET /.well-known/oauth-authorization-server`** (RFC 8414):
  - `issuer`;
  - `authorization_endpoint` `/oauth/authorize`, `token_endpoint` `/oauth/token`, `registration_endpoint` `/oauth/register`, `revocation_endpoint` `/oauth/revoke`;
  - `response_types_supported ['code']`, `grant_types_supported ['authorization_code', 'refresh_token']`, `code_challenge_methods_supported ['S256']`, `token_endpoint_auth_methods_supported ['none']`, `scopes_supported ['kit']`.

  Client ID Metadata Documents не оголошуються: сервер у внутрішній мережі не повинен ходити по чужих URL. Тому клієнт реєструється через DCR.
- **`POST /oauth/register`** (RFC 7591): лише публічні клієнти. Дозволені redirect_uris — тільки loopback (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`) і `OAUTH_EXTRA_REDIRECTS`. Клієнт, яким не користувались 30 днів, видаляється.
- **`GET /oauth/authorize`:**
  - перевіряє клієнта й redirect_uri (для loopback порт може відрізнятися, RFC 8252 §7.3), лише `S256`, а `resource` (якщо є) має дорівнювати `<PUBLIC_URL>/mcp`;
  - якщо сесії немає — вхід через SSO і повернення назад;
  - сторінка згоди: «<client_name> хоче працювати зі Spine Draft Kit від імені <email>. Дозволити · Скасувати» (CSRF-токен у формі, `frame-ancestors 'none'`);
  - код одноразовий, живе 60 с і привʼязаний до клієнта, redirect_uri, challenge, resource і людини; редирект іде з `code`, `state`, `iss`;
  - повторне використання коду відкликає все, що з нього видано.
- **`POST /oauth/token`:**
  - `authorization_code` з перевіркою PKCE (`base64url(sha256(verifier)) == challenge`);
  - `access_token` непрозорий, живе 1 год;
  - `refresh_token` живе 30 днів і міняється при кожному оновленні; повтор старого відкликає всю родину токенів.
- **`POST /oauth/revoke`.**
- **Персональний токен** — запасний шлях і для скриптів. Створюється в киті, показується один раз, діє 90 днів, відкликається, працює лише для `/mcp`. Підключення: `claude mcp add --transport http spine-kit <PUBLIC_URL>/mcp --header "Authorization: Bearer <токен>"`.
- **Діалог Connect** у серверному режимі:
  - команда `claude mcp add --transport http spine-kit <PUBLIC_URL>/mcp` з кнопкою «Копіювати»;
  - рядок «Далі в Claude Code: /mcp → spine-kit → Authenticate»;
  - список підключених клієнтів (назва, коли підключено, остання дія) з кнопкою «Відключити»;
  - «Персональний токен».

### 8.3 Інструменти

- Описи інструментів виносяться з `mcp.mjs` у `server/tools.mjs`, а `mcp.mjs` їх імпортує. Перевірка: відповідь `tools/list` stdio-сервера до і після байт у байт однакова.
- HTTP-набір = stdio-набір з такими змінами:
  - `open_kit` і `scan_art` прибрані: сервер не бачить диска людини.
  - `kit_status` обробляє сервер: хто я, поточний проект сесії, його адреса `/p/<id>`, хто зараз у проекті.
  - **Новий `upload_files {files: [{name}]}`** повертає `{files: [{name, ref: 'upload:<id>', url}], expires_in: 900, curl: "curl -fsS -T '<локальний шлях>' '<url>'"}`. Посилання `/u/<токен>`: одноразове, лише PUT, діє 15 хв, привʼязане до людини, з лімітами з розділу 7.3. Після заливки `ref` діє годину для тієї ж людини.
  - Усі поля картинок (`image`, `blur_image`, `parts[].image`) приймають `upload:<id>`. `import_layouts {refs}` і `import_component {ref}` приймають ref замість шляхів. Сервер збирає з ref ті самі обʼєкти, які зараз готує `mcp.mjs` (`{blob, name, path}`, а для лейаутів `files: [{name, path, text}]`), і віддає блоби рушію через `/api/bridge/blobs/<id>`. Тож `link.js` тут не міняється.
  - `export_drafts` і `export_component` повертають `{name, bytes, spines, layouts, download: url, expires_in: 900, curl: "curl -fsS -o '<папка>/<name>' '<url>'"}`. Посилання `/d/<токен>`: лише GET, діє 15 хв.
  - `list_projects` обробляє сервер; поле `open` позначає поточний проект цієї MCP-сесії.
  - `open_project` і `create_project` змінюють лише поточний проект сесії й ніколи не перемикають проект у людей.
  - Нові інструменти: `get_history {scope?, limit?}`, `restore_version {entry, scope}`, `save_version {label}`.
- `instructions` для HTTP — як у stdio, плюс текст: «Арт лежить на диску людини: подивись папку своїми інструментами (find, `file`/`sips` для розмірів). Назви вгадуй так: wild_*, scatter_* / bonus, high_N / h_N, low_N / l_N і карти (A K Q J 10 9), *_blur — блюр; frame / border (above / over / front → frame_above, under / back → frame_under), logo, popup / big_win / mega / epic, bg / background. Потім виклич upload_files, виконай видані curl однією командою і передай ref. Проект можуть одночасно правити інші люди: перед великою зміною скажи, що робитимеш. Кожна твоя зміна записується як «Claude · <людина>» і відкочується в історії».

### 8.4 Хто що зробив

- Кожен виклик несе `{email, name, client}` власника токена. Рушій виконує виклики проекту по одному (черга в `link.js`). Тому сервер записує всі пачки від вкладки-рушія на поточний (або останній) виклик: «Claude · <імʼя>».

## 9. Рушій на сервері

- **Запуск.** `server/engine.mjs` запускає Chromium (`CHROME_PATH`) з `--headless=new --remote-debugging-pipe`: CDP іде через fd 3/4 повідомленнями JSON, розділеними `\0`, без TCP-порту. Прапорці:
  - окремий `--user-data-dir`;
  - з `check/check-browser.mjs`, без яких не працює WebGL: `--use-angle=swiftshader --enable-unsafe-swiftshader`;
  - `--no-first-run --no-default-browser-check --disable-extensions --disable-background-networking --disable-sync --disable-component-update --mute-audio --hide-scrollbars --window-size=1320,940`;
  - `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"`, щоб рушій не ходив нікуди, крім кита.

  Якщо середовище не дає sandbox (немає user namespaces), `--no-sandbox` допустимий лише разом із цим мережевим замком.
- **Окремий внутрішній слухач.** Сторінки рушія ходять на `127.0.0.1:ENGINE_PORT`, який не публікується й не проксується. Перевіряти лише `remoteAddress` на основному порту не можна: проксі може стояти поруч і теж приходити з 127.0.0.1.
  - Цей слухач віддає ту саму сторінку з meta `engine`, `/vendor`, API проектів від імені рушія, `PUT/GET /api/bridge/blobs` (як у `bridge.mjs`) і чергу викликів.
  - Доступ дає кука рушія, яку сервер ставить через CDP `Network.setCookie` перед відкриттям вкладки, тож токенів в URL немає.
- **Вкладки.** На кожен проект — вкладка `/p/<id>`.
  - Для `create_project` відкривається `/` без проекту: вкладка створює проект через `App.createProject` → серверний Store. Сервер бере id з результату (`summary().project.id`) і закріплює вкладку за цим проектом.
  - Рушій — звичайний клієнт синхронізації: чужі правки приходять до нього наживо, тож Claude працює з найсвіжішим станом.
- **`link.js` у режимі рушія:** замість `/api/bridge/page` підключитися до `/api/engine/calls` (SSE з тими самими подіями `call`), результати слати на `/api/engine/result`. Кнопки Connect немає, `leaveOk` нічого не питає.
- **Життя вкладок:**
  - вкладка створюється на перший виклик і закривається після `ENGINE_IDLE_MIN` (10) хв простою;
  - одночасно не більше `ENGINE_MAX_TABS` (6), понад це закривається найстаріша вкладка без викликів;
  - тайм-аути викликів — як у `TOOLS` (90 с, експорт 300 с);
  - кожні 30 с перевірка Chromium (`Browser.getVersion`); якщо він упав — перезапуск і один повтор виклику.
- **Памʼять:** Chromium займає ~300 МБ плюс 100–250 МБ на активну вкладку. Великі картинки живуть у canvas розміром до 4092² — це ~67 МБ кожна. Записати в `docs/deploy.md`.
- **Перегляд, скріншоти, спін** працюють як зараз, у рушії (`shot()`, `flat()` у `link.js`). Картинки повертаються в MCP-відповіді; людям вони не показуються, бо дані не змінюються.

## 10. Інтерфейс у серверному режимі

- Шапка: аватарки присутніх і чіпи Claude; меню акаунта (імʼя, email, «Вийти»).
- Сайдбар: живий список проектів із сервера; під назвою «змінено <час> · <хто>»; для адміна — «Кошик».
- Історія — розділ 6, Connect — розділ 8.2, банери — розділ 5.3.
- Імпорт `.json` і `.component.json`, експорт zip і «В арт-репо» (File System Access у браузері) працюють як зараз. Так само переносяться локальні проекти з браузера: «Експорт» у локальному киті, «Імпорт» на сервері.
- Порожній стан і майстер «+ Новий проект» створюють проект на сервері.

## 11. Розгортання

- **`Dockerfile`:**
  - `node:24-bookworm-slim` (код має працювати й на 22) + `chromium` + `fonts-dejavu-core` (кирилиця на заглушках);
  - під час збірки `node build.mjs && node vendor.mjs`;
  - `USER node`, `ENV DATA_DIR=/data`, `VOLUME /data`, `EXPOSE 8080`, `HEALTHCHECK` на `/healthz`, `CMD ["node", "serve.mjs"]`.
- **`.dockerignore`:** `projects/`, `dist/`, `.idea/`, `check/`, `v2-backup-*`, `server-data/`, `.git`.
- **`docker-compose.example.yml`:** один сервіс, том для `/data`, env із прикладами.
- **Змінні оточення:**

| Змінна | Що | Типово |
|---|---|---|
| `PUBLIC_URL` | зовнішня адреса, `https://spine-kit.<домен>` | обовʼязкова |
| `PORT` | порт | 8080 |
| `DATA_DIR` | папка даних | `/data` |
| `AUTH` | `oidc` або `dev` (лише loopback) | `oidc` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET[_FILE]` | SSO | — |
| `OIDC_SCOPES`, `OIDC_GROUPS_CLAIM` | scopes і claim груп | `openid email profile`, `groups` |
| `ALLOWED_EMAIL_DOMAINS`, `ALLOWED_GROUPS` | хто має доступ | хоч одна обовʼязкова |
| `ADMIN_EMAILS` | адміни | — |
| `TRUST_PROXY` | брати IP з `X-Forwarded-For` | `0` |
| `CHROME_PATH`, `ENGINE_PORT`, `ENGINE_MAX_TABS`, `ENGINE_IDLE_MIN` | рушій | `/usr/bin/chromium`, випадковий, 6, 10 |
| `MAX_IMAGE_MB` | ліміт картинки | 64 |
| `OAUTH_EXTRA_REDIRECTS` | додаткові redirect URI для MCP-клієнтів | — |

- **Проксі** (nginx або ingress):
  - TLS; зберігати `Host`; передавати `X-Forwarded-Proto` і `X-Forwarded-For`;
  - для `/api/events` і `/mcp` — `proxy_buffering off` і `proxy_read_timeout 3600s`;
  - `client_max_body_size 256m`.
- **Kubernetes:** 1 репліка (стан на диску), `strategy: Recreate`, PVC ReadWriteOnce на 10–20 ГБ, readiness і liveness на `/healthz`, ресурси — 1 CPU і 2–4 ГіБ памʼяті.
- **Бекап:** знімок тому або нічний `tar` папки `DATA_DIR` (записи атомарні). Відновлення — повернути папку й перезапустити.
- **Мережа:** доступ лише з внутрішньої мережі або VPN. claude.ai ходить до MCP-серверів із хмари Anthropic, тож сервер у внутрішній мережі йому недоступний; працює Claude Code на компʼютерах команди. Відкривати кит в інтернет не треба.
- **`docs/deploy.md`** (українською, для DevOps і IT): що зареєструвати в SSO (redirect URI, scopes, claim груп), таблиця змінних, налаштування проксі, ресурси, бекап, оновлення, логи, безпека.
- **README:** розділ «Командний сервер» для користувачів: вхід, підключення Claude Code, історія, чим відрізняється від локального режиму.

## 12. Етапи і перевірка

Перевірки роби у scratchpad: окремі порти, окрема `DATA_DIR`, без `:5180`, `projects/` і браузера користувача.

Для ручної перевірки користувачем — порт 5190 і команда `node serve.mjs --dev`. Вона означає `AUTH=dev`, `PORT=5190`, `PUBLIC_URL=http://localhost:5190`, `DATA_DIR=./server-data`, перезбірку й перезавантаження сторінки при зміні `src/` (як у `dev.mjs`).

### Етап 1. Сховище на сервері, живе редагування, історія

1. `src/patch.js` + `check/check-patch.mjs`:
   - ручні кейси: обʼєкти; масиви з ключами (вставка, видалення, порядок, перейменування); атомарні масиви; `images`; `invert`;
   - випадкова перевірка збіжності: 3 клієнти × 200 випадкових правок, сервер застосовує їх у порядку надходження — у кінці всі документи однакові.
2. `server/data.mjs`, `server/hub.mjs`, `server/http.mjs`, `serve.mjs` з `--dev` і `import`.
3. `src/sync.js`, токен `/*@SYNC@*/` у `page.html` і `build.mjs`, хуки в `ui.js` (5.4), присутність (5.5), історія (6), ⌘Z (5.3), банери, адреса `/p/<id>`.
4. `check/check-server.mjs`: headless Chrome, два dev-користувачі у двох browser contexts на одному проекті.

Етап готовий, коли:
- правка будь-якого поля в A зʼявляється в B за ≤ 1 с; одночасні правки різних полів зберігаються обидві; на одному полі обидві вкладки й сервер сходяться до одного значення;
- одночасне додавання, видалення й перестановка компонентів, символів, анімацій, частин і кісток з двох вкладок дає той самий стан, що й на сервері;
- картинка з A зʼявляється в B, а в історії є «Картинка high_1» з автором A;
- записи історії групуються й мають авторів; відкат scope оновлює обидві вкладки; працюють іменована версія, копія з версії й перегляд версії лише для читання;
- ⌘Z в A скасовує лише зміни A і не чіпає поля, які потім змінив B;
- перезавантаження сторінки й перезапуск сервера не гублять ні стану, ні історії;
- якщо вимкнути сервер на 30 с, зʼявляється банер, правки чекають і після запуску доходять — нічого не загублено;
- у вкладці, яку лише відкрили й нічого не правили, не зʼявляється жодного запису історії;
- `import` переносить копію `projects/dice--cmw3e9k1l1` без втрат (усі картинки й лейаути);
- локальний режим працює без змін: `npm run dev` + Connect + stdio MCP, `npm run check`, `check-browser` (на копії й іншому порту), окремий `Spine-Draft-Kit.html` з `file://`.

### Етап 2. Вхід і безпека

1. `server/auth.mjs` (7.1), ролі (7.2), захист (7.3), `vendor.mjs`, `server/log.mjs`.
2. `check/mock-oidc.mjs` — маленький OIDC-провайдер для тестів: discovery, authorize, token, JWKS, RS256.

Етап готовий, коли:
- вхід через mock OIDC працює; чужий домен бачить «Немає доступу»; вихід працює;
- після завершення сесії зʼявляється банер; після нового входу незбережені правки доходять;
- POST без `Origin`, з чужим `Origin` або без `X-Kit-Csrf` отримує 403; чужий `Host` — 421; `--dev` на не-loopback адресі не стартує;
- сторінка працює з CSP: у консолі нуль порушень і нуль запитів на зовнішні хости;
- SVG, підроблений PNG і завелика картинка відхиляються; перевищення частоти дає 429;
- у логах немає кук, токенів, кодів і одноразових посилань;
- у 16 місцях з `innerHTML`/`insertAdjacentHTML` немає даних проекту.

### Етап 3. MCP по мережі й рушій

1. `server/tools.mjs`; stdio `tools/list` лишається без змін.
2. `server/oauth.mjs` і діалог Connect (8.2).
3. `server/mcp-http.mjs` (8.1, 8.3, 8.4) і `server/files.mjs`.
4. `server/engine.mjs` і режим рушія в `link.js` та `sync.js` (розділ 9).
5. `check/check-mcp-http.mjs` — скриптовий MCP-клієнт.

Етап готовий, коли:
- скриптовий клієнт проходить увесь шлях:
  1. запит без токена отримує 401 з `resource_metadata`;
  2. клієнт читає метадані, реєструється через DCR, проходить authorize (вхід через mock OIDC + згода) і отримує token з PKCE;
  3. `initialize` → `tools/list` → `create_project` → `upload_files` + curl → `set_symbols`;
  4. `screenshot` повертає картинку, `spin` працює;
  5. після `export_drafts` curl скачує zip, і він розпаковується;
  6. `get_history` показує «Claude · <імʼя>», `restore_version` працює;
  7. оновлення токена ротує його, а відкликаний токен отримує 401;
- дві MCP-сесії двох людей на одному проекті виконують виклики по черзі з правильними авторами, а людина у вкладці бачить зміни наживо;
- вкладка рушія закривається після простою; убитий Chromium піднімається на наступному виклику; рушій не може відкрити зовнішній URL;
- вручну (це робить користувач):
  1. `claude mcp add --transport http spine-kit http://localhost:5190/mcp`;
  2. у Claude Code `/mcp` → Authenticate (dev-вхід);
  3. запит «створи тестовий проект і додай 3 символи з <папка>».

  Усе видно у вкладці кита, а в історії стоїть «Claude · <імʼя>». Якщо Claude Code не прийме OAuth на http, перевірити з персональним токеном.

### Етап 4. Розгортання

1. `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `docs/deploy.md`, розділ у README.

Етап готовий, коли:
- `docker build` проходить;
- `docker run` з mock OIDC: вхід працює, MCP-шлях з етапу 3 проходить, дані живуть після перезапуску контейнера, healthcheck зелений, процес не root;
- у `docs/deploy.md` записані розмір образу й споживання памʼяті в спокої та з однією вкладкою рушія.

## 13. Що не можна зламати

- `npm run dev` на 5180, Connect, stdio `mcp.mjs` з усіма його інструментами, `projects/` як копію на диску.
- `dist/spine-draft-kit.html` (артефакт: CSP claude.ai, без мережі) і `Spine-Draft-Kit.html` з `file://` — без meta `sync.js` нічого не робить.
- Проекти локального режиму в IndexedDB.
- `src/spin.js`, геометрію й генерацію в `core.js`.
- `npm run check` має проходити.

## 14. Відкриті питання

Відповіді потрібні до етапу 2; поки що діють типові.

- **Який SSO у компанії?** Типово — будь-який OIDC. Якщо іншого немає, GitLab теж є OIDC-провайдером.
- **Хто бачить проекти?** Типово — усі, хто увійшов; видалене потрапляє в «Кошик»; закриті проекти — пізніше.
- **Де стоятиме кит?** Домен, тип хостингу (VM, Docker, Kubernetes) і хто з DevOps та IT цим займеться.
- **Скільки зберігати історії?** Типово — усю.

## 15. Пізніше (не в цьому плані)

- Арт напряму з корпоративного GitLab: читання з арт-репо, експорт як merge request.
- Локальний stdio-компаньйон, що працює із сервером: `scan_art` і локальні шляхи без curl.
- Закриті проекти з учасниками, роль «лише перегляд», коментарі, курсори.
- Прибирання непотрібних блобів і старих знімків.
- Кілька екземплярів сервера.

## 16. Стан після етапів 1–2

- **Файли.** `serve.mjs` (`--dev`, `import`), `server/data.mjs`, `server/hub.mjs`, `server/http.mjs`, `server/auth.mjs` + `server/oidc.mjs`, `server/log.mjs`, `vendor.mjs`, `src/patch.js` і `src/sync.js` (обидва йдуть у токен `/*@SYNC@*/`). `mcp-http`, `oauth`, `tools`, `engine`, `files` ще немає (етап 3).
- **Перевірки** (кожна бере свою папку в scratchpad і свої порти):
  - `node check/check-patch.mjs`;
  - `node check/check-server.mjs <папка>` — сервер 5197, Chrome 9397, локальний dev 5198 + stdio MCP;
  - `node check/check-auth.mjs <папка>` — кит 5193, mock OIDC 5194, ліміти 5195, Chrome 9395;
  - `node check/check-core.mjs` (`npm run check`).
  
  Для етапу 3 бери інші порти. `check/check-browser.mjs` застарів (шукає `#dl-meta`, якого в UI вже немає) і падає незалежно від серверної роботи.
- **Відхилення від розділу 5.3.** Нормалізація й далі не відправляється, але `anchor()` у `sync.js`: якщо батьківського шляху операції на сервері немає (компонент, який `normalize()` додав лише в браузері), клієнт шле весь вузол цілком. Інакше правки таких компонентів мовчки губились би.
- **Як влаштований клієнт.** `App.applyRemote` патчить `state.s` на місці (обʼєкти в замиканнях полів лишаються живими) і одразу ставить `state.blobs`, а canvas декодує потім. Збереження й чужі пачки йдуть однією чергою (`serial`), а `flushLocal()` спершу відправляє ще не збережені правки. ⌘Z: дрібні правки одного автора протягом 1,2 с — один крок; перевірка «поле ще моє» робиться до відкату.
- **Для рушія (етап 3).** Кнопку Connect у серверному режимі `sync.js` ховає (`#link-btn`), повернути її з діалогом 8.2. `Sync.wanted()` у режимі `engine` вже повертає лише проект з адреси, а на `/` — жоден. `link.js` поки не знає про серверний режим.
- **check-core.** Символи, чий еталон відрізняється від спільного контракту символів гри (у Dice це `wild_1`, `low_5`, `low_6`), тест не порівнює: набір символів у кожній грі свій.
