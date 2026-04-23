import { UPGRADE_HYSTERESIS, type PickedLevel } from '../types';

/** Choose the smallest cached mip level that still renders crisply at the
 *  requested on-screen size. `current` (optional) suppresses rapid A/B
 *  swaps: an upgrade (to a larger level or to 'full') only fires once
 *  the target crosses `current × UPGRADE_HYSTERESIS`. Downgrades apply
 *  immediately.
 */
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
