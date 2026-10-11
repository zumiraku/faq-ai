// AI が書くのは scores / comment まで。humanDecision はこの画面の人だけ

const DECISIONS = {
  pass:   { label: '合格',   tone: 'ok',     icon: '✓' },
  hold:   { label: '保留',   tone: 'warn',   icon: '—' },
  reject: { label: '不合格', tone: 'danger', icon: '×' },
};

const Dashboard = (() => {
  let records = [];
  let selectedId = null;

  const $ = (id) => document.getElementById(id);

  // 見本データは常に残す（空のときだけ入れると、デモで1件受けた時点で見本が消える）
  async function load() {
    if (Sessions.remote) {
      // 本番は見本を混ぜない
      records = await Sessions.fetchAll();
      records.sort((a, b) => b.total - a.total);
      return;
    }

    const byId = new Map(SEED_SESSIONS.map((s) => [s.id, s]));
    for (const r of Sessions.all()) byId.set(r.id, r);

    records = Array.from(byId.values());
    persist();
    records.sort((a, b) => b.total - a.total);
  }

  function persist() {
    if (Sessions.remote) return;
    Store.set(CONFIG.KEY_SESSIONS, records);
  }

  function current() {
    return records.find((r) => r.id === selectedId) || null;
  }

  function paintList() {
    $('count').textContent = `${records.length}名`;

    if (!records.length) {
      $('list').innerHTML = '<p class="hint" style="padding:14px">記録がありません。</p>';
      return;
    }

    $('list').innerHTML = records.map((r) => {
      const band = scoreBand(r.total);
      const dec = r.humanDecision ? DECISIONS[r.humanDecision] : null;
      const statusBadge = dec
        ? `<span class="badge badge--${dec.tone}">${dec.icon} ${dec.label}</span>`
        : '<span class="badge">未判定</span>';

      return `
        <button class="row ${r.id === selectedId ? 'is-active' : ''}" type="button" data-id="${escapeHtml(r.id)}">
          <span class="row__score" title="AIによる参考スコア（20点満点）">
            <b>${r.total}</b><i>/20</i>
          </span>
          <span class="row__body">
            <span class="row__name">${escapeHtml(r.candidate.name)}</span>
            <span class="row__role">${escapeHtml(r.candidate.role)}</span>
            <span class="row__meta">
              ${statusBadge}
              <span class="badge badge--${band.tone}">${escapeHtml(band.label)}</span>
            </span>
          </span>
        </button>`;
    }).join('');
  }

  // 棒は単一色。色は点数の低さだけを表す
  function severityOf(score) {
    if (score <= 2) return 'danger';
    if (score === 3) return 'warn';
    return 'accent';
  }

  function paintMeters(rec) {
    $('meters').innerHTML = Content.axes.map((axis) => {
      const v = rec.scores[axis.key] ?? 0;
      return `
        <div class="meter" title="${escapeHtml(axis.desc)}">
          <div class="meter__head">
            <span class="meter__label">${escapeHtml(axis.label)}</span>
            <span class="meter__value">${v}<i>/5</i></span>
          </div>
          <div class="meter__track">
            <span class="meter__fill meter__fill--${severityOf(v)}" style="width:${(v / 5) * 100}%"></span>
          </div>
          <p class="meter__desc">${escapeHtml(axis.desc)}</p>
        </div>`;
    }).join('');
  }

  function paintTranscript(rec) {
    $('transcript').innerHTML = rec.answers.map((a, i) => `
      <li class="qa">
        <div class="qa__q"><span class="qa__n">Q${i + 1}</span>${escapeHtml(a.question)}</div>
        <div class="qa__a">${escapeHtml(a.text || '（無回答）')}</div>
        <div class="qa__t">回答時間 ${formatClock(a.seconds || 0)}</div>
      </li>`).join('');
  }

  function paintDecision(rec) {
    const dec = rec.humanDecision ? DECISIONS[rec.humanDecision] : null;

    $('decisionState').innerHTML = dec
      ? `<span class="badge badge--${dec.tone}">${dec.icon} ${dec.label}（人事判断済み）</span>`
      : '<span class="badge">未判定 — 人事担当者の判断をお願いします</span>';

    document.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.decision === rec.humanDecision);
    });

    $('memo').value = rec.humanMemo || '';
  }

  function paintDetail() {
    const rec = current();
    if (!rec) { $('empty').hidden = false; $('detail').hidden = true; return; }

    $('empty').hidden = true;
    $('detail').hidden = false;

    const band = scoreBand(rec.total);

    $('dName').textContent = rec.candidate.name;
    $('dRole').textContent = rec.candidate.role;
    $('dTotal').textContent = rec.total;
    $('dBand').textContent = band.label;
    $('dBand').className = `badge badge--${band.tone}`;
    $('dWhen').textContent = formatDateTime(rec.finishedAt);
    $('dDuration').textContent = `${Math.max(1, Math.round(rec.durationSec / 60))}分`;
    $('dMode').textContent = rec.mode === 'live' ? 'AI評価（ライブ）' : 'AI評価（デモ）';
    $('dComment').textContent = rec.comment;

    paintMeters(rec);
    paintTranscript(rec);
    paintDecision(rec);
  }

  function select(id) {
    selectedId = id;
    paintList();
    paintDetail();
    if (window.matchMedia('(max-width: 900px)').matches) {
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function decide(value) {
    const rec = current();
    if (!rec) return;

    // 同じボタン再押下で未判定に戻す
    const next = rec.humanDecision === value ? null : value;
    const before = rec.humanDecision;

    rec.humanDecision = next;
    persist();
    paintList();
    paintDecision(rec);

    if (!Sessions.remote) return;
    try {
      // サーバーの値で上書き
      const saved = await Sessions.decide(rec.id, next, rec.humanMemo || '');
      if (saved) Object.assign(rec, saved);
    } catch (err) {
      rec.humanDecision = before;
      paintList();
      paintDecision(rec);
      alert(`判断を保存できませんでした。\n${err.message}`);
    }
  }

  // 物理削除で取り消せないので確認は二重
  async function purge() {
    const rec = current();
    if (!rec) return;
    if (!Sessions.remote) {
      alert('デモ表示のため、この操作は行えません。');
      return;
    }

    const label = `${rec.candidate.name}（${rec.candidate.role}）`;
    if (!confirm(`${label} の面接記録を完全に削除します。\n\n回答内容・スコア・所見がすべて消え、元に戻せません。\n続けますか？`)) return;
    if (!confirm('取り消せません。本当に削除しますか？')) return;

    try {
      const res = await fetch(`${CONFIG.API_BASE}/privacy?id=${encodeURIComponent(rec.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `削除できませんでした (${res.status})`);
      }
      selectedId = null;
      await load();
      paintList();
      paintDetail();
      alert('削除しました。');
    } catch (err) {
      alert(err.message);
    }
  }

  // 請求を閉じると氏名・連絡先が消えて誰の請求か分からなくなる。必ず「記録の削除 → 請求を閉じる」の順
  let requests = [];

  async function loadRequests() {
    if (!Sessions.remote) return;
    try {
      const res = await fetch(`${CONFIG.API_BASE}/privacy?requests=1`, { cache: 'no-store' });
      if (!res.ok) return; // 権限なし等
      const data = await res.json();
      requests = (data.requests || []).filter((r) => r.status === 'open');
    } catch (_) {
      requests = [];
    }
  }

  function paintRequests() {
    const panel = $('reqPanel');
    if (!panel) return;

    if (!requests.length) { panel.hidden = true; return; }
    panel.hidden = false;
    $('reqCount').textContent = requests.length;

    const canClose = Auth.can('reviewer');

    $('reqList').innerHTML = requests.map((r) => `
      <div class="edit-item" data-req="${r.id}"
           style="padding:12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <strong style="font-size:13.5px">${escapeHtml(r.name || '（お名前の記載なし）')}</strong>
          <span class="hint">${escapeHtml(r.email || '')}</span>
          <span style="flex:1"></span>
          <span class="hint">${formatDateTime(r.requestedAt)}</span>
        </div>
        ${r.message ? `<p style="margin:8px 0 0;font-size:13px;white-space:pre-wrap">${escapeHtml(r.message)}</p>` : ''}
        <p class="hint" style="margin:8px 0 0">
          該当する記録を左の一覧から探し、「この記録を完全に削除」で消してから、下のボタンを押してください。
        </p>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn--sm" type="button" data-reqdone="${r.id}" ${canClose ? '' : 'disabled'}>対応しました</button>
          <button class="btn btn--ghost btn--sm" type="button" data-reqskip="${r.id}" ${canClose ? '' : 'disabled'}>対象外にする</button>
        </div>
      </div>`).join('');

    if (!canClose) {
      $('reqList').insertAdjacentHTML('beforeend',
        '<p class="hint" style="margin:0">閲覧のみの権限のため、対応の記録はできません。</p>');
    }
  }

  async function closeRequest(id, status) {
    const label = status === 'done' ? '対応済み' : '対象外';
    const confirmText = status === 'done'
      ? 'この請求を対応済みにします。\n\n記録の削除はお済みですか？\n'
        + '対応済みにすると、請求に含まれるお名前・連絡先は消去され、\n'
        + 'あとから「どなたの請求だったか」を確認できなくなります。'
      : 'この請求を対象外にします。\n\n記録は削除されません。';
    if (!confirm(confirmText)) return;

    const note = prompt(`${label}にする理由・対応内容をご記入ください（記録に残ります）`, '') ;
    if (note === null) return;

    try {
      const res = await fetch(`${CONFIG.API_BASE}/privacy`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `保存できませんでした (${res.status})`);
      requests = requests.filter((r) => r.id !== id);
      paintRequests();
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveMemo() {
    const rec = current();
    if (!rec) return;
    rec.humanMemo = $('memo').value;
    persist();

    const btn = $('memoSave');
    if (Sessions.remote) {
      try {
        await Sessions.decide(rec.id, rec.humanDecision || null, rec.humanMemo);
      } catch (err) {
        alert(`メモを保存できませんでした。\n${err.message}`);
        return;
      }
    }
    btn.textContent = '保存しました';
    setTimeout(() => { btn.textContent = 'メモを保存'; }, 1600);
  }

  async function resetSeed() {
    if (Sessions.remote) {
      alert('本番のデータベースに接続されているため、この操作は行えません。');
      return;
    }
    if (!confirm('この端末に保存された面接記録（実際に受けたものを含む）をすべて削除し、見本データだけの状態に戻します。よろしいですか？')) return;
    Store.set(CONFIG.KEY_SESSIONS, SEED_SESSIONS.slice());
    selectedId = null;
    await load();
    paintList();
    paintDetail();
  }

  function paintSource() {
    const el = $('sourceNote');
    if (!el) return;
    if (Sessions.remote) {
      el.innerHTML = '<span class="badge badge--ok">サーバー保存</span> '
        + '記録はデータベースに保存され、他の担当者の画面にも反映されます。';
      $('resetBtn').hidden = true;
      ['candLink', 'contentLink', 'insightLink'].forEach((id) => {
        const link = $(id);
        if (link) link.hidden = false;
      });
    } else {
      el.innerHTML = '<span class="badge">この端末のみ</span> '
        + 'デモ表示です。記録はご覧の端末内にのみ保存され、他の方には共有されません。';
    }
  }

  function paintPermissions() {
    const canDecide = Auth.can('reviewer');
    document.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = !canDecide; });
    $('memo').disabled = !canDecide;
    $('memoSave').disabled = !canDecide;
    $('purgeBtn').hidden = !(Sessions.remote && Auth.can('admin'));

    if (Auth.required && !canDecide) {
      $('decisionState').insertAdjacentHTML('afterend',
        '<p class="hint" style="margin:6px 0 0">閲覧のみの権限のため、合否の記録はできません。</p>');
    }
  }

  async function init() {
    await Mode.ready();
    await Content.load();
    await Auth.ensure();
    Auth.paintWho();

    try {
      await load();
    } catch (err) {
      $('list').innerHTML = `<p class="hint" style="padding:14px">読み込めませんでした。<br>${escapeHtml(err.message)}</p>`;
    }

    await loadRequests();

    selectedId = records.length ? records[0].id : null;
    paintSource();
    paintList();
    paintDetail();
    paintPermissions();
    paintRequests();

    $('reqToggle').addEventListener('click', () => {
      const list = $('reqList');
      list.hidden = !list.hidden;
      $('reqToggle').textContent = list.hidden ? '内容を見る' : '閉じる';
    });

    $('reqList').addEventListener('click', (e) => {
      const done = e.target.closest('[data-reqdone]');
      if (done) { closeRequest(Number(done.dataset.reqdone), 'done'); return; }
      const skip = e.target.closest('[data-reqskip]');
      if (skip) closeRequest(Number(skip.dataset.reqskip), 'rejected');
    });

    $('list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) select(row.dataset.id);
    });

    document.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.dataset.decision));
    });

    $('memoSave').addEventListener('click', saveMemo);
    $('resetBtn').addEventListener('click', resetSeed);
    $('purgeBtn').addEventListener('click', purge);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Dashboard.init);
