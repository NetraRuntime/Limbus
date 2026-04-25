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
    <div style={{ display: 'flex', gap: 4, padding: '8px 24px', flexWrap: 'wrap' }}>
      {available.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => toggle(l)}
          aria-pressed={selected.includes(l)}
          style={{
            padding: '4px 8px',
            borderRadius: 12,
            border: '1px solid #ddd',
            background: selected.includes(l) ? '#111' : 'white',
            color: selected.includes(l) ? 'white' : '#111',
            cursor: 'pointer',
          }}
        >
          #{l}
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])}>
          Clear
        </button>
      )}
    </div>
  );
}
