import { useId, type KeyboardEvent } from 'react';

export type TabItem<K extends string> = {
  key: K;
  label: string;
  icon?: string;
  disabled?: boolean;
};

type Props<K extends string> = {
  items: ReadonlyArray<TabItem<K>>;
  active: K;
  onChange: (key: K) => void;
  ariaLabel: string;
};

// Stylized segmented tab bar. Shares the visual language of
// `.settings-segmented` (small rounded pill, soft active fill) but is a
// standalone primitive with proper roving-tabindex keyboard navigation
// for a top-level tablist. Bodies are rendered by the parent — this
// component only owns the strip.
export function Tabs<K extends string>({ items, active, onChange, ariaLabel }: Props<K>) {
  const id = useId();

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabled = items.filter((it) => !it.disabled);
    if (enabled.length === 0) return;
    const currentEnabledIdx = enabled.findIndex((it) => it.key === items[index]?.key);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (currentEnabledIdx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (currentEnabledIdx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    if (target) onChange(target.key);
  }

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const selected = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${id}-${item.key}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${id}-${item.key}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className={`tabs-tab${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {item.icon && <i className={item.icon} aria-hidden />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

