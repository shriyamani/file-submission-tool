interface ProgressBarProps {
  value: number
  label?: string
}

const clamp = (value: number): number => {
  if (value < 0) {
    return 0
  }

  if (value > 100) {
    return 100
  }

  return value
}

const ProgressBar = ({ value, label }: ProgressBarProps) => {
  const safeValue = clamp(value)

  return (
    <div className="progress-wrap" aria-live="polite">
      <div className="progress-meta">
        <span>{label ?? 'Transfer progress'}</span>
        <span>{Math.round(safeValue)}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={Math.round(safeValue)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  )
}

export default ProgressBar
