const test = require('node:test');
const assert = require('node:assert/strict');
const { cards, rules, game, ai } = require('./load.cjs');

function playMatch(levels, opts, seed) {
  const rng = cards.mulberry32(seed);
  const st = game.createMatch(
    { players: levels.map((level, i) => ({ name: 'P' + i, level })), decks: 2, maxCards: 6, shape: 'pyramid', ...opts },
    rng
  );
  while (st.phase !== 'matchEnd') {
    const r = st.round;
    const total = r.hands.reduce((a, h) => a + h.length, 0);
    assert.equal(total, r.n * st.players.length);
    const dealt = r.hands.map((h) => h.map((c) => c.id).sort());
    for (let p = 0; p < st.players.length; p++) game.setBid(st, p, ai.chooseBid(game.viewFor(st, p), st.players[p].level, rng));
    game.startPlay(st);
    while (st.phase === 'playing' || st.phase === 'trickDone') {
      if (st.phase === 'trickDone') {
        game.collectTrick(st);
        continue;
      }
      const p = st.round.turn;
      const view = game.viewFor(st, p);
      const card = ai.chooseCard(view, st.players[p].level, rng);
      assert.ok(rules.isLegal(card, view.hand, view.trick, view.trump), 'AI played an illegal card');
      game.playCard(st, p, card.id);
    }
    const h = st.history[st.history.length - 1];
    assert.equal(h.won.reduce((a, b) => a + b, 0), h.n);
    assert.deepEqual(game.dealtHands(h.tricks, st.players.length).map((hd) => hd.map((c) => c.id).sort()), dealt, 'replay rebuilds the deal');
    game.nextRound(st, rng);
  }
  return st;
}

test('full matches run to completion with legal play at every level', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const st = playMatch(['easy', 'normal', 'hard', 'easy'], {}, seed);
    assert.equal(st.history.length, 11);
    st.players.forEach((p, i) => assert.equal(p.score, st.history.reduce((a, h) => a + h.points[i], 0)));
  }
});

test('dealer rotates and the player after the dealer leads', () => {
  const rng = cards.mulberry32(7);
  const st = game.createMatch({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], decks: 1, maxCards: 3 }, rng);
  const d0 = st.dealer;
  assert.equal(st.round.turn, (d0 + 1) % 3);
  for (let p = 0; p < 3; p++) game.setBid(st, p, 0);
  game.startPlay(st);
  for (let k = 0; k < 3; k++) {
    const p = st.round.turn;
    const card = rules.legalCards(st.round.hands[p], st.round.trick, st.round.trump)[0];
    game.playCard(st, p, card.id);
  }
  game.collectTrick(st);
  game.nextRound(st, rng);
  assert.equal(st.dealer, (d0 + 1) % 3);
});

test('illegal plays are rejected', () => {
  const rng = cards.mulberry32(3);
  const st = game.createMatch({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], decks: 2, maxCards: 8, shape: 'down' }, rng);
  assert.throws(() => game.playCard(st, st.round.turn, st.round.hands[st.round.turn][0].id), /Not playing/);
  for (let p = 0; p < 3; p++) game.setBid(st, p, 1);
  game.startPlay(st);
  const other = (st.round.turn + 1) % 3;
  assert.throws(() => game.playCard(st, other, st.round.hands[other][0].id), /Not your turn/);
});

test('bids stay hidden from views during bidding', () => {
  const st = game.createMatch({ players: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], decks: 1, maxCards: 3 }, cards.mulberry32(1));
  game.setBid(st, 0, 1);
  assert.equal(game.viewFor(st, 1).bids, null);
});

test('inferred voids and caps are respected by sampled deals', () => {
  const c = (str) => ({ id: str + '.x', s: str[0], r: Number(str.slice(1)) });
  const view = {
    me: 0, N: 3, decks: 1, n: 3, trump: 'S', trumpCard: c('D2'),
    hand: [c('H2'), c('C5')],
    // P1 led H10; P2 could not beat it (so no heart above 10) ; I (P0) won with... pretend.
    tricks: [{ plays: [{ p: 1, card: c('H10') }, { p: 2, card: c('H4') }, { p: 0, card: c('H13') }], winner: 0 }],
    trick: [{ p: 0, card: c('C9') }, { p: 1, card: c('D7') }], // P1 is void in clubs and in spades
    won: [1, 0, 0], bids: [1, 1, 1], handCounts: [2, 1, 2],
  };
  const cons = ai.inferConstraints(view, true);
  assert.ok(cons.voids[1].C && cons.voids[1].S);
  assert.equal(cons.caps[2].H, 10);
  const unknown = ai.unknownCards(view);
  const rng = cards.mulberry32(5);
  for (let i = 0; i < 200; i++) {
    const deal = ai.sampleDeal(unknown, [0, 1, 2], cons, rng);
    assert.ok(deal);
    assert.equal(deal[1].length, 1);
    assert.equal(deal[2].length, 2);
    for (const x of deal[1]) assert.ok(x.s !== 'C' && x.s !== 'S');
    for (const x of deal[2]) assert.ok(!(x.s === 'H' && x.r > 10));
  }
});

test('first-to-target matches repeat the round pattern until someone gets there', () => {
  const rng = cards.mulberry32(11);
  const st = game.createMatch(
    { players: ['a', 'b', 'c'].map((name) => ({ name, level: 'easy' })), decks: 1, maxCards: 3, shape: 'pyramid', scoring: 'twenty', target: 150 },
    rng
  );
  while (st.phase !== 'matchEnd') {
    for (let p = 0; p < 3; p++) game.setBid(st, p, ai.chooseBid(game.viewFor(st, p), 'easy', rng));
    game.startPlay(st);
    while (st.phase !== 'roundEnd') {
      if (st.phase === 'trickDone') game.collectTrick(st);
      else game.playCard(st, st.round.turn, ai.chooseCard(game.viewFor(st, st.round.turn), 'easy', rng).id);
    }
    const before = st.players.some((p) => p.score >= 150);
    game.nextRound(st, rng);
    assert.equal(st.phase === 'matchEnd', before);
  }
  assert.ok(st.history.length > 5, 'pattern repeated past its 5 rounds');
  assert.deepEqual(st.schedule.slice(0, 9), [1, 2, 3, 2, 1, 2, 3, 2, 1]);
  st.history.forEach((h) => h.points.forEach((pt, i) => assert.equal(pt, rules.roundScore(h.bids[i], h.won[i], 'twenty'))));
});

test('eggs count the zeros in a score', () => {
  assert.deepEqual([0, 7, 20, 208, 200, -100, 1005].map(game.eggs), [1, 0, 1, 1, 2, 2, 2]);
});

test('match stats track places, runs on top and eggs', () => {
  const totals = [
    [10, 0, 0],
    [20, 30, 0],
    [40, 30, 10],
    [60, 30, 10],
    [60, 60, 100],
  ];
  const st = { players: ['a', 'b', 'c'].map((name) => ({ name })), history: totals.map((t) => ({ totals: t })) };
  const s = game.matchStats(st);
  assert.deepEqual(s.map((e) => e.top), [3, 1, 1]);
  assert.deepEqual(s.map((e) => e.bottom), [1, 2, 4]);
  assert.deepEqual(s.map((e) => e.bestStreak), [2, 1, 1]);
  assert.deepEqual(s.map((e) => e.streak), [0, 0, 1]);
  assert.deepEqual(s.map((e) => e.avgPlace), [7 / 5, 9 / 5, 12 / 5]);
  assert.deepEqual(s.map((e) => e.eggs), [1 + 1 + 1 + 1 + 1, 1 + 1 + 1 + 1 + 1, 1 + 1 + 1 + 1 + 2]);
});
