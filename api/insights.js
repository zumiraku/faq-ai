// miss の POST は公開。残すのは質問文だけで入力者は記録しない

const insights = require('./_insights.js');
const content = require('./_content.js');
const auth = require('./_auth.js');
const store = require('./_store.js');

function readBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!store.isEnabled()) {
    res.status(501).json({ error: '保存先が未設定です。', storage: 'local' });
    return;
  }

  try {
    const body = readBody(req);

    if (req.method === 'POST' && body.action === 'miss') {
      await insights.recordMiss({
        question: body.question,
        bestScore: body.bestScore,
        bestId: body.bestId,
      });
      // 閲覧者には常に成功を返す
      res.status(200).json({ ok: true });
      return;
    }

    // ここから担当者のみ
    const me = await auth.requireRole(req, res, 'viewer');
    if (!me) return;

    if (req.method === 'GET') {
      const axes = await content.getSetting('axes', null)
        .then((a) => (Array.isArray(a) && a.length ? a : require('../assets/js/interview-data.js').AXES));

      const [misses, agreementReport] = await Promise.all([
        insights.listMisses(),
        insights.agreement(axes),
      ]);
      res.status(200).json({ misses, agreement: agreementReport });
      return;
    }

    if (req.method === 'PATCH') {
      const status = body.status === 'added' ? 'added' : 'ignored';
      const n = await insights.closeMisses(body.ids, status, me);
      res.status(200).json({ ok: true, updated: n });
      return;
    }

    res.status(405).json({ error: '対応していないメソッドです。' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
