type Props = {
  isEmpty: boolean;
};

export function EmptyState({ isEmpty }: Props) {
  if (!isEmpty) return null;
  return (
    <div className="empty-state" aria-hidden>
      <div className="empty-state-inner">
        <div className="empty-eyebrow">Drop to begin</div>
        <div className="empty-title">
          Drop images or videos <span className="accent">anywhere</span>
        </div>
        <div className="empty-sub">
          They'll land where you drop and zoom into view.
        </div>
      </div>
    </div>
  );
}
