const PongGame = (() => {
  const firebaseConfig = {
    apiKey: 'AIzaSyCNo7o2Ft22JDEyJ97BspE3Kur5DNAPKQc',
    authDomain: 'funatwork-cd237.firebaseapp.com',
    projectId: 'funatwork-cd237',
    storageBucket: 'funatwork-cd237.firebasestorage.app',
    messagingSenderId: '798226885203',
    appId: '1:798226885203:web:ce83f4d9e96b82266274a6'
  };

  let db = null;
  let unsub = null;
  let state = null;
  let serving = false;
  let paused = false;
  let syncAcc = 0;

  const params = new URLSearchParams(location.search);
  const matchId = params.get('matchId');
  const mioNome = localStorage.getItem('mioNome') || 'PLAYER';

  function ensureFirebase() {
    if (!matchId) return;
    if (!window.firebase) return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  }

  function fresh(opts) {
    const arena = PongEngine.getArena();
    const hard = opts.mode === 'hardcore';
    const left = PongModels.paddle('left', arena);
    const right = PongModels.paddle('right', arena);
    if (hard) {
      left.h = right.h = 64;
      left.speed = right.speed = 620;
    }
    return {
      mode: opts.mode || 'classic',
      target: parseInt(opts.target || 7, 10),
      ai: opts.ai || 'normal',
      arenaId: opts.arenaId || PongSave.load().arena || 'neon',
      control: opts.control,
      names: opts.names,
      ball: Object.assign(PongModels.ball(arena), { speed: hard ? 560 : 420 }),
      paddles: { left, right },
      score: { left: 0, right: 0 },
      over: false,
      host: opts.host || true
    };
  }

  function serve(dir) {
    const arena = PongEngine.getArena();
    state.ball.x = arena.w / 2;
    state.ball.y = arena.h / 2;
    serving = true;
    setTimeout(() => {
      PongPhysics.launch(state.ball, dir);
      serving = false;
    }, 650);
  }

  function start(opts) {
    PongEngine.stop();
    PongParticles.clear();
    PongPowerups.reset();
    PongEngine.resize();
    state = fresh(opts);
    PongUI.hideAll();
    PongUI.scores(0, 0);
    PongUI.meta(`${state.names.left}  vs  ${state.names.right}  ·  ${state.target} PT`);
    serve(Math.random() < 0.5 ? -1 : 1);
    PongEngine.start(tick);
  }

  function tick(dt, arena) {
    if (paused || state.over) {
      PongEngine.drawWorld(state);
      return;
    }
    if (PongInput.wantsPause() && !matchId) {
      paused = true;
      PongUI.show('pause-screen');
    }

    if (state.control.left === 'human') PongInput.apply(state.paddles, arena, dt, { left: 'human', right: 'none' });
    if (state.control.right === 'human') PongInput.apply(state.paddles, arena, dt, { left: 'none', right: 'human' });
    if (state.control.right === 'ai') PongAI.move(state.paddles.right, state.ball, arena, dt, state.ai);
    if (state.control.left === 'ai') PongAI.move(state.paddles.left, state.ball, arena, dt, state.ai);

    if (state.host && !serving) {
      PongPhysics.stepBall(state.ball, arena, dt);
      PongPhysics.collidePaddle(state.ball, state.paddles.left);
      PongPhysics.collidePaddle(state.ball, state.paddles.right);
      PongPowerups.update(dt, arena, state.ball, state.paddles, state.mode === 'power');
      if (state.ball.x + state.ball.r < 0) point('right');
      else if (state.ball.x - state.ball.r > arena.w) point('left');
    }

    PongParticles.update(dt);
    PongEngine.drawWorld(state);

    if (matchId && db) {
      syncAcc += dt;
      if (syncAcc > 0.08) {
        syncAcc = 0;
        pushNet();
      }
    }
  }

  function point(side) {
    state.score[side] += 1;
    PongUI.scores(state.score.left, state.score.right);
    PongAudio.score();
    if (state.score[side] >= state.target) {
      end(side);
      return;
    }
    serve(side === 'left' ? 1 : -1);
  }

  function end(winnerSide) {
    state.over = true;
    PongEngine.stop();
    PongAudio.win();
    PongSave.registraPartita();
    const humanLeft = state.control.left === 'human';
    const humanRight = state.control.right === 'human';
    let win = false;
    if (humanLeft && !humanRight) win = winnerSide === 'left';
    else if (humanRight && !humanLeft) win = winnerSide === 'right';
    else win = true;
    if (humanLeft !== humanRight) PongSave.record(win);
    document.getElementById('end-title').textContent = win ? 'VITTORIA' : 'SCONFITTA';
    document.getElementById('end-sub').textContent =
      `${state.names.left} ${state.score.left}  —  ${state.score.right} ${state.names.right}`;
    PongUI.show('end-screen');
    if (matchId && db && state.host) {
      const punteggi = {};
      punteggi[state.names.left] = state.score.left;
      punteggi[state.names.right] = state.score.right;
      db.collection('partite').doc(matchId).update({
        punteggi,
        stato: 'conclusa',
        finito: firebase.firestore.FieldValue.arrayUnion(mioNome)
      }).catch(() => {});
    }
  }

  function resume() {
    paused = false;
    PongUI.hideAll();
  }

  async function startOnline() {
    ensureFirebase();
    if (!db) {
      startLocal('classic', 7, 'cpu');
      return;
    }
    const snap = await db.collection('partite').doc(matchId).get();
    const data = snap.data();
    if (!data) {
      alert('Partita non trovata');
      location.href = '../../index.html';
      return;
    }
    const hostName = data.partecipanti[0];
    const guestName = data.partecipanti.find(n => n !== hostName) || 'OSPITE';
    const iAmHost = mioNome === hostName;
    const target = parseInt(data.opzioni?.target || 7, 10);
    const mode = data.opzioni?.mode || 'classic';
    const arenaId = data.opzioni?.arena || PongSave.load().arena;

    start({
      mode,
      target,
      arenaId,
      control: { left: iAmHost ? 'human' : 'net', right: iAmHost ? 'net' : 'human' },
      names: { left: hostName, right: guestName },
      host: iAmHost,
      ai: 'normal'
    });

    if (data.stato === 'attesa' && iAmHost) {
      await db.collection('partite').doc(matchId).update({ stato: 'in_corso' });
    }

    unsub = db.collection('partite').doc(matchId).onSnapshot(doc => {
      const d = doc.data();
      if (!d || !d.pong) return;
      if (!iAmHost && d.pong.ball) {
        Object.assign(state.ball, d.pong.ball);
        state.paddles.left.y = d.pong.leftY ?? state.paddles.left.y;
        state.score = d.pong.score || state.score;
        PongUI.scores(state.score.left, state.score.right);
      }
      if (iAmHost && typeof d.pong.rightY === 'number') {
        state.paddles.right.y = d.pong.rightY;
      }
    });
  }

  function pushNet() {
    if (!state) return;
    const payload = state.host
      ? {
          ball: { x: state.ball.x, y: state.ball.y, vx: state.ball.vx, vy: state.ball.vy, r: state.ball.r },
          leftY: state.paddles.left.y,
          score: state.score
        }
      : { rightY: state.paddles.right.y };
    db.collection('partite').doc(matchId).set({ pong: payload }, { merge: true }).catch(() => {});
  }

  function startLocal(mode, target, versus) {
    const me = mioNome;
    const two = versus === 'local2';
    start({
      mode,
      target,
      arenaId: PongSave.load().arena,
      control: { left: 'human', right: two ? 'human' : 'ai' },
      names: { left: me, right: two ? 'P2' : 'CPU' },
      host: true,
      ai: mode === 'hardcore' ? 'hard' : 'normal'
    });
  }

  return { startLocal, startOnline, resume, matchId, mioNome };
})();
