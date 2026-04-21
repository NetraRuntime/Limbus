const USE_CASES = [
  {
    title: 'Object Detection',
    body: 'Find, count and track anything in any feed.',
    icon: 'ri-focus-3-line',
  },
  {
    title: 'Scene Understanding',
    body: "Ask a VLM what's happening in the frame.",
    icon: 'ri-eye-2-line',
  },
  {
    title: 'Quality Inspection',
    body: 'Catch defects on the line in milliseconds.',
    icon: 'ri-shield-check-line',
  },
  {
    title: 'On-device Assistants',
    body: 'VLM assistants that run fully offline.',
    icon: 'ri-smartphone-line',
  },
] as const;

const ROTATING = [
  'Drone Inspection',
  'Retail Analytics',
  'Medical Imaging',
  'Robot Navigation',
  'Smart Cameras',
  'Mobile Apps',
] as const;

export function Why() {
  return (
    <section className="section section-why" id="why">
      <div className="container why-v2">
        <div className="why-v2-head reveal reveal-up" data-delay="0">
          <h2 className="why-v2-title">From capture to insight</h2>
          <p className="why-v2-sub">Detect, understand and decide — without the cloud.</p>
        </div>

        <div className="why-v2-grid">
          {USE_CASES.map((u, i) => (
            <article
              key={u.title}
              className="why-v2-card reveal reveal-up"
              data-delay={`${i + 1}`}
            >
              <div className="why-v2-icon">
                <i className={u.icon} />
              </div>
              <div className="why-v2-body">
                <h3 className="why-v2-cardtitle">{u.title}</h3>
                <p className="why-v2-cardbody">{u.body}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="why-v2-pill reveal reveal-up" data-delay="5">
          <span className="why-v2-pill-prefix">NetraRT Used for</span>
          <div className="why-v2-marquee">
            <div className="why-v2-marquee-track">
              {[...ROTATING, ...ROTATING].map((t, i) => (
                <span key={`${t}-${i}`} className="why-v2-marquee-item">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <i className="ri-check-line why-v2-pill-check" />
        </div>
      </div>
    </section>
  );
}
