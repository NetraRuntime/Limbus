import { useEffect, useRef, useState } from 'react';

type Props = {
  
  to: number;
  
  from?: number;
  
  durationMs?: number;
  
  decimals?: number;
  
  prefix?: string;
  
  suffix?: string;
  
  group?: boolean;

  threshold?: number;

  startDelayMs?: number;
  padTo?: number;
  className?: string;
};

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
  padTo = 0,
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

  const rounded = Math.round(value);
  const formatted =
    decimals > 0
      ? value.toFixed(decimals)
      : padTo > 0
        ? rounded.toString().padStart(padTo, '0')
        : group
          ? rounded.toLocaleString('en-US')
          : rounded.toString();

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
