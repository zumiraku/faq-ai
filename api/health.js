const { isConfigured, MODEL } = require('./_claude.js');
const store = require('./_store.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    configured: isConfigured(), // 鍵そのものは返さない
    model: MODEL,
    storage: store.isEnabled() ? 'db' : 'local',
  });
};
