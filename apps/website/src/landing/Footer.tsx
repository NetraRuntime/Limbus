const SOCIALS = [
  {
    id: 'github',
    label: 'GitHub',
    icon: 'ri-github-fill',
    href: 'https://github.com/rifkybujana',
  },
  {
    id: 'threads',
    label: 'Threads',
    icon: 'ri-threads-fill',
    href: 'https://www.threads.com/@rifkybujanabisri',
  },
  {
    id: 'x',
    label: 'X',
    icon: 'ri-twitter-x-line',
    href: 'https://x.com/BisriRifky',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: 'ri-linkedin-fill',
    href: 'https://www.linkedin.com/in/rifkybujana/',
  },
] as const;

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-bg" />
      <div className="container footer-inner">
        <div className="footer-top">
          <div className="footer-brand reveal reveal-up" data-delay="0">
            <span className="footer-wordmark">NetraRT</span>
            <p>Local, collaborative data annotation for computer vision.</p>
            <div className="footer-socials">
              {SOCIALS.map((s) => (
                <a
                  key={s.id}
                  href={s.href}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className={s.icon} aria-hidden />
                </a>
              ))}
            </div>
          </div>
          <div className="footer-cols footer-cols-2 reveal reveal-up" data-delay="2">
            <div>
              <h4>Project</h4>
              <a href="#why">Why NetraRT</a>
              <a href="#story">Mission</a>
              <a href="#waitlist">Waitlist</a>
            </div>
            <div>
              <h4>Contact</h4>
              <a href="mailto:hello@netrart.com">hello@netrart.com</a>
              <button type="button" disabled aria-label="Press (coming soon)">
                Press
              </button>
            </div>
          </div>
        </div>
        <div className="footer-bottom reveal reveal-fade" data-delay="3">
          <span>© 2026 NetraRT. Early access.</span>
          <span className="mono-12px">v0.1 · pre-release</span>
        </div>
      </div>
    </footer>
  );
}
