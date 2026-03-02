-- Add confidence, status fields to facts table for conflict resolution
ALTER TABLE facts ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2) DEFAULT 1.0;
ALTER TABLE facts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Status values: 'active' | 'needs_review' | 'archived'
-- needs_review: conflict detected during consolidation (contradicts another fact)

CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence);