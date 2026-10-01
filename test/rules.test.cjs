const test = require('node:test');
const assert = require('node:assert/strict');
const { rules } = require('./load.cjs');

// 'H10' -> {id:'H10.0', s:'H', r:10}; ranks J=11 Q=12 K=13 A=14
const c = (str, d = 0) => ({ id: str + '.' + d, s: str[0], r: Number(str.slice(1)) });
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
