/* The rules of Rikiki: who wins a trick, which cards are legal, scoring.
 *
 * Jokers are the highest trumps. The trump group is the trump suit plus the
 * jokers; in a round without a trump suit it is the jokers alone. `trump` is
 * null in such rounds. `same` is the "same card beats" variant. */
(function (root) {
  'use strict';
  const Riki = (root.Riki = root.Riki || {});
  const { SUIT_NAME, SUIT_SYMBOL, JOKER, cardName } = Riki.cards;

  const TRUMPS = 'T';

  function isTrump(card, trump) {
    return card.s === JOKER || (!!trump && card.s === trump);
  }

  /** The suit a card follows: its own, or TRUMPS for trumps and jokers. */
  function group(card, trump) {
    return isTrump(card, trump) ? TRUMPS : card.s;
  }

  /** Does `card` take the lead from the currently winning `best` card?
   * Strictly higher only: with two decks, the first of two identical cards wins,
   * unless `same` (same card beats) is on, when the later one wins. */
  function beats(card, best, trump, same) {
    if (group(card, trump) === group(best, trump)) return card.r > best.r || (!!same && card.r === best.r && card.s === best.s);
    return isTrump(card, trump);
  }

  /** trick: [{p, card}] in play order. Returns the winning entry. */
  function winningPlay(trick, trump, same) {
    let w = trick[0];
    for (let i = 1; i < trick.length; i++) {
      if (beats(trick[i].card, w.card, trump, same)) w = trick[i];
    }
    return w;
  }

  /** Follow suit; otherwise trump; otherwise anything. Within the forced group
   * you must beat the currently winning card if any of your cards can. */
  function legalCards(hand, trick, trump, same) {
    if (!trick.length) return hand.slice();
    const led = group(trick[0].card, trump);
    const best = winningPlay(trick, trump, same).card;
    let pool = hand.filter((c) => group(c, trump) === led);
    if (!pool.length) pool = hand.filter((c) => isTrump(c, trump));
    if (!pool.length) return hand.slice();
    const over = pool.filter((c) => beats(c, best, trump, same));
    return over.length ? over : pool;
  }

  function isLegal(card, hand, trick, trump, same) {
    return legalCards(hand, trick, trump, same).some((c) => c.id === card.id);
  }

  /** "a trump ♠", or "a joker" when jokers are the only trumps. */
  const aTrump = (trump) => (trump ? `a trump ${SUIT_SYMBOL[trump]}` : 'a joker');

  /** Human-readable reason a card can't be played, or null if it can. */
  function whyIllegal(card, hand, trick, trump, same) {
    if (isLegal(card, hand, trick, trump, same)) return null;
    const led = group(trick[0].card, trump);
    const best = winningPlay(trick, trump, same).card;
    if (hand.some((c) => group(c, trump) === led)) {
      if (led === TRUMPS) {
        if (!isTrump(card, trump)) return `Trumps were led: you must play ${aTrump(trump)}.`;
        return `You must beat the ${cardName(best)}: one of your trumps can.`;
      }
      if (card.s !== led) return `Follow suit: you have ${SUIT_NAME[led]} ${SUIT_SYMBOL[led]}.`;
      return `You must beat the ${cardName(best)}: you have a ${SUIT_NAME[led]} card that does.`;
    }
    if (!isTrump(card, trump)) return `You have no ${SUIT_NAME[led]}, so you must play ${aTrump(trump)}.`;
    return `You must beat the ${cardName(best)}: one of your trumps can.`;
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

  /** One card is left over to turn up as trump, unless there is never a trump. */
  function maxHandSize(players, decks, jokers, trumpMode) {
    return Math.floor((decks * (52 + (jokers || 0)) - (trumpMode === 'never' ? 0 : 1)) / players);
  }

  /** Chance that a round has no trump suit. 'sometimes': a turned-up joker
   * means no trump; without jokers, one round in five. */
  const NO_TRUMP_CHANCE = 0.2;
  function noTrumpChance(trumpMode, jokers) {
    if (trumpMode === 'never') return 1;
    if (trumpMode !== 'sometimes') return 0;
    return jokers ? jokers / (52 + jokers) : NO_TRUMP_CHANCE;
  }

  function buildSchedule(maxCards, shape) {
    const up = [];
    for (let i = 1; i <= maxCards; i++) up.push(i);
    if (shape === 'up') return up;
    if (shape === 'down') return up.slice().reverse();
    return up.concat(up.slice(0, -1).reverse());
  }

  Riki.rules = {
    TRUMPS,
    NO_TRUMP_CHANCE,
    isTrump,
    group,
    beats,
    winningPlay,
    legalCards,
    isLegal,
    whyIllegal,
    roundScore,
    made,
    maxHandSize,
    noTrumpChance,
    buildSchedule,
  };
})(globalThis);
