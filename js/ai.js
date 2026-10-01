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
  const { SUITS, SUIT_INDEX, JOKER, shuffle } = Riki.cards;
  const { TRUMPS, isTrump, group, beats, winningPlay, legalCards, roundScore } = Riki.rules;

  // 1: a beginner's simple habits. 2: the heuristic, guessing one off now and then.
  // 3: the heuristic. 4, 5: Monte Carlo search.
  const LEVELS = {
    1: { novice: true, holdAces: true, kings: true },
    2: { mc: false, bidNoise: 0.4, playNoise: 0 },
    3: { mc: false, bidNoise: 0, playNoise: 0 },
    4: { mc: true, bidSamples: 60, playSamples: 60, ms: 250, caps: false },
    5: { mc: true, bidSamples: 500, playSamples: 500, ms: 900, caps: true },
  };
  /** Level names used before the numbered levels, still found in saved matches. */
  const LEGACY = { easy: 2, normal: 4, hard: 5 };
  const levelOf = (level) => (LEVELS[level] ? Number(level) : LEGACY[level] || 4);

  const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
  const key = (s, r) => SUIT_INDEX[s] * 15 + r;
  const KEYS = key(JOKER, 15) + 1;

  /** Every distinct card in play as [suit, rank], jokers last when there are any. */
  function kinds(jokers) {
    const out = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) out.push([s, r]);
    if (jokers) out.push([JOKER, 15]);
    return out;
  }
  /** How many copies of a card the whole pack holds. g: {decks, jokers} */
  const copies = (s, g) => (s === JOKER ? g.decks * (g.jokers || 0) : g.decks);

  // ---------------------------------------------------------------- helpers

  function strength(c, trump) {
    return (isTrump(c, trump) ? 100 : 0) + c.r;
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

  /** Nothing that beats it within its group can still be out there (trumping a
   * side suit is not counted). g: {trump, decks, jokers, same} */
  function isBoss(card, hand, seen, g) {
    const threats = [];
    if (card.s !== JOKER) for (let r = g.same ? card.r : card.r + 1; r <= 14; r++) threats.push([card.s, r]);
    if (isTrump(card, g.trump) && (card.s !== JOKER || g.same)) threats.push([JOKER, 15]);
    for (const [s, r] of threats) {
      let out = copies(s, g) - seen[key(s, r)];
      for (const h of hand) if (h.s === s && h.r === r) out--;
      if (out > 0) return false;
    }
    return true;
  }

  function publicSeen(view) {
    const seen = new Int8Array(KEYS);
    if (view.trumpCard) seen[key(view.trumpCard.s, view.trumpCard.r)]++;
    for (const t of view.tricks) for (const pl of t.plays) seen[key(pl.card.s, pl.card.r)]++;
    for (const pl of view.trick) seen[key(pl.card.s, pl.card.r)]++;
    return seen;
  }

  // ------------------------------------------------------- heuristic bidding

  /** g: {trump, trumpCard, decks, jokers, same}, e.g. a view. */
  function heuristicBid(hand, g, N, isLeader) {
    const trump = g.trump;
    const n = hand.length;
    const unknown = g.decks * (52 + (g.jokers || 0)) - n - (g.trumpCard ? 1 : 0);
    const frac = Math.min(1, ((N - 1) * n) / unknown);
    const rem = new Int8Array(KEYS);
    const remSuit = { S: 0, H: 0, C: 0, D: 0, X: 0 };
    for (const [s, r] of kinds(g.jokers)) rem[key(s, r)] = copies(s, g);
    for (const c of g.trumpCard ? hand.concat([g.trumpCard]) : hand) rem[key(c.s, c.r)]--;
    for (const [s, r] of kinds(g.jokers)) remSuit[s] += rem[key(s, r)];
    const remTrumps = remSuit.X + (trump ? remSuit[trump] : 0);

    const mySuit = { S: 0, H: 0, C: 0, D: 0 };
    for (const c of hand) if (c.s !== JOKER) mySuit[c.s]++;
    let shortSuits = 0;
    for (const s in mySuit) if (s !== trump && mySuit[s] <= 1) shortSuits++;

    let exp = 0;
    for (const c of hand) {
      // cards that beat it within its group; a tie between identical cards goes either way
      let higher = c.s === JOKER ? remSuit.X * 0.5 : 0;
      if (c.s !== JOKER) for (let r = c.r + 1; r <= 14; r++) higher += rem[key(c.s, r)];
      if (c.s !== JOKER && g.same) higher += rem[key(c.s, c.r)] * 0.5;
      if (c.s !== JOKER && c.s === trump) higher += remSuit.X;
      let p = Math.pow(1 - frac, higher);
      if (!isTrump(c, trump)) {
        const pVoid = Math.pow(1 - remSuit[c.s] / unknown, n);
        const pHasTrump = 1 - Math.pow(1 - remTrumps / unknown, n);
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
   * ctx: {hand, trick, trump, same, need, N, seen, decks, jokers} */
  function heuristicPlay(ctx) {
    const { hand, trick, trump, same, need, N, seen } = ctx;
    const legal = legalCards(hand, trick, trump, same);
    if (legal.length === 1) return legal[0];
    const st = (c) => strength(c, trump);

    if (!trick.length) {
      if (need > 0) {
        const bosses = legal.filter((c) => isBoss(c, hand, seen, ctx));
        const trumpBoss = bosses.filter((c) => isTrump(c, trump));
        if (trumpBoss.length) return maxBy(trumpBoss, st);
        if (bosses.length) return maxBy(bosses, st);
        const nonTrump = legal.filter((c) => !isTrump(c, trump));
        if (nonTrump.length && nonTrump.length < legal.length) {
          // Shorten the shortest side suit so we can ruff it later.
          const count = {};
          for (const c of nonTrump) count[c.s] = (count[c.s] || 0) + 1;
          return minBy(nonTrump, (c) => count[c.s] * 100 + c.r);
        }
        return maxBy(legal, st);
      }
      const nonTrump = legal.filter((c) => !isTrump(c, trump));
      return minBy(nonTrump.length ? nonTrump : legal, (c) => c.r);
    }

    const best = winningPlay(trick, trump, same).card;
    const winners = legal.filter((c) => beats(c, best, trump, same));
    const losers = legal.filter((c) => !beats(c, best, trump, same));
    const last = trick.length === N - 1;
    if (need > 0) {
      if (!winners.length) return minBy(losers, st);
      if (last) return minBy(winners, st);
      const safe = winners.filter((c) => isBoss(c, hand, seen, ctx));
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
      const w = winningPlay(sim.trick, sim.trump, sim.same).p;
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
        same: sim.same,
        need: sim.bids[p] - sim.won[p],
        N: sim.N,
        seen: sim.seen,
        decks: sim.decks,
        jokers: sim.jokers,
      });
      simPlay(sim, p, card);
    }
    return roundScore(sim.bids[me], sim.won[me], sim.scoring);
  }

  function makeSim(view, deal, seen, bids, turn) {
    return {
      N: view.N,
      trump: view.trump,
      same: view.same,
      decks: view.decks,
      jokers: view.jokers,
      scoring: view.scoring,
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
    const cnt = new Int8Array(KEYS);
    const seen = publicSeen(view);
    const out = [];
    for (const [s, r] of kinds(view.jokers)) cnt[key(s, r)] = copies(s, view) - seen[key(s, r)];
    for (const c of view.hand) cnt[key(c.s, c.r)]--;
    for (const [s, r] of kinds(view.jokers)) {
      for (let k = 0; k < cnt[key(s, r)]; k++) out.push({ id: '?' + s + r + '.' + k, s, r });
    }
    return out;
  }

  /** What each player's plays prove about their hand, per group (a suit, or
   * TRUMPS for the trump suit and jokers together):
   *  - failed to follow => void in that group; failed to trump as well => void in trumps
   *  - followed but did not overtake => holds nothing in that group that beats the winning card */
  function inferConstraints(view, useCaps) {
    const N = view.N;
    const voids = Array.from({ length: N }, () => ({}));
    const caps = Array.from({ length: N }, () => ({ S: 15, H: 15, C: 15, D: 15, [TRUMPS]: 15 }));
    const { trump, same } = view;
    const tricks = view.tricks.map((t) => t.plays).concat(view.trick.length ? [view.trick] : []);
    for (const plays of tricks) {
      const led = group(plays[0].card, trump);
      for (let i = 1; i < plays.length; i++) {
        const { p, card } = plays[i];
        const best = winningPlay(plays.slice(0, i), trump, same).card;
        const over = beats(card, best, trump, same);
        const bestGroup = group(best, trump);
        const cap = same ? best.r - 1 : best.r; // a group never mixes two suits, so rank alone decides
        if (group(card, trump) !== led) {
          voids[p][led] = true;
          if (!isTrump(card, trump)) voids[p][TRUMPS] = true;
          else if (useCaps && !over && bestGroup === TRUMPS) caps[p][TRUMPS] = Math.min(caps[p][TRUMPS], cap);
        } else if (useCaps && !over && bestGroup === led) {
          caps[p][led] = Math.min(caps[p][led], cap);
        }
      }
    }
    return { voids, caps, trump };
  }

  /** Randomly deal `unknown` to the other players (needs[q] cards each), the rest
   * to the undealt stock, honouring constraints. Returns hands or null. */
  function sampleDeal(unknown, needs, cons, rng) {
    const N = needs.length;
    const allowed = (q, c) => {
      if (!cons) return true;
      const g = group(c, cons.trump);
      return !cons.voids[q][g] && c.r <= cons.caps[q][g];
    };
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

  function playCtx(view, seen) {
    return {
      hand: view.hand,
      trick: view.trick,
      trump: view.trump,
      same: view.same,
      need: view.bids[view.me] - view.won[view.me],
      N: view.N,
      seen,
      decks: view.decks,
      jokers: view.jokers,
    };
  }

  function mcBid(view, cfg, rng) {
    const n = view.n;
    const fallback = heuristicBid(view.hand, view, view.N, view.me === view.firstLeader);
    const deal = dealer(view, false, rng);
    const seen = publicSeen(view);
    const totals = new Float64Array(n + 1);
    const t0 = now();
    let samples = 0;
    while (samples < cfg.bidSamples && (samples < 20 || now() - t0 < cfg.ms)) {
      const hands = deal();
      const bids = hands.map((h, q) =>
        q === view.me ? 0 : heuristicBid(h, view, view.N, q === view.firstLeader)
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
    const legal = legalCards(view.hand, view.trick, view.trump, view.same);
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
    const fallback = heuristicPlay(playCtx(view, seen));
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

  // ------------------------------------------------------------ novice

  /** Counts sure-looking winners: side aces (and kings with cfg.kings), high trumps, jokers. */
  function noviceBid(view, cfg) {
    const side = cfg.kings ? 13 : 14;
    let b = 0;
    for (const c of view.hand) if (c.s === JOKER || (isTrump(c, view.trump) ? c.r >= 11 : c.r >= side)) b++;
    return Math.min(view.n, b);
  }

  /** A beginner's habits: lead a side ace while nobody is known to be out of that suit,
   * else the lowest side card; otherwise play the lowest legal card, except that
   * once the guess is made, big cards are thrown away when not following suit.
   * cfg.holdAces: never leads an ace while it holds another side card. */
  function noviceCard(view, cfg) {
    const { hand, trick, trump, same } = view;
    const legal = legalCards(hand, trick, trump, same);
    const need = view.bids[view.me] - view.won[view.me];
    const side = legal.filter((c) => !isTrump(c, trump));
    if (!trick.length) {
      if (need > 0 && !cfg.holdAces) {
        const { voids } = inferConstraints(view, false);
        const aces = side.filter((c) => c.r === 14 && !voids.some((v, q) => q !== view.me && v[c.s]));
        if (aces.length) return aces[0];
      }
      return minBy(side.length ? side : legal, (c) => c.r);
    }
    const following = legal.some((c) => group(c, trump) === group(trick[0].card, trump));
    if (!following && need <= 0 && side.length) return maxBy(side, (c) => c.r);
    return minBy(legal, (c) => strength(c, trump));
  }

  // ------------------------------------------------------------- public API

  function chooseBid(view, level, rng) {
    rng = rng || Math.random;
    const cfg = LEVELS[levelOf(level)];
    if (cfg.novice) return noviceBid(view, cfg);
    if (cfg.mc) return mcBid(view, cfg, rng);
    let b = heuristicBid(view.hand, view, view.N, view.me === view.firstLeader);
    if (rng() < cfg.bidNoise) b += rng() < 0.5 ? -1 : 1;
    return Math.max(0, Math.min(view.n, b));
  }

  function chooseCard(view, level, rng) {
    rng = rng || Math.random;
    const cfg = LEVELS[levelOf(level)];
    if (cfg.novice) return noviceCard(view, cfg);
    if (cfg.mc) return mcCard(view, cfg, rng);
    const legal = legalCards(view.hand, view.trick, view.trump, view.same);
    if (rng() < cfg.playNoise) return legal[Math.floor(rng() * legal.length)];
    return heuristicPlay(playCtx(view, publicSeen(view)));
  }

  Riki.ai = { LEVELS, levelOf, chooseBid, chooseCard, heuristicBid, heuristicPlay, inferConstraints, sampleDeal, unknownCards };
})(globalThis);
