/* Match state machine. State is a plain JSON object so it can be saved and
 * resumed. No DOM here.
 *
 * phase: 'bidding' -> 'playing' <-> 'trickDone' -> 'roundEnd' -> ... -> 'matchEnd'
 */
(function (root) {
  'use strict';
  const Riki = (root.Riki = root.Riki || {});
  const { makeDeck, shuffle, isJoker } = Riki.cards;
  const { winningPlay, isLegal, roundScore, buildSchedule, maxHandSize, NO_TRUMP_CHANCE } = Riki.rules;

  /**
   * opts: { players: [{name, isHuman, level}], decks, maxCards, shape,
   *         scoring: 'classic' | 'twenty',
   *         target: 0 = play the round sequence once, N = first to N points (the sequence repeats),
   *         jokers: jokers per deck, sameBeats: a later identical card wins,
   *         trumpMode: 'always' | 'sometimes' | 'never' }
   */
  function createMatch(opts, rng) {
    rng = rng || Math.random;
    const N = opts.players.length;
    if (N < 3) throw new Error('Rikiki needs at least 3 players');
    const jokers = opts.jokers || 0;
    const trumpMode = opts.trumpMode || 'always';
    const maxCards = Math.min(opts.maxCards, maxHandSize(N, opts.decks, jokers, trumpMode));
    const state = {
      v: 1,
      opts: {
        decks: opts.decks,
        maxCards,
        shape: opts.shape || 'pyramid',
        scoring: opts.scoring || 'classic',
        target: opts.target || 0,
        jokers,
        sameBeats: !!opts.sameBeats,
        trumpMode,
      },
      players: opts.players.map((p) => ({ name: p.name, isHuman: !!p.isHuman, level: p.level || 'normal', score: 0 })),
      schedule: buildSchedule(maxCards, opts.shape || 'pyramid'),
      roundIndex: -1,
      dealer: Math.floor(rng() * N),
      history: [],
      round: null,
      phase: 'idle',
    };
    startRound(state, rng);
    return state;
  }

  function startRound(state, rng) {
    const N = state.players.length;
    state.roundIndex++;
    if (state.roundIndex > 0) state.dealer = (state.dealer + 1) % N;
    const n = state.schedule[state.roundIndex];
    const deck = shuffle(makeDeck(state.opts.decks, state.opts.jokers), rng);
    const hands = Array.from({ length: N }, () => []);
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 1; j <= N; j++) hands[(state.dealer + j) % N].push(deck[k++]);
    }
    const trumpCard = turnUp(state.opts, deck.slice(k), rng);
    const first = (state.dealer + 1) % N;
    state.round = {
      n,
      trumpCard,
      trump: trumpCard && !isJoker(trumpCard) ? trumpCard.s : null,
      hands,
      bids: Array(N).fill(null),
      won: Array(N).fill(0),
      trick: [],
      tricks: [],
      leader: first,
      turn: first,
      trickWinner: null,
    };
    state.phase = 'bidding';
  }

  /** The card turned up for trump, or null when none is turned. A turned-up
   * joker means no trump; when there must be one, it goes back into the stock
   * and the next suited card is turned instead. */
  function turnUp(opts, stock, rng) {
    const mode = opts.trumpMode || 'always';
    if (mode === 'never') return null;
    if (mode === 'sometimes') return opts.jokers || rng() >= NO_TRUMP_CHANCE ? stock[0] : null;
    return stock.find((c) => !isJoker(c)) || stock[0];
  }

  function setBid(state, p, bid) {
    const r = state.round;
    if (state.phase !== 'bidding') throw new Error('Not bidding');
    if (!Number.isInteger(bid) || bid < 0 || bid > r.n) throw new Error('Bid out of range');
    r.bids[p] = bid;
  }

  function allBid(state) {
    return state.round.bids.every((b) => b !== null);
  }

  function startPlay(state) {
    if (!allBid(state)) throw new Error('Bids missing');
    state.phase = 'playing';
  }

  function playCard(state, p, cardId) {
    const r = state.round;
    if (state.phase !== 'playing') throw new Error('Not playing');
    if (r.turn !== p) throw new Error('Not your turn');
    const hand = r.hands[p];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error('Card not in hand');
    const card = hand[idx];
    if (!isLegal(card, hand, r.trick, r.trump, state.opts.sameBeats)) throw new Error('Illegal card');
    hand.splice(idx, 1);
    r.trick.push({ p, card });
    if (r.trick.length === state.players.length) {
      r.trickWinner = winningPlay(r.trick, r.trump, state.opts.sameBeats).p;
      state.phase = 'trickDone';
    } else {
      r.turn = (p + 1) % state.players.length;
    }
    return card;
  }

  function collectTrick(state) {
    const r = state.round;
    if (state.phase !== 'trickDone') throw new Error('No finished trick');
    const w = r.trickWinner;
    r.won[w]++;
    r.tricks.push({ plays: r.trick, winner: w });
    r.trick = [];
    r.leader = r.turn = w;
    r.trickWinner = null;
    if (r.hands[0].length === 0) finishRound(state);
    else state.phase = 'playing';
  }

  function finishRound(state) {
    const r = state.round;
    const points = r.bids.map((b, i) => roundScore(b, r.won[i], state.opts.scoring));
    points.forEach((pt, i) => (state.players[i].score += pt));
    state.history.push({
      n: r.n,
      trump: r.trump,
      trumpCard: r.trumpCard,
      dealer: state.dealer,
      bids: r.bids.slice(),
      won: r.won.slice(),
      points,
      totals: state.players.map((p) => p.score),
      tricks: r.tricks,
    });
    state.phase = 'roundEnd';
  }

  function nextRound(state, rng) {
    if (state.phase !== 'roundEnd') throw new Error('Round not finished');
    if (isLastRound(state)) {
      state.phase = 'matchEnd';
      return;
    }
    if (state.roundIndex + 1 >= state.schedule.length) extendSchedule(state);
    startRound(state, rng);
  }

  /** Target matches end once anyone has reached the target after a round. */
  function isLastRound(state) {
    if (state.opts.target) return state.players.some((p) => p.score >= state.opts.target);
    return state.roundIndex + 1 >= state.schedule.length;
  }

  /** Repeat the round pattern, without doubling the hand size at the seam (…2, 1, 2, 3…). */
  function extendSchedule(state) {
    const pattern = buildSchedule(state.opts.maxCards, state.opts.shape);
    const last = state.schedule[state.schedule.length - 1];
    state.schedule.push(...(pattern[0] === last && pattern.length > 1 ? pattern.slice(1) : pattern));
  }

  /** Everyone's hand as dealt, rebuilt from the cards they played. */
  function dealtHands(tricks, N) {
    const hands = Array.from({ length: N }, () => []);
    for (const t of tricks) for (const { p, card } of t.plays) hands[p].push(card);
    return hands;
  }

  /** Players sorted by score, with shared places for ties. */
  function standings(state) {
    const list = state.players.map((p, i) => ({ i, name: p.name, score: p.score, exact: 0, over: 0, under: 0 }));
    for (const h of state.history) {
      h.bids.forEach((b, i) => list[i][b === h.won[i] ? 'exact' : h.won[i] > b ? 'over' : 'under']++);
    }
    list.sort((a, b) => b.score - a.score || b.exact - a.exact);
    list.forEach((e, k) => (e.place = k > 0 && list[k - 1].score === e.score ? list[k - 1].place : k + 1));
    return list;
  }

  /** Zeros in a score's digits: 20 has one egg, 200 has two. */
  function eggs(n) {
    return (String(Math.abs(n)).match(/0/g) || []).length;
  }

  /**
   * Per player, from the totals after each finished round: rounds on top and
   * at the bottom (ties count for everyone sharing the place), average place,
   * current and best run of rounds on top, and eggs in all the running totals.
   */
  function matchStats(state) {
    const N = state.players.length;
    const list = state.players.map((p, i) => ({ i, name: p.name, top: 0, bottom: 0, placeSum: 0, streak: 0, bestStreak: 0, eggs: 0 }));
    for (const h of state.history) {
      const places = h.totals.map((t) => 1 + h.totals.filter((u) => u > t).length);
      const lastPlace = Math.max(...places);
      for (let i = 0; i < N; i++) {
        const e = list[i];
        e.placeSum += places[i];
        e.eggs += eggs(h.totals[i]);
        if (places[i] === lastPlace && lastPlace > 1) e.bottom++;
        if (places[i] === 1) {
          e.top++;
          e.bestStreak = Math.max(e.bestStreak, ++e.streak);
        } else e.streak = 0;
      }
    }
    const rounds = state.history.length;
    list.forEach((e) => (e.avgPlace = rounds ? e.placeSum / rounds : null));
    return list;
  }

  /** What player p is allowed to know. Other bids are hidden until play starts. */
  function viewFor(state, p) {
    const r = state.round;
    const N = state.players.length;
    return {
      me: p,
      N,
      decks: state.opts.decks,
      jokers: state.opts.jokers || 0,
      same: !!state.opts.sameBeats,
      scoring: state.opts.scoring || 'classic',
      n: r.n,
      hand: r.hands[p].slice(),
      trump: r.trump,
      trumpCard: r.trumpCard,
      dealer: state.dealer,
      firstLeader: (state.dealer + 1) % N,
      bids: state.phase === 'bidding' ? null : r.bids.slice(),
      won: r.won.slice(),
      trick: r.trick.slice(),
      tricks: r.tricks,
      handCounts: r.hands.map((h) => h.length),
    };
  }

  Riki.game = {
    createMatch,
    startRound,
    setBid,
    allBid,
    startPlay,
    playCard,
    collectTrick,
    nextRound,
    isLastRound,
    standings,
    eggs,
    matchStats,
    dealtHands,
    viewFor,
  };
})(globalThis);
