import { useAutoLiquidGlassFilter } from '../../../components/LiquidGlass';

export type SortKey = 'recent' | 'name' | 'created';

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
];

type Props = {
  value: SortKey;
  onChange: (next: SortKey) => void;
};

export function SortMenu({ value, onChange }: Props) {
  const glass = useAutoLiquidGlassFilter({ radius: 12 });
  return (
    <>
      {glass.filterSvg}
      <div
        ref={glass.ref}
        className="btn-cluster is-liquid-glass"
        role="radiogroup"
        aria-label="Sort projects"
        style={glass.style}
      >
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`btn-ghost${value === opt.value ? ' is-active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}
