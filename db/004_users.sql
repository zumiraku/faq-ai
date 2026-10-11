-- 001〜003 の後に適用

-- key_hash は sha256。平文のキーは保存しない
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'reviewer'
                 CHECK (role IN ('viewer', 'reviewer', 'admin')),
  key_hash     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  disabled_at  TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id    TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_email TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id, at DESC);

-- HR_ACCESS_TOKEN は users が空のあいだの初期設定専用。管理者を作ったら環境変数から消す
