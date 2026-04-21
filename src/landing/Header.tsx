import { useCallback, useEffect, useState } from 'react';
import { Link } from '../router';

export function Header() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on navigation (back/forward, hash scroll).
  useEffect(() => {
    window.addEventListener('popstate', close);
    window.addEventListener('hashchange', close);
    return () => {
      window.removeEventListener('popstate', close);
      window.removeEventListener('hashchange', close);
    };
  }, [close]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Lock body scroll while the menu is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className={`site-header ${open ? 'menu-open' : ''}`}>
      <div className="container header-inner">
        <Link to="/" className="brand" onClick={close}>
          <span className="brand-wordmark">NetraRT</span>
          <span className="brand-divider" />
          <span className="brand-tag">The vision layer for every device</span>
        </Link>

        <nav className="primary-nav">
          <a className="nav-item" href="#why">
            Why NetraRT
          </a>
          <a className="nav-item" href="#waitlist">
            Waitlist
          </a>
          <Link className="nav-item" to="/app">
            Canvas
          </Link>
        </nav>

        <div className="header-actions">
          <a
            className="btn btn-outline btn-sm"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
          >
            <i className="ri-github-fill" /> GitHub
          </a>
          <Link className="btn btn-primary btn-sm" to="/app">
            Open canvas
          </Link>
        </div>

        <button
          type="button"
          className="menu-toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          <i className={open ? 'ri-close-line' : 'ri-menu-line'} />
        </button>
      </div>

      {/* Slide-down panel, only rendered visible on narrow viewports via CSS. */}
      <div
        id="mobile-menu"
        className={`menu-panel ${open ? 'is-open' : ''}`}
        onClick={close}
        aria-hidden={!open}
      >
        <div className="menu-inner" onClick={(e) => e.stopPropagation()}>
          <a className="menu-link" href="#why" onClick={close}>
            Why NetraRT
          </a>
          <a className="menu-link" href="#waitlist" onClick={close}>
            Waitlist
          </a>
          <Link className="menu-link" to="/app" onClick={close}>
            Canvas
          </Link>
          <div className="menu-divider" aria-hidden />
          <a
            className="btn btn-outline btn-md"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            onClick={close}
          >
            <i className="ri-github-fill" /> GitHub
          </a>
          <Link className="btn btn-primary btn-md" to="/app" onClick={close}>
            Open canvas
          </Link>
        </div>
      </div>
    </header>
  );
}
