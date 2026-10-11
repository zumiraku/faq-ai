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

  // DB なし＝デモ。ログイン不要
  if (!store.isEnabled()) {
    res.status(200).json({ authRequired: false, user: null, storage: 'local' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const me = await auth.currentUser(req);
      res.status(200).json({
        authRequired: true,
        user: me,
        needsBootstrap: await auth.bootstrapAllowed(),
      });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: '対応していないメソッドです。' });
      return;
    }

    const body = readBody(req);

    if (body.action === 'logout') {
      auth.setCookie(res, '', 0);
      res.status(200).json({ ok: true });
      return;
    }

    if (body.action === 'bootstrap') {
      if (!(await auth.bootstrapAllowed())) {
        res.status(409).json({ error: '担当者はすでに登録されています。' });
        return;
      }
      if (!auth.bootstrapTokenValid(req)) {
        res.status(401).json({ error: '初期設定用の鍵が正しくありません。' });
        return;
      }

      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      if (!email || !name) {
        res.status(400).json({ error: '氏名とメールアドレスを入力してください。' });
        return;
      }

      const key = auth.newAccessKey();
      const user = await store.createUser({
        email, name, role: 'admin', keyHash: auth.hashKey(key), actor: 'bootstrap',
      });
      await store.audit('user.bootstrap', user.id, { email }, user);

      // 平文のキーを返すのはこの1回だけ
      res.status(200).json({ user, accessKey: key });
      return;
    }

    const email = String(body.email || '').trim();
    const key = String(body.key || '').trim();
    if (!email || !key) {
      res.status(400).json({ error: 'メールアドレスとアクセスキーを入力してください。' });
      return;
    }

    const user = await store.authenticate(email, auth.hashKey(key));
    if (!user) {
      // どちらが違うかは伝えない（総当たり対策）
      res.status(401).json({ error: 'メールアドレスまたはアクセスキーが正しくありません。' });
      return;
    }

    auth.setCookie(res, auth.issue(user.id), auth.SESSION_HOURS * 3600);
    await store.audit('user.login', user.id, {}, user);
    res.status(200).json({ ok: true, user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '処理に失敗しました。' });
  }
};
