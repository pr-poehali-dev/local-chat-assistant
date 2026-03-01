"""
Персональный ассистент — REST API
Sessions, Messages, Facts, Settings — PostgreSQL
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

SCHEMA = os.environ.get("MAIN_DB_SCHEMA", "t_p4825665_local_chat_assistant")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
    "Content-Type": "application/json",
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


def rows_to_list(cur) -> list:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def row_to_dict(cur) -> dict | None:
    cols = [d[0] for d in cur.description]
    row = cur.fetchone()
    return dict(zip(cols, row)) if row else None


# ── Router ─────────────────────────────────────────────────────

def route(event: dict) -> dict:
    method = event.get("httpMethod", "GET").upper()
    path = event.get("path", "/")
    qs = event.get("queryStringParameters") or {}
    body_raw = event.get("body") or "{}"
    try:
        body = json.loads(body_raw) if body_raw else {}
    except Exception:
        body = {}

    # Strip /api prefix
    if path.startswith("/api/"):
        path = path[4:]
    parts = [p for p in path.split("/") if p]

    # Strip leading project-id segment added by proxy (uuid or short alphanumeric)
    if parts and re.fullmatch(r"[0-9a-f\-]{32,36}|[a-z0-9]{20}", parts[0]):
        parts = parts[1:]

    if method == "OPTIONS":
        return ok({})

    if not parts:
        return ok({"status": "ok", "version": "2.0", "db": "postgres"})

    # /sessions
    if parts == ["sessions"]:
        if method == "GET":
            return sessions_list()
        if method == "POST":
            return sessions_create(body)

    # /sessions/{id}
    if len(parts) == 2 and parts[0] == "sessions":
        if method == "DELETE":
            return sessions_delete(parts[1])

    # /sessions/{id}/messages
    if len(parts) == 3 and parts[0] == "sessions" and parts[2] == "messages":
        sid = parts[1]
        if method == "GET":
            return messages_list(sid)
        if method == "POST":
            return messages_create(sid, body)

    # /facts
    if parts == ["facts"]:
        if method == "GET":
            return facts_list(qs)
        if method == "POST":
            return facts_create(body)

    # /facts/{id}
    if len(parts) == 2 and parts[0] == "facts":
        if method == "DELETE":
            return facts_delete(parts[1])

    # /settings
    if parts == ["settings"]:
        if method == "GET":
            return settings_get()
        if method == "POST":
            return settings_save(body)

    return err("Not found", 404)


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
    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = %s ORDER BY created_at ASC",
                (session_id,),
            )
            rows = rows_to_list(cur)
        con.commit()
        return ok(rows)
    finally:
        con.close()


def messages_create(session_id: str, body: dict) -> dict:
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
        return ok({"id": mid, "session_id": session_id, "role": role, "content": content, "created_at": ts}, 201)
    finally:
        con.close()


# ── Facts ──────────────────────────────────────────────────────

def facts_list(qs: dict) -> dict:
    category = qs.get("category", "")
    q = qs.get("q", "")
    try:
        limit = int(qs.get("limit", 200))
    except Exception:
        limit = 200

    conditions = []
    params: list = []

    if category and category != "Все":
        conditions.append("category = %s")
        params.append(category)
    if q:
        conditions.append("text ILIKE %s")
        params.append(f"%{q}%")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                f"SELECT id, text, category, source, created_at, updated_at FROM facts {where} ORDER BY created_at DESC LIMIT %s",
                params,
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
    fid = str(uuid.uuid4())
    ts = now_iso()

    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO facts (id, text, category, source, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (fid, text, category, source, ts, ts),
            )
        con.commit()
        return ok({"id": fid, "text": text, "category": category, "source": source, "created_at": ts, "updated_at": ts}, 201)
    finally:
        con.close()


def facts_delete(fid: str) -> dict:
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
            cur.execute("SELECT id, base_url, api_key, model, temperature, max_tokens, system_prompt, toggles_json FROM settings WHERE id = 1")
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
    ts = now_iso()
    toggles = body.get("toggles", {})
    toggles_json = json.dumps(toggles)

    con = get_db()
    try:
        with con.cursor() as cur:
            cur.execute("""
                UPDATE settings SET
                    base_url = %s,
                    api_key = %s,
                    model = %s,
                    temperature = %s,
                    max_tokens = %s,
                    system_prompt = %s,
                    toggles_json = %s
                WHERE id = 1
            """, (
                body.get("base_url", "https://api.openai.com/v1"),
                body.get("api_key", ""),
                body.get("model", "gpt-4o"),
                float(body.get("temperature", 0.7)),
                int(body.get("max_tokens", 2048)),
                body.get("system_prompt", ""),
                toggles_json,
            ))
        con.commit()
        return ok({"saved": True})
    finally:
        con.close()


# ── Entry point ────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """Персональный ассистент: REST API — сессии, сообщения, факты, настройки. БД: PostgreSQL."""
    return route(event)