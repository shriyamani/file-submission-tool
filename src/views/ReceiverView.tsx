import { useEffect, useState } from 'react'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import { connectAsReceiver, receiveFile } from '../lib/mockTransfer'
import { type ReceivedFile, type TransferConnection, type TransferStatus } from '../lib/transferTypes'

interface ReceiverViewProps {
  sessionId: string
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`
}

const ReceiverView = ({ sessionId }: ReceiverViewProps) => {
  const [connection, setConnection] = useState<TransferConnection | null>(null)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!receivedFile) {
      setDownloadUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(receivedFile.blob)
    setDownloadUrl(nextUrl)

    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [receivedFile])

  const handleConnect = async (): Promise<void> => {
    setErrorMessage('')
    setProgress(0)
    setStatus('waiting')

    try {
      // TODO: Replace with actual PeerJS/WebRTC receiver join flow.
      const receiverConnection = await connectAsReceiver(sessionId)
      setConnection(receiverConnection)
      setStatus('connected')
    } catch {
      setStatus('error')
      setErrorMessage('Could not connect to sender. Verify the session link and retry.')
    }
  }

  const handleReceive = async (): Promise<void> => {
    if (!connection) {
      return
    }

    setErrorMessage('')
    setProgress(0)
    setStatus('transferring')

    try {
      const file = await receiveFile(connection, (nextProgress) => {
        setProgress(nextProgress)
      })

      setReceivedFile(file)
      setStatus('done')
    } catch {
      setStatus('error')
      setErrorMessage('Failed to receive the file. Reconnect and try again.')
    }
  }

  return (
    <section className="beam-card">
      <header className="card-header">
        <div>
          <h2>Receiver</h2>
          <p>Connect to sender, receive file, then save it locally.</p>
        </div>
        <StatusPill status={status} />
      </header>

      <div className="session-box">
        <span>Session</span>
        <strong>{sessionId}</strong>
      </div>

      <div className="action-row">
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleConnect}
          disabled={status === 'waiting' || status === 'transferring'}
        >
          {connection ? 'Reconnect' : 'Connect'}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={handleReceive}
          disabled={!connection || status === 'waiting' || status === 'transferring'}
        >
          Receive file
        </button>
      </div>

      {(status === 'transferring' || status === 'done') && (
        <ProgressBar value={progress} label="Download progress" />
      )}

      {receivedFile && downloadUrl && (
        <div className="download-box">
          <div>
            <strong>{receivedFile.name}</strong>
            <span>{formatBytes(receivedFile.size)}</span>
          </div>
          <a className="btn btn-primary" href={downloadUrl} download={receivedFile.name}>
            Save file
          </a>
        </div>
      )}

      {status === 'waiting' && <p className="message">Attempting connection...</p>}
      {status === 'connected' && <p className="message message--success">Connected. Press Receive file.</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default ReceiverView
