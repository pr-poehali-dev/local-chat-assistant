ALTER TABLE t_p4825665_local_chat_assistant.facts
    ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_facts_keywords_gin
    ON t_p4825665_local_chat_assistant.facts USING GIN (keywords);

COMMENT ON COLUMN t_p4825665_local_chat_assistant.facts.keywords
    IS 'Semantic keywords extracted by LLM for fast vector-free retrieval';