# Розгортання Spine Draft Kit (командний сервер)

Для DevOps і IT. Як це влаштовано всередині — у `docs/server-mode-plan.md`.

## Коротко

- Один контейнер: Node 24 (працює й на 22) і headless Chromium, без npm-залежностей.
- Дані — у томі `/data`. Сервер тримає стан на диску, тому **рівно одна репліка**.
- Вхід — корпоративний SSO (будь-який OIDC: Google Workspace, Microsoft Entra ID, Okta, Keycloak, GitLab).
- Claude Code підключається до `<PUBLIC_URL>/mcp` по OAuth (кит сам видає токени) або з персональним токеном.
- Доступ — лише з внутрішньої мережі або VPN. claude.ai ходить до MCP із хмари Anthropic, тож внутрішній сервер йому недоступний. Працює Claude Code на компʼютерах команди.

## Швидкий старт (Docker Compose)

```bash
cp docker-compose.example.yml docker-compose.yml
printf '%s' '<client secret із SSO>' > oidc_client_secret.txt
chmod 644 oidc_client_secret.txt
docker compose up -d --build
docker compose ps
```

У `docker-compose.yml` заміни `PUBLIC_URL`, `OIDC_*`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`. Контейнер слухає `127.0.0.1:8080`, а назовні його публікує проксі з TLS (див. «Проксі»).

Файл секрету монтується в `/run/secrets/` як є, а процес у контейнері працює від `node` (uid 1000), тому файл має бути доступний цьому uid на читання.

## Збірка образу

```bash
docker build -t spine-draft-kit .
```

- Під час збірки виконуються `node build.mjs` (збирає сторінку) і `node vendor.mjs` (качає spine-player 4.1.55 з jsdelivr і JSZip 3.10.1 з cdnjs і звіряє sha256).
- **Без інтернету під час збірки:** заздалегідь виконай `node vendor.mjs` у папці кита. Файли з `vendor/` потраплять в образ, і `vendor.mjs` лише перевірить їхні sha256.
- **Дзеркало реєстру:** базовий образ задається аргументом, наприклад `docker build --build-arg NODE_IMAGE=registry.example.com/library/node:24-bookworm-slim -t spine-draft-kit .`. Пакети `chromium`, `fonts-dejavu-core` і `tini` ставляться з Debian bookworm через apt.
- Що всередині: `/app` — код (власник root, лише читання), `/data` — том для даних (власник `node`), `tini` як PID 1 (прибирає зомбі-процеси Chromium і передає SIGTERM), `HEALTHCHECK` на `/healthz`, порт 8080.

## Що зареєструвати в SSO

Створи OIDC-застосунок типу «web / confidential client»:

| Що | Значення |
|---|---|
| Redirect URI | `<PUBLIC_URL>/auth/callback`, наприклад `https://spine-kit.example.com/auth/callback` |
| Grant type | Authorization Code з PKCE (S256) |
| Автентифікація клієнта | client secret (`client_secret_basic` або `client_secret_post`, кит бере те, що оголошує провайдер) |
| Scopes | `openid email profile` (змінна `OIDC_SCOPES`) |
| Claim груп | `groups` в ID token (змінна `OIDC_GROUPS_CLAIM`), лише якщо доступ дається за групами |

- Email береться з `email`, а якщо його немає — з `preferred_username`. Якщо `email_verified` дорівнює `false`, вхід відхиляється.
- Доступ отримує той, у кого домен пошти є в `ALLOWED_EMAIL_DOMAINS` **або** хоча б одна група є в `ALLOWED_GROUPS`. Потрібна хоча б одна з цих змінних.
- Групи читаються **лише з ID token**, а не з userinfo. Як їх туди додати:
  - Keycloak: mapper «Group Membership», `Full group path` вимкнути, «Add to ID token» увімкнути;
  - Microsoft Entra ID: Token configuration → Add groups claim → ID. Entra кладе туди id груп, тому в `ALLOWED_GROUPS` пиши id;
  - Okta: Groups claim у налаштуваннях застосунку;
  - Google Workspace груп в ID token не дає, тому використовуй `ALLOWED_EMAIL_DOMAINS` (див. «Google Workspace» нижче).
- Провайдер з внутрішнім TLS-сертифікатом: додай корпоративний CA через `NODE_EXTRA_CA_CERTS=/шлях/до/ca.pem` (і змонтуй файл).
- Окремо для Claude Code в SSO нічого реєструвати не треба: кит сам є OAuth-сервером для `/mcp`, а Claude Code реєструється в ньому автоматично (DCR) і пускає людину через той самий SSO.

### Google Workspace

У компанії SSO — Google. Робить адмін Google Cloud у проекті, що належить організації Workspace:

1. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience): User type — **Internal**. Тоді увійти можуть лише акаунти вашого Workspace, а перевірка застосунку Google не потрібна. Scopes додавати не треба: `openid email profile` базові.
2. **Credentials → Create credentials → OAuth client ID**, тип **Web application**:
   - Authorized redirect URIs: `<PUBLIC_URL>/auth/callback`, наприклад `https://spine-kit.example.com/auth/callback`. Google приймає лише https (виняток — `http://localhost`);
   - Authorized JavaScript origins не потрібні.
3. Client ID і Client secret передай тому, хто розгортає кит. Секрет клади у файл (`OIDC_CLIENT_SECRET_FILE`), а не в змінну.

Змінні:

```
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<…>.apps.googleusercontent.com
OIDC_CLIENT_SECRET_FILE=/run/secrets/oidc_client_secret
ALLOWED_EMAIL_DOMAINS=<домен Workspace, наприклад example.com>
ADMIN_EMAILS=<хто адмін кита>
```

- `OIDC_GROUPS_CLAIM` і `ALLOWED_GROUPS` з Google не працюють: груп в ID token немає.
- Для Google кит перевіряє не лише домен пошти, а й claim `hd` (домен Workspace). Звичайний Google-акаунт, зареєстрований на корпоративну адресу, має `email_verified`, але не має `hd`, тож його не пустить. Кілька доменів у Workspace — перелічи їх через кому, `hd` має збігтися з доменом пошти.
- `iss` від Google буває і `https://accounts.google.com`, і `accounts.google.com`. Кит приймає обидва.
- **Мережа.** Сам сервер кита ходить до Google по HTTPS: `accounts.google.com` (discovery), `oauth2.googleapis.com` (обмін коду), `www.googleapis.com` (ключі JWKS). Якщо кит стоїть у закритій мережі, ці адреси мають бути дозволені назовні прямим правилом у файрволі: змінну `HTTPS_PROXY` кит не використовує. Браузери людей теж мають бачити `accounts.google.com`.

## Змінні оточення

| Змінна | Що | Типово |
|---|---|---|
| `PUBLIC_URL` | зовнішня адреса, `https://spine-kit.<домен>`. Запити з іншим `Host` отримують 421 | обовʼязкова |
| `PORT` | порт у контейнері | `8080` |
| `HOST` | адреса, яку слухає сервер | `0.0.0.0` |
| `DATA_DIR` | папка даних | `/data` |
| `AUTH` | `oidc`; `dev` (форма без пароля) — лише для локальних тестів на loopback | `oidc` |
| `OIDC_ISSUER` | адреса провайдера (https) | обовʼязкова |
| `OIDC_CLIENT_ID` | id застосунку в SSO | обовʼязкова |
| `OIDC_CLIENT_SECRET` або `OIDC_CLIENT_SECRET_FILE` | секрет (краще файлом) | обовʼязкова |
| `OIDC_SCOPES` | scopes | `openid email profile` |
| `OIDC_GROUPS_CLAIM` | claim з групами в ID token | `groups` |
| `ALLOWED_EMAIL_DOMAINS` | домени через кому: `example.com,studio.example.com` | хоча б одна з двох |
| `ALLOWED_GROUPS` | групи через кому | хоча б одна з двох |
| `ADMIN_EMAILS` | адміни через кому: «Кошик», аудит, відкликання чужих токенів | — |
| `TRUST_PROXY` | `1`: брати IP клієнта з `X-Forwarded-For` (останній запис) для лімітів і аудиту. Вмикай лише за проксі | `0` |
| `MAX_IMAGE_MB` | ліміт однієї картинки | `64` |
| `RATE_AUTH_PER_MIN` | запитів до `/auth/*` за хвилину з одного IP | `10` |
| `OAUTH_EXTRA_REDIRECTS` | додаткові redirect URI для MCP-клієнтів через кому (loopback дозволений завжди) | — |
| `CHROME_PATH` | Chromium рушія | `/usr/bin/chromium` |
| `ENGINE_PORT` | внутрішній порт рушія на `127.0.0.1`. Не публікувати й не проксувати | випадковий |
| `ENGINE_MAX_TABS` | скільки проектів одночасно тримає рушій | `6` |
| `ENGINE_IDLE_MIN` | через скільки хвилин простою закривається вкладка проекту | `10` |
| `ENGINE_NO_SANDBOX` | `1`: Chromium без sandbox (див. «Безпека») | `0` |
| `NODE_EXTRA_CA_CERTS` | корпоративний CA для звернень до SSO | — |

## Проксі

Потрібні TLS, збережений `Host`, `X-Forwarded-Proto` і `X-Forwarded-For`. Для `/api/events` (живі зміни, SSE) і `/mcp` (довгі виклики, до 5 хв на експорт) треба вимкнути буферизацію і збільшити тайм-аут.

```nginx
server {
  listen 443 ssl http2;
  server_name spine-kit.example.com;
  ssl_certificate     /etc/ssl/spine-kit.crt;
  ssl_certificate_key /etc/ssl/spine-kit.key;

  client_max_body_size 256m;

  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_http_version 1.1;

  location ~ ^/(api/events|mcp)$ {
    proxy_pass http://127.0.0.1:8080;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 300s;
  }
}
```

- `Host` має збігатися з хостом із `PUBLIC_URL`, інакше сервер відповідає 421.
- `/healthz` не перевіряє `Host`, тож його можна смикати напряму.
- Внутрішній порт рушія (`ENGINE_PORT`) слухає лише `127.0.0.1` у контейнері. Його не можна публікувати.

## Ресурси

Заміряно 2026-11-05 на Docker Desktop (Linux VM, arm64), образ на `node:24-bookworm-slim`, Chromium 156. Проект: сітка 5×3, два символи 220×220.

| Стан | Памʼять контейнера (`docker stats`) |
|---|---|
| Сервер у спокої, після входу (Chromium ще не запущений) | ~55 МБ |
| Одна вкладка рушія після `screenshot` і `spin` | ~500–610 МБ |
| Chromium запущений, вкладка закрита після простою | ~395 МБ |

- **Розмір образу:** 903 МБ (Chromium з бібліотеками — основна частина).
- Холодний старт Chromium разом з першою вкладкою — ~4 с, далі виклики йдуть за 0,05–1 с.
- Кожна наступна вкладка рушія додає ~100–250 МБ, а велика картинка в canvas (до 4092²) — до ~67 МБ. Тож для 6 вкладок закладай до 2,5–3 ГБ.
- **Рекомендація:** 1 CPU і 2–4 ГіБ памʼяті (у compose — `mem_limit: 3g`), диск 10–20 ГБ. Картинки лежать за вмістом (sha256) і не дублюються, знімки історії стиснуті.

## Kubernetes

1 репліка, `strategy: Recreate` (новий pod стартує, лише коли старий відпустив том), PVC ReadWriteOnce на 10–20 ГБ, проби на `/healthz`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spine-kit
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: { app: spine-kit }
  template:
    metadata:
      labels: { app: spine-kit }
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: kit
          image: registry.example.com/spine-draft-kit:2026-11-05
          ports:
            - containerPort: 8080
          env:
            - { name: PUBLIC_URL, value: https://spine-kit.example.com }
            - { name: OIDC_ISSUER, value: https://accounts.google.com }
            - { name: OIDC_CLIENT_ID, value: 000000000000-xxxxxxxx.apps.googleusercontent.com }
            - { name: OIDC_CLIENT_SECRET_FILE, value: /secrets/oidc/client-secret }
            - { name: ALLOWED_EMAIL_DOMAINS, value: example.com }
            - { name: ADMIN_EMAILS, value: lead@example.com }
            - { name: TRUST_PROXY, value: "1" }
            - { name: ENGINE_NO_SANDBOX, value: "1" }
          resources:
            requests: { cpu: 500m, memory: 1Gi }
            limits: { cpu: "1", memory: 3Gi }
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 20
            periodSeconds: 30
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: [ALL] }
          volumeMounts:
            - { name: data, mountPath: /data }
            - { name: tmp, mountPath: /tmp }
            - { name: oidc, mountPath: /secrets/oidc, readOnly: true }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: spine-kit-data }
        - name: tmp
          emptyDir: { sizeLimit: 2Gi }
        - name: oidc
          secret: { secretName: spine-kit-oidc }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: spine-kit-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 20Gi }
```

- `readOnlyRootFilesystem` працює, якщо `/tmp` — `emptyDir`: там живе профіль Chromium рушія. Перевірено в Docker з `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`.
- `fsGroup: 1000` робить том записуваним для `node`.
- Ingress-nginx: анотації `nginx.ingress.kubernetes.io/proxy-buffering: "off"`, `proxy-read-timeout: "3600"`, `proxy-send-timeout: "3600"`, `proxy-body-size: 256m`. Вони діють на весь ingress, і це нормально.

## Бекап і відновлення

Усі записи атомарні (tmp + rename), тому бекап можна робити на ходу.

- Знімок тому (PVC snapshot, знімок диска VM) або нічний архів:

  ```bash
  docker compose exec -T spine-kit tar czf - --exclude=./.lock -C /data . > spine-kit-$(date +%F).tgz
  ```

- Відновлення: зупини контейнер, поверни вміст тому, запусти знову.

  ```bash
  docker compose stop spine-kit
  docker compose run --rm --no-deps --entrypoint sh spine-kit -c 'rm -rf /data/* /data/.lock'
  docker compose run --rm --no-deps -T --entrypoint tar spine-kit xzf - -C /data < spine-kit-2026-11-05.tgz
  docker compose start spine-kit
  ```

Що лежить у `/data`: `projects/<id>/` (документ, історія, знімки), `blobs/` (картинки за sha256), `auth/` (сесії, MCP-клієнти й токени — лише хеші), `users.json`, `audit.jsonl`.

## Оновлення

```bash
git pull
docker compose up -d --build
```

- Перерва — кілька секунд. На SIGTERM сервер скидає все на диск і виходить (`tini` передає сигнал; перевірено: вихід з кодом 0 менш ніж за секунду).
- Після перезапуску входи людей, OAuth-токени й персональні токени дійсні. MCP-сесії живуть у памʼяті: Claude Code сам перепідключиться, а проект треба відкрити знову (`kit_status` про це скаже).
- Відкриті вкладки показують банер «Немає звʼязку» і доправляють незбережені правки, щойно сервер повернеться.

## Логи

- Усе пишеться в stdout рядками JSON. Запит: `{"t", "kind": "req", "id", "user", "m", "route", "status", "ms"}`; ще є `info`, `error`, події аудиту й MCP-виклики (`"msg": "mcp.call"`, інструмент, проект, мс). Збирай звичайним драйвером логів Docker або агентом k8s.
- Куки, токени, коди й одноразові посилання в лог не потрапляють: шляхи `/u/…` і `/d/…` пишуться без хвоста.
- Аудит дублюється у `/data/audit.jsonl`: вхід, вихід і відмова, видача й відкликання токенів, створення, видалення й відновлення проектів, відкати. Адміну він доступний через `GET /api/audit`.
- Рушій пише `engine: chromium started`, `engine: tab opened`, `engine: tab closed` та `engine: chromium stopped`.

## Безпека

- Лише внутрішня мережа або VPN, лише HTTPS (http дозволений тільки для `localhost`).
- Процеси в контейнері працюють від `node` (uid 1000), код у `/app` не можна змінити, писати можна лише в `/data` і `/tmp`.
- Сторінка віддається з суворим CSP, без CDN (spine-player і JSZip з `/vendor`). Запити з кукою, які щось міняють, перевіряють `Origin` і CSRF-токен. Чужий `Host` отримує 421.
- Секрети — з env або файлів `*_FILE`. Сесії й токени зберігаються лише як хеші SHA-256.
- Ліміти частоти (429): правки, MCP, `/auth/*`, реєстрація MCP-клієнтів, завантаження.
- **Рушій (Chromium).** Він відкриває лише сторінку кита з `127.0.0.1` і має мережевий замок `--host-resolver-rules`: жодних інших хостів, навіть IP-адрес.
  - Типовий seccomp Docker забороняє user namespaces, і sandbox Chromium тоді не стартує (`No usable sandbox`). Тому в compose і k8s стоїть `ENGINE_NO_SANDBOX=1`. Кит додає `--no-sandbox` лише разом із мережевим замком.
  - Якщо хочеш sandbox Chromium, дозволь user namespaces (наприклад, seccomp-профіль, що дозволяє `clone`/`unshare` з `CLONE_NEWUSER`) і прибери `ENGINE_NO_SANDBOX`. З `--security-opt seccomp=unconfined` sandbox у контейнері працює (перевірено), але це послаблює ізоляцію самого контейнера.

## Перевірка після розгортання

1. `curl -fsS https://spine-kit.example.com/healthz` → `ok`.
2. Відкрий `PUBLIC_URL`: вхід через SSO, порожній список проектів або твої проекти.
3. Людина з чужого домену бачить «Немає доступу».
4. **Connect** у киті показує команду для Claude Code. Після `claude mcp add --transport http spine-kit https://spine-kit.example.com/mcp` і `/mcp → spine-kit → Authenticate` Claude створює проект, а в історії стоїть «Claude · <імʼя>».

## Перевірка образу локально

`node check/check-docker.mjs <папка>` перевіряє готовий образ (`IMAGE`, типово `spine-draft-kit:test`; з `BUILD=1` спершу збирає його). Скрипт запускає mock OIDC на хості, контейнер на `localhost:5201` з томом і проходить вхід, MCP через OAuth, рушій (скріншот, спін, експорт), перезапуск контейнера зі збереженням даних, healthcheck, не-root і заміри памʼяті.
