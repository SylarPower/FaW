const PongSave = (() => {
  const KEY = 'faw_pong_save';
  const defaults = {
    wins: 0,
    losses: 0,
    bestStreak: 0,
    streak: 0,
    arena: 'neon',
    volume: 0.7
  };

  function load() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      return { ...defaults };
    }
  }

  function write(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function record(win) {
    const s = load();
    if (win) {
      s.wins += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.losses += 1;
      s.streak = 0;
    }
    write(s);
    return s;
  }

  function registraPartita() {
    const STATS_KEY = 'funatwork_daily_stats';
    const oggi = new Date().toISOString().split('T')[0];
    const stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{"days":{},"totals":{}}');
    if (!stats.days[oggi]) stats.days[oggi] = {};
    stats.days[oggi].pong = (stats.days[oggi].pong || 0) + 1;
    stats.totals.pong = (stats.totals.pong || 0) + 1;
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }

  return { load, write, record, registraPartita };
})();
