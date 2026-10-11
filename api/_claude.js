// APIキーは環境変数からのみ。ブラウザには渡さない

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

// 拒否時は別モデルへ自動切替（候補者側で応答を止めない）
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function isConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function ask({ system, messages, maxTokens = 2048, effort = 'low' }) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // system は毎回同じなのでキャッシュ
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages,
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });

  // content を読む前に refusal を確認
  if (response.stop_reason === 'refusal') {
    const err = new Error('この内容にはお答えできませんでした。');
    err.status = 422;
    throw err;
  }

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function readBody(req) {
  // 文字列で届くことがある
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

// 公開URLでの課金暴走よけ。インスタンスごとのメモリ上なので厳密ではない
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_WINDOW || 40);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map();

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || 'unknown';
}

function overLimit(req) {
  const now = Date.now();
  const key = clientKey(req);
  const slot = buckets.get(key);

  if (!slot || now > slot.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (buckets.size > 5000) buckets.clear(); // 際限なく増やさない
    return false;
  }

  slot.count += 1;
  return slot.count > RATE_LIMIT;
}

// 弾いたら応答済みで null
function guard(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST のみ受け付けます。' });
    return null;
  }
  if (!isConfigured()) {
    res.status(503).json({
      error: 'サーバーにAPIキーが設定されていません。',
      hint: 'Vercel の環境変数 ANTHROPIC_API_KEY を設定してください。',
      configured: false,
    });
    return null;
  }
  if (overLimit(req)) {
    res.status(429).json({
      error: 'ご利用が集中しています。しばらく時間をおいてからお試しください。'
        + '（デモのため、一定時間あたりの回数に上限を設けています）',
    });
    return null;
  }
  return readBody(req);
}

function fail(res, err) {
  const status = err.status || err.statusCode || 500;
  const known = {
    401: '認証に失敗しました。APIキーをご確認ください。',
    429: 'ただいま混み合っています。少し時間をおいてお試しください。',
    529: 'ただいま混み合っています。少し時間をおいてお試しください。',
  };
  const message = known[status] || err.message || '応答の取得に失敗しました。';
  // 鍵・スタックを漏らさないようメッセージだけ返す
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
}

module.exports = { ask, guard, fail, isConfigured, MODEL };
