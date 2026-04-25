import { ProjectColors, type ProjectColor } from '../types/project';

type Props = {
  value: ProjectColor;
  onChange: (next: ProjectColor) => void;
};

export function ColorPicker({ value, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Project color" style={{ display: 'flex', gap: 8 }}>
      {ProjectColors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`project-color-${c}`}
          onClick={() => onChange(c)}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: c === value ? '2px solid #111' : '2px solid transparent',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}
