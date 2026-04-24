const USE_CASES = [
  {
    title: 'Prompt Segmentation',
    body: 'Click or type, get a pixel-perfect mask.',
    icon: 'ri-cursor-line',
  },
  {
    title: 'Bounding Boxes',
    body: 'Draw once, auto-propagate across a clip.',
    icon: 'ri-square-line',
  },
  {
    title: 'Polygons & Keypoints',
    body: 'Fine-grained labels for anything you see.',
    icon: 'ri-shape-2-line',
  },
  {
    title: 'One-click Export',
    body: 'COCO, YOLO, Pascal VOC — no glue code.',
    icon: 'ri-download-2-line',
  },
] as const;

const ROTATING = [
  'Segmentation Masks',
  'Bounding Boxes',
  'Keypoints',
  'Polygons',
  'Medical Imaging',
  'Drone Footage',
  'Autonomous Driving',
  'Industrial QA',
] as const;

export function Why() {
  return (
    <section className="section section-why" id="why">
      <div className="container why-v2">
        <div className="why-v2-head reveal reveal-up" data-delay="0">
          <h2 className="why-v2-title">From raw pixels to clean datasets</h2>
          <p className="why-v2-sub">Annotate, refine, and export — without the cloud.</p>
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
          <span className="why-v2-pill-prefix">Annotate for</span>
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
