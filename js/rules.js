/* The rules of Rikiki: who wins a trick, which cards are legal, scoring. */
(function (root) {
  'use strict';
  const Riki = (root.Riki = root.Riki || {});
  const { SUIT_NAME, SUIT_SYMBOL, cardName } = Riki.cards;

  /** Does `card` take the lead from the currently winning `best` card?
   * Strictly higher only: with two decks, the first of two identical cards wins. */
  function beats(card, best, trump) {
    if (card.s === best.s) return card.r > best.r;
    return card.s === trump;
  }

  /** trick: [{p, card}] in play order. Returns the winning entry. */
  function winningPlay(trick, trump) {
    let w = trick[0];
    for (let i = 1; i < trick.length; i++) {
      if (beats(trick[i].card, w.card, trump)) w = trick[i];
    }
    return w;
  }

  /** Follow suit; otherwise trump; otherwise anything. Within the forced group
   * you must beat the currently winning card if any of your cards can. */
  function legalCards(hand, trick, trump) {
    if (!trick.length) return hand.slice();
    const led = trick[0].card.s;
    const best = winningPlay(trick, trump).card;
    let pool = hand.filter((c) => c.s === led);
    if (!pool.length) pool = hand.filter((c) => c.s === trump);
    if (!pool.length) return hand.slice();
    const over = pool.filter((c) => beats(c, best, trump));
    return over.length ? over : pool;
  }

  function isLegal(card, hand, trick, trump) {
    return legalCards(hand, trick, trump).some((c) => c.id === card.id);
  }

  /** Human-readable reason a card can't be played, or null if it can. */
  function whyIllegal(card, hand, trick, trump) {
    if (isLegal(card, hand, trick, trump)) return null;
    const led = trick[0].card.s;
    const best = winningPlay(trick, trump).card;
    if (hand.some((c) => c.s === led)) {
      if (card.s !== led) return `Follow suit: you have ${SUIT_NAME[led]} ${SUIT_SYMBOL[led]}.`;
      return `You must beat the ${cardName(best)}: you have a higher ${SUIT_NAME[led]} card.`;
    }
    if (card.s !== trump) return `You have no ${SUIT_NAME[led]}, so you must trump ${SUIT_SYMBOL[trump]}.`;
    return `You must beat the ${cardName(best)} with a higher trump.`;
  }

  /**
   * classic: exact = 10 + 2 per trick; missed = -2 per trick of difference.
   * twenty:  made it = 20 per guessed trick, -2 per extra trick; short = -2 per
   *          missing trick. A zero guess is worth 10, -2 per trick taken.
   */
  function roundScore(bid, won, scoring) {
    if (scoring === 'twenty') {
      if (bid === 0) return 10 - 2 * won;
      return won >= bid ? 20 * bid - 2 * (won - bid) : -2 * (bid - won);
    }
    return bid === won ? 10 + 2 * won : -2 * Math.abs(bid - won);
  }

  /** Did the guess count as made? Classic needs it exact; with 20 per trick,
   * extra tricks only cost a little, so reaching the guess is enough. */
  function made(bid, won, scoring) {
    return scoring === 'twenty' ? won >= bid : won === bid;
  }

  /** One card is always left over to turn up as trump. */
  function maxHandSize(players, decks) {
    return Math.floor((decks * 52 - 1) / players);
  }

  function buildSchedule(maxCards, shape) {
    const up = [];
    for (let i = 1; i <= maxCards; i++) up.push(i);
    if (shape === 'up') return up;
    if (shape === 'down') return up.slice().reverse();
    return up.concat(up.slice(0, -1).reverse());
  }

  Riki.rules = { beats, winningPlay, legalCards, isLegal, whyIllegal, roundScore, made, maxHandSize, buildSchedule };
})(globalThis);
