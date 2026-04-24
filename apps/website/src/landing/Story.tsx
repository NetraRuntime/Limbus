const STROKE = 'rgb(255 255 255 / 0.55)';
const STROKE_MUTED = 'rgb(255 255 255 / 0.22)';
const ORANGE = '#FF4800';

function VisualWhy() {
  return (
    <svg
      className="story-v2-svg"
      viewBox="0 0 300 140"
      role="img"
      aria-label="Cloud crossed out — no cloud dependency"
    >
      <circle cx="150" cy="70" r="46" fill="none" stroke={ORANGE} strokeWidth="1.5" />
      <path
        d="M124 84h52a12 12 0 0 0 6-22 14 14 0 0 0-23-12 18 18 0 0 0-35 4 13 13 0 0 0 0 26z"
        fill="none"
        stroke={STROKE}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line
        x1="117"
        y1="103"
        x2="183"
        y2="37"
        stroke={ORANGE}
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VisualToday() {
  return (
    <svg
      className="story-v2-svg"
      viewBox="0 0 300 140"
      role="img"
      aria-label="Image frame with a segmentation mask"
    >
      <rect
        x="100"
        y="25"
        width="100"
        height="90"
        rx="6"
        fill="none"
        stroke={STROKE}
        strokeWidth="1.5"
      />
      <g stroke={STROKE_MUTED} strokeWidth="1" strokeDasharray="2 3">
        <line x1="100" y1="40" x2="200" y2="40" />
        <line x1="115" y1="25" x2="115" y2="115" />
      </g>
      <path
        d="M150 48c14 0 26 10 26 24s-10 26-24 26-28-10-28-24 12-26 26-26z"
        fill={ORANGE}
        fillOpacity="0.18"
        stroke={ORANGE}
        strokeWidth="1.75"
      />
      <circle cx="150" cy="72" r="3" fill={ORANGE} />
      <circle cx="150" cy="72" r="7" fill="none" stroke={ORANGE} strokeWidth="1" opacity="0.55" />
    </svg>
  );
}

type Device = { icon: string; angle: number };
const DEVICES: readonly Device[] = [
  { icon: 'ri-camera-line', angle: 0 },
  { icon: 'ri-drone-line', angle: 60 },
  { icon: 'ri-smartphone-line', angle: 120 },
  { icon: 'ri-cpu-line', angle: 180 },
  { icon: 'ri-robot-2-line', angle: 240 },
  { icon: 'ri-sensor-line', angle: 300 },
];

const RX = 95;
const RY = 48;

function devicePos(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 150 + RX * Math.cos(a), y: 70 + RY * Math.sin(a) };
}

function VisualTomorrow() {
  return (
    <div
      className="story-v2-constellation"
      role="img"
      aria-label="Vision AI on every device"
    >
      <svg className="story-v2-svg" viewBox="0 0 300 140" aria-hidden="true">
        <g stroke={STROKE_MUTED} strokeWidth="1" strokeDasharray="2 3" fill="none">
          {DEVICES.map((d) => {
            const p = devicePos(d.angle);
            return <line key={d.icon} x1="150" y1="70" x2={p.x} y2={p.y} />;
          })}
        </g>
        <circle cx="150" cy="70" r="20" fill="none" stroke={ORANGE} strokeOpacity="0.35" strokeWidth="1" />
        <circle cx="150" cy="70" r="10" fill={ORANGE} fillOpacity="0.18" stroke={ORANGE} strokeWidth="1.5" />
        <circle cx="150" cy="70" r="3" fill={ORANGE} />
      </svg>
      {DEVICES.map((d) => {
        const p = devicePos(d.angle);
        return (
          <span
            key={d.icon}
            className="story-v2-device"
            style={{ left: `${(p.x / 300) * 100}%`, top: `${(p.y / 140) * 100}%` }}
            aria-hidden="true"
          >
            <i className={d.icon} />
          </span>
        );
      })}
    </div>
  );
}

const CHAPTERS = [
  {
    label: '01 · Why',
    visual: <VisualWhy />,
    body: (
      <>
        Vision at the edge is painful — clunky tools, cloud lock-in, per-box bills. So devs pay
        the cloud tax. Born from{' '}
        <a
          className="story-v2-origin"
          href="https://github.com/rifkybujana/sam3.c"
          target="_blank"
          rel="noreferrer"
        >
          SAM3.c
        </a>{' '}
        and{' '}
        <a
          className="story-v2-origin"
          href="https://kolosal.ai"
          target="_blank"
          rel="noreferrer"
        >
          Kolosal AI
        </a>
        , Netra ends it.
      </>
    ),
  },
  {
    label: '02 · Today',
    visual: <VisualToday />,
    body: (
      <>
        Start where it hurts most: <strong>data</strong>. Prompt to segment, export clean
        datasets, prune the result into a model that fits on an Arduino. No cloud. No setup hell.
      </>
    ),
  },
  {
    label: '03 · Tomorrow',
    visual: <VisualTomorrow />,
    body: (
      <>
        The runtime for vision AI on every camera, drone, robot, phone, and Pi. Vision is the
        gateway to robotics — and robotics shouldn't be gated by the annotation bill.
      </>
    ),
  },
] as const;

export function Story() {
  return (
    <section className="section section-story" id="story">
      <div className="container story-v2">
        <div className="story-v2-head reveal reveal-up" data-delay="0">
          <span className="story-v2-eyebrow mono">
            <span className="story-v2-dot" aria-hidden="true" />
            OUR MISSION
          </span>
          <h2 className="story-v2-title">
            Vision AI, <span className="story-v2-caveat">without the tax</span>
          </h2>
          <p className="story-v2-sub">As accessible as text AI. Small enough to run on a chip.</p>
        </div>

        <ol className="story-v2-chapters">
          {CHAPTERS.map((c, i) => (
            <li
              key={c.label}
              className="story-v2-chapter reveal reveal-up"
              data-delay={`${i + 1}`}
            >
              <div className="story-v2-visual" aria-hidden="true">
                {c.visual}
              </div>
              <span className="story-v2-chapter-label mono">{c.label}</span>
              <p className="story-v2-chapter-body">{c.body}</p>
            </li>
          ))}
        </ol>

        <figure className="story-v2-quote reveal reveal-up" data-delay="4">
          <i className="ri-double-quotes-l story-v2-quote-mark" aria-hidden="true" />
          <blockquote className="story-v2-quote-body">
            A teenager films a video, auto-segments it, shrinks it to YOLO, flashes it onto a chip
            — on their laptop.
          </blockquote>
          <figcaption className="story-v2-quote-cap mono">
            <span className="story-v2-quote-dash" aria-hidden="true" />
            That's today.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
