# PROJECT SNAPSHOT — Analyst Personal Assistant
> Дата: 2026-03-01 | Стек: React + TypeScript + Python + PostgreSQL

---

## Что это за приложение

**Analyst** — персональный ИИ-ассистент для анализа данных и деловых решений.
Пользователь подключает любой OpenAI-совместимый LLM (свой ключ + base URL), ведёт диалоги,
а система автоматически извлекает факты о нём из разговоров и подставляет их в контекст каждого нового сообщения.

### Ключевые возможности:
- **Чат** с историей диалогов (несколько сессий)
- **База знаний (факты)** — ручное и автоматическое добавление через второй LLM-вызов
- **Настройки LLM** — base URL, API key, модель, температура, max_tokens, system prompt, тогглы
- **Правый сайдбар** — показывает до 4 фактов из базы знаний прямо в чате
- **Авто-извлечение фактов** с дедупликацией (confidence >= 0.6)

---

## Архитектура

```
Frontend (React SPA)  →  Backend (Python Cloud Function)  →  PostgreSQL
                                    ↓
                              LLM API (OpenAI-compatible)
```

- **Frontend**: React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: одна Python-функция, роутинг через query-параметры `?r=resource&a=action`
- **БД**: PostgreSQL, 4 таблицы: `sessions`, `messages`, `facts`, `settings`
- **LLM**: вызывается напрямую из браузера (chat completions), авто-извлечение фактов — из бэкенда

---

## Структура файлов

```
/src
  App.tsx                  — корневой компонент, роутинг
  pages/Index.tsx          — главная страница, вся вёрстка UI
  hooks/useChatStore.ts    — весь стейт: сессии, сообщения, факты, конфиг
  lib/api.ts               — HTTP-клиент к бэкенду
  components/
    ChatPanel.tsx          — область сообщений + поле ввода
    HistoryPanel.tsx       — список сессий
    FactsPanel.tsx         — управление базой знаний
    SettingsPanel.tsx      — форма настроек LLM
    ui/                    — shadcn/ui компоненты (56 штук)

/backend/api
  index.py                 — вся серверная логика (router + handlers + fact extractor)
  requirements.txt         — psycopg2
  tests.json               — тесты эндпоинтов

/db_migrations
  V0001__create_analyst_tables.sql
  V0002__fix_default_toggles.sql
```

---

## База данных (PostgreSQL)

**Схема**: `t_p4825665_local_chat_assistant`

```sql
-- Сессии диалогов
sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Сообщения
messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,           -- 'user' | 'assistant' | 'system'
  content TEXT,
  created_at TIMESTAMPTZ
)
INDEX: (session_id, created_at)

-- Факты о пользователе
facts (
  id TEXT PRIMARY KEY,
  text TEXT,
  category TEXT,       -- 'О компании' | 'Финансы' | 'Команда' | 'Рынок' | 'Другое'
  source TEXT,         -- 'manual' | 'auto'
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
INDEX: (category)

-- Настройки LLM (одна строка, id=1)
settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  base_url TEXT,
  api_key TEXT,
  model TEXT,
  temperature FLOAT,
  max_tokens INTEGER,
  system_prompt TEXT,
  toggles_json TEXT    -- JSON: {autoExtract, antiDuplicates, topFacts}
)
```

---

## Backend API (`/backend/api/index.py`)

**Единая Cloud Function**, роутинг через query-params.

### Эндпоинты (все на один URL):

| r= | a= | Method | Описание |
|----|----|--------|----------|
| sessions | list | GET | Список сессий с preview |
| sessions | create | POST | Создать сессию + welcome-сообщение |
| sessions | delete | DELETE | Удалить сессию и все её сообщения |
| messages | list | GET | Сообщения сессии (?id=session_id) |
| messages | create | POST | Добавить сообщение → триггер авто-извлечения |
| facts | list | GET | Все факты (фильтр: category, q, limit) |
| facts | create | POST | Добавить факт |
| facts | delete | DELETE | Удалить факт |
| settings | get | GET | Получить настройки |
| settings | save | POST | Сохранить настройки |

### Авто-извлечение фактов (`_maybe_extract_facts`):
Срабатывает при каждом `messages.create` с `role=assistant`:
1. Читает настройки (base_url, api_key, model, toggles)
2. Если `autoExtract=true` — берёт последние 5 сообщений сессии
3. Вызывает LLM с системным промптом-экстрактором (JSON-режим)
4. Фильтрует по confidence >= 0.6
5. Дедуплицирует по нормализованному тексту внутри категории
6. Вставляет новые факты в БД с `source='auto'`

```python
# Полный код backend/api/index.py

"""
Персональный ассистент — REST API
Роутинг через query-параметры: ?r=sessions&a=list&id=...
Sessions, Messages, Facts, Settings — PostgreSQL
+ Авто-извлечение фактов (второй LLM-вызов)
"""

import json, os, re, uuid, urllib.request, urllib.error
from datetime import datetime, timezone
import psycopg2

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p4825665_local_chat_assistant")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
    "Content-Type": "application/json",
}

CATEGORY_MAP = {
    "profile": "О компании", "preferences": "Другое", "projects": "Рынок",
    "constraints": "Другое", "other": "Другое",
    "о компании": "О компании", "финансы": "Финансы",
    "команда": "Команда", "рынок": "Рынок", "другое": "Другое",
}
VALID_CATEGORIES = {"О компании", "Финансы", "Команда", "Рынок", "Другое"}

EXTRACTOR_SYSTEM = (
    "You extract long-term user facts for a personal knowledge base. "
    'Return ONLY valid JSON: {"facts":[{"text":"...","category":"profile|preferences|projects|constraints|other","confidence":0.0}]}\n'
    "Rules: fact must be stable, user-specific, reusable later. "
    "Do NOT extract ephemeral details, assistant suggestions, or greetings. "
    "One fact = one short atomic sentence. Confidence 0..1."
)

def get_db():
    con = psycopg2.connect(os.environ["DATABASE_URL"], options=f"-c search_path={SCHEMA}")
    con.autocommit = False
    return con

def now_iso(): return datetime.now(timezone.utc).isoformat()
def rows_to_list(cur): cols = [d[0] for d in cur.description]; return [dict(zip(cols, row)) for row in cur.fetchall()]
def row_to_dict(cur): cols = [d[0] for d in cur.description]; row = cur.fetchone(); return dict(zip(cols, row)) if row else None
def ok(body, status=200): return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps(body, ensure_ascii=False, default=str)}
def err(message, status=400): return {"statusCode": status, "headers": CORS_HEADERS, "body": json.dumps({"error": message}, ensure_ascii=False)}

def route(event):
    method = event.get("httpMethod", "GET").upper()
    if method == "OPTIONS": return ok({})
    qs = event.get("queryStringParameters") or {}
    body = json.loads(event.get("body") or "{}") if event.get("body") else {}
    r, a, rid = qs.get("r",""), qs.get("a",""), qs.get("id","")
    if not r: return ok({"status":"ok","version":"3.0","db":"postgres"})
    if r=="sessions":
        if a=="list" or (not a and method=="GET"): return sessions_list()
        if a=="create" or (not a and method=="POST"): return sessions_create(body)
        if a=="delete" or (not a and method=="DELETE"): return sessions_delete(rid)
    if r=="messages":
        if a=="list" or (not a and method=="GET"): return messages_list(rid)
        if a=="create" or (not a and method=="POST"): return messages_create(rid, body)
    if r=="facts":
        if a=="list" or (not a and method=="GET"): return facts_list(qs)
        if a=="create" or (not a and method=="POST"): return facts_create(body)
        if a=="delete" or (not a and method=="DELETE"): return facts_delete(rid)
    if r=="settings":
        if a=="get" or (not a and method=="GET"): return settings_get()
        if a=="save" or (not a and method=="POST"): return settings_save(body)
    return err(f"Unknown r={r} a={a}", 404)

# --- Sessions ---
def sessions_list():
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""SELECT s.id, s.title, s.created_at, s.updated_at,
                (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS preview
                FROM sessions s ORDER BY s.updated_at DESC""")
            rows = rows_to_list(cur)
        con.commit(); return ok(rows)
    finally: con.close()

def sessions_create(body):
    sid, ts = str(uuid.uuid4()), now_iso()
    title = body.get("title", "Новый диалог")
    welcome = "Готов к работе. Задайте вопрос по анализу данных или деловому решению."
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("INSERT INTO sessions (id,title,created_at,updated_at) VALUES (%s,%s,%s,%s)", (sid,title,ts,ts))
            cur.execute("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (%s,%s,%s,%s,%s)", (str(uuid.uuid4()),sid,"assistant",welcome,ts))
        con.commit(); return ok({"id":sid,"title":title,"created_at":ts,"updated_at":ts}, 201)
    finally: con.close()

def sessions_delete(sid):
    if not sid: return err("id required")
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE session_id = %s", (sid,)); deleted_msgs = cur.rowcount
            cur.execute("DELETE FROM sessions WHERE id = %s", (sid,))
        con.commit(); return ok({"deleted":sid,"messages_deleted":deleted_msgs})
    finally: con.close()

# --- Messages ---
def messages_list(session_id):
    if not session_id: return err("id required")
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT id,session_id,role,content,created_at FROM messages WHERE session_id=%s ORDER BY created_at ASC", (session_id,))
            rows = rows_to_list(cur)
        con.commit(); return ok(rows)
    finally: con.close()

def messages_create(session_id, body):
    if not session_id: return err("id required")
    role = body.get("role","user"); content = body.get("content","").strip()
    if not content: return err("content is required")
    if role not in ("user","assistant","system"): return err("invalid role")
    mid, ts = str(uuid.uuid4()), now_iso()
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT id FROM sessions WHERE id=%s", (session_id,))
            if not cur.fetchone(): return err("Session not found", 404)
            cur.execute("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (%s,%s,%s,%s,%s)", (mid,session_id,role,content,ts))
            if role == "user":
                new_title = content[:40] + ("..." if len(content)>40 else "")
                cur.execute("UPDATE sessions SET updated_at=%s, title=%s WHERE id=%s", (ts,new_title,session_id))
            else:
                cur.execute("UPDATE sessions SET updated_at=%s WHERE id=%s", (ts,session_id))
        con.commit()
        if role=="assistant":
            try: _maybe_extract_facts(session_id, content)
            except Exception as ex: print(f"[WARN] fact extractor: {ex}")
        return ok({"id":mid,"session_id":session_id,"role":role,"content":content,"created_at":ts}, 201)
    finally: con.close()

# --- Fact Extractor ---
def _normalize(text): return re.sub(r"\s+", " ", text.lower().strip()).rstrip(".")

def _llm_call(base_url, api_key, model, messages):
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({"model":model,"temperature":0.0,"max_tokens":512,"messages":messages,"response_format":{"type":"json_object"}}).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type":"application/json","Authorization":f"Bearer {api_key}"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp: data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]

def _maybe_extract_facts(session_id, assistant_content):
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT base_url,api_key,model,toggles_json FROM settings WHERE id=1")
            cfg = row_to_dict(cur)
        if not cfg: return
        try: toggles = json.loads(cfg.get("toggles_json") or "{}")
        except: toggles = {}
        if not toggles.get("autoExtract", False): return
        base_url = (cfg.get("base_url") or "").strip(); api_key = (cfg.get("api_key") or "").strip(); model = cfg.get("model","gpt-4o")
        if not base_url or not api_key: return
        with con.cursor() as cur:
            cur.execute("SELECT role,content FROM messages WHERE session_id=%s ORDER BY created_at DESC LIMIT 5", (session_id,))
            rows = list(reversed(cur.fetchall()))
        if not rows: return
        dialog_text = "\n".join(f"{r[0].upper()}: {r[1]}" for r in rows)
        raw = _llm_call(base_url, api_key, model, [
            {"role":"system","content":EXTRACTOR_SYSTEM},
            {"role":"user","content":f"Extract facts:\n\n{dialog_text}"}
        ])
        try: candidates = json.loads(raw).get("facts",[])
        except: return
        with con.cursor() as cur:
            cur.execute("SELECT text,category FROM facts")
            existing_rows = cur.fetchall()
        existing = {}
        for t,c in existing_rows: existing.setdefault(c, set()).add(_normalize(t))
        ts = now_iso(); inserted = 0
        for item in (candidates or []):
            if not isinstance(item, dict): continue
            text = (item.get("text") or "").strip(); confidence = float(item.get("confidence",0))
            raw_cat = (item.get("category") or "other").lower().strip()
            if not text or confidence < 0.6: continue
            category = CATEGORY_MAP.get(raw_cat, "Другое"); norm = _normalize(text)
            if norm in existing.get(category, set()): continue
            fid = str(uuid.uuid4())
            with con.cursor() as cur:
                cur.execute("INSERT INTO facts (id,text,category,source,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s)", (fid,text,category,"auto",ts,ts))
            con.commit(); existing.setdefault(category, set()).add(norm); inserted += 1
        print(f"[INFO] extractor: {inserted} new fact(s)")
    except Exception as ex: print(f"[WARN] extractor: {ex}")
    finally: con.close()

# --- Facts ---
def facts_list(qs):
    category, q = qs.get("category",""), qs.get("q","")
    raw_limit = qs.get("limit",""); limit = int(raw_limit) if raw_limit.isdigit() else None
    conditions, params = [], []
    if category and category != "Все": conditions.append("category = %s"); params.append(category)
    if q: conditions.append("text ILIKE %s"); params.append(f"%{q}%")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    limit_clause = ""
    if limit: limit_clause = " LIMIT %s"; params.append(limit)
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(f"SELECT id,text,category,source,created_at,updated_at FROM facts {where} ORDER BY created_at DESC{limit_clause}", params)
            rows = rows_to_list(cur)
        con.commit(); return ok(rows)
    finally: con.close()

def facts_create(body):
    text = (body.get("text") or body.get("content") or "").strip()
    if not text: return err("text is required")
    category = body.get("category","Другое"); source = body.get("source","manual")
    fid, ts = str(uuid.uuid4()), now_iso()
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("INSERT INTO facts (id,text,category,source,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s)", (fid,text,category,source,ts,ts))
        con.commit(); return ok({"id":fid,"text":text,"category":category,"source":source,"created_at":ts,"updated_at":ts}, 201)
    finally: con.close()

def facts_delete(fid):
    if not fid: return err("id required")
    con = get_db()
    try:
        with con.cursor() as cur: cur.execute("DELETE FROM facts WHERE id=%s", (fid,))
        con.commit(); return ok({"deleted":fid})
    finally: con.close()

# --- Settings ---
def settings_get():
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT id,base_url,api_key,model,temperature,max_tokens,system_prompt,toggles_json FROM settings WHERE id=1")
            row = row_to_dict(cur)
        con.commit()
        if not row: return err("Settings not found", 404)
        try: row["toggles"] = json.loads(row.get("toggles_json","{}"))
        except: row["toggles"] = {}
        return ok(row)
    finally: con.close()

def settings_save(body):
    toggles = body.get("toggles",{})
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""UPDATE settings SET base_url=%s,api_key=%s,model=%s,temperature=%s,max_tokens=%s,system_prompt=%s,toggles_json=%s WHERE id=1""",
                (body.get("base_url","https://api.openai.com/v1"), body.get("api_key",""), body.get("model","gpt-4o"),
                 float(body.get("temperature",0.7)), int(body.get("max_tokens",2048)), body.get("system_prompt",""), json.dumps(toggles)))
        con.commit(); return ok({"saved":True})
    finally: con.close()

def handler(event, context):
    """Персональный ассистент API."""
    return route(event)
```

---

## Frontend: src/lib/api.ts

```typescript
const BASE = "https://functions.poehali.dev/5a867386-9601-4226-87b2-b0486113195c";

async function request<T>(resource, action, options = {}): Promise<T> {
  const params = new URLSearchParams({ r: resource, a: action });
  if (options.id) params.set("id", options.id);
  if (options.qs) Object.entries(options.qs).forEach(([k,v]) => { if(v) params.set(k,v); });
  const url = `${BASE}?${params}`;
  const { id, qs, ...fetchOptions } = options;
  const res = await fetch(url, { headers: {"Content-Type":"application/json",...(fetchOptions.headers??{})}, ...fetchOptions });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  sessions: {
    list: () => request("sessions", "list"),
    create: (title="Новый диалог") => request("sessions","create",{method:"POST",body:JSON.stringify({title})}),
    delete: (id) => request("sessions","delete",{method:"DELETE",id}),
  },
  messages: {
    list: (sessionId) => request("messages","list",{id:sessionId}),
    create: (sessionId,role,content) => request("messages","create",{method:"POST",id:sessionId,body:JSON.stringify({role,content})}),
  },
  facts: {
    list: (params?) => { const qs={}; if(params?.category&&params.category!=="Все") qs.category=params.category; if(params?.q) qs.q=params.q; if(params?.limit) qs.limit=String(params.limit); return request("facts","list",{qs}); },
    create: (text,category,source="manual") => request("facts","create",{method:"POST",body:JSON.stringify({text,category,source})}),
    delete: (id) => request("facts","delete",{method:"DELETE",id}),
  },
  settings: {
    get: () => request("settings","get"),
    save: (data) => request("settings","save",{method:"POST",body:JSON.stringify(data)}),
  },
};
```

---

## Frontend: src/hooks/useChatStore.ts (логика)

### Что делает хук:
- Загружает при старте: список сессий + факты + настройки из бэкенда
- Управляет активной сессией, подгружает сообщения при выборе
- `sendMessage`: сохраняет user-msg → вызывает LLM напрямую из браузера (fetch к base_url) → сохраняет ответ на бэкенд
- В системный промпт вставляет ВСЕ факты из базы знаний (`[категория] текст`)
- История контекста: последние 10 сообщений текущей сессии

### Интерфейс LLMConfig:
```typescript
{
  baseUrl: string;       // "https://api.openai.com/v1"
  apiKey: string;
  model: string;         // "gpt-4o"
  temperature: number;   // 0.7
  maxTokens: number;     // 2048
  systemPrompt: string;
  autoExtract: boolean;  // авто-извлечение фактов
  antiDuplicates: boolean;
  topFacts: boolean;
}
```

---

## Frontend: UI (Index.tsx)

### Layout:
```
┌─────────────┬──────────────────────────────┬───────────────┐
│  Sidebar    │    Chat Panel (flex-1)        │  Facts Panel  │
│  w-64/w-14  │                              │  w-64 lg:flex │
│  (collapse) │  Messages list               │               │
│             │  + Input area                │  Top 4 facts  │
│  Nav:       │  + Session ID + model name   │  + LLM status │
│  • Чат      │                              │               │
│  • История  ├──────────────────────────────┴───────────────┤
│  • Факты    │           HistoryPanel / FactsPanel / SettingsPanel
│  • Настройки│           (full width, same container)
│             │
│  ● model    │
└─────────────┘
```

### Компоненты:
- **ChatPanel** — messages + textarea + кнопка отправки; внизу: ID сессии слева, название модели справа
- **HistoryPanel** — список сессий, клик → переключить, кнопка "Новый диалог"
- **FactsPanel** — таблица фактов с фильтром по категории, поиском, ручным добавлением и удалением
- **SettingsPanel** — форма: base URL, API key (скрыт), model, temperature, max_tokens, system prompt, 3 тоггла

---

## Цветовая схема (Tailwind + CSS vars)

Минималистичная монохромная: `foreground/background` + `muted-foreground` + `border`.
Активный элемент: `bg-foreground text-background` (инверсия).
Статус подключения: зелёная/серая точка.

---

## Что не реализовано / возможные улучшения:
1. Streaming ответов (сейчас ждём полного ответа)
2. Редактирование сообщений
3. Экспорт диалогов
4. Мультипользовательность (сейчас один пользователь)
5. Поиск по сообщениям
6. Markdown-рендеринг в сообщениях ассистента
7. Переименование сессий вручную
