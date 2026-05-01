import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BootCard } from './BootCard';

afterEach(cleanup);

describe('BootCard', () => {
  it('renders title and subtitle as a status by default', () => {
    render(<BootCard title="Loading" subtitle="Please wait" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading');
    expect(status).toHaveTextContent('Please wait');
  });

  it('renders as an alert when role="alert"', () => {
    render(<BootCard role="alert" title="Failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });

  it('renders an action when provided', () => {
    render(
      <BootCard
        role="alert"
        title="Stop"
        action={<button>Retry</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
