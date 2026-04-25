import { useAutoLiquidGlassFilter } from '../../../components/LiquidGlass';

type Props = {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export function LabelFilterRow({ available, selected, onChange }: Props) {
  const glass = useAutoLiquidGlassFilter({ radius: 999 });
  if (available.length === 0) return null;
  const toggle = (label: string) => {
    onChange(
      selected.includes(label)
        ? selected.filter((l) => l !== label)
        : [...selected, label],
    );
  };
  return (
    <>
      {glass.filterSvg}
      <div
        ref={glass.ref}
        className="home-labels is-liquid-glass"
        role="group"
        aria-label="Filter by label"
        style={glass.style}
      >
        <span className="home-labels-prefix" aria-hidden>
          Labels
        </span>
        {available.map((l) => (
          <button
            key={l}
            type="button"
            className={`label-chip${selected.includes(l) ? ' is-active' : ''}`}
            onClick={() => toggle(l)}
            aria-pressed={selected.includes(l)}
          >
            #{l}
          </button>
        ))}
        {selected.length > 0 && (
          <button
            type="button"
            className="label-chip label-chip-clear"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        )}
      </div>
    </>
  );
}
