import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section ref={dialogRef} className="modal" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button><h2 id="modal-title">{title}</h2>{children}</section></div>;
}
