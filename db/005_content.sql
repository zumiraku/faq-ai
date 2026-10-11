-- 001〜004 の後に適用

-- published = false は下書き
CREATE TABLE IF NOT EXISTS knowledge (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  question   TEXT NOT NULL,
  keywords   JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer     TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  published  BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_order ON knowledge (published, sort_order, id);

-- 深掘りの1問は自動生成なのでここには入らない
CREATE TABLE IF NOT EXISTS interview_questions (
  id         TEXT PRIMARY KEY,
  axis       TEXT NOT NULL,
  text       TEXT NOT NULL,
  hint       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_order ON interview_questions (enabled, sort_order, id);

-- key: company / video / axes。axes の key は記録と紐づくので変えない
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);
