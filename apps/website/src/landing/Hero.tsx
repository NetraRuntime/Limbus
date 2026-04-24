export function Hero() {
  return (
    <section className="hero hero-v2">
      <div className="container hero-v2-inner">
        <div className="hero-v2-head reveal reveal-up" data-delay="0">
          <div className="hero-v2-title">
            <div className="hero-v2-line">Annotate Anything</div>
            <div className="hero-v2-line hero-v2-line-2">
              <span className="hero-v2-caveat">For Anyone</span>
            </div>
          </div>
          <p className="hero-v2-sub">
            Local, collaborative data annotation for computer vision.
            <br />
            Prompt to segment. Export clean datasets. No cloud.
          </p>
        </div>

        <div
          className="hero-v2-strip reveal reveal-up"
          data-delay="2"
          role="img"
          aria-label="NetraRT canvas preview — coming soon"
        >
          <div className="hero-v2-strip-bg" aria-hidden="true" />
          <div className="hero-v2-placeholder-label" aria-hidden="true">
            canvas preview
          </div>
        </div>

        <div className="hero-v2-cta reveal reveal-up" data-delay="4">
          <span className="hero-v2-soon">
            <span className="hero-v2-soon-dot" aria-hidden="true" />
            <span className="mono">COMING SOON</span>
          </span>
        </div>
      </div>
    </section>
  );
}
