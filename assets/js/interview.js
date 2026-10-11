// デモの規則ベース採点。加点の根拠は必ず所見に書く

const RE_NUMBER = /[0-9０-９]+\s*(%|％|人|名|件|社|倍|円|万|時間|日|週|ヶ月|か月|カ月|年|位|点|回)/;
const WORDS_TEAM = ['チーム', '相談', '共有', '協力', '連携', 'レビュー', '相手', '一緒', 'メンバー', '周り', '支え', '聞く', '伝え'];
const WORDS_LEARN = ['学', '身につけ', '挑戦', '改善', '成長', 'キャッチアップ', '勉強', '習得', '吸収'];
const WORDS_RESULT = ['結果', '改善', '削減', '向上', '達成', '解決', '短縮', '増え', '減ら'];

function countHits(text, words) {
  return words.filter((w) => text.includes(w)).length;
}

function clamp5(n) {
  return Math.max(1, Math.min(5, Math.round(n)));
}

function answersFor(answers, axis) {
  return answers.filter((a) => a.axis === axis).map((a) => a.text).join('\n');
}

function evaluateByRules(answers) {
  const all = answers.map((a) => a.text).join('\n');
  const totalLen = all.replace(/\s/g, '').length;
  const notes = [];

  const motivationText = answersFor(answers, 'motivation');
  const mLen = motivationText.replace(/\s/g, '').length;
  const companyRefs = Content.knowledge
    .flatMap((e) => e.keywords)
    .filter((kw) => kw.length >= 2 && motivationText.includes(kw)).length;
  let motivation = 1 + Math.min(2, mLen / 90) + Math.min(2, companyRefs * 0.7);
  if (companyRefs > 0) notes.push(`志望動機で当社の事業・制度に${companyRefs}箇所ふれている`);
  else notes.push('志望動機が一般論にとどまり、当社ならではの理由が読み取りにくい');

  const expText = answersFor(answers, 'experience');
  const eLen = expText.replace(/\s/g, '').length;
  const hasNumber = RE_NUMBER.test(expText);
  const resultHits = countHits(expText, WORDS_RESULT);
  let experience = 1 + Math.min(2, eLen / 130) + (hasNumber ? 1.4 : 0) + Math.min(1.2, resultHits * 0.5);
  notes.push(hasNumber
    ? '取り組みの結果が数字で語られている'
    : '取り組みは語られているが、結果が数値で示されていない');

  // 回答の長さのばらつきで見る
  const lens = answers.map((a) => a.text.replace(/\s/g, '').length);
  const avg = lens.reduce((s, n) => s + n, 0) / (lens.length || 1);
  const tooShort = lens.filter((n) => n < 25).length;
  const polite = /です|ます|ございます/.test(all);
  let communication = 1 + Math.min(2.4, avg / 110) + (polite ? 1 : 0) - tooShort * 0.6;
  if (tooShort > 0) notes.push(`${tooShort}問で回答が極端に短く、意図が読み取りにくい`);

  const cultureText = answersFor(answers, 'culture');
  const teamHits = countHits(cultureText || all, WORDS_TEAM);
  const learnHits = countHits(all, WORDS_LEARN);
  let culture = 1 + Math.min(2.2, teamHits * 0.7) + Math.min(1.6, learnHits * 0.6);
  if (teamHits >= 2) notes.push('チームでの関わり方が具体的な場面とともに語られている');

  // 全体が極端に短ければ全軸を抑える
  if (totalLen < 120) {
    motivation -= 1; experience -= 1; communication -= 1; culture -= 1;
    notes.push('回答全体の情報量が少なく、判断材料が不足している');
  }

  const scores = {
    motivation: clamp5(motivation),
    experience: clamp5(experience),
    communication: clamp5(communication),
    culture: clamp5(culture),
  };

  const total = Object.values(scores).reduce((s, n) => s + n, 0);

  const comment = [
    `${Content.axes.map((a) => `${a.label}${scores[a.key]}点`).join('／')}の計${total}点（20点満点）。`,
    ...notes.map((n) => `・${n}`),
    '',
    '※この評価は一次スクリーニングの参考値です。合否は人事担当者が回答内容を確認したうえで判断してください。',
  ].join('\n');

  return { scores, total, comment };
}

// 評価基準はサーバー側（ブラウザに置くと候補者に読まれる）
async function evaluateByClaude(answers) {
  const payload = answers.map((a) => ({ question: a.question, text: a.text }));
  const { scores, total, comment } = await callApi('interview', {
    action: 'evaluate',
    answers: payload,
  });
  if (!scores || typeof total !== 'number') throw new Error('評価結果を受け取れませんでした。');
  return { scores, total, comment };
}

async function followUpQuestion(answers) {
  const target = answers.find((a) => a.id === 'q3') || answers[answers.length - 1];
  const body = String(target?.text || '').trim();

  if (Mode.isLive() && body) {
    try {
      const { question } = await callApi('interview', {
        action: 'followup',
        answers: [{ question: target.question, text: body }],
      });
      if (question) return question;
    } catch (_) {
      // 失敗時は下の定型質問へ
    }
  }

  if (!RE_NUMBER.test(body)) {
    return 'ありがとうございます。もう少しだけ伺わせてください。その取り組みの結果は、数字で表すとどの程度の変化がありましたか。';
  }
  return 'ありがとうございます。もう少しだけ伺わせてください。その取り組みの中で、最も難しかったのはどの部分でしたか。';
}

const Interview = (() => {
  const screens = {};
  let candidate = null;
  let token = '';

  const answers = [];      // {id, axis, question, text, seconds}
  let queue = [];
  let index = 0;
  let startedAt = null;
  let questionStartedAt = null;
  let followUpUsed = false;

  const $ = (id) => document.getElementById(id);

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => { el.hidden = key !== name; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // サーバーに候補者管理があればそちらが正。無ければデモ用の CANDIDATES
  async function resolveCandidate() {
    token = new URLSearchParams(location.search).get('token') || '';
    if (!token) return null;

    if (Sessions.remote) {
      try {
        const res = await fetch(`${CONFIG.API_BASE}/candidates?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        candidate = data.candidate || null;
        return candidate;
      } catch (_) {
        return null;
      }
    }

    candidate = CANDIDATES[token] || null;
    return candidate;
  }

  const STATUS_MESSAGE = {
    done: {
      title: 'この面接は受付済みです',
      body: 'ご回答はすでに受け付けております。重ねてのご対応は不要です。'
          + '結果は追ってご連絡いたしますので、いましばらくお待ちください。',
    },
    expired: {
      title: 'このURLの有効期限が切れています',
      body: '恐れ入りますが、採用ご担当者へご連絡ください。あらためてURLをお送りいたします。',
    },
    revoked: {
      title: 'このURLは無効になっています',
      body: '恐れ入りますが、採用ご担当者へご連絡ください。',
    },
  };

  function paintInvalid(status) {
    const msg = STATUS_MESSAGE[status];
    if (msg) {
      $('invalidTitle').textContent = msg.title;
      $('invalidBody').textContent = msg.body;
      $('invalidBadge').textContent = status === 'done' ? '受付済み' : '無効なURL';
      $('invalidBadge').className = status === 'done' ? 'badge badge--ok' : 'badge badge--warn';
      $('tokenHelp').hidden = true;
      show('invalid');
      return;
    }

    if (!Sessions.remote) {
      $('tokenList').innerHTML = Object.entries(CANDIDATES)
        .map(([t, c]) => `<li><a href="interview.html?token=${encodeURIComponent(t)}">${escapeHtml(c.name)}（${escapeHtml(c.role)}）</a></li>`)
        .join('');
      $('tokenHelp').hidden = false;
    } else {
      $('tokenHelp').hidden = true;
    }
    show('invalid');
  }

  function paintQuestion() {
    const q = queue[index];
    const total = queue.length;

    $('qStep').textContent = `質問 ${index + 1} / ${total}`;
    $('qProgress').style.width = `${(index / total) * 100}%`;
    $('qText').textContent = q.text;
    $('qHint').textContent = q.hint || '';
    $('qHint').hidden = !q.hint;

    $('answerInput').value = '';
    $('answerInput').focus();
    $('answerCount').textContent = '0 文字';
    $('nextBtn').textContent = index === total - 1 ? '回答を送信して終了する' : '次の質問へ';

    $('sampleBtn').hidden = !SAMPLE_ANSWERS[q.id];

    questionStartedAt = Date.now();
  }

  // デモ限定
  function fillSample() {
    const q = queue[index];
    const sample = SAMPLE_ANSWERS[q.id];
    if (!sample) return;
    const box = $('answerInput');
    box.value = sample;
    box.dispatchEvent(new Event('input'));
    box.focus();
  }

  async function submitAnswer() {
    const q = queue[index];
    const text = $('answerInput').value.trim();

    if (text.length < 10) {
      if (!confirm('回答がとても短いようです。このまま次へ進みますか？')) return;
    }

    answers.push({
      id: q.id,
      axis: q.axis || 'communication',
      question: q.text,
      text,
      seconds: Math.round((Date.now() - questionStartedAt) / 1000),
    });

    // 深掘りの枠は最初から queue にあるので質問数の表示はぶれない
    if (!followUpUsed && index === Content.questions.length - 1) {
      followUpUsed = true;
      $('nextBtn').disabled = true;
      $('nextBtn').textContent = '考えています…';
      queue[Content.questions.length].text = await followUpQuestion(answers);
      $('nextBtn').disabled = false;
    }

    index += 1;
    if (index >= queue.length) {
      finish();
    } else {
      paintQuestion();
    }
  }

  async function finish() {
    show('analyzing');

    let result;
    let usedMode = Mode.isLive() ? 'live' : 'demo';
    try {
      result = usedMode === 'live'
        ? await evaluateByClaude(answers)
        : evaluateByRules(answers);
    } catch (err) {
      // 失敗しても規則ベースで記録を残す
      result = evaluateByRules(answers);
      result.comment = `（AIによる評価に失敗したため、規則ベースの暫定評価です: ${err.message}）\n\n${result.comment}`;
      usedMode = 'demo';
    }

    const finishedAt = new Date();
    await Sessions.save({
      id: `${token}-${startedAt.getTime()}`,
      token,
      candidate: { name: candidate.name, role: candidate.role },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSec: Math.round((finishedAt - startedAt) / 1000),
      mode: usedMode,
      answers,
      scores: result.scores,
      total: result.total,
      comment: result.comment,
      // 合否は人が決める
      humanDecision: null,
      humanMemo: '',
    });

    $('doneName').textContent = candidate.name;
    $('doneCount').textContent = `${answers.length}問`;
    $('doneTime').textContent = `${Math.max(1, Math.round((finishedAt - startedAt) / 60000))}分`;
    show('done');
  }

  function setupVoice() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $('voiceBtn');
    if (!Rec) { btn.hidden = true; return; }

    const rec = new Rec();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = false;
    let on = false;

    rec.addEventListener('result', (e) => {
      let add = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        if (e.results[i].isFinal) add += e.results[i][0].transcript;
      }
      if (!add) return;
      const box = $('answerInput');
      box.value = (box.value + add).trim();
      box.dispatchEvent(new Event('input'));
    });

    const stop = () => { on = false; btn.classList.remove('is-recording'); btn.textContent = '🎤 音声で入力'; };
    rec.addEventListener('end', stop);
    rec.addEventListener('error', stop);

    btn.addEventListener('click', () => {
      if (on) { rec.stop(); return; }
      try {
        rec.start();
        on = true;
        btn.classList.add('is-recording');
        btn.textContent = '■ 停止';
      } catch (_) { stop(); }
    });
  }

  // 開示文は実際の設定（保存先・AI利用・保存期間）から作る
  async function paintConsent() {
    try {
      const res = await fetch(`${CONFIG.API_BASE}/privacy`, { cache: 'no-store' });
      if (!res.ok) throw new Error('unavailable');
      const info = await res.json();

      if (info.storage === 'db') {
        const days = info.retentionDays && info.retentionDays.session;
        if (days) {
          $('consentRetention').textContent =
            `ご回答の記録は、受験日から${days}日（約${Math.round(days / 30)}ヶ月）の経過をもって自動的に削除されます。`;
        }
      } else {
        $('consentRetention').textContent =
          'このページはデモです。ご入力の内容は、ご覧の端末内にのみ保存され、サーバーへは送信されません。';
      }

      $('consentAi').textContent = info.aiProvider
        ? `ご回答の内容は、評価の作成のため ${info.aiProvider} へ送信され、分析されます。`
        : 'このページはデモのため、ご回答が外部のAIサービスへ送信されることはありません。';
    } catch (_) {
      // 取れなければデモ扱い
      $('consentRetention').textContent =
        'このページはデモです。ご入力の内容は、ご覧の端末内にのみ保存されます。';
      $('consentAi').textContent =
        'このページはデモのため、ご回答が外部のAIサービスへ送信されることはありません。';
    }
  }

  async function init() {
    ['invalid', 'intro', 'question', 'analyzing', 'done'].forEach((k) => {
      screens[k] = document.getElementById(`screen-${k}`);
    });

    await Mode.ready();
    await Content.load();

    const found = await resolveCandidate();
    if (!found) { paintInvalid(); return; }

    if (candidate.status && candidate.canStart === false) {
      paintInvalid(candidate.status);
      return;
    }

    $('introName').textContent = candidate.name;
    $('introRole').textContent = candidate.role;
    $('introCount').textContent = `${Content.questions.length + 1}問`;

    if (candidate.expiresAt) {
      $('introExpiry').textContent = `${formatDateTime(candidate.expiresAt)} まで`;
      $('introExpiryRow').hidden = false;
    }

    paintConsent();

    $('agree').addEventListener('change', (e) => { $('startBtn').disabled = !e.target.checked; });

    $('startBtn').addEventListener('click', async () => {
      if (Sessions.remote) {
        try {
          const res = await fetch(`${CONFIG.API_BASE}/candidates`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'start', token }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            paintInvalid((data.candidate && data.candidate.status) || 'revoked');
            return;
          }
        } catch (_) {
          // 通信失敗でも面接は続行
        }
      }

      startedAt = new Date();
      // 深掘りの文面は5問目の回答後に埋める
      queue = Content.questions.concat([{ id: 'follow', axis: 'communication', text: '', hint: '' }]);
      index = 0;
      show('question');
      paintQuestion();
    });

    $('answerInput').addEventListener('input', (e) => {
      $('answerCount').textContent = `${e.target.value.replace(/\s/g, '').length} 文字`;
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.max(150, e.target.scrollHeight)}px`;
    });

    $('nextBtn').addEventListener('click', submitAnswer);
    $('sampleBtn').addEventListener('click', fillSample);

    setupVoice();
    show('intro');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Interview.init);
