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

# Нормализация только для старых/технических значений — свободные категории проходят как есть
CATEGORY_MAP = {
    "profile":     "О компании",
    "preferences": "Другое",
    "projects":    "Личные проекты",
    "constraints": "Другое",
    "other":       "Другое",
}

MEMORY_GATE_SYSTEM = (
    "You are a knowledge base builder for a personal AI assistant. "
    "The PURPOSE is to build a reliable, structured knowledge base for future personalised help.\n\n"
    "CRITICAL: NEVER use the word 'пользователь' or 'user' in fact text. "
    "Always use the person's actual name (e.g. 'Андрей'). "
    "If name is unknown, use 'владелец'.\n\n"
    "Return ONLY valid JSON, no markdown:\n"
    '{"should_write":false,"reason":"...","facts":[]}\n\n'
    "SAVE facts that are:\n"
    "- Identity: full name, age, location, family, background\n"
    "- Business (Joywood): products, sales, clients, team, history, values, goals\n"
    "- Personal projects separate from main business\n"
    "- Stable preferences, work style, recurring patterns\n"
    "- Explicit decisions, plans, challenges\n\n"
    "DO NOT save:\n"
    "- Small talk with zero informational value\n"
    "- Assistant suggestions or questions\n"
    "- Exact duplicates of EXISTING FACTS\n\n"
    "Rules:\n"
    "- NEVER write 'пользователь' — always use real name from context\n"
    "- Each fact must be SELF-CONTAINED. Examples:\n"
    "  BAD: 'Пользователь создаёт приложение'\n"
    "  GOOD: 'Андрей разрабатывает приложение персонального ИИ-ассистента с памятью — личный проект, не связан с Joywood'\n"
    "- CRITICAL category assignment (use Russian names):\n"
    "  * 'Личное' = personal identity: name, age, location, family, hobbies, personal life\n"
    "  * 'Личные проекты' = personal projects NOT related to main business\n"
    "  * 'О компании' = ONLY Joywood business facts\n"
    "  * 'Финансы' = Joywood finances only\n"
    "  * 'Рынок' = Joywood market, competitors, customers\n"
    "  * 'Команда' = Joywood employees and partners\n"
    "  * NEVER use 'Другое' for personal data — use 'Личное' instead\n"
    "- subcategory: 1-3 descriptive Russian words (e.g. 'Семья', 'Возраст', 'Локация')\n"
    "- confidence 0..1 — skip if < 0.6\n"
    "- reason: one short sentence for logs"
)

SUBCATEGORY_LIMIT = 20

# Категории → ключевые слова для маршрутизации
CATEGORY_HINTS = {
    "Финансы":    ["деньги","бюджет","выручка","прибыль","расход","инвестиц","цена","стоимость","оплата","финанс","доход","налог","кредит","долг","маржа","cac","ltv","arr","mrr"],
    "Команда":    ["команда","сотрудник","найм","hr","человек","люди","разработчик","менеджер","директор","партнёр","коллег","штат","уволь","зарплат"],
    "Рынок":      ["рынок","конкурент","клиент","сегмент","аудитор","спрос","продаж","маркетинг","канал","лид","сделк","b2b","b2c","ниша","тренд"],
    "О компании": ["компания","продукт","сервис","запуск","стратег","цель","миссия","офис","юрлицо","ооо","ип","бренд","название","логотип"],
}


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
        if a == "profile":
            return facts_profile(qs)
        if a == "create" or (not a and method == "POST"):
            return facts_create(body)
        if a == "update":
            return facts_update(rid, body)
        if a == "reindex":
            return facts_reindex()
        if a == "clear":
            return facts_clear()
        if a == "delete" or (not a and method == "DELETE"):
            return facts_delete(rid)

    if r == "settings":
        if a == "get" or (not a and method == "GET"):
            return settings_get()
        if a == "save" or (not a and method == "POST"):
            return settings_save(body)

    if r == "summaries":
        if a == "list" or (not a and method == "GET"):
            return summaries_list()
        if a == "save" or (not a and method == "POST"):
            return summaries_save(body)

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
    welcome = "Привет! Давайте познакомимся, чтобы я мог лучше вам помогать. Как вас зовут?"
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

        # Memory gate перенесён на фронтенд (бэкенд заблокирован по гео OpenAI)

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
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def _detect_category_hint(text: str) -> str | None:
    """Определяет категорию по ключевым словам запроса для маршрутизации."""
    t = text.lower()
    scores = {cat: sum(1 for kw in hints if kw in t) for cat, hints in CATEGORY_HINTS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


def _keywords_from_text(text: str) -> list:
    """Простое извлечение ключевых слов без LLM: существительные длиной ≥4, нормализованные."""
    words = re.sub(r"[^\w\s]", " ", text.lower()).split()
    stop = {"это","что","как","так","для","при","или","но","же","бы","ли","из","за","под","над","его","её","их","там","тут","уже","ещё","если","когда","also","that","this","with","from","have","will","been","they","your","their","more","some","very","just","than","then","into","over","after","before","about","which"}
    return list(dict.fromkeys(w for w in words if len(w) >= 4 and w not in stop))[:12]


def _memory_gate(session_id: str, user_msg: str, assistant_msg: str) -> None:
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

        # Релевантные факты для контекста gate (анти-дуп)
        with con.cursor() as cur:
            cur.execute("SELECT text, category, subcategory FROM facts")
            existing_rows = cur.fetchall()
        existing: dict[str, set] = {}
        existing_subcats: set = set()
        for t, c, sc in existing_rows:
            existing.setdefault(c, set()).add(_normalize(t))
            if sc:
                existing_subcats.add(sc)

        existing_sample = "\n".join(
            f"- [{c}] {t}" for t, c, _ in existing_rows[:8]
        ) or "none"

        user_content = (
            f"USER: {user_msg}\n\n"
            f"ASSISTANT: {assistant_msg}\n\n"
            f"EXISTING FACTS (do not duplicate):\n{existing_sample}"
        )

        raw = _llm_call(base_url, api_key, model, [
            {"role": "system", "content": MEMORY_GATE_SYSTEM},
            {"role": "user", "content": user_content},
        ])
        print(f"[GATE] raw: {raw[:500]}")

        try:
            # Ищем JSON даже если модель обернула в ```json ... ```
            json_match = re.search(r'\{.*\}', raw, re.DOTALL)
            result = json.loads(json_match.group(0) if json_match else raw)
        except Exception:
            print(f"[GATE] invalid JSON: {raw[:300]}")
            return

        should_write = result.get("should_write", False)
        reason = result.get("reason", "—")
        candidates = result.get("facts", []) or []
        print(f"[GATE] should_write={should_write} | reason: {reason}")

        if not should_write or not candidates:
            return

        ts = now_iso()
        inserted = 0
        for item in candidates:
            if not isinstance(item, dict):
                continue
            text = (item.get("text") or "").strip()
            confidence = float(item.get("confidence", 0))
            raw_cat = (item.get("category") or "Другое").strip()
            raw_sub = (item.get("subcategory") or "").strip()
            if not text or confidence < 0.6:
                continue

            # Используем категорию как есть (title case), только старые технические значения нормализуем
            category = CATEGORY_MAP.get(raw_cat.lower(), raw_cat) if raw_cat.lower() in CATEGORY_MAP else raw_cat
            norm = _normalize(text)
            if norm in existing.get(category, set()):
                print(f"[GATE] dup skip [{category}]: {text[:50]}")
                continue

            subcategory = _normalize_subcategory(raw_sub, existing_subcats)
            fid = str(uuid.uuid4())
            with con.cursor() as cur:
                cur.execute(
                    "INSERT INTO facts (id, text, category, subcategory, source, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (fid, text, category, subcategory, "memory_gate", ts, ts),
                )
            con.commit()
            existing.setdefault(category, set()).add(norm)
            existing_subcats.add(subcategory)
            inserted += 1
            print(f"[GATE] +fact [{category}/{subcategory}]: {text[:70]}")

        print(f"[GATE] saved {inserted} fact(s) for session {session_id[:8]}")

    except urllib.error.HTTPError as e:
        print(f"[GATE] HTTP {e.code}: {e.read().decode('utf-8', errors='ignore')[:200]}")
    except urllib.error.URLError as e:
        print(f"[GATE] URL error: {e.reason}")
    except Exception as ex:
        print(f"[GATE] unexpected: {ex}")
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


def facts_clear() -> dict:
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM category_summaries")
            cur.execute("DELETE FROM facts")
            deleted = cur.rowcount
        con.commit()
        return ok({"cleared": deleted})
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
    raw_limit = qs.get("limit", "10")
    limit = int(raw_limit) if raw_limit.isdigit() else 10

    con = get_db()
    try:
        words = _keywords_from_text(q) if q else []
        cat_hint = _detect_category_hint(q) if q else None
        rows = []

        if words:
            kw_array = words  # GIN поиск: keywords && ARRAY[...]

            # 1. Поиск через GIN-индекс по keywords (быстро, масштабируется)
            with con.cursor() as cur:
                cur.execute(
                    "SELECT id, text, category, subcategory, keywords, source, created_at "
                    "FROM facts WHERE keywords && %s::text[] "
                    "ORDER BY updated_at DESC LIMIT 100",
                    (kw_array,),
                )
                rows = rows_to_list(cur)

            # 2. Fallback: ILIKE по тексту если GIN ничего не дал
            if not rows:
                conditions = " OR ".join(["text ILIKE %s"] * len(words))
                params = [f"%{w}%" for w in words]
                with con.cursor() as cur:
                    cur.execute(
                        f"SELECT id, text, category, subcategory, keywords, source, created_at "
                        f"FROM facts WHERE {conditions} ORDER BY updated_at DESC LIMIT 100",
                        params,
                    )
                    rows = rows_to_list(cur)

            # Ранжирование: кол-во совпавших keywords + бонус за совпадение категории
            def score(row: dict) -> int:
                fact_kw = set(row.get("keywords") or [])
                query_kw = set(words)
                hits = len(fact_kw & query_kw)
                cat_bonus = 2 if cat_hint and row.get("category") == cat_hint else 0
                return hits + cat_bonus

            rows.sort(key=score, reverse=True)
            rows = rows[:limit]

        # Fallback: последние N фактов (когда запрос пустой или ничего не нашли)
        if not rows:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT id, text, category, subcategory, keywords, source, created_at "
                    "FROM facts ORDER BY updated_at DESC LIMIT %s",
                    (limit,),
                )
                rows = rows_to_list(cur)

        con.commit()
        return ok(rows)
    finally:
        con.close()


def facts_profile(qs: dict) -> dict:
    raw_limit = qs.get("limit_per_section", "5")
    limit_per_section = int(raw_limit) if raw_limit.isdigit() else 5

    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT category, subcategory, text, updated_at "
                "FROM facts ORDER BY category ASC, subcategory ASC NULLS LAST, updated_at DESC"
            )
            rows = cur.fetchall()
        con.commit()
    finally:
        con.close()

    # Группируем в Python
    from collections import defaultdict
    grouped: dict = defaultdict(lambda: defaultdict(list))
    for cat, sub, text, upd in rows:
        sub_key = sub if sub else "Общее"
        grouped[cat][sub_key].append({"text": text, "updated_at": str(upd) if upd else ""})

    profile = []
    for cat in sorted(grouped.keys()):
        sections = []
        for sub_key in sorted(grouped[cat].keys()):
            items = grouped[cat][sub_key][:limit_per_section]
            sections.append({"subcategory": sub_key, "items": items})
        profile.append({"category": cat, "sections": sections})

    all_subcats = {(cat, sub) for cat, sub, *_ in rows if sub}
    stats = {
        "facts_total": len(rows),
        "categories": len(grouped),
        "subcategories": len(all_subcats),
    }

    return ok({"profile": profile, "stats": stats})


def facts_create(body: dict) -> dict:
    text = (body.get("text") or body.get("content") or "").strip()
    if not text:
        return err("text is required")
    category = body.get("category", "Другое")
    source = body.get("source", "manual")
    raw_sub = (body.get("subcategory") or "").strip()
    subcategory = re.sub(r"\s+", " ", raw_sub)[:32].title() if raw_sub else None
    # keywords = переданные явно ИЛИ извлечённые из текста
    raw_kw = body.get("keywords") or []
    keywords = raw_kw if isinstance(raw_kw, list) else _keywords_from_text(text)
    if not keywords:
        keywords = _keywords_from_text(text)
    # Добавляем subcategory и category как дополнительные якоря
    for anchor in [subcategory, category]:
        if anchor:
            for w in anchor.lower().split():
                if w not in keywords:
                    keywords.append(w)
    keywords = keywords[:15]

    fid, ts = str(uuid.uuid4()), now_iso()
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO facts (id, text, category, subcategory, keywords, source, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (fid, text, category, subcategory, keywords, source, ts, ts),
            )
        con.commit()
        return ok({"id": fid, "text": text, "category": category, "subcategory": subcategory,
                   "keywords": keywords, "source": source, "created_at": ts, "updated_at": ts}, 201)
    finally:
        con.close()


def facts_update(fid: str, body: dict) -> dict:
    if not fid:
        return err("id required")
    fields, params = [], []
    new_text = body.get("text", "").strip() if "text" in body else None
    new_cat = body.get("category") if "category" in body else None
    new_sub_raw = body.get("subcategory", "").strip() if "subcategory" in body else None
    new_sub = re.sub(r"\s+", " ", new_sub_raw)[:32].title() if new_sub_raw else None

    if new_text:
        fields.append("text = %s"); params.append(new_text)
    if new_cat:
        fields.append("category = %s"); params.append(new_cat)
    if "subcategory" in body:
        fields.append("subcategory = %s"); params.append(new_sub)

    # Пересчитываем keywords если изменился текст, категория или подкатегория
    if new_text or new_cat or "subcategory" in body:
        con2 = get_db()
        try:
            with con2.cursor() as cur:
                cur.execute("SELECT text, category, subcategory FROM facts WHERE id = %s", (fid,))
                existing = cur.fetchone()
        finally:
            con2.close()
        if existing:
            t = new_text or existing[0]
            c = new_cat or existing[1]
            s = new_sub or existing[2]
            kw = _keywords_from_text(t)
            for anchor in [s, c]:
                if anchor:
                    for w in anchor.lower().split():
                        if w not in kw: kw.append(w)
            fields.append("keywords = %s"); params.append(kw[:15])

    if not fields:
        return err("nothing to update")
    fields.append("updated_at = %s"); params.append(now_iso())
    params.append(fid)
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(f"UPDATE facts SET {', '.join(fields)} WHERE id = %s", params)
            if cur.rowcount == 0:
                return err("fact not found", 404)
        con.commit()
        return ok({"updated": fid})
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


def facts_reindex() -> dict:
    """Пересчитывает keywords для всех фактов у которых keywords пустые."""
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, text, category, subcategory FROM facts "
                "WHERE keywords IS NULL OR keywords = '{}' ORDER BY created_at DESC LIMIT 500"
            )
            rows = cur.fetchall()

        updated = 0
        ts = now_iso()
        for fid, text, category, subcategory in rows:
            kw = _keywords_from_text(text)
            for anchor in [subcategory, category]:
                if anchor:
                    for w in anchor.lower().split():
                        if w not in kw:
                            kw.append(w)
            kw = kw[:15]
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE facts SET keywords = %s, updated_at = %s WHERE id = %s",
                    (kw, ts, fid),
                )
            con.commit()
            updated += 1

        return ok({"reindexed": updated})
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


# ── Category Summaries ─────────────────────────────────────────

def summaries_list() -> dict:
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT category, summary, facts_count, updated_at FROM category_summaries ORDER BY category")
            rows = rows_to_list(cur)
        con.commit()
        return ok(rows)
    finally:
        con.close()

def summaries_save(body: dict) -> dict:
    category = body.get("category", "").strip()
    summary = body.get("summary", "").strip()
    facts_count = int(body.get("facts_count", 0))
    if not category or not summary:
        return err("category and summary required", 400)
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""
                INSERT INTO category_summaries (category, summary, facts_count, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (category) DO UPDATE
                SET summary = EXCLUDED.summary,
                    facts_count = EXCLUDED.facts_count,
                    updated_at = NOW()
            """, (category, summary, facts_count))
        con.commit()
        return ok({"saved": True})
    finally:
        con.close()


# ── Entry point ────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """Персональный ассистент API: sessions, messages, facts, settings + авто-извлечение фактов."""
    return route(event)