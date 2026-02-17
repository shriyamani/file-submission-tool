import { type TransferStatus } from '../lib/transferTypes'

interface StatusPillProps {
  status: TransferStatus
}

const STATUS_LABELS: Record<TransferStatus, string> = {
  idle: 'Idle',
  waiting: 'Waiting',
  connected: 'Connected',
  transferring: 'Transferring',
  done: 'Done',
  error: 'Error',
}

const StatusPill = ({ status }: StatusPillProps) => {
  return <span className={`status-pill status-pill--${status}`}>{STATUS_LABELS[status]}</span>
}

export default StatusPill
