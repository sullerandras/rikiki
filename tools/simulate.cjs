#!/usr/bin/env node
// Bot tournament: node tools/simulate.cjs [matches=20] [levels=1,2,3,4,5] [maxCards=8] [scoring=classic|twenty] [house rules]
// House rules, comma separated: jokers=N (per deck), same (same card beats), trump=always|sometimes|never
// Seats rotate each match. Reports average match score, exact-bid rate, negative-round rate and think time per level.
const { cards, game, ai } = require('../test/load.cjs');

const matches = Number(process.argv[2] || 20);
const levels = (process.argv[3] || '1,2,3,4,5').split(',');
const maxCards = Number(process.argv[4] || 8);
const scoring = process.argv[5] || 'classic';
const house = { jokers: 0, sameBeats: false, trumpMode: 'always' };
for (const kv of (process.argv[6] || '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (k === 'jokers') house.jokers = Number(v);
  else if (k === 'same') house.sameBeats = true;
  else if (k === 'trump') house.trumpMode = v;
}
const stats = {};
for (const l of new Set(levels)) stats[l] = { score: 0, seats: 0, exact: 0, neg: 0, rounds: 0, wins: 0, ms: 0, moves: 0 };

for (let m = 0; m < matches; m++) {
  const rng = cards.mulberry32(1000 + m);
  const seatLevels = levels.map((_, i) => levels[(i + m) % levels.length]);
  const st = game.createMatch({ players: seatLevels.map((level, i) => ({ name: 'P' + i, level })), decks: 2, maxCards, shape: 'pyramid', scoring, ...house }, rng);
  const timed = (lvl, f) => {
    const t = performance.now();
    const out = f();
    stats[lvl].ms += performance.now() - t;
    stats[lvl].moves++;
    return out;
  };
  while (st.phase !== 'matchEnd') {
    st.players.forEach((p, i) => game.setBid(st, i, timed(p.level, () => ai.chooseBid(game.viewFor(st, i), p.level, rng))));
    game.startPlay(st);
    while (st.phase !== 'roundEnd') {
      if (st.phase === 'trickDone') { game.collectTrick(st); continue; }
      const p = st.round.turn;
      const lvl = st.players[p].level;
      game.playCard(st, p, timed(lvl, () => ai.chooseCard(game.viewFor(st, p), lvl, rng)).id);
    }
    const h = st.history[st.history.length - 1];
    st.players.forEach((p, i) => { stats[p.level].rounds++; if (h.bids[i] === h.won[i]) stats[p.level].exact++; if (h.points[i] < 0) stats[p.level].neg++; });
    game.nextRound(st, rng);
  }
  st.players.forEach((p) => { stats[p.level].score += p.score; stats[p.level].seats++; });
  const top = Math.max(...st.players.map((p) => p.score));
  st.players.filter((p) => p.score === top).forEach((p) => stats[p.level].wins++);
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(`${matches} matches, seats: ${levels.join(', ')}, up to ${maxCards} cards, ${scoring} scoring, ${house.jokers} jokers/deck, trump ${house.trumpMode}${house.sameBeats ? ', same card beats' : ''}`);
for (const [l, s] of Object.entries(stats)) {
  console.log(
    `${l.padEnd(7)} avg score ${(s.score / s.seats).toFixed(1).padStart(6)}  exact ${((100 * s.exact) / s.rounds).toFixed(0).padStart(3)}%  negative ${((100 * s.neg) / s.rounds).toFixed(0).padStart(3)}%` +
      `  wins ${s.wins} (${((100 * s.wins) / s.seats).toFixed(0)}% of seats)  avg think ${(s.ms / s.moves).toFixed(1)} ms`
  );
}
