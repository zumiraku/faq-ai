// 保存期間切れの削除。Vercel Cron から日次（vercel.json の crons）

const crypto = require('crypto');
const store = require('./_store.js');

// CRON_SECRET があれば Bearer を必ず検証（外から叩かせない）
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 開発時のみ

  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!authorized(req)) {
    res.status(401).json({ error: '認証に失敗しました。' });
    return;
  }

  if (!store.isEnabled()) {
    res.status(200).json({ ok: true, skipped: '保存先が未設定のため何もしませんでした。' });
    return;
  }

  try {
    const deleted = await store.purgeExpired();
    res.status(200).json({
      ok: true,
      deleted,
      retention: store.retentionPolicy(),
      at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || '削除処理に失敗しました。' });
  }
};
