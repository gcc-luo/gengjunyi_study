import type { ReactNode } from 'react';

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="关闭">×</button><h2 id="modal-title">{title}</h2>{children}</section></div>;
}
