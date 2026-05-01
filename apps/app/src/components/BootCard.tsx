import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  spinner?: boolean;
  role?: 'status' | 'alert';
  action?: ReactNode;
};

export function BootCard({
  title,
  subtitle,
  spinner = false,
  role = 'status',
  action,
}: Props) {
  return (
    <div
      className="boot-screen"
      role={role}
      {...(role === 'status' ? { 'aria-live': 'polite' as const } : {})}
    >
      <div className="boot-card">
        {spinner && <div className="boot-spinner" aria-hidden />}
        <div className="boot-title">{title}</div>
        {subtitle && <div className="boot-subtitle">{subtitle}</div>}
        {action}
      </div>
    </div>
  );
}
