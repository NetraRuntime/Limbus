export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-bg" />
      <div className="container footer-inner">
        <div className="footer-top">
          <div className="footer-brand reveal reveal-up" data-delay="0">
            <span className="footer-wordmark">NetraRT</span>
            <p>Vision AI, as easy as text. On any device.</p>
            <div className="footer-socials">
              <a href="#" aria-label="GitHub">
                <i className="ri-github-fill" />
              </a>
              <a href="#" aria-label="X">
                <i className="ri-twitter-x-line" />
              </a>
              <a href="#" aria-label="LinkedIn">
                <i className="ri-linkedin-fill" />
              </a>
            </div>
          </div>
          <div className="footer-cols footer-cols-2 reveal reveal-up" data-delay="2">
            <div>
              <h4>Project</h4>
              <a href="#why">Why NetraRT</a>
              <a href="#waitlist">Waitlist</a>
            </div>
            <div>
              <h4>Contact</h4>
              <a href="mailto:hello@netra.dev">hello@netra.dev</a>
              <a href="#">Press</a>
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
