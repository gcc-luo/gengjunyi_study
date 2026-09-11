import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => !element.hasAttribute('disabled'));
    const first = () => focusable()[0] ?? dialogRef.current;
    first()?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const current = document.activeElement;
      const index = elements.indexOf(current as HTMLElement);
      if (event.shiftKey) { event.preventDefault(); elements[index <= 0 ? elements.length - 1 : index - 1].focus(); }
      else { event.preventDefault(); elements[index === -1 || index === elements.length - 1 ? 0 : index + 1].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section ref={dialogRef} className="modal" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button><h2 id="modal-title">{title}</h2>{children}</section></div>;
}
