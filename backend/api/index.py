"""
Персональный ассистент — REST API
Sessions, Messages, Facts, Settings — хранится в SQLite
"""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

DB_PATH = "/tmp/analyst.db"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
    "Content-Type": "application/json",
}


def get_db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db():
    con = get_db()
    con.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Новый диалог',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS facts (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Другое',
            source TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
            api_key TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT 'gpt-4o',
            temperature REAL NOT NULL DEFAULT 0.7,
            max_tokens INTEGER NOT NULL DEFAULT 2048,
            system_prompt TEXT NOT NULL DEFAULT 'Ты — персональный ИИ-ассистент для анализа данных и принятия деловых решений.',
            toggles_json TEXT NOT NULL DEFAULT '{"autoExtract":true,"antiDuplicates":true,"topFacts":true}'
        );

        INSERT OR IGNORE INTO settings (id) VALUES (1);
    """)
    con.commit()
    con.close()


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


def route(event: dict) -> dict:
    method = event.get("httpMethod", "GET").upper()
    path = event.get("path", "/")
    qs = event.get("queryStringParameters") or {}
    body_raw = event.get("body") or "{}"
    try:
        body = json.loads(body_raw) if body_raw else {}
    except Exception:
        body = {}

    # Strip /api prefix if present
    if path.startswith("/api/"):
        path = path[4:]
    parts = [p for p in path.split("/") if p]

    # Strip leading project-id segment (uuid4 format) added by proxy
    import re
    if parts and re.fullmatch(r"[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}|[a-z0-9]{20}", parts[0]):
        parts = parts[1:]

    # OPTIONS preflight
    if method == "OPTIONS":
        return ok({})

    # ── health check ───────────────────────────────────────────
    if not parts or parts == []:
        return ok({"status": "ok", "version": "1.0"})

    # ── /sessions ──────────────────────────────────────────────
    if parts == ["sessions"]:
        if method == "GET":
            return sessions_list()
        if method == "POST":
            return sessions_create(body)

    # ── /sessions/{id} ─────────────────────────────────────────
    if len(parts) == 2 and parts[0] == "sessions":
        sid = parts[1]
        if method == "DELETE":
            return sessions_delete(sid)

    # ── /sessions/{id}/messages ────────────────────────────────
    if len(parts) == 3 and parts[0] == "sessions" and parts[2] == "messages":
        sid = parts[1]
        if method == "GET":
            return messages_list(sid)
        if method == "POST":
            return messages_create(sid, body)

    # ── /facts ─────────────────────────────────────────────────
    if parts == ["facts"]:
        if method == "GET":
            return facts_list(qs)
        if method == "POST":
            return facts_create(body)

    # ── /facts/{id} ────────────────────────────────────────────
    if len(parts) == 2 and parts[0] == "facts":
        fid = parts[1]
        if method == "DELETE":
            return facts_delete(fid)

    # ── /settings ──────────────────────────────────────────────
    if parts == ["settings"]:
        if method == "GET":
            return settings_get()
        if method == "POST":
            return settings_save(body)

    return err("Not found", 404)


# ── Sessions ───────────────────────────────────────────────────

def sessions_list() -> dict:
    con = get_db()
    rows = con.execute("""
        SELECT s.id, s.title, s.created_at, s.updated_at,
               (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS preview
        FROM sessions s
        ORDER BY s.updated_at DESC
    """).fetchall()
    con.close()
    return ok([dict(r) for r in rows])


def sessions_create(body: dict) -> dict:
    sid = str(uuid.uuid4())
    ts = now_iso()
    title = body.get("title", "Новый диалог")
    con = get_db()
    con.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (sid, title, ts, ts),
    )
    # Приветственное сообщение ассистента
    con.execute(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), sid, "assistant",
         "Готов к работе. Задайте вопрос по анализу данных или деловому решению.", ts),
    )
    con.commit()
    con.close()
    return ok({"id": sid, "title": title, "created_at": ts, "updated_at": ts}, 201)


def sessions_delete(sid: str) -> dict:
    con = get_db()
    con.execute("DELETE FROM sessions WHERE id = ?", (sid,))
    con.commit()
    con.close()
    return ok({"deleted": sid})


# ── Messages ───────────────────────────────────────────────────

def messages_list(session_id: str) -> dict:
    con = get_db()
    rows = con.execute(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
        (session_id,),
    ).fetchall()
    con.close()
    return ok([dict(r) for r in rows])


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
    # Проверяем что сессия существует
    row = con.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        con.close()
        return err("Session not found", 404)

    con.execute(
        "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        (mid, session_id, role, content, ts),
    )

    # Обновляем updated_at сессии и при необходимости заголовок
    title_update = ""
    if role == "user":
        new_title = content[:40] + ("..." if len(content) > 40 else "")
        title_update = new_title
        con.execute(
            "UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?",
            (ts, new_title, session_id),
        )
    else:
        con.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (ts, session_id))

    con.commit()
    con.close()
    return ok({"id": mid, "session_id": session_id, "role": role, "content": content, "created_at": ts}, 201)


# ── Facts ──────────────────────────────────────────────────────

def facts_list(qs: dict) -> dict:
    category = qs.get("category", "")
    q = qs.get("q", "")
    try:
        limit = int(qs.get("limit", 100))
    except Exception:
        limit = 100

    con = get_db()
    sql = "SELECT * FROM facts WHERE 1=1"
    params: list = []
    if category and category != "Все":
        sql += " AND category = ?"
        params.append(category)
    if q:
        sql += " AND text LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    rows = con.execute(sql, params).fetchall()
    con.close()
    return ok([dict(r) for r in rows])


def facts_create(body: dict) -> dict:
    text = body.get("text", "").strip() or body.get("content", "").strip()
    if not text:
        return err("text is required")
    category = body.get("category", "Другое")
    source = body.get("source", "manual")
    fid = str(uuid.uuid4())
    ts = now_iso()

    con = get_db()
    con.execute(
        "INSERT INTO facts (id, text, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (fid, text, category, source, ts, ts),
    )
    con.commit()
    con.close()
    return ok({"id": fid, "text": text, "category": category, "source": source, "created_at": ts}, 201)


def facts_delete(fid: str) -> dict:
    con = get_db()
    con.execute("DELETE FROM facts WHERE id = ?", (fid,))
    con.commit()
    con.close()
    return ok({"deleted": fid})


# ── Settings ───────────────────────────────────────────────────

def settings_get() -> dict:
    con = get_db()
    row = con.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    con.close()
    d = dict(row)
    try:
        d["toggles"] = json.loads(d.get("toggles_json", "{}"))
    except Exception:
        d["toggles"] = {}
    return ok(d)


def settings_save(body: dict) -> dict:
    ts = now_iso()
    toggles = body.get("toggles", {})
    toggles_json = json.dumps(toggles)

    con = get_db()
    con.execute("""
        UPDATE settings SET
            base_url = ?,
            api_key = ?,
            model = ?,
            temperature = ?,
            max_tokens = ?,
            system_prompt = ?,
            toggles_json = ?
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
    con.close()
    return ok({"saved": True})


# ── Entry point ────────────────────────────────────────────────

init_db()


def handler(event: dict, context) -> dict:
    """Персональный ассистент: REST API для сессий, сообщений, фактов и настроек."""
    return route(event)