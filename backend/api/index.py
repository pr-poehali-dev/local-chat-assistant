"""
Персональный ассистент — REST API
Роутинг через query-параметры: ?r=sessions&a=list&id=...
Sessions, Messages, Facts, Settings — PostgreSQL
+ Авто-извлечение фактов (второй LLM-вызов)
"""

import json
import os
import re
import uuid
import urllib.request
import urllib.error
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
    "profile":     "О компании",
    "preferences": "Другое",
    "projects":    "Рынок",
    "constraints": "Другое",
    "other":       "Другое",
    "о компании":  "О компании",
    "финансы":     "Финансы",
    "команда":     "Команда",
    "рынок":       "Рынок",
    "другое":      "Другое",
}
VALID_CATEGORIES = {"О компании", "Финансы", "Команда", "Рынок", "Другое"}

EXTRACTOR_SYSTEM = (
    "You extract long-term user facts for a personal knowledge base. "
    "Return ONLY valid JSON in this exact schema, no markdown, no commentary:\n"
    '{"facts":[{"text":"...","category":"profile|preferences|projects|constraints|other","subcategory":"...","confidence":0.0}]}\n'
    "Rules:\n"
    "- fact must be stable, user-specific, reusable later.\n"
    "- Do NOT extract ephemeral details (today, this chat), assistant suggestions, or greetings.\n"
    "- One fact = one short atomic sentence. Confidence 0..1.\n"
    "- subcategory: a short stable section name (1-3 words) such as: "
    "'Продукты', 'Клиенты', 'Финансы', 'Команда', 'Маркетинг', 'Операции', 'Риски', 'Юнит-экономика', 'Процессы'. "
    "If unsure — use 'Общее'."
)

SUBCATEGORY_LIMIT = 20


def get_db():
    con = psycopg2.connect(
        os.environ["DATABASE_URL"],
        options=f"-c search_path={SCHEMA}",
    )
    con.autocommit = False
    return con


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def rows_to_list(cur) -> list:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def row_to_dict(cur):
    cols = [d[0] for d in cur.description]
    row = cur.fetchone()
    return dict(zip(cols, row)) if row else None


def ok(body: object, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def err(message: str, status: int = 400) -> dict:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}, ensure_ascii=False),
    }


# ── Router ─────────────────────────────────────────────────────
# Все запросы на корневой URL, роутинг через query:
#   ?r=sessions  a=list|create|delete  id=<session_id>
#   ?r=messages  a=list|create         id=<session_id>
#   ?r=facts     a=list|create|delete  id=<fact_id>
#   ?r=settings  a=get|save

def route(event: dict) -> dict:
    method = event.get("httpMethod", "GET").upper()

    if method == "OPTIONS":
        return ok({})

    qs = event.get("queryStringParameters") or {}
    body_raw = event.get("body") or "{}"
    try:
        body = json.loads(body_raw) if body_raw else {}
    except Exception:
        body = {}

    r = qs.get("r", "")
    a = qs.get("a", "")
    rid = qs.get("id", "")

    if not r:
        return ok({"status": "ok", "version": "3.0", "db": "postgres"})

    if r == "sessions":
        if a == "list" or (not a and method == "GET"):
            return sessions_list()
        if a == "create" or (not a and method == "POST"):
            return sessions_create(body)
        if a == "delete" or (not a and method == "DELETE"):
            return sessions_delete(rid)

    if r == "messages":
        if a == "list" or (not a and method == "GET"):
            return messages_list(rid)
        if a == "create" or (not a and method == "POST"):
            return messages_create(rid, body)

    if r == "facts":
        if a == "list" or (not a and method == "GET"):
            return facts_list(qs)
        if a == "relevant":
            return facts_relevant(qs)
        if a == "create" or (not a and method == "POST"):
            return facts_create(body)
        if a == "delete" or (not a and method == "DELETE"):
            return facts_delete(rid)

    if r == "settings":
        if a == "get" or (not a and method == "GET"):
            return settings_get()
        if a == "save" or (not a and method == "POST"):
            return settings_save(body)

    return err(f"Unknown r={r} a={a}", 404)


# ── Sessions ───────────────────────────────────────────────────

def sessions_list() -> dict:
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""
                SELECT s.id, s.title, s.created_at, s.updated_at,
                       (SELECT content FROM messages
                        WHERE session_id = s.id
                        ORDER BY created_at DESC LIMIT 1) AS preview
                FROM sessions s
                ORDER BY s.updated_at DESC
            """)
            rows = rows_to_list(cur)
        con.commit()
        return ok(rows)
    finally:
        con.close()


def sessions_create(body: dict) -> dict:
    sid = str(uuid.uuid4())
    ts = now_iso()
    title = body.get("title", "Новый диалог")
    welcome = "Готов к работе. Задайте вопрос по анализу данных или деловому решению."
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                (sid, title, ts, ts),
            )
            cur.execute(
                "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (%s, %s, %s, %s, %s)",
                (str(uuid.uuid4()), sid, "assistant", welcome, ts),
            )
        con.commit()
        return ok({"id": sid, "title": title, "created_at": ts, "updated_at": ts}, 201)
    finally:
        con.close()


def sessions_delete(sid: str) -> dict:
    if not sid:
        return err("id required")
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE session_id = %s", (sid,))
            deleted_msgs = cur.rowcount
            cur.execute("DELETE FROM sessions WHERE id = %s", (sid,))
        con.commit()
        return ok({"deleted": sid, "messages_deleted": deleted_msgs})
    finally:
        con.close()


# ── Messages ───────────────────────────────────────────────────

def messages_list(session_id: str) -> dict:
    if not session_id:
        return err("id (session_id) required")
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, session_id, role, content, created_at "
                "FROM messages WHERE session_id = %s ORDER BY created_at ASC",
                (session_id,),
            )
            rows = rows_to_list(cur)
        con.commit()
        return ok(rows)
    finally:
        con.close()


def messages_create(session_id: str, body: dict) -> dict:
    if not session_id:
        return err("id (session_id) required")
    role = body.get("role", "user")
    content = body.get("content", "").strip()
    if not content:
        return err("content is required")
    if role not in ("user", "assistant", "system"):
        return err("invalid role")

    mid = str(uuid.uuid4())
    ts = now_iso()
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT id FROM sessions WHERE id = %s", (session_id,))
            if not cur.fetchone():
                return err("Session not found", 404)
            cur.execute(
                "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (%s, %s, %s, %s, %s)",
                (mid, session_id, role, content, ts),
            )
            if role == "user":
                new_title = content[:40] + ("..." if len(content) > 40 else "")
                cur.execute(
                    "UPDATE sessions SET updated_at = %s, title = %s WHERE id = %s",
                    (ts, new_title, session_id),
                )
            else:
                cur.execute(
                    "UPDATE sessions SET updated_at = %s WHERE id = %s",
                    (ts, session_id),
                )
        con.commit()

        # Авто-извлечение фактов после ответа ассистента
        if role == "assistant":
            try:
                _maybe_extract_facts(session_id, content)
            except Exception as ex:
                print(f"[WARN] fact extractor failed silently: {ex}")

        return ok({"id": mid, "session_id": session_id, "role": role, "content": content, "created_at": ts}, 201)
    finally:
        con.close()


# ── Fact Extractor ─────────────────────────────────────────────

def _normalize(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r"\s+", " ", t)
    return t.rstrip(".")


def _normalize_subcategory(raw: str, existing_subcats: set) -> str:
    if not raw:
        return "Общее"
    s = re.sub(r"\s+", " ", raw.strip())[:32]
    s = s.title()
    if s not in existing_subcats and len(existing_subcats) >= SUBCATEGORY_LIMIT:
        return "Общее"
    return s


def _llm_call(base_url: str, api_key: str, model: str, messages: list) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "temperature": 0.0,
        "max_tokens": 512,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def _maybe_extract_facts(session_id: str, assistant_content: str) -> None:
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT base_url, api_key, model, toggles_json FROM settings WHERE id = 1")
            cfg = row_to_dict(cur)
        if not cfg:
            return

        try:
            toggles = json.loads(cfg.get("toggles_json") or "{}")
        except Exception:
            toggles = {}
        if not toggles.get("autoExtract", False):
            return

        base_url = (cfg.get("base_url") or "").strip()
        api_key = (cfg.get("api_key") or "").strip()
        model = cfg.get("model", "gpt-4o")
        if not base_url or not api_key:
            return

        # Контекст: последние 5 сообщений
        with con.cursor() as cur:
            cur.execute(
                "SELECT role, content FROM messages WHERE session_id = %s "
                "ORDER BY created_at DESC LIMIT 5",
                (session_id,),
            )
            rows = list(reversed(cur.fetchall()))
        if not rows:
            return

        dialog_text = "\n".join(f"{r[0].upper()}: {r[1]}" for r in rows)
        raw = _llm_call(base_url, api_key, model, [
            {"role": "system", "content": EXTRACTOR_SYSTEM},
            {"role": "user", "content": f"Extract facts from this conversation:\n\n{dialog_text}"},
        ])
        print(f"[INFO] extractor raw JSON: {raw[:400]}")

        try:
            candidates = json.loads(raw).get("facts", [])
        except Exception:
            print(f"[WARN] extractor: invalid JSON: {raw[:200]}")
            return

        # Существующие факты для дедупликации + текущие subcategory
        with con.cursor() as cur:
            cur.execute("SELECT text, category, subcategory FROM facts")
            existing_rows = cur.fetchall()
        existing: dict[str, set] = {}
        existing_subcats: set = set()
        for t, c, sc in existing_rows:
            existing.setdefault(c, set()).add(_normalize(t))
            if sc:
                existing_subcats.add(sc)

        ts = now_iso()
        inserted = 0
        for item in (candidates or []):
            if not isinstance(item, dict):
                continue
            text = (item.get("text") or "").strip()
            confidence = float(item.get("confidence", 0))
            raw_cat = (item.get("category") or "other").lower().strip()
            raw_sub = (item.get("subcategory") or "").strip()
            if not text or confidence < 0.6:
                continue

            category = CATEGORY_MAP.get(raw_cat, "Другое")
            norm = _normalize(text)
            if norm in existing.get(category, set()):
                print(f"[INFO] extractor: dup skip [{category}]: {text[:50]}")
                continue

            subcategory = _normalize_subcategory(raw_sub, existing_subcats)
            fid = str(uuid.uuid4())
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO facts (id, text, category, subcategory, source, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (fid, text, category, subcategory, "auto", ts, ts),
                )
            con.commit()
            existing.setdefault(category, set()).add(norm)
            existing_subcats.add(subcategory)
            inserted += 1
            print(f"[INFO] extractor: +fact [{category}/{subcategory}]: {text[:60]}")

        print(f"[INFO] extractor: {inserted} new fact(s) for session {session_id[:8]}")

    except urllib.error.HTTPError as e:
        print(f"[WARN] extractor HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')[:200]}")
    except urllib.error.URLError as e:
        print(f"[WARN] extractor URL error: {e.reason}")
    except Exception as ex:
        print(f"[WARN] extractor unexpected: {ex}")
    finally:
        con.close()


# ── Facts ──────────────────────────────────────────────────────

def facts_list(qs: dict) -> dict:
    category = qs.get("category", "")
    q = qs.get("q", "")
    # Без лимита по умолчанию — грузим все факты
    # limit=N в запросе позволяет явно ограничить (например для контекста LLM)
    raw_limit = qs.get("limit", "")
    limit = int(raw_limit) if raw_limit.isdigit() else None

    conditions, params = [], []
    if category and category != "Все":
        conditions.append("category = %s")
        params.append(category)
    if q:
        conditions.append("text ILIKE %s")
        params.append(f"%{q}%")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    limit_clause = ""
    if limit:
        limit_clause = " LIMIT %s"
        params.append(limit)

    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                f"SELECT id, text, category, subcategory, source, created_at, updated_at "
                f"FROM facts {where} ORDER BY created_at DESC{limit_clause}",
                params,
            )
            rows = rows_to_list(cur)
        con.commit()
        return ok(rows)
    finally:
        con.close()


STOPWORDS = {
    "и","в","на","с","по","для","от","до","при","не","но","а","это",
    "что","как","так","же","бы","ли","из","за","под","над","или","то",
    "the","and","for","with","that","this","from","have","are","was",
    "were","not","but","you","your","they","their","its","can","will",
}


def _query_words(q: str) -> list:
    words = re.sub(r"[^\w\s]", " ", q.lower()).split()
    return [w for w in words if len(w) >= 4 and w not in STOPWORDS]


def facts_relevant(qs: dict) -> dict:
    q = (qs.get("q") or "").strip()
    raw_limit = qs.get("limit", "8")
    limit = int(raw_limit) if raw_limit.isdigit() else 8

    con = get_db()
    try:
        words = _query_words(q) if q else []

        if words:
            conditions = " OR ".join(["text ILIKE %s"] * len(words))
            params = [f"%{w}%" for w in words]
            with con.cursor() as cur:
                cur.execute(
                    f"SELECT id, text, category, subcategory, source, created_at FROM facts "
                    f"WHERE {conditions} ORDER BY created_at DESC LIMIT 50",
                    params,
                )
                rows = rows_to_list(cur)

            def score(row):
                t = row["text"].lower()
                return sum(1 for w in words if w in t)

            rows.sort(key=score, reverse=True)
            rows = rows[:limit]

        if not words or not rows:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT id, text, category, subcategory, source, created_at FROM facts "
                    "ORDER BY updated_at DESC LIMIT %s",
                    (limit,),
                )
                rows = rows_to_list(cur)

        con.commit()
        return ok(rows)
    finally:
        con.close()


def facts_create(body: dict) -> dict:
    text = (body.get("text") or body.get("content") or "").strip()
    if not text:
        return err("text is required")
    category = body.get("category", "Другое")
    source = body.get("source", "manual")
    raw_sub = (body.get("subcategory") or "").strip()
    subcategory = re.sub(r"\s+", " ", raw_sub)[:32].title() if raw_sub else None
    fid, ts = str(uuid.uuid4()), now_iso()
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO facts (id, text, category, subcategory, source, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (fid, text, category, subcategory, source, ts, ts),
            )
        con.commit()
        return ok({"id": fid, "text": text, "category": category, "subcategory": subcategory,
                   "source": source, "created_at": ts, "updated_at": ts}, 201)
    finally:
        con.close()


def facts_delete(fid: str) -> dict:
    if not fid:
        return err("id required")
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM facts WHERE id = %s", (fid,))
        con.commit()
        return ok({"deleted": fid})
    finally:
        con.close()


# ── Settings ───────────────────────────────────────────────────

def settings_get() -> dict:
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, base_url, api_key, model, temperature, max_tokens, system_prompt, toggles_json "
                "FROM settings WHERE id = 1"
            )
            row = row_to_dict(cur)
        con.commit()
        if not row:
            return err("Settings not found", 404)
        try:
            row["toggles"] = json.loads(row.get("toggles_json", "{}"))
        except Exception:
            row["toggles"] = {}
        return ok(row)
    finally:
        con.close()


def settings_save(body: dict) -> dict:
    toggles = body.get("toggles", {})
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""
                UPDATE settings SET
                    base_url = %s, api_key = %s, model = %s,
                    temperature = %s, max_tokens = %s,
                    system_prompt = %s, toggles_json = %s
                WHERE id = 1
            """, (
                body.get("base_url", "https://api.openai.com/v1"),
                body.get("api_key", ""),
                body.get("model", "gpt-4o"),
                float(body.get("temperature", 0.7)),
                int(body.get("max_tokens", 2048)),
                body.get("system_prompt", ""),
                json.dumps(toggles),
            ))
        con.commit()
        return ok({"saved": True})
    finally:
        con.close()


# ── Entry point ────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """Персональный ассистент API: sessions, messages, facts, settings + авто-извлечение фактов."""
    return route(event)