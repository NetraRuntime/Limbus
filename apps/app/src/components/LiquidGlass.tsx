import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  generateFilterAssets,
  type SurfaceType,
} from '../lib/liquid-glass';

// WebKit advertises `backdrop-filter: url(#id)` via `CSS.supports` but
// doesn't actually execute the SVG filter at render time — panels end
// up transparent instead of refracted. Verified against macOS WKWebView
// (Tauri desktop build) where the probe returns true but nothing
// renders. `window.chrome` is the reliable sniff: present on Chromium /
// Edge / Tauri-on-Windows, absent on Safari / WKWebView / WebKitGTK /
// Firefox. We still gate on `CSS.supports` as a belt-and-braces check.
export const SUPPORTS_BACKDROP_FILTER_URL = (() => {
  if (typeof window === 'undefined') return false;
  const isChromium = !!(window as Window & { chrome?: unknown }).chrome;
  if (!isChromium) return false;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  const probe = 'url(#_liquid_glass_probe)';
  return (
    CSS.supports('backdrop-filter', probe) ||
    CSS.supports('-webkit-backdrop-filter', probe)
  );
})();

/** Plain frosted-glass fallback applied when the engine can't execute
 *  SVG URL filters inside `backdrop-filter`. */
export const FALLBACK_BACKDROP_FILTER = 'blur(16px) saturate(1.4)';

// ─── Hook ───────────────────────────────────────────────────────────────────
// Returns a stable filter id + the SVG <defs> node to render. Callers are
// responsible for (a) rendering `filterSvg` somewhere in their tree and
// (b) applying `backdrop-filter: url(#${filterId})` to the element they
// want to refract.

export type LiquidGlassFilterOptions = {
  /** Element width in px. Keep it rounded to an integer bucket to avoid
   *  regenerating the displacement map every pixel of resize. */
  width: number;
  /** Element height in px. */
  height: number;
  /** Element border-radius in px. */
  radius: number;
  /** Width of the refracting bezel, in px. Defaults to 70% of radius
   *  (capped at 40 and at min(w,h)/4). */
  bezelWidth?: number;
  /** Logical thickness of the glass — drives how far light bends
   *  through the bezel. Higher = more dramatic refraction. Defaults
   *  to bezelWidth * 6. */
  glassThickness?: number;
  /** Glass index of refraction. 1.5 ≈ window glass. */
  refractiveIndex?: number;
  /** Bezel profile — flat interior with a rounded edge by default. */
  surfaceType?: SurfaceType;
  /** Multiplier on feDisplacementMap scale (post-precompute). */
  refractionScale?: number;
  /** Alpha multiplier on the specular highlight (0..1). */
  specularOpacity?: number;
  /** Slight defocus before refraction — 0.5 is a subtle anti-alias. */
  preBlur?: number;
  /** Extra color-saturation boost on the refracted backdrop. */
  saturate?: number;
};

export type LiquidGlassFilterResult = {
  filterId: string;
  filterSvg: ReactNode;
  /** False when the current engine can't render SVG URL filters inside
   *  backdrop-filter. Callers building their own backdrop-filter string
   *  should branch on this and fall back to
   *  `FALLBACK_BACKDROP_FILTER`. */
  supported: boolean;
};

export function useLiquidGlassFilter({
  width,
  height,
  radius,
  bezelWidth,
  glassThickness,
  refractiveIndex = 1.5,
  surfaceType = 'convex_squircle',
  refractionScale = 1.5,
  specularOpacity = 0.8,
  preBlur = 0.5,
  saturate = 1.3,
}: LiquidGlassFilterOptions): LiquidGlassFilterResult {
  const rawId = useId();
  const filterId = `liquid-glass-${rawId.replace(/:/g, '')}`;

  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const bezel =
    bezelWidth ?? Math.min(radius * 0.7, Math.min(w, h) / 4, 40);
  const thickness = glassThickness ?? bezel * 6;

  const { displacementUrl, specularUrl, maximumDisplacement } = useMemo(
    () =>
      generateFilterAssets({
        width: w,
        height: h,
        radius,
        bezelWidth: bezel,
        glassThickness: thickness,
        refractiveIndex,
        surfaceType,
      }),
    [w, h, radius, bezel, thickness, refractiveIndex, surfaceType],
  );

  // Always render the SVG filter defs. WebKit can't apply them via
  // `backdrop-filter: url(#)`, but it *can* apply them via regular
  // `filter: url(#)` on a clone layer (the clone-fallback path).
  const filterSvg = (
    <svg
      width="0"
      height="0"
      aria-hidden
      style={{
        position: 'absolute',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <filter
          id={filterId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={preBlur}
            result="blurred"
          />
          <feImage
            href={displacementUrl}
            x="0"
            y="0"
            width={w}
            height={h}
            result="displacement_map"
            preserveAspectRatio="none"
          />
          <feDisplacementMap
            in="blurred"
            in2="displacement_map"
            scale={maximumDisplacement * refractionScale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feColorMatrix
            in="displaced"
            type="saturate"
            values={String(saturate)}
            result="displaced_saturated"
          />
          <feImage
            href={specularUrl}
            x="0"
            y="0"
            width={w}
            height={h}
            result="specular_layer"
            preserveAspectRatio="none"
          />
          <feComponentTransfer in="specular_layer" result="specular_faded">
            <feFuncA type="linear" slope={specularOpacity} />
          </feComponentTransfer>
          <feBlend
            in="specular_faded"
            in2="displaced_saturated"
            mode="screen"
          />
        </filter>
      </defs>
    </svg>
  );

  return { filterId, filterSvg, supported: SUPPORTS_BACKDROP_FILTER_URL };
}

// ─── Auto-sizing variant ────────────────────────────────────────────────────
// Measures the attached element via ResizeObserver and regenerates the
// filter only when the (bucketed) dimensions change. Use for elements
// whose size is driven by content — pills, dynamic cards, toolbars —
// instead of hard-coding `width`/`height`.
//
// Usage:
//   const { ref, filterSvg, style } = useAutoLiquidGlassFilter({ radius: 999 });
//   return (<><div ref={ref} style={style}>...</div>{filterSvg}</>);
//
// `radius: 999` (or any value ≥ height/2) is clamped internally to
// `height/2`, so you get a pill shape automatically.

export type AutoLiquidGlassOptions = Omit<
  LiquidGlassFilterOptions,
  'width' | 'height' | 'radius'
> & {
  /** Border radius in px. Values ≥ min(w,h)/2 are treated as a pill. */
  radius: number;
  /** Pixel bucket for width to avoid filter churn during resize. */
  widthStep?: number;
  /** Pixel bucket for height (usually stable, so small by default). */
  heightStep?: number;
};

export type AutoLiquidGlassResult = {
  ref: RefObject<HTMLDivElement>;
  filterId: string;
  filterSvg: ReactNode;
  /** Merge into the target element's `style` prop. */
  style: CSSProperties;
};

export function useAutoLiquidGlassFilter({
  radius,
  widthStep = 4,
  heightStep = 2,
  ...filterOpts
}: AutoLiquidGlassOptions): AutoLiquidGlassResult {
  const ref = useRef<HTMLDivElement>(null);
  // Start at non-zero so the first filter is valid even before measure.
  const [size, setSize] = useState({ width: 200, height: 32 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const w = Math.max(1, Math.round(r.width / widthStep) * widthStep);
      const h = Math.max(1, Math.round(r.height / heightStep) * heightStep);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthStep, heightStep]);

  const clampedRadius = Math.min(radius, Math.min(size.width, size.height) / 2);

  const { filterId, filterSvg, supported } = useLiquidGlassFilter({
    width: size.width,
    height: size.height,
    radius: clampedRadius,
    ...filterOpts,
  });

  const backdropFilter = supported
    ? `url(#${filterId})`
    : FALLBACK_BACKDROP_FILTER;

  const style: CSSProperties = {
    WebkitBackdropFilter: backdropFilter,
    backdropFilter,
  };

  return { ref, filterId, filterSvg, style };
}

// ─── Wrapper component ──────────────────────────────────────────────────────
// The quick path — a `<div>` sized to `width/height` with a liquid-glass
// backdrop filter, a standard tint + hairline border + shadow. For forms,
// sections, buttons or any custom element, use `useLiquidGlassFilter`
// directly and apply `backdrop-filter` inline yourself.

export type LiquidGlassProps = {
  width: number;
  height: number;
  radius: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  /** 0..1 — opacity of the neutral tint painted over the refracted
   *  backdrop. 0 disables the tint entirely. */
  tintOpacity?: number;
  /** Post-refraction Gaussian blur (px). 0 keeps the refraction crisp;
   *  raise for a frosted finish on top of the bend. */
  postBlur?: number;
  /** Post-refraction saturation boost. */
  saturation?: number;
  /** Hide the default border. */
  borderless?: boolean;
  /** Hide the default drop shadow. */
  shadowless?: boolean;
} & Partial<Omit<LiquidGlassFilterOptions, 'width' | 'height' | 'radius'>>;

export function LiquidGlass({
  width,
  height,
  radius,
  className,
  style,
  children,
  tintOpacity = 0.2,
  postBlur = 0,
  saturation = 1.4,
  borderless = false,
  shadowless = false,
  bezelWidth,
  glassThickness,
  refractiveIndex,
  surfaceType,
  refractionScale,
  specularOpacity,
  preBlur,
  saturate,
}: LiquidGlassProps) {
  const { filterId, filterSvg, supported } = useLiquidGlassFilter({
    width,
    height,
    radius,
    bezelWidth,
    glassThickness,
    refractiveIndex,
    surfaceType,
    refractionScale,
    specularOpacity,
    preBlur,
    saturate,
  });

  const backdropFilter = supported
    ? [
        `url(#${filterId})`,
        postBlur > 0 ? `blur(${postBlur}px)` : '',
        `saturate(${saturation})`,
      ]
        .filter(Boolean)
        .join(' ')
    : `blur(16px) saturate(${saturation})`;

  const tintPct = Math.max(0, Math.min(100, Math.round(tintOpacity * 100)));

  const composedStyle: CSSProperties = {
    width,
    height,
    borderRadius: radius,
    background:
      tintPct > 0
        ? `color-mix(in srgb, var(--color-neutral) ${tintPct}%, transparent)`
        : undefined,
    WebkitBackdropFilter: backdropFilter,
    backdropFilter,
    border: borderless
      ? undefined
      : '1px solid color-mix(in srgb, var(--color-neutral) 60%, transparent)',
    boxShadow: shadowless
      ? undefined
      : '0 12px 24px -12px rgb(0 0 0 / 0.25), 0 0 0 1px color-mix(in srgb, var(--color-text) 4%, transparent)',
    ...style,
  };

  return (
    <>
      {filterSvg}
      <div className={className} style={composedStyle}>
        {children}
      </div>
    </>
  );
}
