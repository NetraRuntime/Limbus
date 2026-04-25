export type SortKey = 'recent' | 'name' | 'created';

type Props = {
  value: SortKey;
  onChange: (next: SortKey) => void;
};

export function SortMenu({ value, onChange }: Props) {
  return (
    <label className="home-sort">
      <span>Sort by</span>
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        <option value="recent">Recently opened</option>
        <option value="name">Name</option>
        <option value="created">Created</option>
      </select>
    </label>
  );
}
