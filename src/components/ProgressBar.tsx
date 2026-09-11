export function ProgressBar({ value, label = '进度' }: { value: number; label?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return <div className="progress-wrap"><div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{ width: `${percent}%` }} /></div><span>{percent}%</span></div>;
}
