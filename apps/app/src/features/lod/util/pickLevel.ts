import { UPGRADE_HYSTERESIS, type PickedLevel } from '../types';

/** Pick smallest mip level that renders crisply; upgrades require crossing UPGRADE_HYSTERESIS to avoid A/B flicker. */
export function pickLevel(
  levels: readonly number[],
  onScreenPx: number,
  dpr: number,
  current?: PickedLevel,
): PickedLevel {
  const target = onScreenPx * dpr;
  const candidate: PickedLevel = levels.find((l) => l >= target) ?? 'full';
  if (current === undefined || candidate === current) return candidate;
  const currentPx = current === 'full' ? Infinity : current;
  const candidatePx = candidate === 'full' ? Infinity : candidate;
  const isUpgrade = candidatePx > currentPx;
  if (isUpgrade && target < currentPx * UPGRADE_HYSTERESIS) return current;
  return candidate;
}
