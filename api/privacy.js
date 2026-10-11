// 削除請求の POST は鍵不要だが受付のみ。本人確認なしで消すと他人が消せてしまうので、削除は人事が行う

const auth = require('./_auth.js');
const store = require('./_store.js');

const MAX_TEXT = 2000;

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query || {};
  const body = readBody(req);

  // 開示は公開。個人情報は含めない
  if (req.method === 'GET' && !q.requests) {
    const policy = store.isEnabled()
      ? store.retentionPolicy()
      : { session: 0, candidate: 0, audit: 0 };

    res.status(200).json({
      storage: store.isEnabled() ? 'db' : 'local',
      retentionDays: policy,
      aiProvider: process.env.ANTHROPIC_API_KEY ? 'Anthropic (Claude)' : null,
      contact: process.env.PRIVACY_CONTACT || '',
    });
    return;
  }

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    if (req.method === 'POST' && body.action === 'request') {
      const name = String(body.name || '').trim().slice(0, 200);
      const email = String(body.email || '').trim().slice(0, 200);
      if (!name && !email) {
        res.status(400).json({ error: 'お名前またはメールアドレスをご入力ください。' });
        return;
      }
      const saved = await store.createDeletionRequest({
        token: String(body.token || '').slice(0, 200),
        name,
        email,
        message: String(body.message || '').slice(0, MAX_TEXT),
      });
      res.status(200).json({ ok: true, receivedAt: saved.requested_at });
      return;
    }

    // ここから人事のみ

    if (req.method === 'GET' && q.requests) {
      const me = await auth.requireRole(req, res, 'viewer');
      if (!me) return;
      res.status(200).json({ requests: await store.listDeletionRequests() });
      return;
    }

    if (req.method === 'PATCH') {
      const me = await auth.requireRole(req, res, 'reviewer');
      if (!me) return;
      if (!body.id) {
        res.status(400).json({ error: '対象が指定されていません。' });
        return;
      }
      const result = await store.closeDeletionRequest(Number(body.id), {
        status: body.status === 'rejected' ? 'rejected' : 'done',
        note: String(body.note || '').slice(0, MAX_TEXT),
        actor: me,
      });
      res.status(200).json({ ok: true, request: result });
      return;
    }

    // 取り消せないので admin のみ
    if (req.method === 'DELETE') {
      const me = await auth.requireRole(req, res, 'admin');
      if (!me) return;

      if (q.token) {
        const result = await store.purgeCandidate(String(q.token), me);
        res.status(200).json({ ok: true, deleted: result });
        return;
      }
      if (q.id) {
        await store.purgeSession(String(q.id), me);
        res.status(200).json({ ok: true });
        return;
      }
      res.status(400).json({ error: '削除対象が指定されていません。' });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
