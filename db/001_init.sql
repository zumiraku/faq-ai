-- psql "$DATABASE_URL" -f db/001_init.sql（何度流しても同じ結果）

CREATE TABLE IF NOT EXISTS candidates (
  token       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  email       TEXT,
  applied_on  DATE,
  expires_at  TIMESTAMPTZ,
  used_at     TIMESTAMPTZ,          -- 使い切り判定
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- human_decision は人事だけが書く。AI 側は NULL のまま（既定値も NULL）
CREATE TABLE IF NOT EXISTS interview_sessions (
  id              TEXT PRIMARY KEY,
  token           TEXT REFERENCES candidates(token) ON DELETE SET NULL,
  candidate_name  TEXT NOT NULL,
  candidate_role  TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ NOT NULL,
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  mode            TEXT NOT NULL DEFAULT 'demo',   -- demo | live
  answers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores          JSONB NOT NULL DEFAULT '{}'::jsonb,
  total           INTEGER NOT NULL DEFAULT 0,
  comment         TEXT,
  human_decision  TEXT CHECK (human_decision IN ('pass', 'hold', 'reject')),
  human_memo      TEXT NOT NULL DEFAULT '',
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_total    ON interview_sessions (total DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_decision ON interview_sessions (human_decision);
CREATE INDEX IF NOT EXISTS idx_sessions_finished ON interview_sessions (finished_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL DEFAULT 'unknown',
  action  TEXT NOT NULL,        -- session.save / session.decide / session.view
  target  TEXT,                 -- interview_sessions.id
  detail  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_at     ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target);

-- 動作確認用。本番では流さない
-- INSERT INTO candidates (token, name, role, applied_on) VALUES
--   ('demo-tanaka', '田中 陽子', 'Webエンジニア（中途採用）',                 '2026-08-25'),
--   ('demo-suzuki', '鈴木 健',   'エンジニア（ポテンシャル採用・未経験可）', '2026-08-26'),
--   ('demo-kato',   '加藤 美咲', 'カスタマーサポート（中途採用）',           '2026-08-27')
-- ON CONFLICT (token) DO NOTHING;
