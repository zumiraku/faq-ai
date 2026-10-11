// POST（応募者）は鍵不要、GET/PATCH は要ログイン。応募者に他人の回答は読ませない

const store = require('./_store.js');
const auth = require('./_auth.js');

const MAX_ANSWERS = 20;
const MAX_TEXT = 8000;

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

// 応募者側の記録は信用しない
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.candidate || !raw.candidate.name) return null;

  const answers = Array.isArray(raw.answers) ? raw.answers.slice(0, MAX_ANSWERS) : [];

  return {
    id: String(raw.id).slice(0, 200),
    token: raw.token ? String(raw.token).slice(0, 200) : null,
    candidate: {
      name: String(raw.candidate.name).slice(0, 200),
      role: String(raw.candidate.role || '').slice(0, 200),
    },
    startedAt: raw.startedAt || new Date().toISOString(),
    finishedAt: raw.finishedAt || new Date().toISOString(),
    durationSec: Number(raw.durationSec) || 0,
    mode: raw.mode === 'live' ? 'live' : 'demo',
    answers: answers.map((a) => ({
      id: String(a.id || '').slice(0, 50),
      axis: String(a.axis || '').slice(0, 50),
      question: String(a.question || '').slice(0, MAX_TEXT),
      text: String(a.text || '').slice(0, MAX_TEXT),
      seconds: Number(a.seconds) || 0,
    })),
    scores: (raw.scores && typeof raw.scores === 'object') ? raw.scores : {},
    total: Number(raw.total) || 0,
    comment: String(raw.comment || '').slice(0, MAX_TEXT),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // DB なしなら画面側が localStorage で処理する
  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const me = await auth.requireRole(req, res, 'viewer');
      if (!me) return;
      const records = await store.listSessions();
      res.status(200).json({ records });
      return;
    }

    if (req.method === 'POST') {
      const rec = sanitize(readBody(req));
      if (!rec) {
        res.status(400).json({ error: '記録の形式が正しくありません。' });
        return;
      }
      await store.saveSession(rec);
      res.status(200).json({ ok: true, id: rec.id });
      return;
    }

    if (req.method === 'PATCH') {
      const me = await auth.requireRole(req, res, 'reviewer');
      if (!me) return;

      const body = readBody(req);
      if (!body.id) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const record = await store.decideSession(String(body.id), {
        decision: body.decision === undefined ? null : body.decision,
        memo: String(body.memo || '').slice(0, MAX_TEXT),
        actor: me,
      });
      res.status(200).json({ ok: true, record });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || '処理に失敗しました。' });
  }
};

