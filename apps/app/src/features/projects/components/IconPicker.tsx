import { ProjectIcons, type ProjectIcon } from '../types/project';

type Props = {
  value: ProjectIcon;
  onChange: (next: ProjectIcon) => void;
};

export function IconPicker({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Project icon"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 32px)', gap: 8 }}
    >
      {ProjectIcons.map((icon) => (
        <button
          key={icon}
          type="button"
          role="radio"
          aria-checked={icon === value}
          aria-label={icon}
          onClick={() => onChange(icon)}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            border: icon === value ? '2px solid #111' : '1px solid #ddd',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          <i className={icon} aria-hidden />
        </button>
      ))}
    </div>
  );
}
