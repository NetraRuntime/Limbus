type Props = {
  message: string | null;
  onDismiss: () => void;
};

export function DropErrorToast({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div className="canvas-drop-toast" role="alert">
      <i className="ri-error-warning-line" aria-hidden />
      <span>{message}</span>
      <button
        type="button"
        className="canvas-drop-toast-close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <i className="ri-close-line" aria-hidden />
      </button>
    </div>
  );
}
