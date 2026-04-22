import { useEffect } from 'react';

type Options = {
  
  selector?: string;
  
  visibleClass?: string;
  
  threshold?: number;
  
  rootMargin?: string;
  
  once?: boolean;
};


export function useRevealOnScroll(
  {
    selector = '.reveal',
    visibleClass = 'is-visible',
    threshold = 0.15,
    rootMargin = '0px 0px -8% 0px',
    once = true,
  }: Options = {},
  deps: readonly unknown[] = [],
) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Honor reduced-motion: flip everything visible immediately, no observer.
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (!els.length) return;
    if (prefersReduced) {
      els.forEach((el) => el.classList.add(visibleClass));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(visibleClass);
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove(visibleClass);
          }
        }
      },
      { threshold, rootMargin },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, visibleClass, threshold, rootMargin, once, ...deps]);
}
