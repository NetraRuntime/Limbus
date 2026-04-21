import { useEffect, useRef, useState } from 'react';

type Props = {
  /** Final value to count up to. */
  to: number;
  /** Starting value (default 0). */
  from?: number;
  /** Animation duration in ms. */
  durationMs?: number;
  /** Decimal places to render (0 = integer, 1 = 1 decimal, etc). */
  decimals?: number;
  /** Prepend — e.g. "$" or "~". */
  prefix?: string;
  /** Append — e.g. "%", "+", " users". */
  suffix?: string;
  /** Use locale thousands grouping (e.g. "1,234"). Only applies to integers. */
  group?: boolean;
  /** IntersectionObserver threshold to trigger (0..1). */
  threshold?: number;
  /** Delay in ms after visibility before starting the count. */
  startDelayMs?: number;
  className?: string;
};

// Render a number that eases from `from` to `to` the first time the element
// enters the viewport. rAF-driven, reduced-motion aware, keeps the digits on
// tabular rails so the surrounding layout doesn't jiggle.
export function CountUp({
  to,
  from = 0,
  durationMs = 1400,
  decimals = 0,
  prefix = '',
  suffix = '',
  group = true,
  threshold = 0.3,
  startDelayMs = 0,
  className,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(from);
  const doneRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = ref.current;
    if (!el || doneRef.current) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const animate = () => {
      doneRef.current = true;
      if (prefersReduced) {
        setValue(to);
        return;
      }
      const startedAt = performance.now() + startDelayMs;
      const delta = to - from;
      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
        if (t <= 0) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
        setValue(from + delta * e);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
        else rafRef.current = null;
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            animate();
            return;
          }
        }
      },
      { threshold },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [to, from, durationMs, startDelayMs, threshold]);

  const formatted =
    decimals > 0
      ? value.toFixed(decimals)
      : group
        ? Math.round(value).toLocaleString('en-US')
        : Math.round(value).toString();

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
