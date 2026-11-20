import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, isLandingOnHazard, randomCoinTrailCount } from '../dist/gameRules.js';

test('score adds one point per meter and 25 points per coin', () => {
  assert.equal(calculateScore(184, 0), 184);
  assert.equal(calculateScore(184, 3), 259);
});

test('score clamps invalid and negative progress to zero', () => {
  assert.equal(calculateScore(-10, -2), 0);
  assert.equal(calculateScore(Number.NaN, 2), 50);
  assert.equal(calculateScore(12, Number.POSITIVE_INFINITY), 12);
});

test('random coin trail count stays between one and the previous maximum of four', () => {
  assert.equal(randomCoinTrailCount(() => 0), 1);
  assert.equal(randomCoinTrailCount(() => 0.25), 2);
  assert.equal(randomCoinTrailCount(() => 0.5), 3);
  assert.equal(randomCoinTrailCount(() => 0.75), 4);
  assert.equal(randomCoinTrailCount(() => 1), 4);
  assert.equal(randomCoinTrailCount(() => -1), 1);
});

const landing = {
  wasFalling: true,
  previousBottom: 40,
  currentBottom: 60,
  hazardTop: 50,
  playerLeft: 30,
  playerRight: 50,
  hazardLeft: 45,
  hazardRight: 65,
};

test('a descending player crossing the spike top while overlapping it lands on the hazard', () => {
  assert.equal(isLandingOnHazard(landing), true);
});

test('side, underside, upward, and non-overlapping contacts are not spike landings', () => {
  assert.equal(isLandingOnHazard({ ...landing, previousBottom: 51 }), false);
  assert.equal(isLandingOnHazard({ ...landing, wasFalling: false }), false);
  assert.equal(isLandingOnHazard({ ...landing, playerRight: 44 }), false);
  assert.equal(isLandingOnHazard({ ...landing, currentBottom: 49 }), false);
});
