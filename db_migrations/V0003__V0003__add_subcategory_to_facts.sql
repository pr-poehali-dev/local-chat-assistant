ALTER TABLE t_p4825665_local_chat_assistant.facts
    ADD COLUMN IF NOT EXISTS subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_facts_subcategory
    ON t_p4825665_local_chat_assistant.facts(subcategory)
    WHERE subcategory IS NOT NULL;