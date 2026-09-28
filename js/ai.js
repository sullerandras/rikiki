/* Computer opponents.
 *
 * - A fast heuristic policy (bidding + card play) that only uses what a player
 *   can see: own hand, cards already played, the turned-up trump.
 * - Monte Carlo search on top of it: deal the unseen cards randomly to the
 *   other players (respecting what their earlier plays revealed), play the
 *   round out with the heuristic policy for every candidate move, and pick the
 *   move with the best average round score.
 */
(function (root) {
  'use strict';
  const Riki = (root.Riki = root.Riki || {});
  const { SUIT_INDEX, shuffle } = Riki.cards;
  const { beats, winningPlay, legalCards, roundScore } = Riki.rules;

  const LEVELS = {
    easy: { mc: false, bidNoise: 0.4, playNoise: 0.2 },
    normal: { mc: true, bidSamples: 60, playSamples: 60, ms: 250, caps: false },
    hard: { mc: true, bidSamples: 500, playSamples: 500, ms: 900, caps: true },
  };

  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const key = (s, r) => SUIT_INDEX[s] * 15 + r;

  // ---------------------------------------------------------------- helpers

  function strength(c, trump) {
    return (c.s === trump ? 100 : 0) + c.r;
  }
  function minBy(cards, f) {
    let best = cards[0];
    for (const c of cards) if (f(c) < f(best)) best = c;
    return best;
  }
  function maxBy(cards, f) {
    let best = cards[0];
    for (const c of cards) if (f(c) > f(best)) best = c;
    return best;
  }

  /** No higher card of this suit can still be out there (in-suit only). */
  function isBoss(card, hand, seen, decks) {
    const si = SUIT_INDEX[card.s] * 15;
    for (let r = card.r + 1; r <= 14; r++) {
      let out = decks - seen[si + r];
      for (const h of hand) if (h.s === card.s && h.r === r) out--;
      if (out > 0) return false;
    }
    return true;
  }

  function publicSeen(view) {
    const seen = new Int8Array(60);
    seen[key(view.trumpCard.s, view.trumpCard.r)]++;
    for (const t of view.tricks) for (const pl of t.plays) seen[key(pl.card.s, pl.card.r)]++;
    for (const pl of view.trick) seen[key(pl.card.s, pl.card.r)]++;
    return seen;
  }

  // ------------------------------------------------------- heuristic bidding

  function heuristicBid(hand, trump, N, decks, trumpCard, isLeader) {
    const n = hand.length;
    const unknown = decks * 52 - n - 1;
    const frac = Math.min(1, ((N - 1) * n) / unknown);
    const rem = new Int8Array(60);
    const remSuit = { S: 0, H: 0, C: 0, D: 0 };
    for (const s of ['S', 'H', 'C', 'D']) for (let r = 2; r <= 14; r++) rem[key(s, r)] = decks;
    for (const c of hand.concat([trumpCard])) rem[key(c.s, c.r)]--;
    for (const s in remSuit) for (let r = 2; r <= 14; r++) remSuit[s] += rem[key(s, r)];

    const mySuit = { S: 0, H: 0, C: 0, D: 0 };
    for (const c of hand) mySuit[c.s]++;
    let shortSuits = 0;
    for (const s in mySuit) if (s !== trump && mySuit[s] <= 1) shortSuits++;

    let exp = 0;
    for (const c of hand) {
      let higher = 0;
      for (let r = c.r + 1; r <= 14; r++) higher += rem[key(c.s, r)];
      let p = Math.pow(1 - frac, higher);
      if (c.s !== trump) {
        const pVoid = Math.pow(1 - remSuit[c.s] / unknown, n);
        const pHasTrump = 1 - Math.pow(1 - remSuit[trump] / unknown, n);
        p *= Math.pow(1 - pVoid * pHasTrump, N - 1);
        if (n === 1 && !isLeader) p *= 0.15;
      } else if (n >= 3) {
        p = Math.max(p, (0.3 * shortSuits) / 3);
      }
      exp += p;
    }
    return Math.max(0, Math.min(n, Math.round(exp)));
  }

  // ---------------------------------------------------------- heuristic play

  /** Pick a card for player p of a (possibly simulated) round.
   * ctx: {hand, trick, trump, need, N, seen, decks} */
  function heuristicPlay(ctx) {
    const { hand, trick, trump, need, N, seen, decks } = ctx;
    const legal = legalCards(hand, trick, trump);
    if (legal.length === 1) return legal[0];
    const st = (c) => strength(c, trump);

    if (!trick.length) {
      if (need > 0) {
        const bosses = legal.filter((c) => isBoss(c, hand, seen, decks));
        const trumpBoss = bosses.filter((c) => c.s === trump);
        if (trumpBoss.length) return maxBy(trumpBoss, st);
        if (bosses.length) return maxBy(bosses, st);
        const nonTrump = legal.filter((c) => c.s !== trump);
        if (nonTrump.length && nonTrump.length < legal.length) {
          // Shorten the shortest side suit so we can ruff it later.
          const count = {};
          for (const c of nonTrump) count[c.s] = (count[c.s] || 0) + 1;
          return minBy(nonTrump, (c) => count[c.s] * 100 + c.r);
        }
        return maxBy(legal, st);
      }
      const nonTrump = legal.filter((c) => c.s !== trump);
      return minBy(nonTrump.length ? nonTrump : legal, (c) => c.r);
    }

    const best = winningPlay(trick, trump).card;
    const winners = legal.filter((c) => beats(c, best, trump));
    const losers = legal.filter((c) => !beats(c, best, trump));
    const last = trick.length === N - 1;
    if (need > 0) {
      if (!winners.length) return minBy(losers, st);
      if (last) return minBy(winners, st);
      const safe = winners.filter((c) => isBoss(c, hand, seen, decks));
      if (safe.length) return minBy(safe, st);
      return maxBy(winners, st);
    }
    if (losers.length) return maxBy(losers, st);
    return last ? maxBy(winners, st) : minBy(winners, st);
  }

  // ------------------------------------------------------------- simulation

  function simPlay(sim, p, card) {
    const hand = sim.hands[p];
    const idx = hand.indexOf(card);
    hand.splice(idx >= 0 ? idx : hand.findIndex((c) => c.id === card.id), 1);
    sim.trick.push({ p, card });
    sim.seen[key(card.s, card.r)]++;
    if (sim.trick.length === sim.N) {
      const w = winningPlay(sim.trick, sim.trump).p;
      sim.won[w]++;
      sim.trick = [];
      sim.turn = w;
    } else {
      sim.turn = (p + 1) % sim.N;
    }
  }

  function rollout(sim, me) {
    while (sim.hands[sim.turn].length > 0) {
      const p = sim.turn;
      const card = heuristicPlay({
        hand: sim.hands[p],
        trick: sim.trick,
        trump: sim.trump,
        need: sim.bids[p] - sim.won[p],
        N: sim.N,
        seen: sim.seen,
        decks: sim.decks,
      });
      simPlay(sim, p, card);
    }
    return roundScore(sim.bids[me], sim.won[me]);
  }

  function makeSim(view, deal, seen, bids, turn) {
    return {
      N: view.N,
      trump: view.trump,
      decks: view.decks,
      hands: deal.map((h) => h.slice()),
      bids,
      won: view.won.slice(),
      trick: view.trick.slice(),
      turn,
      seen: seen.slice(),
    };
  }

  // ------------------------------------------------ hidden-hand inference

  /** Cards not visible to `view.me`: not in own hand, not played, not the trump card. */
  function unknownCards(view) {
    const cnt = new Int8Array(60);
    const seen = publicSeen(view);
    const out = [];
    for (const s of ['S', 'H', 'C', 'D']) {
      for (let r = 2; r <= 14; r++) cnt[key(s, r)] = view.decks - seen[key(s, r)];
    }
    for (const c of view.hand) cnt[key(c.s, c.r)]--;
    for (const s of ['S', 'H', 'C', 'D']) {
      for (let r = 2; r <= 14; r++) {
        for (let k = 0; k < cnt[key(s, r)]; k++) out.push({ id: '?' + s + r + '.' + k, s, r });
      }
    }
    return out;
  }

  /** What each player's plays prove about their hand:
   *  - failed to follow suit => void in it; failed to trump as well => void in trumps
   *  - followed but did not overtake => holds nothing above the winning card in that suit */
  function inferConstraints(view, useCaps) {
    const N = view.N;
    const voids = Array.from({ length: N }, () => ({}));
    const caps = Array.from({ length: N }, () => ({ S: 14, H: 14, C: 14, D: 14 }));
    const trump = view.trump;
    const tricks = view.tricks.map((t) => t.plays).concat(view.trick.length ? [view.trick] : []);
    for (const plays of tricks) {
      const led = plays[0].card.s;
      for (let i = 1; i < plays.length; i++) {
        const { p, card } = plays[i];
        const best = winningPlay(plays.slice(0, i), trump).card;
        const over = beats(card, best, trump);
        if (card.s !== led) {
          voids[p][led] = true;
          if (card.s !== trump) voids[p][trump] = true;
          else if (useCaps && !over && best.s === trump) caps[p][trump] = Math.min(caps[p][trump], best.r);
        } else if (useCaps && !over && best.s === led) {
          caps[p][led] = Math.min(caps[p][led], best.r);
        }
      }
    }
    return { voids, caps };
  }

  /** Randomly deal `unknown` to the other players (needs[q] cards each), the rest
   * to the undealt stock, honouring constraints. Returns hands or null. */
  function sampleDeal(unknown, needs, cons, rng) {
    const N = needs.length;
    const allowed = (q, c) => !cons || (!cons.voids[q][c.s] && c.r <= cons.caps[q][c.s]);
    let stockCap = unknown.length;
    for (const x of needs) stockCap -= x;
    for (let attempt = 0; attempt < 25; attempt++) {
      const cards = shuffle(unknown.slice(), rng);
      if (cons) {
        const elig = new Map();
        for (const c of cards) {
          let e = stockCap > 0 ? 1 : 0;
          for (let q = 0; q < N; q++) if (needs[q] > 0 && allowed(q, c)) e++;
          elig.set(c, e);
        }
        cards.sort((a, b) => elig.get(a) - elig.get(b));
      }
      const rem = needs.slice();
      let stock = stockCap;
      const hands = Array.from({ length: N }, () => []);
      let ok = true;
      for (const c of cards) {
        let total = stock;
        for (let q = 0; q < N; q++) if (rem[q] > 0 && allowed(q, c)) total += rem[q];
        if (total === 0) {
          ok = false;
          break;
        }
        let x = rng() * total;
        if (x < stock) {
          stock--;
          continue;
        }
        x -= stock;
        for (let q = 0; q < N; q++) {
          if (rem[q] > 0 && allowed(q, c)) {
            if (x < rem[q]) {
              hands[q].push(c);
              rem[q]--;
              break;
            }
            x -= rem[q];
          }
        }
      }
      if (ok) return hands;
    }
    return null;
  }

  function dealer(view, useCaps, rng) {
    const unknown = unknownCards(view);
    const needs = view.handCounts.slice();
    needs[view.me] = 0;
    let cons = inferConstraints(view, useCaps);
    return function () {
      let deal = cons && sampleDeal(unknown, needs, cons, rng);
      if (!deal && cons) {
        cons = useCaps ? inferConstraints(view, false) : null;
        deal = cons && sampleDeal(unknown, needs, cons, rng);
      }
      if (!deal) {
        cons = null;
        deal = sampleDeal(unknown, needs, null, rng);
      }
      deal[view.me] = view.hand.slice();
      return deal;
    };
  }

  // --------------------------------------------------------- Monte Carlo

  function mcBid(view, cfg, rng) {
    const n = view.n;
    const fallback = heuristicBid(view.hand, view.trump, view.N, view.decks, view.trumpCard, view.me === view.firstLeader);
    const deal = dealer(view, false, rng);
    const seen = publicSeen(view);
    const totals = new Float64Array(n + 1);
    const t0 = now();
    let samples = 0;
    while (samples < cfg.bidSamples && (samples < 20 || now() - t0 < cfg.ms)) {
      const hands = deal();
      const bids = hands.map((h, q) =>
        q === view.me ? 0 : heuristicBid(h, view.trump, view.N, view.decks, view.trumpCard, q === view.firstLeader)
      );
      for (let b = 0; b <= n; b++) {
        bids[view.me] = b;
        totals[b] += rollout(makeSim(view, hands, seen, bids.slice(), view.firstLeader), view.me);
      }
      samples++;
    }
    let best = fallback;
    for (let b = 0; b <= n; b++) if (totals[b] > totals[best] + 1e-9) best = b;
    return best;
  }

  function mcCard(view, cfg, rng) {
    const legal = legalCards(view.hand, view.trick, view.trump);
    if (legal.length === 1) return legal[0];
    const options = [];
    const seenKeys = new Set();
    for (const c of legal) {
      const k = c.s + c.r;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        options.push(c);
      }
    }
    const seen = publicSeen(view);
    const fallback = heuristicPlay({
      hand: view.hand,
      trick: view.trick,
      trump: view.trump,
      need: view.bids[view.me] - view.won[view.me],
      N: view.N,
      seen,
      decks: view.decks,
    });
    if (options.length === 1) return options[0];
    const deal = dealer(view, cfg.caps, rng);
    const totals = new Float64Array(options.length);
    const t0 = now();
    let samples = 0;
    while (samples < cfg.playSamples && (samples < 20 || now() - t0 < cfg.ms)) {
      const hands = deal();
      for (let i = 0; i < options.length; i++) {
        const sim = makeSim(view, hands, seen, view.bids, view.me);
        simPlay(sim, view.me, sim.hands[view.me].find((c) => c.id === options[i].id));
        totals[i] += rollout(sim, view.me);
      }
      samples++;
    }
    let bi = options.findIndex((c) => c.s === fallback.s && c.r === fallback.r);
    if (bi < 0) bi = 0;
    for (let i = 0; i < options.length; i++) if (totals[i] > totals[bi] + 1e-9) bi = i;
    return options[bi];
  }

  // ------------------------------------------------------------- public API

  function chooseBid(view, level, rng) {
    rng = rng || Math.random;
    const cfg = LEVELS[level] || LEVELS.normal;
    if (cfg.mc) return mcBid(view, cfg, rng);
    let b = heuristicBid(view.hand, view.trump, view.N, view.decks, view.trumpCard, view.me === view.firstLeader);
    if (rng() < cfg.bidNoise) b += rng() < 0.5 ? -1 : 1;
    return Math.max(0, Math.min(view.n, b));
  }

  function chooseCard(view, level, rng) {
    rng = rng || Math.random;
    const cfg = LEVELS[level] || LEVELS.normal;
    if (cfg.mc) return mcCard(view, cfg, rng);
    const legal = legalCards(view.hand, view.trick, view.trump);
    if (rng() < cfg.playNoise) return legal[Math.floor(rng() * legal.length)];
    return heuristicPlay({
      hand: view.hand,
      trick: view.trick,
      trump: view.trump,
      need: view.bids[view.me] - view.won[view.me],
      N: view.N,
      seen: publicSeen(view),
      decks: view.decks,
    });
  }

  Riki.ai = { LEVELS, chooseBid, chooseCard, heuristicBid, heuristicPlay, inferConstraints, sampleDeal, unknownCards };
})(globalThis);
