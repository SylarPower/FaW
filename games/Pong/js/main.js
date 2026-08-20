(function boot() {
  const canvas = document.getElementById('game-canvas');
  PongEngine.init(canvas);
  PongUI.refreshStats();
  PongUI.renderArenaChips(PongSave.load().arena);

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
  document.querySelectorAll('[data-versus]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-versus]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  document.getElementById('btn-play').onclick = () => {
    const mode = document.querySelector('[data-mode].active')?.dataset.mode || 'classic';
    const versus = document.querySelector('[data-versus].active')?.dataset.versus || 'cpu';
    const target = parseInt(document.getElementById('target-score').value, 10) || 7;
    PongGame.startLocal(mode, target, versus);
  };
  document.getElementById('btn-resume').onclick = () => PongGame.resume();
  document.getElementById('btn-menu').onclick = () => location.reload();
  document.getElementById('btn-again').onclick = () => {
    PongUI.show('menu-screen');
    PongUI.refreshStats();
  };
  document.getElementById('home-btn').onclick = () => { location.href = '../../index.html'; };

  if (PongGame.matchId) {
    document.getElementById('menu-screen').classList.add('hidden');
    PongGame.startOnline();
  } else {
    PongUI.show('menu-screen');
  }
})();
