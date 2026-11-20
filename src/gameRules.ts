export const MAX_COINS_PER_PLATFORM = 4;
export const POINTS_PER_COIN = 25;

export function calculateScore(altitudeMeters: number, runCoins: number): number {
  const safeAltitude = Number.isFinite(altitudeMeters) ? Math.max(0, Math.floor(altitudeMeters)) : 0;
  const safeCoins = Number.isFinite(runCoins) ? Math.max(0, Math.floor(runCoins)) : 0;
  return safeAltitude + safeCoins * POINTS_PER_COIN;
}

export function randomCoinTrailCount(random: () => number = Math.random): number {
  const sample = random();
  const boundedSample = Number.isFinite(sample) ? Math.min(1 - Number.EPSILON, Math.max(0, sample)) : 0.5;
  return 1 + Math.floor(boundedSample * MAX_COINS_PER_PLATFORM);
}

export type HazardLanding = {
  wasFalling: boolean;
  previousBottom: number;
  currentBottom: number;
  hazardTop: number;
  playerLeft: number;
  playerRight: number;
  hazardLeft: number;
  hazardRight: number;
};

export function isLandingOnHazard({
  wasFalling,
  previousBottom,
  currentBottom,
  hazardTop,
  playerLeft,
  playerRight,
  hazardLeft,
  hazardRight,
}: HazardLanding): boolean {
  return wasFalling && previousBottom <= hazardTop && currentBottom >= hazardTop &&
    playerRight > hazardLeft && playerLeft < hazardRight;
}
