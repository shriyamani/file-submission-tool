import { useEffect, useMemo, useState } from 'react'
import ConfettiBurst from '../components/ConfettiBurst'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import { receiveFile, requestReceiverConnection, waitForSenderApproval } from '../lib/mockTransfer'
import {
  type ReceivedFile,
  type ReceiverApprovalRequest,
  type TransferConnection,
  type TransferStatus,
} from '../lib/transferTypes'

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
  const [pendingRequest, setPendingRequest] = useState<ReceiverApprovalRequest | null>(null)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)

  const stageProgress = useMemo(() => {
    if (status === 'done') {
      return 100
    }

    if (status === 'transferring') {
      return progress
    }

    if (status === 'connected') {
      return 68
    }

    if (status === 'waiting') {
      return 34
    }

    return 0
  }, [progress, status])

  const stageLabel = useMemo(() => {
    if (status === 'done') {
      return 'Download complete'
    }

    if (status === 'transferring') {
      return 'Download progress'
    }

    if (status === 'connected') {
      return 'Sender approved. Ready to receive'
    }

    if (status === 'waiting') {
      return 'Waiting for sender approval'
    }

    return 'Press Connect to request access'
  }, [status])

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

  useEffect(() => {
    if (status !== 'done') {
      return
    }

    setShowConfetti(true)
    const timerId = window.setTimeout(() => {
      setShowConfetti(false)
    }, 3000)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [status])

  const handleConnect = async (): Promise<void> => {
    setErrorMessage('')
    setProgress(0)
    setReceivedFile(null)
    setConnection(null)
    setPendingRequest(null)
    setStatus('waiting')

    try {
      const request = await requestReceiverConnection(sessionId)
      setPendingRequest(request)

      // TODO: Replace with actual PeerJS/WebRTC receiver join flow + sender auth.
      const receiverConnection = await waitForSenderApproval(sessionId, request.requestId)
      setConnection(receiverConnection)
      setPendingRequest(null)
      setStatus('connected')
    } catch (error) {
      setStatus('error')
      setPendingRequest(null)

      if (error instanceof Error && error.message.toLowerCase().includes('rejected')) {
        setErrorMessage('Sender rejected your connection request. Ask them to approve and try again.')
        return
      }

      if (error instanceof Error && error.message.toLowerCase().includes('timed out')) {
        setErrorMessage('Sender did not approve in time. Press Connect and try again.')
        return
      }

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
    } catch (error) {
      setStatus('error')

      if (error instanceof Error && error.message.toLowerCase().includes('timed out waiting for sender file')) {
        setErrorMessage('Sender has not sent the file yet. Ask sender to press Send, then press Receive file again.')
        return
      }

      setErrorMessage('Failed to receive the file. Reconnect and try again.')
    }
  }

  return (
    <section className="beam-card">
      <ConfettiBurst active={showConfetti} />

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
          {status === 'waiting' ? 'Waiting for approval...' : connection ? 'Reconnect' : 'Connect'}
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

      <ProgressBar value={stageProgress} label={stageLabel} />

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

      {status === 'waiting' && pendingRequest && (
        <p className="message">
          Request sent as <strong>{pendingRequest.receiverLabel}</strong>. Waiting for sender approval...
        </p>
      )}
      {status === 'waiting' && !pendingRequest && <p className="message">Attempting connection...</p>}
      {status === 'connected' && <p className="message message--success">Connected. Press Receive file.</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default ReceiverView
