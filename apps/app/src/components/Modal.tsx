import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  titleVariant?: 'default' | 'danger';
  width?: 'normal' | 'wide';
  children: ReactNode;
};

// Modal shell — backdrop, card, header (title + close), focus management,
// Escape, focus trap. Consumers render their own body/footer markup as
// children (typically using `.modal-body` / `.modal-footer` utility
// classes, or feature-specific layouts wrapped in a <form>).
export function Modal({
  open,
  onClose,
  title,
  titleVariant = 'default',
  width = 'normal',
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = `modal-title-${useId()}`;

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusable = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`modal-card${width === 'wide' ? ' modal-card-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2
            id={titleId}
            className={`modal-title${titleVariant === 'danger' ? ' is-danger' : ''}`}
          >
            {title}
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <i className="ri-close-line" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
