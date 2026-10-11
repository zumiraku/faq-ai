-- 001 / 002 の後に適用

-- 対応の証跡として行は残すが、対応後は氏名・メールを消す
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           BIGSERIAL PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  token        TEXT,                -- 分かる場合のみ
  name         TEXT,                -- 対応後に NULL にする
  email        TEXT,                -- 対応後に NULL にする
  message      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'done', 'rejected')),
  handled_at   TIMESTAMPTZ,
  handled_by   TEXT,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_deletion_status ON deletion_requests (status, requested_at DESC);

-- 日次の自動削除用
CREATE INDEX IF NOT EXISTS idx_sessions_purge   ON interview_sessions (finished_at);
CREATE INDEX IF NOT EXISTS idx_candidates_purge ON candidates (created_at);

-- 保存期間は環境変数 RETENTION_DAYS_*（既定 面接180 / 候補者365 / 操作ログ730日）
