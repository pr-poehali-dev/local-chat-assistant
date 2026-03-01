CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New dialog',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON t_p4825665_local_chat_assistant.messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.facts (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facts_category ON t_p4825665_local_chat_assistant.facts(category);

CREATE TABLE IF NOT EXISTS t_p4825665_local_chat_assistant.settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    api_key TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'gpt-4o',
    temperature FLOAT NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 2048,
    system_prompt TEXT NOT NULL DEFAULT '',
    toggles_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO t_p4825665_local_chat_assistant.settings (id) VALUES (1) ON CONFLICT DO NOTHING;
