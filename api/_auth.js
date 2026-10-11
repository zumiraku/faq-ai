// キーは sha256 ハッシュのみ保存。Cookie は HttpOnly
// メールリンク認証の代替。差し替えるときはこのファイルだけ触ればいい

const crypto = require('crypto');
const store = require('./_store.js');

const COOKIE = 'faqai_session';
const SESSION_HOURS = 12;

// 上位は下位の操作を含む
const RANK = { viewer: 1, reviewer: 2, admin: 3 };

function secret() {
  // 未設定でも落とさないよう他の秘密値で代用
  return process.env.AUTH_SECRET
    || process.env.HR_ACCESS_TOKEN
    || process.env.ANTHROPIC_API_KEY
    || 'faq-ai-development-only';
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function newAccessKey() {
  return crypto.randomBytes(24).toString('base64url');
}

function equal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 署名付きCookie。失効は disabled_at で見るので停止者は Cookie が残っても弾かれる
function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issue(userId) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, expires, mac] = parts;
  if (!equal(mac, sign(`${userId}.${expires}`))) return null;
  if (Date.now() > Number(expires)) return null;
  return userId;
}

function setCookie(res, value, maxAgeSec) {
  const bits = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ];
  // vercel dev は http なので本番だけ
  if (process.env.VERCEL) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  return hit ? hit.slice(COOKIE.length + 1) : '';
}

async function currentUser(req) {
  const userId = verify(readCookie(req));
  if (!userId) return null;

  const user = await store.getUser(userId);
  if (!user || user.disabledAt) return null;
  return user;
}

// null なら応答済み
async function requireRole(req, res, minimum = 'viewer') {
  const me = await currentUser(req);

  if (!me) {
    res.status(401).json({ error: 'ログインが必要です。', login: true });
    return null;
  }
  if (RANK[me.role] < RANK[minimum]) {
    res.status(403).json({
      error: 'この操作を行う権限がありません。担当者の権限をご確認ください。',
    });
    return null;
  }
  return me;
}

// 担当者0人のときだけ HR_ACCESS_TOKEN で最初の管理者を作れる。1人でもいたら閉じる
async function bootstrapAllowed() {
  if (!process.env.HR_ACCESS_TOKEN) return false;
  return (await store.countUsers()) === 0;
}

function bootstrapTokenValid(req) {
  const given = String(req.headers['x-hr-token'] || '');
  return !!process.env.HR_ACCESS_TOKEN && equal(given, process.env.HR_ACCESS_TOKEN);
}

module.exports = {
  COOKIE, SESSION_HOURS, RANK,
  hashKey, newAccessKey, equal,
  issue, verify, setCookie, readCookie,
  currentUser, requireRole,
  bootstrapAllowed, bootstrapTokenValid,
};
