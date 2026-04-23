import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { CountUp } from '../components/CountUp';

const TOTAL_SPOTS = 500;
const CLAIMED = 0;
const FILL_PCT = (CLAIMED / TOTAL_SPOTS) * 100;

const EmailSchema = z.string().trim().email();

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export function Waitlist() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const emailId = useId();
  const errorId = useId();

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
    if (status.kind === 'submitting') return;
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setStatus({ kind: 'error', message: 'Please enter a valid email address.' });
      return;
    }
    setStatus({ kind: 'submitting' });
    setStatus({ kind: 'success' });
  };

  const fillStyle = { '--fill-width': `${FILL_PCT}%` } as React.CSSProperties;
  const isError = status.kind === 'error';

  return (
    <section className="section section-waitlist" id="waitlist">
      <div className="container">
        <div className="wl-grid">
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

            {status.kind !== 'success' ? (
              <form className="wl-form" onSubmit={submit} noValidate>
                <div className="wl-field">
                  <label htmlFor={emailId} className="visually-hidden">
                    Email address
                  </label>
                  <i className="ri-mail-line wl-field-icon" aria-hidden="true" />
                  <input
                    id={emailId}
                    type="email"
                    className="wl-input"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status.kind === 'error') setStatus({ kind: 'idle' });
                    }}
                    aria-invalid={isError || undefined}
                    aria-describedby={isError ? errorId : undefined}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg wl-submit"
                  disabled={status.kind === 'submitting'}
                >
                  {status.kind === 'submitting' ? 'Sending…' : 'Request invite'}
                  <i className="ri-arrow-right-line" />
                </button>
                {isError && (
                  <div id={errorId} role="alert" className="wl-error">
                    {status.message}
                  </div>
                )}
              </form>
            ) : (
              <div className="wl-thanks" role="status">
                <i className="ri-checkbox-circle-fill" aria-hidden />
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
                <dd>
                  <span className="wl-price">
                    <span className="wl-price-now">$20</span>
                    <s className="wl-price-was" aria-label="regular price $100">$100</s>
                    <span className="wl-price-tag">lifetime</span>
                  </span>
                  Updates + Discord included. SAM3.c core stays free.
                </dd>
              </div>
            </dl>

            <div className="wl-index-foot">
              <span className="mono-12px wl-spots">
                <CountUp
                  className="wl-spots-num"
                  to={CLAIMED}
                  durationMs={1600}
                  padTo={3}
                  group={false}
                />
                <span className="wl-spots-label">/ {TOTAL_SPOTS} SPOTS CLAIMED</span>
              </span>
              <div
                ref={progressRef}
                className={`wl-progress ${progressActive ? 'is-active' : ''}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={TOTAL_SPOTS}
                aria-valuenow={CLAIMED}
                aria-label={`${CLAIMED} of ${TOTAL_SPOTS} spots claimed`}
              >
                <div className="wl-progress-fill" style={fillStyle} />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
