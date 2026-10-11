-- 001 の後に適用

-- token は JWT ではなく DB 管理（署名だけだと無効化・使い切りの判定ができない）
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS invited_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS created_by  TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS note        TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_candidates_created ON candidates (created_at DESC);
