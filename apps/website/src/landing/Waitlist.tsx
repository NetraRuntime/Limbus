import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CountUp } from '../components/CountUp';

const TOTAL_SPOTS = 500;
const CLAIMED = 312;
const FILL_PCT = (CLAIMED / TOTAL_SPOTS) * 100;

export function Waitlist() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // Progress bar animates its width off a dedicated IO so it starts at the
  // same time as the CountUp numbers. CSS transition (see kit.css) handles
  // the ease — we just toggle the final width as a CSS custom property.
  const progressRef = useRef<HTMLDivElement>(null);
  const [progressActive, setProgressActive] = useState(false);

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setProgressActive(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setProgressActive(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSent(true);
  };

  return (
    <section className="section section-waitlist" id="waitlist">
      <div className="container">
        <div className="wl-grid">
          {/* LEFT — headline + form */}
          <div className="wl-main reveal reveal-left" data-delay="0">
            <div className="wl-eyebrow">
              <span className="wl-dot" aria-hidden="true" />
              <span className="mono">EARLY ACCESS · 2026</span>
            </div>

            <h2 className="wl-title">
              The first <CountUp to={TOTAL_SPOTS} durationMs={1600} /> builders
              <br />
              get <span className="accent underline-brush">NetraRT</span> before anyone else.
            </h2>

            <p className="wl-sub">
              We're opening the SDK and CLI to a small cohort of edge-AI developers. Drop your
              email — we'll send an invite when your slot is ready.
            </p>

            {!sent ? (
              <form className="wl-form" onSubmit={submit}>
                <div className="wl-field">
                  <i className="ri-mail-line wl-field-icon" aria-hidden="true" />
                  <input
                    type="email"
                    className="wl-input"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-lg wl-submit">
                  Request invite
                  <i className="ri-arrow-right-line" />
                </button>
              </form>
            ) : (
              <div className="wl-thanks">
                <i className="ri-checkbox-circle-fill" />
                <div>
                  <div className="wl-thanks-title">You're on the list.</div>
                  <div className="wl-thanks-sub mono-12px">
                    We'll be in touch when your slot opens up.
                  </div>
                </div>
              </div>
            )}

            <div className="wl-fineprint mono-12px">
              One email. No marketing. Unsubscribe with one click.
            </div>
          </div>

          {/* RIGHT — editorial index */}
          <aside className="wl-index reveal reveal-right" data-delay="2">
            <dl className="wl-dl">
              <div className="wl-row">
                <dt className="mono">01 · What</dt>
                <dd>NetraRT SDK, CLI, and local runtime for on-device vision AI.</dd>
              </div>
              <div className="wl-row">
                <dt className="mono">02 · Who</dt>
                <dd>Edge and embedded engineers shipping vision on real hardware.</dd>
              </div>
              <div className="wl-row">
                <dt className="mono">03 · When</dt>
                <dd>Rolling invites through Q3 2026. Public release to follow.</dd>
              </div>
              <div className="wl-row">
                <dt className="mono">04 · Price</dt>
                <dd>Free for the cohort. Open-source core, forever.</dd>
              </div>
            </dl>

            <div className="wl-index-foot">
              <span className="mono-12px wl-spots">
                <CountUp className="wl-spots-num" to={CLAIMED} durationMs={1600} />
                <span className="wl-spots-label">/ {TOTAL_SPOTS} SPOTS CLAIMED</span>
              </span>
              <div
                ref={progressRef}
                className={`wl-progress ${progressActive ? 'is-active' : ''}`}
                aria-hidden="true"
              >
                <div
                  className="wl-progress-fill"
                  style={{ ['--fill-width' as string]: `${FILL_PCT}%` }}
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
