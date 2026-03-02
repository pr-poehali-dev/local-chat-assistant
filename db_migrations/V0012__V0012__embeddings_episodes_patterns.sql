ALTER TABLE t_p4825665_local_chat_assistant.facts ADD COLUMN IF NOT EXISTS embedding real[];

CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.episodes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    session_id  TEXT,
    happened_at TEXT,
    category    TEXT NOT NULL DEFAULT 'Событие',
    embedding   real[],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.patterns (
    id          TEXT PRIMARY KEY,
    text        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Паттерн',
    evidence    TEXT,
    count       INTEGER NOT NULL DEFAULT 1,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
