const PongUI = (() => {
  function show(id) {
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  function hideAll() {
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  }

  function scores(left, right) {
    document.getElementById('score-left').textContent = left;
    document.getElementById('score-right').textContent = right;
  }

  function meta(text) {
    document.getElementById('match-meta').textContent = text;
  }

  function refreshStats() {
    const s = PongSave.load();
    const box = document.getElementById('stats-box');
    if (!box) return;
    box.innerHTML = `
      <p>Vittorie: <span>${s.wins}</span> · Sconfitte: <span>${s.losses}</span></p>
      <p>Streak: <span>${s.streak}</span> · Best: <span>${s.bestStreak}</span></p>
    `;
  }

  function renderArenaChips(selected) {
    const wrap = document.getElementById('arena-chips');
    if (!wrap) return;
    wrap.innerHTML = listArenas().map(a =>
      `<button class="chip ${a.id === selected ? 'active' : ''}" data-arena="${a.id}">${a.name}</button>`
    ).join('');
    wrap.querySelectorAll('.chip').forEach(btn => {
      btn.onclick = () => {
        const data = PongSave.load();
        data.arena = btn.dataset.arena;
        PongSave.write(data);
        renderArenaChips(data.arena);
      };
    });
  }

  return { show, hideAll, scores, meta, refreshStats, renderArenaChips };
})();
