export function Hero() {
  return (
    <section className="hero hero-v2">
      <div className="container hero-v2-inner">
        {/* Headline group */}
        <div className="hero-v2-head reveal reveal-up" data-delay="0">
          <div className="hero-v2-title">
            <div className="hero-v2-line">Vision AI</div>
            <div className="hero-v2-line hero-v2-line-2">
              <span className="hero-v2-caveat">For Anyone</span>
            </div>
          </div>
          <p className="hero-v2-sub">
            Run state-of-the-art vision models on any device.
            <br />
            No cloud. No API bills. No frames leaving your hardware.
          </p>
        </div>

        {/* 280px strip with overlaid input card */}
        <div className="hero-v2-strip reveal reveal-up" data-delay="2">
          <div className="hero-v2-strip-bg" aria-hidden="true" />

          <div className="hero-v2-card">
            <div className="hero-v2-card-top">
              <span className="hero-v2-placeholder">Type anything you like...</span>
            </div>
            <div className="hero-v2-card-foot">
              <button className="hero-v2-picker" type="button">
                <i className="ri-stack-line" />
                <span>Select model</span>
                <i className="ri-arrow-down-s-line" />
              </button>
              <div className="hero-v2-foot-right">
                <span className="hero-v2-mode">
                  <i className="ri-checkbox-circle-fill" />
                  LOCAL MODE
                </span>
                <button className="hero-v2-send" type="button" aria-label="Run">
                  <i className="ri-arrow-right-up-line" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CTA row: Coming soon chip */}
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
