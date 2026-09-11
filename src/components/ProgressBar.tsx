export function ProgressBar({ value, label = '进度' }: { value: number; label?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return <div className="progress-wrap" aria-label={label}><div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div><span>{percent}%</span></div>;
}
