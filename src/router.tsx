import { useEffect, useState, useCallback } from 'react';

// Minimal path-based router — no dependency, just the History API. Two
// routes today (/ and /app); extend the Route union when more are added.
export type Route = '/' | '/app';

const normalize = (path: string): Route => (path === '/app' ? '/app' : '/');

export const useRoute = (): { route: Route; navigate: (to: Route) => void } => {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? '/' : normalize(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setRoute(normalize(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: Route) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, '', to);
    setRoute(to);
  }, []);

  return { route, navigate };
};

// Drop-in anchor that navigates via pushState and falls back to a real
// link for cmd-click / middle-click.
export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: Route;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        // Let the browser handle modified clicks (new tab, etc).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        window.history.pushState(null, '', to);
        // Re-emit so subscribers update.
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
