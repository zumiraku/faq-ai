-- 001〜005 の後に適用

-- 自由入力なので個人情報が混ざりうる。入力者は記録しない（IP・識別子なし）、200字で切る、自動削除対象
CREATE TABLE IF NOT EXISTS chat_misses (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  question    TEXT NOT NULL,
  best_score  REAL NOT NULL DEFAULT 0,   -- 閾値未満
  best_id     TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'added', 'ignored')),
  handled_at  TIMESTAMPTZ,
  handled_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_misses_status ON chat_misses (status, at DESC);
CREATE INDEX IF NOT EXISTS idx_misses_at     ON chat_misses (at);
