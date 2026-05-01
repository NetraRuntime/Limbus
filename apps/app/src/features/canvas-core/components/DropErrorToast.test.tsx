import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DropErrorToast } from './DropErrorToast';

afterEach(cleanup);

describe('DropErrorToast', () => {
  it('renders nothing when message is null', () => {
    const { container } = render(
      <DropErrorToast message={null} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the message and announces as alert', () => {
    render(<DropErrorToast message="Bad file" onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad file');
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<DropErrorToast message="Bad file" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
