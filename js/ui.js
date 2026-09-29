/* Browser UI: setup screen, table rendering, animations and the game loop
 * that drives the computer players. The human is always player 0. */
(function () {
  'use strict';
  const { cards: C, rules: R, game: G, ai: AI } = Riki;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const HUMAN = 0;
  const KEY_MATCH = 'rikiki.match.v1';
  const KEY_SETTINGS = 'rikiki.settings.v1';
  const BOT_NAMES = ['Alice', 'Ben', 'Chloe', 'Daniel', 'Emma', 'Finn', 'Grace', 'Henry', 'Isla', 'Jack', 'Lucy', 'Max', 'Nora', 'Oliver', 'Ruby', 'Sam'];
  const HUES = [42, 205, 335, 115, 270, 18, 172, 300];
  const SPEEDS = {
    relaxed: { bot: 1100, trick: 1700, fly: 380, count: 650, perCard: 1.7 },
    normal: { bot: 650, trick: 1100, fly: 300, count: 480, perCard: 1.1 },
    quick: { bot: 300, trick: 650, fly: 220, count: 340, perCard: 0.7 },
  };
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable: play on without saving */
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        /* ignore */
      }
    },
  };

  const settings = Object.assign(
    { name: '', opponents: 3, level: 'normal', decks: 2, maxCards: 10, shape: 'pyramid', scoring: 'classic', target: 0, speed: 'normal', hints: true },
    store.get(KEY_SETTINGS) || {}
  );

  let state = null;
  let gen = 0; // bumps whenever a match is started/left, cancelling the running loop
  let runningGen = -1;
  let skipWait = null;
  let dealtRound = -1;
  let flippedRound = -1;
  let thinking = -1;
  let pendingBid = null;
  let hint = null;
  let revealAnim = false;
  let modalCtx = null;
  let trickKey = ''; // identifies the trick whose slots are on the table

  const sp = () => SPEEDS[settings.speed] || SPEEDS.normal;
  const alive = (g) => g === gen;
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const nameOf = (p) => (p === HUMAN ? 'You' : state.players[p].name);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fmtScore = (n) => (n < 0 ? '−' + -n : String(n));
  const SCORING_HINT = {
    classic: 'Exact guess: 10 + 2 per trick. Otherwise −2 per trick you are off.',
    twenty: 'Guess made: 20 per guessed trick, −2 per extra trick. Short: −2 per missing trick. A zero guess: 10, −2 per trick taken.',
  };
  /** "Round 5 of 19", or "Round 5 · to 1000" in first-to-target matches. */
  const roundLabel = (st) =>
    st.opts.target ? `Round ${st.roundIndex + 1} · to ${st.opts.target}` : `Round ${st.roundIndex + 1} of ${st.schedule.length}`;
  const fmtPts = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + -n : '0');
  const saveSettings = () => store.set(KEY_SETTINGS, settings);
  const save = () => state && state.phase !== 'matchEnd' && store.set(KEY_MATCH, state);

  function sleep(ms, skippable) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        if (skipWait === done) skipWait = null;
        resolve();
      };
      const t = setTimeout(done, ms);
      if (skippable) skipWait = done;
    });
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  // ------------------------------------------------------------ card element

  function cardEl(c, opts) {
    opts = opts || {};
    const el = document.createElement(opts.button ? 'button' : 'div');
    if (opts.button) el.type = 'button';
    const rank = C.rankLabel(c.r);
    const sym = C.SUIT_SYMBOL[c.s];
    el.className = 'card ' + (C.isRed(c.s) ? 'red' : 'black') + (opts.trump ? ' trump' : '');
    let face;
    if (c.r >= 11 && c.r <= 13) face = `<span class="face court">${sym}</span>`;
    else if (c.r === 14) face = `<span class="face ace">${sym}</span>`;
    else face = `<span class="face">${sym}</span>`;
    el.innerHTML = `<span class="ix"><b>${rank}</b><i>${sym}</i></span>${face}<span class="ix ix-b"><b>${rank}</b><i>${sym}</i></span>`;
    el.setAttribute('aria-label', `${rank === 'A' ? 'Ace' : { J: 'Jack', Q: 'Queen', K: 'King' }[rank] || rank} of ${C.SUIT_NAME[c.s]}`);
    if (!opts.button) el.setAttribute('role', 'img');
    return el;
  }

  // ------------------------------------------------------------ setup screen

  function seg(container, name, options, value, onChange) {
    container.innerHTML = '';
    for (const [val, label] of options) {
      const lab = document.createElement('label');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = name;
      inp.id = `${name}-${val}`;
      inp.value = String(val);
      inp.checked = String(val) === String(value);
      inp.addEventListener('change', () => onChange(val));
      const span = document.createElement('span');
      span.textContent = label;
      lab.append(inp, span);
      container.append(lab);
    }
  }

  function initSetup() {
    const fan = $('#brand-fan');
    [{ s: 'S', r: 14 }, { s: 'H', r: 13 }, { s: 'D', r: 10 }].forEach((c, i) => {
      const el = cardEl({ ...c, id: 'fan' + i });
      el.style.transform = `rotate(${(i - 1) * 16}deg)`;
      fan.append(el);
    });

    $('#f-name').value = settings.name;
    $('#f-name').addEventListener('input', (e) => {
      settings.name = e.target.value.trim();
      saveSettings();
    });
    seg($('#f-opp'), 'opp', [2, 3, 4, 5, 6, 7].map((n) => [n, String(n)]), settings.opponents, (v) => {
      settings.opponents = v;
      refreshSetup();
    });
    seg($('#f-level'), 'level', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['mixed', 'Mixed']], settings.level, (v) => {
      settings.level = v;
      refreshSetup();
    });
    seg($('#f-decks'), 'decks', [1, 2, 3, 4].map((n) => [n, String(n)]), settings.decks, (v) => {
      settings.decks = v;
      refreshSetup();
    });
    seg($('#f-scoring'), 'scoring', [['classic', 'Classic'], ['twenty', '20 per trick']], settings.scoring, (v) => {
      settings.scoring = v;
      refreshSetup();
    });
    seg($('#f-target'), 'target', [[0, 'Once through'], [500, 'First to 500'], [1000, 'First to 1000']], settings.target, (v) => {
      settings.target = v;
      refreshSetup();
    });
    seg($('#f-speed'), 'speed', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['quick', 'Quick']], settings.speed, (v) => {
      settings.speed = v;
      refreshSetup();
    });
    $('#f-max').addEventListener('input', (e) => {
      settings.maxCards = Number(e.target.value);
      refreshSetup();
    });
    $('#f-hints').checked = settings.hints;
    $('#f-hints').addEventListener('change', (e) => {
      settings.hints = e.target.checked;
      saveSettings();
    });
    $('#setup').addEventListener('submit', (e) => {
      e.preventDefault();
      startNewMatch();
    });
    $('#btn-resume').addEventListener('click', resumeMatch);
    refreshSetup();
  }

  function refreshSetup() {
    const players = settings.opponents + 1;
    const maxH = R.maxHandSize(players, settings.decks);
    const range = $('#f-max');
    range.max = String(maxH);
    settings.maxCards = Math.max(1, Math.min(settings.maxCards, maxH));
    range.value = String(settings.maxCards);
    $('#o-max').textContent = settings.maxCards;
    const m = settings.maxCards;
    seg($('#f-shape'), 'shape', [['pyramid', `1 → ${m} → 1`], ['up', `1 → ${m}`], ['down', `${m} → 1`]], settings.shape, (v) => {
      settings.shape = v;
      refreshSetup();
    });
    const schedule = R.buildSchedule(m, settings.shape);
    const cardsPlayed = schedule.reduce((a, b) => a + b, 0) * players;
    const minutes = Math.max(1, Math.round((cardsPlayed * sp().perCard + schedule.length * 15) / 60));
    $('#scoring-hint').textContent = SCORING_HINT[settings.scoring] || SCORING_HINT.classic;
    const length = settings.target
      ? `Until someone reaches <b>${settings.target} points</b>, repeating ${plural(schedule.length, 'round')}`
      : `<b>${plural(schedule.length, 'round')}</b>`;
    $('#setup-summary').innerHTML =
      `${length} · ${players} players · ${plural(settings.decks, 'deck')} (${settings.decks * 52} cards)` +
      (settings.target ? '' : ` · about <b>${minutes} min</b>`);
    saveSettings();
  }

  function showStart() {
    gen++;
    closeModal(true);
    $('#game').hidden = true;
    $('#start').hidden = false;
    const saved = loadSaved();
    $('#resume-box').hidden = !saved;
    if (saved) {
      const me = saved.players[HUMAN];
      const lead = G.standings(saved)[0];
      $('#resume-info').textContent =
        `${roundLabel(saved)} · ${saved.players.length} players · ` +
        (lead.i === HUMAN ? `you lead with ${me.score}` : `you have ${me.score}, ${lead.name} leads with ${lead.score}`);
    }
  }

  function loadSaved() {
    const s = store.get(KEY_MATCH);
    if (!s || s.v !== 1 || !s.round || !Array.isArray(s.players) || s.phase === 'matchEnd') return null;
    return s;
  }

  function startNewMatch() {
    const n = settings.opponents;
    const mine = (settings.name || '').toLowerCase();
    const names = C.shuffle(BOT_NAMES.filter((x) => x.toLowerCase() !== mine)).slice(0, n);
    const cycle = ['easy', 'normal', 'hard'];
    const players = [{ name: settings.name || 'You', isHuman: true }].concat(
      names.map((name, i) => ({ name, level: settings.level === 'mixed' ? cycle[i % 3] : settings.level }))
    );
    state = G.createMatch({
      players,
      decks: settings.decks,
      maxCards: settings.maxCards,
      shape: settings.shape,
      scoring: settings.scoring,
      target: settings.target,
    });
    save();
    enterGame();
  }

  function resumeMatch() {
    const saved = loadSaved();
    if (!saved) return showStart();
    state = saved;
    enterGame();
  }

  function enterGame() {
    gen++;
    dealtRound = flippedRound = -1;
    trickKey = '';
    thinking = -1;
    pendingBid = hint = null;
    $('#start').hidden = true;
    $('#game').hidden = false;
    $('#seats').innerHTML = '';
    $('#countdown').innerHTML = '';
    closeModal(true);
    render();
    kick();
  }

  // ------------------------------------------------------------ rendering

  function render() {
    if (!state) return;
    renderTop();
    renderSeats();
    renderTrick();
    renderMe();
    renderHand();
    renderBidbar();
    renderFeltMsg();
  }

  function renderTop() {
    const r = state.round;
    $('#ri-round').textContent = roundLabel(state);
    let sub = `${plural(r.n, 'card')} · ${state.dealer === HUMAN ? 'you deal' : state.players[state.dealer].name + ' deals'}`;
    if (state.phase !== 'bidding') {
      const sum = r.bids.reduce((a, b) => a + b, 0);
      const cls = sum > r.n ? 'over' : sum < r.n ? 'under' : '';
      sub = `${plural(r.n, 'card')} · guesses <b class="${cls}">${sum}</b> for ${r.n}`;
    }
    $('#ri-sub').innerHTML = sub;
    const box = $('#trump-card');
    box.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'trump-chip ' + (C.isRed(r.trump) ? 'red' : 'black');
    t.innerHTML = `<b>${C.rankLabel(r.trumpCard.r)}</b><i>${C.SUIT_SYMBOL[r.trump]}</i>`;
    t.setAttribute('role', 'img');
    t.setAttribute('aria-label', `Trump is ${C.SUIT_NAME[r.trump]}, the turned-up card is ${C.cardName(r.trumpCard)}`);
    t.title = `Trump: ${C.SUIT_NAME[r.trump]}`;
    if (flippedRound !== state.roundIndex) {
      flippedRound = state.roundIndex;
      t.classList.add('flip');
    }
    box.append(t);
    $('#btn-last').hidden = !(r.tricks.length && (state.phase === 'playing' || state.phase === 'trickDone'));
  }

  /** Guess and tricks taken, as plain numbers everyone can read at a glance. */
  function tallyHTML(p) {
    const r = state.round;
    if (state.phase === 'bidding') {
      const ready = p === HUMAN ? pendingBid !== null : r.bids[p] !== null;
      return `<span class="tally"><span class="unknown">${ready ? 'ready' : 'guessing…'}</span></span>`;
    }
    const bid = r.bids[p];
    const won = r.won[p];
    const cls = (won === bid ? ' exact' : won > bid ? ' bust' : '') + (revealAnim ? ' pop' : '');
    const label = `guessed ${bid}, took ${won}`;
    return (
      `<span class="tally${cls}" aria-label="${label}">` +
      `<span class="g">Guess <b>${bid}</b></span><span class="t">Took <b>${won}</b></span></span>`
    );
  }

  function avatarHTML(p) {
    const initial = esc(Array.from(state.players[p].name)[0] || '?').toUpperCase();
    const dealer = state.dealer === p ? '<span class="dealer" title="Dealer">D</span>' : '';
    return `<span class="avatar" style="--hue:${HUES[p % HUES.length]}">${initial}${dealer}</span>`;
  }

  function seatEl(p) {
    return p === HUMAN ? $('#me-bar') : $(`#seats .seat[data-p="${p}"]`);
  }

  function renderSeats() {
    const wrap = $('#seats');
    const N = state.players.length;
    if (wrap.children.length !== N - 1) {
      wrap.innerHTML = '';
      for (let p = 1; p < N; p++) {
        const el = document.createElement('div');
        el.className = 'seat';
        el.dataset.p = p;
        wrap.append(el);
      }
    }
    balanceSeats();
    const r = state.round;
    for (let p = 1; p < N; p++) {
      const pl = state.players[p];
      const el = seatEl(p);
      const turn = (state.phase === 'playing' && r.turn === p) || thinking === p;
      el.classList.toggle('turn', turn);
      el.title = `${pl.name} (${pl.level} bot)`;
      const dots = thinking === p ? '<span class="thinking" aria-label="thinking"><i></i><i></i><i></i></span>' : '';
      el.innerHTML =
        `<span class="head">${avatarHTML(p)}<span class="nm">${esc(pl.name)}</span>${dots}<span class="score">${fmtScore(pl.score)}</span></span>` +
        `<span class="meta">${tallyHTML(p)}</span>`;
    }
  }

  /** Even rows of seats: 4 opponents on a phone become 2 + 2, not 3 + 1. */
  function balanceSeats() {
    const wrap = $('#seats');
    const k = wrap.children.length;
    const W = wrap.clientWidth - 32;
    const fits = Math.max(1, Math.floor((W + 6) / (124 + 6)));
    const rows = Math.ceil(k / fits);
    wrap.style.setProperty('--per-row', String(Math.ceil(k / rows)));
  }

  /** Players in table order, opponents as the seats show them and you last,
   * so every player keeps the same place in the trick whoever leads. */
  const tableOrder = (N) => Array.from({ length: N }, (_, k) => (k + 1) % N);

  /** One fixed slot per player, in table order. Slots are built once per
   * trick and cards drop into them, so nothing shifts around. */
  function renderTrick() {
    const r = state.round;
    const box = $('#trick');
    const N = state.players.length;
    const active = state.phase === 'playing' || state.phase === 'trickDone';
    // between tricks the slots stay (invisibly) so the table keeps its size
    const key = active ? `${state.roundIndex}:${r.tricks.length}:${r.leader}` : `idle:${N}`;
    box.classList.toggle('idle', !active);
    if (key !== trickKey) {
      trickKey = key;
      box.innerHTML = '';
      for (const p of tableOrder(N)) {
        const slot = document.createElement('div');
        slot.className = 'play empty' + (active && p === r.leader ? ' led' : '');
        slot.dataset.p = p;
        slot.innerHTML = `<div class="slot"></div><span class="who">${esc(nameOf(p))}</span>`;
        box.append(slot);
      }
    }
    if (!active) return;
    for (const { p, card } of r.trick) {
      const slot = $(`.play[data-p="${p}"]`, box);
      if (!slot.classList.contains('empty')) continue;
      slot.classList.remove('empty');
      slot.querySelector('.slot').replaceWith(cardEl(card, { trump: card.s === r.trump }));
    }
    const lead = r.trick.length ? R.winningPlay(r.trick, r.trump).p : -1;
    for (const slot of box.children) {
      const p = Number(slot.dataset.p);
      slot.classList.toggle('leading', p === lead);
      slot.classList.toggle('winner', p === lead && state.phase === 'trickDone');
      slot.classList.toggle('next', state.phase === 'playing' && p === r.turn);
    }
  }

  /** What the human must play right now, in words. */
  function requirement() {
    const r = state.round;
    const hand = r.hands[HUMAN];
    if (!r.trick.length) return 'Your lead: any card';
    const led = r.trick[0].card.s;
    const best = R.winningPlay(r.trick, r.trump).card;
    const sym = C.SUIT_SYMBOL[led];
    const tsym = C.SUIT_SYMBOL[r.trump];
    const can = (pool) => pool.some((c) => R.beats(c, best, r.trump));
    const ledCards = hand.filter((c) => c.s === led);
    if (ledCards.length) return can(ledCards) ? `Follow ${sym} and beat the ${C.cardName(best)}` : `Follow ${sym}`;
    const trumps = hand.filter((c) => c.s === r.trump);
    if (trumps.length) return can(trumps) ? `No ${sym}: trump it, beat the ${C.cardName(best)}` : `No ${sym}: play a trump ${tsym}`;
    return `No ${sym} and no trumps: any card`;
  }

  function renderMe() {
    const r = state.round;
    const me = state.players[HUMAN];
    const bar = $('#me-bar');
    const myTurn = state.phase === 'playing' && r.turn === HUMAN;
    bar.classList.toggle('turn', myTurn);
    const showHint = settings.hints && myTurn;
    let status = '';
    let cls = '';
    if (state.phase === 'bidding') status = pendingBid === null ? 'Your guess?' : `You picked ${pendingBid}`;
    else if (myTurn) {
      // what to play is spelled out on the felt; the Hint button needs the room on phones
      status = showHint ? '' : 'Your turn';
      cls = 'your-turn';
    } else if (state.phase === 'playing') status = `${nameOf(r.turn)} to play`;
    else if (state.phase === 'trickDone') status = r.trickWinner === HUMAN ? 'You take it' : `${nameOf(r.trickWinner)} takes it`;
    bar.innerHTML =
      `${avatarHTML(HUMAN)}<span class="who"><span class="nm">${esc(me.name)}</span>${tallyHTML(HUMAN)}</span>` +
      `<span class="status ${cls}">${esc(status)}</span>` +
      (showHint ? '<button type="button" class="chip-btn" id="btn-hint">Hint</button>' : '') +
      `<span class="score">${fmtScore(me.score)}</span>`;
    if (showHint) $('#btn-hint').addEventListener('click', showCardHint);
  }

  function renderHand() {
    const r = state.round;
    const handEl = $('#hand');
    const hand = C.sortHand(r.hands[HUMAN], r.trump);
    const myTurn = state.phase === 'playing' && r.turn === HUMAN;
    const legal = myTurn ? new Set(R.legalCards(r.hands[HUMAN], r.trick, r.trump).map((c) => c.id)) : null;
    handEl.classList.toggle('active', myTurn);
    const deal = dealtRound !== state.roundIndex && !reduceMotion;
    dealtRound = state.roundIndex;
    const els = hand.map((c, i) => {
      const el = cardEl(c, { button: true, trump: c.s === r.trump });
      if (myTurn) el.classList.add(legal.has(c.id) ? 'legal' : 'dim');
      if (hint && hint.kind === 'card' && hint.id === c.id) el.classList.add('hinted');
      if (deal) {
        el.classList.add('deal');
        el.style.animationDelay = `${i * 45}ms`;
      }
      el.addEventListener('click', () => onCardTap(c.id, el));
      return el;
    });
    layoutHand(els);
  }

  /** Overlap cards to fit the width; wrap into more rows when slivers would get too thin to tap. */
  function layoutHand(els = $$('#hand .card')) {
    const handEl = $('#hand');
    if (!els.length) return handEl.replaceChildren();
    // Swap in the finished rows in one go: a half-built hand can briefly change the page height and lose its scroll position.
    const W = handEl.clientWidth;
    if (!$('.card', handEl)) handEl.append(els[0]);
    const cw = $('.card', handEl).offsetWidth;
    const k = els.length;
    const minStep = Math.max(28, cw * 0.45);
    const fit = Math.max(1, Math.floor((W - cw) / minStep) + 1);
    const rows = Math.ceil(k / fit);
    const perRow = Math.ceil(k / rows);
    const built = [];
    for (let i = 0; i < rows; i++) {
      const rowEls = els.slice(i * perRow, (i + 1) * perRow);
      const row = document.createElement('div');
      row.className = 'hand-row';
      const step = rowEls.length > 1 ? Math.min(cw + 5, (W - cw) / (rowEls.length - 1)) : 0;
      rowEls.forEach((el, j) => (el.style.marginLeft = j ? `${step - cw}px` : '0'));
      row.append(...rowEls);
      built.push(row);
    }
    handEl.replaceChildren(...built);
    const hinted = $('.card.hinted', handEl);
    if (hinted) hinted.scrollIntoView({ block: 'nearest' });
  }

  function renderBidbar() {
    const bar = $('#bidbar');
    const r = state.round;
    const show = state.phase === 'bidding' && r.bids[HUMAN] === null && runningGen !== gen;
    bar.hidden = !show;
    if (!show) return;
    const grid = $('#bid-grid');
    const scroll = grid.scrollLeft;
    grid.innerHTML = '';
    // more than two rows of numbers would squeeze the hand: use one swipeable strip instead
    const perRow = Math.max(1, Math.floor((bar.clientWidth - 24 + 6) / 50));
    grid.classList.toggle('strip', r.n + 1 > perRow * 2);
    for (let b = 0; b <= r.n; b++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b;
      btn.setAttribute('aria-pressed', String(pendingBid === b));
      btn.setAttribute('aria-label', `Guess ${plural(b, 'trick')}`);
      if (hint && hint.kind === 'bid' && hint.value === b) btn.classList.add('hinted');
      btn.addEventListener('click', () => pickBid(b));
      grid.append(btn);
    }
    grid.scrollLeft = scroll;
    const focus = $('.hinted', grid) || $('[aria-pressed="true"]', grid);
    if (focus && grid.classList.contains('strip')) {
      const l = focus.offsetLeft - grid.offsetLeft;
      if (l < grid.scrollLeft || l + focus.offsetWidth > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = l - (grid.clientWidth - focus.offsetWidth) / 2;
    }
    const go = $('#btn-bid');
    go.disabled = pendingBid === null;
    go.textContent = pendingBid === null ? 'Pick a number' : `1, 2, 3… show ${pendingBid}!`;
    $('#btn-bid-hint').hidden = !settings.hints;
  }

  function renderFeltMsg(text, big) {
    const el = $('#felt-msg');
    if (text === undefined) {
      const r = state.round;
      text = '';
      if (state.phase === 'playing' && r.turn === HUMAN) text = requirement();
      else if (state.phase === 'playing' && !r.trick.length) text = `${nameOf(r.turn)} leads`;
    }
    el.textContent = text;
    el.classList.toggle('big', !!big);
  }

  // ------------------------------------------------------------ animation

  function animatePlay(p, from, scale) {
    const el = $(`#trick .play[data-p="${p}"] .card`);
    if (!el || !from || reduceMotion || !el.animate) return Promise.resolve();
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = scale || from.width / to.width;
    const rot = (Math.random() - 0.5) * 16;
    return el
      .animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${rot}deg)`, opacity: 0.5 }, { transform: 'none', opacity: 1 }], {
        duration: sp().fly,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      })
      .finished.catch(() => {});
  }

  function animateCollect(w) {
    const target = seatEl(w);
    const els = $$('#trick .card');
    if (!target || reduceMotion || !els.length || !els[0].animate) return Promise.resolve();
    const tr = target.getBoundingClientRect();
    return Promise.all(
      els.map((el, i) => {
        const r = el.getBoundingClientRect();
        const dx = tr.left + tr.width / 2 - (r.left + r.width / 2);
        const dy = tr.top + tr.height / 2 - (r.top + r.height / 2);
        return el
          .animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0 }], {
            duration: sp().fly + 100,
            delay: i * 25,
            easing: 'cubic-bezier(.5,0,.8,.4)',
            fill: 'forwards',
          })
          .finished.catch(() => {});
      })
    );
  }

  function flashSeat(p) {
    const el = seatEl(p);
    if (!el) return;
    el.classList.add('won-trick');
    setTimeout(() => el.classList.remove('won-trick'), 700);
  }

  async function countdown(g) {
    const el = $('#countdown');
    const ms = sp().count;
    const felt = $('#felt').getBoundingClientRect();
    el.style.setProperty('--cy', `${felt.top + felt.height / 2}px`);
    for (const t of ['1', '2', '3!']) {
      el.innerHTML = `<span style="--count-ms:${ms}ms">${t}</span>`;
      await sleep(ms);
      if (!alive(g)) break;
    }
    el.innerHTML = '';
  }

  // ------------------------------------------------------------ game loop

  function kick() {
    if (!state || runningGen === gen) return;
    const g = gen;
    runningGen = g;
    loop(g)
      .catch((err) => {
        console.error(err);
        toast('Something went wrong. Open the menu to continue or start over.', 'warn');
      })
      .finally(() => {
        if (runningGen === g) runningGen = -1;
        if (alive(g) && state) {
          renderBidbar();
          renderMe();
        }
      });
  }

  async function loop(g) {
    while (alive(g)) {
      const st = state;
      const r = st.round;
      const N = st.players.length;
      if (st.phase === 'bidding') {
        render();
        for (let p = 1; p < N; p++) {
          if (r.bids[p] !== null) continue;
          await nextFrame();
          if (!alive(g)) return;
          G.setBid(st, p, AI.chooseBid(G.viewFor(st, p), st.players[p].level));
          renderSeats();
        }
        save();
        if (r.bids[HUMAN] === null) return; // wait for the human; pressing "show" kicks the loop again
        renderFeltMsg('');
        await countdown(g);
        if (!alive(g)) return;
        G.startPlay(st);
        save();
        revealAnim = true;
        render();
        revealAnim = false;
        const sum = r.bids.reduce((a, b) => a + b, 0);
        toast(sum > r.n ? `${sum} guessed, ${r.n} to take: someone will miss` : sum < r.n ? `${sum} guessed, ${r.n} to take: someone gets extra` : `Guesses add up to exactly ${r.n}`);
        await sleep(sp().trick * 0.6);
      } else if (st.phase === 'playing') {
        const p = r.turn;
        if (p === HUMAN) {
          render();
          return;
        }
        thinking = p;
        render();
        const t0 = performance.now();
        await nextFrame();
        if (!alive(g)) return;
        const card = AI.chooseCard(G.viewFor(st, p), st.players[p].level);
        const rest = sp().bot - (performance.now() - t0);
        if (rest > 0) await sleep(rest);
        if (!alive(g)) return;
        thinking = -1;
        const from = seatEl(p).getBoundingClientRect();
        G.playCard(st, p, card.id);
        save();
        render();
        await animatePlay(p, from, 0.45);
      } else if (st.phase === 'trickDone') {
        render();
        const w = r.trickWinner;
        renderFeltMsg(w === HUMAN ? 'You take the trick' : `${nameOf(w)} takes the trick`);
        await sleep(sp().trick, true);
        if (!alive(g)) return;
        await animateCollect(w);
        if (!alive(g)) return;
        G.collectTrick(st);
        save();
        render();
        flashSeat(w);
      } else if (st.phase === 'roundEnd') {
        render();
        showRoundSummary();
        return;
      } else if (st.phase === 'matchEnd') {
        render();
        store.del(KEY_MATCH);
        showMatchEnd();
        return;
      } else return;
    }
  }

  // ------------------------------------------------------------ human input

  function pickBid(b) {
    pendingBid = b;
    renderBidbar();
    renderMe();
  }

  function confirmBid() {
    if (!state || state.phase !== 'bidding' || pendingBid === null || state.round.bids[HUMAN] !== null) return;
    G.setBid(state, HUMAN, pendingBid);
    pendingBid = hint = null;
    save();
    $('#bidbar').hidden = true;
    kick();
  }

  function onCardTap(id, el) {
    if (!state || state.phase !== 'playing') {
      if (state && state.phase === 'bidding') toast('First choose how many tricks you will take');
      return;
    }
    const r = state.round;
    if (r.turn !== HUMAN) return toast(`Wait: ${nameOf(r.turn)} is playing`);
    const card = r.hands[HUMAN].find((c) => c.id === id);
    const why = R.whyIllegal(card, r.hands[HUMAN], r.trick, r.trump);
    if (why) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      return toast(why, 'warn');
    }
    const from = el.getBoundingClientRect();
    hint = null;
    G.playCard(state, HUMAN, id);
    save();
    render();
    animatePlay(HUMAN, from);
    kick();
  }

  function showCardHint() {
    const card = AI.chooseCard(G.viewFor(state, HUMAN), 'hard');
    hint = { kind: 'card', id: card.id };
    renderHand();
    toast(`Hard bot would play the ${C.cardName(card)}`);
  }

  function showBidHint() {
    const b = AI.chooseBid(G.viewFor(state, HUMAN), 'hard');
    hint = { kind: 'bid', value: b };
    renderBidbar();
    toast(`Hard bot would guess ${b}`);
  }

  // ------------------------------------------------------------ modals

  function openModal(html, ctx) {
    modalCtx = ctx || {};
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    $('#modal').hidden = false;
    sheet.scrollTop = 0;
    const focusable = sheet.querySelector('[data-autofocus]') || sheet.querySelector('button');
    if (focusable) focusable.focus({ preventScroll: true });
    return sheet;
  }

  /** Closing a helper sheet during a round/match end returns to its summary. */
  function closeModal(force) {
    $('#modal').hidden = true;
    const back = modalCtx && modalCtx.back;
    modalCtx = null;
    if (force || !state) return;
    if (back) back();
    else if (state.phase === 'roundEnd' && !$('#game').hidden) showRoundSummary();
    else if (state.phase === 'matchEnd' && !$('#game').hidden) showMatchEnd();
  }

  function showRoundSummary() {
    const h = state.history[state.history.length - 1];
    const N = state.players.length;
    const order = G.standings(state);
    const place = {};
    order.forEach((e) => (place[e.i] = e.place));
    const myPts = h.points[HUMAN];
    const title =
      h.bids[HUMAN] === h.won[HUMAN]
        ? h.won[HUMAN] === 0
          ? 'Clean zero!'
          : 'Spot on!'
        : `Off by ${Math.abs(h.bids[HUMAN] - h.won[HUMAN])}`;
    let rows = '';
    for (let p = 0; p < N; p++) {
      const hit = h.bids[p] === h.won[p];
      rows +=
        `<tr class="${hit ? 'hit' : 'miss'}${p === HUMAN ? ' is-me' : ''}"><td><span class="rank">${place[p]}.</span>${esc(state.players[p].name)}</td>` +
        `<td>${h.bids[p]}</td><td>${h.won[p]}</td><td class="pts">${fmtPts(h.points[p])}</td>` +
        `<td class="total">${fmtScore(state.players[p].score)}</td></tr>`;
    }
    const last = G.isLastRound(state);
    const nextN = last ? 0 : state.schedule[state.roundIndex + 1];
    const nextDealer = (state.dealer + 1) % N;
    const html =
      `<h2 id="modal-title">${title} <span style="color:${myPts >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtPts(myPts)}</span></h2>` +
      `<p class="sub">${roundLabel(state)} · ${plural(h.n, 'card')} · trump ${C.SUIT_SYMBOL[h.trump]} ${C.SUIT_NAME[h.trump]}</p>` +
      `<table class="results"><thead><tr><th>Player</th><th>Guess</th><th>Took</th><th>Points</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>` +
      targetLine() +
      `<div class="foot"><button type="button" class="btn" data-act="sheet">Scoresheet</button>` +
      `<button type="button" class="btn primary" data-act="next" data-autofocus>${last ? 'Final results' : `Next: ${plural(nextN, 'card')}, ${nextDealer === HUMAN ? 'you deal' : esc(state.players[nextDealer].name) + ' deals'}`}</button></div>`;
    const sheet = openModal(html, { locked: true });
    sheet.querySelector('[data-act="sheet"]').addEventListener('click', () => showScoresheet(showRoundSummary));
    sheet.querySelector('[data-act="next"]').addEventListener('click', () => {
      G.nextRound(state);
      save();
      closeModal(true);
      kick();
    });
  }

  // House tradition: the winner gets a balloon, the last player a sunken ship.
  const BALLOON =
    '<svg class="balloon" viewBox="0 0 40 70" aria-hidden="true">' +
    '<path d="M20 47c-3 4 3 7 0 11s3 6 0 11" fill="none" stroke="#e8dfc6" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M20 2C9.5 2 3 10.5 3 20c0 11.5 9.5 21 15.5 24.5L17 48h6l-1.5-3.5C27.5 41 37 31.5 37 20 37 10.5 30.5 2 20 2z" fill="#d8342c"/>' +
    '<ellipse cx="12.5" cy="14" rx="4" ry="7" fill="#fff" opacity=".35" transform="rotate(-22 12.5 14)"/></svg>';
  const SHIPWRECK =
    '<svg class="wreck" viewBox="0 0 64 52" aria-hidden="true"><g class="ship">' +
    '<path d="M6 28h48l-7 11H14z" fill="#7a4a2a"/><path d="M6 28h48" stroke="#3b2414" stroke-width="2"/>' +
    '<rect x="16" y="20" width="22" height="8" rx="1" fill="#efe8d6"/>' +
    '<circle cx="21" cy="24" r="1.4" fill="#2c6e8f"/><circle cx="27" cy="24" r="1.4" fill="#2c6e8f"/><circle cx="33" cy="24" r="1.4" fill="#2c6e8f"/>' +
    '<rect x="40" y="11" width="6" height="17" fill="#c0342c"/><rect x="40" y="11" width="6" height="4" fill="#1b1d22"/></g>' +
    '<g class="bubbles" fill="none" stroke="#cdeaf6" stroke-width="1"><circle cx="22" cy="46" r="1.6"/><circle cx="30" cy="48" r="1.1"/><circle cx="37" cy="45" r="1.3"/></g>' +
    '<path d="M0 36c4 0 4-3 8-3s4 3 8 3 4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3v16H0z" fill="#2c6e8f" opacity=".92"/></svg>';

  /** Race status for first-to-target matches. */
  function targetLine() {
    const T = state.opts.target;
    if (!T) return '';
    const lead = G.standings(state)[0];
    const who = lead.i === HUMAN ? 'You lead' : `${esc(lead.name)} leads`;
    const togo = T - lead.score;
    return `<p class="race">First to ${T}: ${who} with <b>${fmtScore(lead.score)}</b>${togo > 0 ? `, ${togo} to go` : ' and has made it'}.</p>`;
  }

  function showMatchEnd() {
    const order = G.standings(state);
    const rounds = state.history.length;
    const top = order.filter((e) => e.place === 1);
    const iWon = top.some((e) => e.i === HUMAN);
    const title = iWon ? (top.length > 1 ? 'You share the win!' : 'You win!') : top.length > 1 ? 'A shared win' : `${esc(top[0].name)} wins`;
    const lastPlace = Math.max(...order.map((e) => e.place));
    const bottom = lastPlace > 1 ? order.filter((e) => e.place === lastPlace) : [];
    const names = (list) => list.map((e) => (e.i === HUMAN ? 'You' : esc(e.name))).join(' & ');
    const prize = (e) => (e.place === 1 ? BALLOON : e.place === lastPlace && lastPlace > 1 ? SHIPWRECK : '');
    const finale =
      `<div class="finale"><figure>${BALLOON}<figcaption>A balloon for <b>${names(top)}</b></figcaption></figure>` +
      (bottom.length ? `<figure>${SHIPWRECK}<figcaption>A sunken ship for <b>${names(bottom)}</b></figcaption></figure>` : '') +
      '</div>';
    const items = order
      .map(
        (e) =>
          `<li class="${e.i === HUMAN ? 'is-me' : ''}"><span class="place">${e.place}</span>` +
          `<span class="nm">${esc(e.name)}<small>${e.exact} of ${rounds} guesses exact</small></span><span class="prize">${prize(e)}</span><span class="sc">${fmtScore(e.score)}</span></li>`
      )
      .join('');
    const html =
      `<h2 id="modal-title">${title}</h2><p class="sub">${plural(rounds, 'round')} played${state.opts.target ? ` · first to ${state.opts.target}` : ''}.</p>${finale}<ol class="podium">${items}</ol>` +
      `<div class="foot"><button type="button" class="btn" data-act="sheet">Scoresheet</button>` +
      `<button type="button" class="btn" data-act="setup">Change settings</button>` +
      `<button type="button" class="btn primary" data-act="again" data-autofocus>Play again</button></div>`;
    const sheet = openModal(html, { locked: true });
    sheet.querySelector('[data-act="sheet"]').addEventListener('click', () => showScoresheet(showMatchEnd));
    sheet.querySelector('[data-act="setup"]').addEventListener('click', () => {
      state = null;
      showStart();
    });
    sheet.querySelector('[data-act="again"]').addEventListener('click', startNewMatch);
  }

  function showScoresheet(back) {
    const N = state.players.length;
    const leadScore = Math.max(...state.players.map((p) => p.score));
    let head = '<th></th>';
    for (let p = 0; p < N; p++) {
      const lead = state.history.length && state.players[p].score === leadScore;
      head += `<th title="${esc(state.players[p].name)}"${lead ? ' class="lead"' : ''}>${esc(state.players[p].name)}</th>`;
    }
    let body = '';
    const rows = state.opts.target ? state.schedule.slice(0, state.roundIndex + 1) : state.schedule;
    rows.forEach((n, i) => {
      const h = state.history[i];
      const current = i === state.roundIndex && !h;
      const trump = h ? h.trump : current ? state.round.trump : null;
      const t = trump ? `<span class="t${C.isRed(trump) ? ' red' : ''}">${C.SUIT_SYMBOL[trump]}</span>` : '';
      let cells = '';
      for (let p = 0; p < N; p++) {
        if (h) {
          const hit = h.bids[p] === h.won[p];
          cells += `<td class="${hit ? 'hit' : 'miss'}" title="${fmtPts(h.points[p])} this round"><span class="p">${fmtScore(h.totals[p])}</span><small>${h.bids[p]} / ${h.won[p]}</small></td>`;
        } else if (current && state.phase !== 'bidding') {
          cells += `<td><small>guess ${state.round.bids[p]}</small></td>`;
        } else cells += '<td></td>';
      }
      body += `<tr class="${current ? 'current' : ''}"><th>${n} ${t}</th>${cells}</tr>`;
    });
    const html =
      `<h2 id="modal-title">Scoresheet</h2><p class="sub">Running totals after each round. Underneath: guess / took, green when exact.</p>` +
      `<div class="pad-wrap"><table class="pad"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
      `<div class="foot"><button type="button" class="btn primary" data-act="close" data-autofocus>Close</button></div>`;
    const sheet = openModal(html, { back });
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => closeModal());
    const cur = sheet.querySelector('tr.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  function showLastTrick() {
    const r = state.round;
    const t = r.tricks[r.tricks.length - 1];
    if (!t) return;
    const sheet = openModal(
      `<h2 id="modal-title">Last trick</h2><p class="sub">${t.winner === HUMAN ? 'You' : esc(nameOf(t.winner))} took it. Trump is ${C.SUIT_SYMBOL[r.trump]}.</p>` +
        `<div class="last-trick"></div><div class="foot"><button type="button" class="btn primary" data-act="close">Close</button></div>`
    );
    const box = sheet.querySelector('.last-trick');
    const led = t.plays[0].p;
    for (const p of tableOrder(state.players.length)) {
      const { card } = t.plays.find((x) => x.p === p);
      const slot = document.createElement('div');
      slot.className = 'play' + (p === t.winner ? ' leading' : '') + (p === led ? ' led' : '');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = nameOf(p);
      slot.append(cardEl(card, { trump: card.s === r.trump }), who);
      box.append(slot);
    }
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => closeModal());
  }

  function showMenu() {
    const html =
      `<h2 id="modal-title">Menu</h2><p class="sub">The match is saved after every card, so you can leave and continue later.</p>` +
      `<div class="menu-list">` +
      `<button type="button" class="btn primary" data-act="close" data-autofocus>Back to the table</button>` +
      `<button type="button" class="btn" data-act="sheet">Scoresheet</button>` +
      `<button type="button" class="btn" data-act="rules">How to play</button>` +
      `<div class="field"><span class="lbl" style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)">Pace</span><div class="seg" id="m-speed"></div></div>` +
      `<label class="check" for="m-hints"><input type="checkbox" id="m-hints"${settings.hints ? ' checked' : ''}><span>Show a hint button</span></label>` +
      `<button type="button" class="btn" data-act="home">Main menu</button>` +
      `</div>`;
    const sheet = openModal(html);
    seg(sheet.querySelector('#m-speed'), 'mspeed', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['quick', 'Quick']], settings.speed, (v) => {
      settings.speed = v;
      saveSettings();
    });
    sheet.querySelector('#m-hints').addEventListener('change', (e) => {
      settings.hints = e.target.checked;
      saveSettings();
      renderMe();
      renderBidbar();
    });
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => closeModal());
    sheet.querySelector('[data-act="sheet"]').addEventListener('click', () => showScoresheet());
    sheet.querySelector('[data-act="rules"]').addEventListener('click', () => showRules());
    sheet.querySelector('[data-act="home"]').addEventListener('click', showStart);
  }

  function showRules() {
    const T = C.SUIT_SYMBOL;
    const html = `<h2 id="modal-title">How to play</h2>
<div class="rules">
<p>Rikiki (also Riki tiki) is played with French cards, 3 or more players, over a series of rounds. The highest total at the end wins.</p>
<h3>Each round</h3>
<ol>
<li>Everyone gets the same number of cards: 1 in the first round, then one more each round (the round order can be changed in the settings).</li>
<li>The next card of the deck is turned up. Its suit is <b>trump</b> for the round. The turned card itself stays out of play.</li>
<li>Look at your cards and guess how many tricks you will take. The dealer counts <b>“1, 2, 3”</b> and everyone shows their guess at the same time.</li>
<li>The player after the dealer leads the first trick. The highest card wins the trick, and its winner leads the next one.</li>
</ol>
<h3>Which card you must play</h3>
<ul>
<li>The leader can play any card, trumps included.</li>
<li>Follow the led suit if you can, and <b>beat the winning card if you can</b>. If you can't beat it, you still have to follow suit.</li>
<li>No card of the led suit? Then you must play a <b>trump</b>. If the trick already holds a trump, you must play a higher one if you have it; if all yours are lower, you still play a trump.</li>
<li>No led suit and no trumps: play anything. A good chance to throw away a dangerous card.</li>
</ul>
<p>Cards rank 2 (low) up to A (high). A trump beats every other suit. With two decks there are identical cards: the one played first wins.</p>
<h3>Classic scoring</h3>
<ul>
<li>Exactly right: <b>10 points + 2 per trick</b>. A correct guess of zero is worth 10.</li>
<li>Wrong: <b>−2 points for every trick</b> you were off, in either direction.</li>
</ul>
<p class="ex">Guess 3, take 3: <b>+16</b> · Guess 3, take 1: <em>−4</em> · Guess 3, take 5: <em>−4</em> · Guess 0, take 0: <b>+10</b></p>
<h3>Variants</h3>
<ul>
<li><b>20 per trick</b> scoring: if you take at least your guess, you get 20 per guessed trick, minus 2 for each extra trick. If you fall short, it is −2 per missing trick. A zero guess is worth 10, minus 2 per trick taken.</li>
<li><b>First to 500 / 1000</b>: the round order repeats until someone reaches the target. The match ends after that round, and the highest score wins. This pairs well with 20 per trick.</li>
</ul>
<p class="ex">20 per trick. Guess 2, take 5: <b>+34</b> · Guess 5, take 2: <em>−6</em> · Guess 3, take 3: <b>+60</b> · Guess 0, take 2: <b>+6</b></p>
<h3>Reading the table</h3>
<ul>
<li>Every player shows their guess and the tricks taken so far. The numbers turn green while exact and red once over.</li>
<li>Trump cards in your hand have a brass line along the bottom edge. Cards you are not allowed to play are dimmed on your turn.</li>
<li>The top bar shows the total of all guesses against the number of tricks: <span style="color:var(--bad)">more</span> means somebody will miss, <span style="color:var(--good)">fewer</span> means somebody will take more than planned.</li>
</ul>
<p>Examples with trump ${T.S}: hearts are led and you hold 10${T.H} and Q${T.H} while the table shows J${T.H}: you must play Q${T.H}. With no hearts but a 3${T.S}, you must trump with the 3${T.S}.</p>
</div>
<div class="foot"><button type="button" class="btn primary" data-act="close" data-autofocus>Got it</button></div>`;
    const sheet = openModal(html);
    sheet.querySelector('[data-act="close"]').addEventListener('click', () => closeModal());
  }

  // ------------------------------------------------------------ toast

  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'warn' ? 3200 : 2400);
  }

  // ------------------------------------------------------------ wiring

  function wire() {
    $('#btn-menu').addEventListener('click', showMenu);
    $('#btn-scores').addEventListener('click', () => showScoresheet());
    $('#btn-last').addEventListener('click', showLastTrick);
    $('#btn-bid').addEventListener('click', confirmBid);
    $('#btn-bid-hint').addEventListener('click', showBidHint);
    $('#felt').addEventListener('click', () => skipWait && skipWait());
    $$('[data-open="rules"]').forEach((b) => b.addEventListener('click', showRules));
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal' && modalCtx && !modalCtx.locked) closeModal();
    });
    let resizeT = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        if (!state || $('#game').hidden) return;
        layoutHand();
        balanceSeats();
      }, 80);
    });
    document.addEventListener('keydown', (e) => {
      if (!$('#modal').hidden) {
        if (e.key === 'Escape' && modalCtx && !modalCtx.locked) closeModal();
        return;
      }
      if (!state || $('#game').hidden || e.target.tagName === 'INPUT') return;
      if (!$('#bidbar').hidden) {
        if (/^[0-9]$/.test(e.key) && Number(e.key) <= state.round.n) pickBid(Number(e.key));
        else if (e.key === 'Enter' && pendingBid !== null) {
          e.preventDefault();
          confirmBid();
        }
      } else if ((e.key === ' ' || e.key === 'Enter') && skipWait) {
        e.preventDefault();
        skipWait();
      }
    });
  }

  initSetup();
  wire();
  showStart();
})();
