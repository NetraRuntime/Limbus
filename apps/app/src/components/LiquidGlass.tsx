import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  generateFilterAssets,
  type SurfaceType,
} from '../lib/liquid-glass';

// WebKit reports `CSS.supports('backdrop-filter', 'url(#)')` true but doesn't render — gate on `window.chrome` too.
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

export const FALLBACK_BACKDROP_FILTER = 'blur(16px) saturate(1.4)';

export type LiquidGlassFilterOptions = {
  /** Element width in px (round to integer buckets to avoid filter churn on resize). */
  width: number;
  height: number;
  radius: number;
  /** Refracting bezel width in px. Defaults to min(radius * 0.7, 40, min(w,h)/4). */
  bezelWidth?: number;
  /** Glass thickness — higher = more refraction. Defaults to bezelWidth * 6. */
  glassThickness?: number;
  /** 1.5 ≈ window glass. */
  refractiveIndex?: number;
  surfaceType?: SurfaceType;
  refractionScale?: number;
  specularOpacity?: number;
  preBlur?: number;
  saturate?: number;
};

export type LiquidGlassFilterResult = {
  filterId: string;
  filterSvg: ReactNode;
  /** False when the engine can't render SVG URL filters in backdrop-filter; use FALLBACK_BACKDROP_FILTER. */
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
  /** Callback ref so the effect re-runs after lazy mount (post early-return). */
  ref: (el: HTMLDivElement | null) => void;
  element: HTMLDivElement | null;
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
  // useState (not useRef) so the measurement effect re-runs on lazy mount.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 200, height: 32 });

  const ref = useCallback((el: HTMLDivElement | null) => {
    setElement(el);
  }, []);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const r = element.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const w = Math.max(1, Math.round(r.width / widthStep) * widthStep);
      const h = Math.max(1, Math.round(r.height / heightStep) * heightStep);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(element);
    return () => ro.disconnect();
  }, [element, widthStep, heightStep]);

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

  return { ref, element, filterId, filterSvg, style };
}

export type LiquidGlassProps = {
  width: number;
  height: number;
  radius: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  tintOpacity?: number;
  postBlur?: number;
  saturation?: number;
  borderless?: boolean;
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
