import { focusHome, closeCurrentCanvas } from '../../../lib/windows';

export function DeletedBanner() {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: '#b00',
        color: 'white',
        padding: '12px 16px',
        textAlign: 'center',
        zIndex: 100,
      }}
    >
      This project no longer exists.{' '}
      <button
        type="button"
        onClick={async () => {
          await focusHome();
          await closeCurrentCanvas();
        }}
        style={{ marginLeft: 8 }}
      >
        Return to Home
      </button>
    </div>
  );
}
