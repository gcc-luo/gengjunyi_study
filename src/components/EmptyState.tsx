import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-orbit">☆</div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
