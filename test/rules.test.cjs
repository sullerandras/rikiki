const test = require('node:test');
const assert = require('node:assert/strict');
const { rules } = require('./load.cjs');

// 'H10' -> {id:'H10.0', s:'H', r:10}; ranks J=11 Q=12 K=13 A=14
const c = (str, d = 0) => ({ id: str + '.' + d, s: str[0], r: Number(str.slice(1)) });
const J = (d = 0) => c('X15', d); // a joker
const ids = (cards) => cards.map((x) => x.id).sort();
const trick = (...cards) => cards.map((card, p) => ({ p, card }));

test('scoring: exact = 10 + 2 per trick, miss = -2 per trick off', () => {
  assert.equal(rules.roundScore(3, 3), 16);
  assert.equal(rules.roundScore(0, 0), 10);
  assert.equal(rules.roundScore(3, 1), -4);
  assert.equal(rules.roundScore(3, 5), -4);
  assert.equal(rules.roundScore(0, 2), -4);
});

test('a guess is made when exact in classic, when reached with 20 per trick', () => {
  assert.equal(rules.made(2, 2, 'classic'), true);
  assert.equal(rules.made(2, 3, 'classic'), false);
  assert.equal(rules.made(2, 3, 'twenty'), true);
  assert.equal(rules.made(0, 1, 'twenty'), true);
  assert.equal(rules.made(3, 2, 'twenty'), false);
});

test('trump beats other suits; higher of led suit wins; off-suit never wins', () => {
  assert.equal(rules.winningPlay(trick(c('H5'), c('H9'), c('S14')), 'C').p, 1);
  assert.equal(rules.winningPlay(trick(c('H5'), c('C2'), c('H14')), 'C').p, 1);
  assert.equal(rules.winningPlay(trick(c('H5'), c('C2'), c('C3')), 'C').p, 2);
});

test('with two decks the first of two identical cards wins', () => {
  assert.equal(rules.winningPlay(trick(c('H14', 0), c('H14', 1)), 'S').p, 0);
});

test('leader may play anything, including trump', () => {
  const hand = [c('H2'), c('S14'), c('C9')];
  assert.deepEqual(ids(rules.legalCards(hand, [], 'S')), ids(hand));
});

test('must follow suit and overtake when possible', () => {
  const hand = [c('H3'), c('H12'), c('H14'), c('S2')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10')), 'S')), ids([c('H12'), c('H14')]));
});

test('must follow suit with a lower card if unable to overtake', () => {
  const hand = [c('H3'), c('H5'), c('S2')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10')), 'S')), ids([c('H3'), c('H5')]));
});

test('following suit after the trick was trumped: any card of the led suit', () => {
  const hand = [c('H3'), c('H14'), c('S13')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10'), c('S2')), 'S')), ids([c('H3'), c('H14')]));
});

test('void in led suit: must trump', () => {
  const hand = [c('S3'), c('S9'), c('D14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10')), 'S')), ids([c('S3'), c('S9')]));
});

test('void in led suit, trick already trumped: must over-trump if possible', () => {
  const hand = [c('S3'), c('S9'), c('D14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10'), c('S5')), 'S')), ids([c('S9')]));
});

test('void in led suit, only lower trumps: still must play a trump', () => {
  const hand = [c('S3'), c('S4'), c('D14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10'), c('S12')), 'S')), ids([c('S3'), c('S4')]));
});

test('void in led suit and trumps: free to discard anything', () => {
  const hand = [c('C3'), c('D14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10'), c('S12')), 'S')), ids(hand));
});

test('trump led: must follow with a higher trump if possible', () => {
  const hand = [c('S3'), c('S13'), c('H14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('S10')), 'S')), ids([c('S13')]));
});

test('overtaking a duplicate needs a strictly higher card', () => {
  const hand = [c('H14', 1), c('H2')];
  // Our ace cannot beat the ace already down, so either heart is fine.
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H14', 0)), 'S')), ids(hand));
});

test('illegal explanations', () => {
  const hand = [c('H3'), c('H12'), c('S2')];
  assert.match(rules.whyIllegal(c('S2'), hand, trick(c('H10')), 'C'), /Follow suit/);
  assert.match(rules.whyIllegal(c('H3'), hand, trick(c('H10')), 'C'), /beat the 10♥/);
  assert.equal(rules.whyIllegal(c('H12'), hand, trick(c('H10')), 'C'), null);
});

test('schedule shapes', () => {
  assert.deepEqual(rules.buildSchedule(3, 'pyramid'), [1, 2, 3, 2, 1]);
  assert.deepEqual(rules.buildSchedule(3, 'up'), [1, 2, 3]);
  assert.deepEqual(rules.buildSchedule(3, 'down'), [3, 2, 1]);
  assert.equal(rules.maxHandSize(3, 2), 34);
  assert.equal(rules.maxHandSize(4, 1), 12);
});

test('"20 per trick" scoring', () => {
  const s = (b, w) => rules.roundScore(b, w, 'twenty');
  assert.equal(s(2, 5), 34); // 2 * 20 - 2 * 3
  assert.equal(s(5, 2), -6); // short: -2 per missing trick
  assert.equal(s(3, 3), 60);
  assert.equal(s(0, 0), 10);
  assert.equal(s(0, 2), 6); // zero guess: 10 - 2 per trick
});

test('same card beats: a later identical card takes the trick', () => {
  assert.equal(rules.winningPlay(trick(c('H14', 0), c('H14', 1)), 'S', true).p, 1);
  assert.equal(rules.winningPlay(trick(c('H14', 0), c('H14', 1), c('H13')), 'S', true).p, 1);
  // ...and counts as beating, so it must be played when it is the only way to win
  const hand = [c('H14', 1), c('H2')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H14', 0)), 'S', true)), ids([c('H14', 1)]));
  // but only the same card: a same-rank card of another suit is no match
  assert.equal(rules.winningPlay(trick(c('H14'), c('D14')), 'S', true).p, 0);
});

test('jokers beat the trump ace; between jokers the first wins, or the last with same card beats', () => {
  assert.equal(rules.winningPlay(trick(c('H5'), c('S14'), J()), 'S').p, 2);
  assert.equal(rules.winningPlay(trick(J(0), J(1)), 'S').p, 0);
  assert.equal(rules.winningPlay(trick(J(0), J(1)), 'S', true).p, 1);
  assert.ok(rules.isTrump(J(), 'S') && rules.isTrump(J(), null));
});

test('a joker is a trump: it cannot be played while you can follow suit', () => {
  const hand = [c('H5'), J()];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10')), 'S')), ids([c('H5')]));
  assert.match(rules.whyIllegal(J(), hand, trick(c('H10')), 'S'), /Follow suit/);
});

test('void in the led suit, trick trumped with the ace: the joker must over-trump', () => {
  const hand = [c('S3'), J(), c('D9')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10'), c('S14')), 'S')), ids([J()]));
});

test('a led joker asks for trumps', () => {
  const hand = [c('S3'), c('H14')];
  assert.deepEqual(ids(rules.legalCards(hand, trick(J()), 'S')), ids([c('S3')]));
  assert.match(rules.whyIllegal(c('H14'), hand, trick(J()), 'S'), /Trumps were led/);
  // no trumps in hand: anything goes
  assert.deepEqual(ids(rules.legalCards([c('H3'), c('D4')], trick(J()), 'S')), ids([c('H3'), c('D4')]));
});

test('no trump suit: only the led suit wins, and jokers are the only trumps', () => {
  assert.equal(rules.winningPlay(trick(c('H5'), c('S14'), c('H6')), null).p, 2);
  assert.equal(rules.winningPlay(trick(c('H5'), J(), c('H6')), null).p, 1);
  assert.deepEqual(ids(rules.legalCards([c('S3'), c('D4')], trick(c('H10')), null)), ids([c('S3'), c('D4')]));
  const hand = [c('S3'), J()];
  assert.deepEqual(ids(rules.legalCards(hand, trick(c('H10')), null)), ids([J()]));
  assert.match(rules.whyIllegal(c('S3'), hand, trick(c('H10')), null), /must play a joker/);
});

test('hand sizes and no-trump chances', () => {
  assert.equal(rules.maxHandSize(4, 1, 2, 'always'), 13); // 54 - 1 turned up
  assert.equal(rules.maxHandSize(3, 1, 0, 'never'), 17); // nothing turned up
  assert.equal(rules.noTrumpChance('always', 2), 0);
  assert.equal(rules.noTrumpChance('never', 0), 1);
  assert.equal(rules.noTrumpChance('sometimes', 0), 0.2);
  assert.equal(rules.noTrumpChance('sometimes', 2), 2 / 54);
});
