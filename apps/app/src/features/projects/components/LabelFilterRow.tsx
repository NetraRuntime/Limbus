type Props = {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export function LabelFilterRow({ available, selected, onChange }: Props) {
  if (available.length === 0) return null;
  const toggle = (label: string) => {
    onChange(
      selected.includes(label)
        ? selected.filter((l) => l !== label)
        : [...selected, label],
    );
  };
  return (
    <div className="label-filter-row">
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
  );
}
