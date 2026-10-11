// DATABASE_URL 未設定なら保存先なし（デモは localStorage だけで動く）

let sql = null;
let driverError = null;

function db() {
  if (sql || driverError) return sql;
  if (!process.env.DATABASE_URL) return null;

  try {
    // HTTP ドライバなのでサーバーレスでも接続が枯渇しない
    const { neon } = require('@neondatabase/serverless');
    sql = neon(process.env.DATABASE_URL);
  } catch (err) {
    // ドライバが無くてもデモは止めない
    driverError = err;
    sql = null;
  }
  return sql;
}

function isEnabled() {
  return !!db();
}

// タグ付きテンプレート。必ず sql`...` で使う（プレースホルダ化される）
function client() {
  return db();
}

function toRecord(row) {
  return {
    id: row.id,
    token: row.token,
    candidate: { name: row.candidate_name, role: row.candidate_role },
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationSec: row.duration_sec,
    mode: row.mode,
    answers: row.answers || [],
    scores: row.scores || {},
    total: row.total,
    comment: row.comment || '',
    humanDecision: row.human_decision,
    humanMemo: row.human_memo || '',
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

// 記録失敗で本処理は止めない
async function audit(action, target, detail = {}, actor = 'system') {
  const q = db();
  if (!q) return;

  // actor は文字列か担当者オブジェクト
  const isUser = actor && typeof actor === 'object';
  const label = isUser ? (actor.email || actor.id) : String(actor);
  const actorId = isUser ? actor.id : null;
  const actorEmail = isUser ? actor.email : null;

  try {
    await q`INSERT INTO audit_log (actor, actor_id, actor_email, action, target, detail)
            VALUES (${label}, ${actorId}, ${actorEmail}, ${action}, ${target},
                    ${JSON.stringify(detail)}::jsonb)`;
  } catch (_) { /* 無視 */ }
}

// 同じ id は上書き（回線切れ時の二重送信対策）
async function saveSession(rec) {
  const q = db();
  if (!q) return null;

  await q`
    INSERT INTO interview_sessions (
      id, token, candidate_name, candidate_role,
      started_at, finished_at, duration_sec, mode,
      answers, scores, total, comment
    ) VALUES (
      ${rec.id}, ${rec.token || null}, ${rec.candidate.name}, ${rec.candidate.role},
      ${rec.startedAt}, ${rec.finishedAt}, ${rec.durationSec || 0}, ${rec.mode || 'demo'},
      ${JSON.stringify(rec.answers || [])}::jsonb,
      ${JSON.stringify(rec.scores || {})}::jsonb,
      ${rec.total || 0}, ${rec.comment || ''}
    )
    ON CONFLICT (id) DO UPDATE SET
      answers = EXCLUDED.answers,
      scores  = EXCLUDED.scores,
      total   = EXCLUDED.total,
      comment = EXCLUDED.comment
  `;
  // human_decision / human_memo は触らない（応募者側の送信で人事の判断を上書きさせない）

  // URL は使い切り
  if (rec.token) {
    try { await markUsed(rec.token); } catch (_) { /* 記録は保存済みなので続行 */ }
  }

  await audit('session.save', rec.id, { total: rec.total, mode: rec.mode }, 'candidate');
  return rec.id;
}

async function listSessions(limit = 200) {
  const q = db();
  if (!q) return [];
  const rows = await q`
    SELECT * FROM interview_sessions
    ORDER BY total DESC, finished_at DESC
    LIMIT ${limit}
  `;
  return rows.map(toRecord);
}

// 合否は人事の操作だけ。AI はここを通らない
async function decideSession(id, { decision, memo, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  const valid = ['pass', 'hold', 'reject', null];
  if (!valid.includes(decision)) throw Object.assign(new Error('不正な判断値です。'), { status: 400 });

  const actorLabel = (actor && typeof actor === 'object')
    ? (actor.name ? `${actor.name}（${actor.email}）` : actor.email)
    : String(actor);

  const rows = await q`
    UPDATE interview_sessions SET
      human_decision = ${decision},
      human_memo     = ${memo || ''},
      decided_by     = ${decision === null ? null : actorLabel},
      decided_at     = ${decision === null ? null : new Date().toISOString()}
    WHERE id = ${id}
    RETURNING *
  `;
  if (!rows.length) throw Object.assign(new Error('該当する記録がありません。'), { status: 404 });

  await audit('session.decide', id, { decision, memo: (memo || '').slice(0, 200) }, actor);
  return toRecord(rows[0]);
}

const crypto = require('crypto');

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// 画面と応募者側の両方がここで判定する
function statusOf(row) {
  const now = Date.now();
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'done';
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return 'expired';
  if (row.started_at) return 'in_progress';
  return 'pending';
}

function toCandidate(row) {
  return {
    token: row.token,
    name: row.name,
    role: row.role,
    email: row.email || '',
    note: row.note || '',
    appliedOn: row.applied_on,
    expiresAt: row.expires_at,
    startedAt: row.started_at,
    usedAt: row.used_at,
    invitedAt: row.invited_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: statusOf(row),
  };
}

async function listCandidates(limit = 300) {
  const q = db();
  if (!q) return [];
  const rows = await q`SELECT * FROM candidates ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(toCandidate);
}

function actorLabel(actor) {
  if (actor && typeof actor === 'object') return actor.email || actor.id || 'unknown';
  return String(actor);
}

async function createCandidate({ name, role, email, note, expiresInDays = 14, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  const token = newToken();
  const expiresAt = new Date(Date.now() + Math.max(1, expiresInDays) * 86400000).toISOString();

  const rows = await q`
    INSERT INTO candidates (token, name, role, email, note, applied_on, expires_at, created_by)
    VALUES (${token}, ${name}, ${role}, ${email || null}, ${note || ''}, CURRENT_DATE, ${expiresAt}, ${actorLabel(actor)})
    RETURNING *
  `;
  await audit('candidate.create', token, { name, role, expiresAt }, actor);
  return toCandidate(rows[0]);
}

// 応募者側用。1件だけ返す
async function getCandidate(token) {
  const q = db();
  if (!q) return null;
  const rows = await q`SELECT * FROM candidates WHERE token = ${token} LIMIT 1`;
  return rows.length ? toCandidate(rows[0]) : null;
}

// 再開時は上書きしない
async function markStarted(token) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    UPDATE candidates SET started_at = COALESCE(started_at, now())
    WHERE token = ${token} AND revoked_at IS NULL AND used_at IS NULL
    RETURNING *
  `;
  return rows.length ? toCandidate(rows[0]) : null;
}

async function markUsed(token) {
  const q = db();
  if (!q || !token) return null;
  const rows = await q`
    UPDATE candidates SET used_at = COALESCE(used_at, now())
    WHERE token = ${token}
    RETURNING *
  `;
  return rows.length ? toCandidate(rows[0]) : null;
}

async function updateCandidate(token, { revoke, extendDays, invited, actor = 'hr' }) {
  const q = db();
  if (!q) return null;

  if (revoke === true) {
    await q`UPDATE candidates SET revoked_at = now() WHERE token = ${token}`;
    await audit('candidate.revoke', token, {}, actor);
  }
  if (revoke === false) {
    await q`UPDATE candidates SET revoked_at = NULL WHERE token = ${token}`;
    await audit('candidate.unrevoke', token, {}, actor);
  }
  if (extendDays) {
    const days = Math.max(1, Math.min(365, Number(extendDays)));
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await q`UPDATE candidates SET expires_at = ${until} WHERE token = ${token}`;
    await audit('candidate.extend', token, { days }, actor);
  }
  if (invited) {
    await q`UPDATE candidates SET invited_at = now() WHERE token = ${token}`;
    await audit('candidate.invite', token, {}, actor);
  }

  const rows = await q`SELECT * FROM candidates WHERE token = ${token} LIMIT 1`;
  return rows.length ? toCandidate(rows[0]) : null;
}

// 保存期間（日）。規程に合わせて環境変数で変える
const RETENTION = {
  session:   Number(process.env.RETENTION_DAYS_SESSION   || 180),
  candidate: Number(process.env.RETENTION_DAYS_CANDIDATE || 365),
  audit:     Number(process.env.RETENTION_DAYS_AUDIT     || 730),
};

function retentionPolicy() {
  return { ...RETENTION };
}

// 論理削除にはしない。削除請求には物理削除で応える
async function purgeCandidate(token, actor = 'hr') {
  const q = db();
  if (!q) return null;

  const sessions = await q`DELETE FROM interview_sessions WHERE token = ${token} RETURNING id`;
  await q`DELETE FROM candidates WHERE token = ${token}`;

  // 監査ログには消した事実だけ。氏名・回答は残さない
  await audit('data.purge', token, { sessions: sessions.length, reason: 'request' }, actor);
  return { sessions: sessions.length };
}

async function purgeSession(id, actor = 'hr') {
  const q = db();
  if (!q) return null;
  await q`DELETE FROM interview_sessions WHERE id = ${id}`;
  await audit('data.purge', id, { reason: 'request' }, actor);
  return true;
}

// cron から日次
async function purgeExpired() {
  const q = db();
  if (!q) return null;

  const days = (n) => `${Math.max(1, n)} days`;

  const sessions = await q`
    DELETE FROM interview_sessions
    WHERE finished_at < now() - ${days(RETENTION.session)}::interval
    RETURNING id
  `;

  // 面接記録が残っている候補者は消さない
  const candidates = await q`
    DELETE FROM candidates
    WHERE created_at < now() - ${days(RETENTION.candidate)}::interval
      AND NOT EXISTS (
        SELECT 1 FROM interview_sessions s WHERE s.token = candidates.token
      )
    RETURNING token
  `;

  const audits = await q`
    DELETE FROM audit_log
    WHERE at < now() - ${days(RETENTION.audit)}::interval
    RETURNING id
  `;

  // 未回答質問は自由入力で個人情報が混ざりうるので面接記録と同じ期間で消す
  let misses = 0;
  try {
    misses = await require('./_insights.js').purgeOldMisses(RETENTION.session);
  } catch (_) { /* テーブル未作成でも続行 */ }

  const result = {
    sessions: sessions.length,
    candidates: candidates.length,
    auditEntries: audits.length,
    chatMisses: misses,
  };

  // 件数だけ記録（個人を特定できる情報は書かない）
  await audit('data.purge_expired', null, { ...result, retention: RETENTION }, 'system');
  return result;
}

async function createDeletionRequest({ token, name, email, message }) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    INSERT INTO deletion_requests (token, name, email, message)
    VALUES (${token || null}, ${name || null}, ${email || null}, ${message || ''})
    RETURNING id, requested_at
  `;
  // 本文に個人情報が含まれうるので監査ログには書かない
  await audit('deletion.request', String(rows[0].id), {}, 'candidate');
  return rows[0];
}

async function listDeletionRequests() {
  const q = db();
  if (!q) return [];
  const rows = await q`
    SELECT * FROM deletion_requests
    ORDER BY (status = 'open') DESC, requested_at DESC
    LIMIT 200
  `;
  return rows.map((r) => ({
    id: r.id,
    requestedAt: r.requested_at,
    token: r.token,
    name: r.name,
    email: r.email,
    message: r.message,
    status: r.status,
    handledAt: r.handled_at,
    note: r.note,
  }));
}

// 対応済みにすると同時に依頼中の個人情報も消す
async function closeDeletionRequest(id, { status = 'done', note = '', actor = 'hr' }) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    UPDATE deletion_requests SET
      status     = ${status},
      handled_at = now(),
      handled_by = ${actorLabel(actor)},
      note       = ${note},
      name       = NULL,
      email      = NULL,
      message    = ''
    WHERE id = ${id}
    RETURNING id, status
  `;
  await audit('deletion.close', String(id), { status }, actor);
  return rows.length ? rows[0] : null;
}

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    lastLoginAt: row.last_login_at,
  };
}

async function countUsers() {
  const q = db();
  if (!q) return 0;
  const rows = await q`SELECT count(*)::int AS n FROM users WHERE disabled_at IS NULL`;
  return rows[0] ? rows[0].n : 0;
}

async function getUser(id) {
  const q = db();
  if (!q) return null;
  const rows = await q`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return rows.length ? toUser(rows[0]) : null;
}

async function authenticate(email, keyHash) {
  const q = db();
  if (!q) return null;
  const rows = await q`
    SELECT * FROM users
    WHERE lower(email) = lower(${email}) AND key_hash = ${keyHash} AND disabled_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return null;
  await q`UPDATE users SET last_login_at = now() WHERE id = ${rows[0].id}`;
  return toUser(rows[0]);
}

async function listUsers() {
  const q = db();
  if (!q) return [];
  const rows = await q`SELECT * FROM users ORDER BY disabled_at NULLS FIRST, created_at ASC`;
  return rows.map(toUser);
}

async function createUser({ email, name, role, keyHash, actor = 'system' }) {
  const q = db();
  if (!q) return null;
  const id = crypto.randomBytes(12).toString('base64url');
  const rows = await q`
    INSERT INTO users (id, email, name, role, key_hash, created_by)
    VALUES (${id}, ${email}, ${name}, ${role}, ${keyHash}, ${actor})
    RETURNING *
  `;
  return toUser(rows[0]);
}

async function updateUser(id, { role, disabled, keyHash }) {
  const q = db();
  if (!q) return null;
  if (role) await q`UPDATE users SET role = ${role} WHERE id = ${id}`;
  if (disabled === true) await q`UPDATE users SET disabled_at = now() WHERE id = ${id}`;
  if (disabled === false) await q`UPDATE users SET disabled_at = NULL WHERE id = ${id}`;
  if (keyHash) await q`UPDATE users SET key_hash = ${keyHash} WHERE id = ${id}`;
  return getUser(id);
}

async function listAudit({ limit = 200, target = null } = {}) {
  const q = db();
  if (!q) return [];
  const rows = target
    ? await q`SELECT * FROM audit_log WHERE target = ${target} ORDER BY at DESC LIMIT ${limit}`
    : await q`SELECT * FROM audit_log ORDER BY at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    target: r.target,
    actor: r.actor,
    actorEmail: r.actor_email,
    detail: r.detail,
  }));
}

module.exports = {
  isEnabled, client, saveSession, listSessions, decideSession, audit,
  countUsers, getUser, authenticate, listUsers, createUser, updateUser, listAudit,
  listCandidates, createCandidate, getCandidate,
  markStarted, markUsed, updateCandidate, statusOf,
  retentionPolicy, purgeCandidate, purgeSession, purgeExpired,
  createDeletionRequest, listDeletionRequests, closeDeletionRequest,
};
