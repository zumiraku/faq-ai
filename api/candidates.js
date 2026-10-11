// 応募者はトークン1件だけ。一覧は要ログイン（混ぜると全員分が読める）

const auth = require('./_auth.js');
const store = require('./_store.js');

const MAX_TEXT = 500;

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

// 応募者向け。メール・人事メモ・他候補者の情報は返さない
function publicView(c) {
  return {
    name: c.name,
    role: c.role,
    status: c.status,
    expiresAt: c.expiresAt,
    canStart: c.status === 'pending' || c.status === 'in_progress',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    const body = readBody(req);
    const queryToken = (req.query && req.query.token) ? String(req.query.token) : '';

    if (req.method === 'GET' && queryToken) {
      const c = await store.getCandidate(queryToken);
      if (!c) {
        res.status(404).json({ error: 'このURLは有効ではありません。' });
        return;
      }
      res.status(200).json({ candidate: publicView(c) });
      return;
    }

    if (req.method === 'POST' && body.action === 'start') {
      const token = String(body.token || '');
      const c = await store.getCandidate(token);
      if (!c) {
        res.status(404).json({ error: 'このURLは有効ではありません。' });
        return;
      }
      if (c.status !== 'pending' && c.status !== 'in_progress') {
        res.status(409).json({ error: 'このURLは使用できません。', candidate: publicView(c) });
        return;
      }
      const updated = await store.markStarted(token);
      res.status(200).json({ candidate: publicView(updated || c) });
      return;
    }

    // ここから人事のみ

    if (req.method === 'GET') {
      const me = await auth.requireRole(req, res, 'viewer');
      if (!me) return;
      const candidates = await store.listCandidates();
      res.status(200).json({ candidates });
      return;
    }

    if (req.method === 'POST') {
      // 登録＝招待なので viewer は不可
      const me = await auth.requireRole(req, res, 'reviewer');
      if (!me) return;

      const name = String(body.name || '').trim().slice(0, MAX_TEXT);
      const role = String(body.role || '').trim().slice(0, MAX_TEXT);
      if (!name || !role) {
        res.status(400).json({ error: '氏名と応募職種を入力してください。' });
        return;
      }

      const candidate = await store.createCandidate({
        name,
        role,
        email: String(body.email || '').trim().slice(0, MAX_TEXT),
        note: String(body.note || '').trim().slice(0, MAX_TEXT),
        expiresInDays: Number(body.expiresInDays) || 14,
        actor: me,
      });
      res.status(200).json({ candidate });
      return;
    }

    if (req.method === 'PATCH') {
      const me = await auth.requireRole(req, res, 'reviewer');
      if (!me) return;
      const token = String(body.token || '');
      if (!token) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const candidate = await store.updateCandidate(token, {
        revoke: body.revoke,
        extendDays: body.extendDays,
        invited: body.invited,
        actor: me,
      });
      if (!candidate) {
        res.status(404).json({ error: '該当する候補者がいません。' });
        return;
      }
      res.status(200).json({ candidate });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
