/* Cards, decks and randomness. Plain script: attaches to globalThis.Riki so it
 * works from file:// in the browser and via require() in Node tests. */
(function (root) {
  'use strict';
  const Riki = (root.Riki = root.Riki || {});

  // Black/red alternating base order.
  const SUITS = ['S', 'H', 'C', 'D'];
  // Jokers have no suit: they get the pseudo-suit X and rank 15, above the aces.
  const JOKER = 'X';
  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs', X: 'Jokers' };
  const SUIT_INDEX = { S: 0, H: 1, C: 2, D: 3, X: 4 };
  const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '★' };

  function rankLabel(r) {
    return RANK_LABEL[r] || String(r);
  }

  function isRed(s) {
    return s === 'H' || s === 'D';
  }

  const isJoker = (c) => c.s === JOKER;

  function cardName(c) {
    return isJoker(c) ? 'Joker' : rankLabel(c.r) + SUIT_SYMBOL[c.s];
  }

  /** Cards are plain JSON-friendly objects: {id, s, r}. Duplicates across decks
   * share s and r but have distinct ids. */
  function makeDeck(decks, jokers) {
    const cards = [];
    for (let d = 0; d < decks; d++) {
      for (const s of SUITS) {
        for (let r = 2; r <= 14; r++) cards.push({ id: s + r + '.' + d, s, r });
      }
      for (let j = 0; j < (jokers || 0); j++) cards.push({ id: JOKER + 15 + '.' + d + '.' + j, s: JOKER, r: 15 });
    }
    return cards;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Suit display order for a hand: non-trump suits alternating colours, trump last, then jokers. */
  function suitOrder(trump) {
    const others = SUITS.filter((s) => s !== trump);
    const red = others.filter(isRed);
    const black = others.filter((s) => !isRed(s));
    const pair = red.length === 2 ? red : black;
    const odd = red.length === 2 ? black : red;
    const order = trump ? [pair[0], odd[0], pair[1]] : others;
    if (trump) order.push(trump);
    order.push(JOKER);
    return order;
  }

  function sortHand(hand, trump) {
    const order = suitOrder(trump);
    return hand.slice().sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s) || a.r - b.r || (a.id < b.id ? -1 : 1));
  }

  Riki.cards = {
    SUITS,
    JOKER,
    SUIT_SYMBOL,
    SUIT_NAME,
    SUIT_INDEX,
    rankLabel,
    isRed,
    isJoker,
    cardName,
    makeDeck,
    mulberry32,
    shuffle,
    suitOrder,
    sortHand,
  };
})(globalThis);
