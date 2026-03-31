import { useEffect, useMemo, useState } from 'react'
import ConfettiBurst from '../components/ConfettiBurst'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import { 
  getPendingFileMeta, 
  receiveFile, 
  requestReceiverConnection, 
  waitForSenderApproval,
  deriveSessionKey,
  notifySenderReceiverReady,
} from '../lib/peerTransfer'
import { generateECDHKeyPair } from '../utils/crypto'
import {
  type ReceivedFile,
  type ReceiverApprovalRequest,
  type TransferFileMeta,
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

const formatFileType = (type: string): string => {
  if (!type || type === 'application/octet-stream') {
    return 'Unknown'
  }

  return type
}

const isSameMeta = (left: TransferFileMeta | null, right: TransferFileMeta | null): boolean => {
  if (!left && !right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.name === right.name && left.size === right.size && left.type === right.type && left.sentAt === right.sentAt
}

const ReceiverView = ({ sessionId }: ReceiverViewProps) => {
  const [connection, setConnection] = useState<TransferConnection | null>(null)
  const [pendingRequest, setPendingRequest] = useState<ReceiverApprovalRequest | null>(null)
  const [pendingFileMeta, setPendingFileMeta] = useState<TransferFileMeta | null>(null)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [receivedFile, setReceivedFile] = useState<ReceivedFile | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null)
  const [showApprovalPrompt, setShowApprovalPrompt] = useState(false)
  const shouldShowProgress = status !== 'idle' && (status !== 'done' || showConfetti)

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
    const syncMeta = (): void => {
      const nextMeta = getPendingFileMeta(sessionId)
      setPendingFileMeta((currentMeta) => {
        if (isSameMeta(currentMeta, nextMeta)) {
          return currentMeta
        }

        return nextMeta
      })
    }

    syncMeta()

    const intervalId = window.setInterval(() => {
      syncMeta()
    }, 360)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [sessionId])

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
    setNoticeMessage('')
    setProgress(0)
    setReceivedFile(null)
    setConnection(null)
    setPendingRequest(null)
    setStatus('waiting')
    setShowApprovalPrompt(false)

    try {
      const request = await requestReceiverConnection(sessionId)
      setPendingRequest(request)

      const receiverConnection = await waitForSenderApproval(sessionId, request.requestId)

      try {
        const generatedKeys = await generateECDHKeyPair()
        setKeyPair(generatedKeys)
        setConnection(receiverConnection)
        setPendingRequest(null)
        setStatus('connected')
        setNoticeMessage('Sender approved. Press Receive file when you are ready.')
        setShowApprovalPrompt(true)
      } catch (err) {
        setConnection(null)
        setPendingRequest(null)
        setStatus('error')
        setErrorMessage('Failed to generate encryption keys. Press Connect and try again.')
      }
    } catch (error) {
      setStatus('error')
      setPendingRequest(null)
      setShowApprovalPrompt(false)

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
    if (!connection || !keyPair) {
      return
    }

    setErrorMessage('')
    setNoticeMessage('')
    setShowApprovalPrompt(false)

    const advertisedMeta = getPendingFileMeta(connection.sessionId)
    if (advertisedMeta) {
      const accepted = window.confirm(
        `Accept this file?\n\nName: ${advertisedMeta.name}\nSize: ${formatBytes(advertisedMeta.size)}\nType: ${formatFileType(advertisedMeta.type)}`,
      )

      if (!accepted) {
        setNoticeMessage('Download canceled. Review file details and press Receive file when ready.')
        return
      }
    }

    setProgress(0)
    setStatus('transferring')

    try {
      const sessionKeyPromise = deriveSessionKey(
        connection.sessionId,
        'receiver',
        keyPair.privateKey,
        keyPair.publicKey,
      )

      const receivePromise = receiveFile(connection, sessionKeyPromise, (nextProgress: number) => {
        setProgress(nextProgress)
      })

      await notifySenderReceiverReady()
      setNoticeMessage('Sender notified. Waiting for them to press Send.')

      const file = await receivePromise

      setReceivedFile(file)
      setNoticeMessage('')
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
          disabled={!connection || !keyPair || status === 'waiting' || status === 'transferring'}
        >
          Receive file
        </button>
      </div>

      {showApprovalPrompt && connection && (
        <div className="request-modal-backdrop" role="presentation">
          <div
            className="request-modal request-modal--info"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sender-approved-title"
          >
            <div className="request-head request-head--neutral">
              <strong id="sender-approved-title">Sender approved your request</strong>
              <span className="request-alert-chip request-alert-chip--info">Ready to receive</span>
            </div>
            <p className="request-note request-note--neutral">
              Press Receive file on the transfer page when you are ready to receive.
            </p>
            {pendingFileMeta && (
              <div className="download-box">
                <div>
                  <strong>{pendingFileMeta.name}</strong>
                  <span>
                    {formatBytes(pendingFileMeta.size)} | {formatFileType(pendingFileMeta.type)}
                  </span>
                </div>
              </div>
            )}
            <div className="action-row action-row--request">
              <button className="btn btn-primary" type="button" onClick={() => setShowApprovalPrompt(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {shouldShowProgress && <ProgressBar value={stageProgress} label={stageLabel} />}

      {pendingFileMeta && status !== 'done' && (
        <div className="download-box">
          <div>
            <strong>Incoming file: {pendingFileMeta.name}</strong>
            <span>
              {formatBytes(pendingFileMeta.size)} | {formatFileType(pendingFileMeta.type)}
            </span>
          </div>
        </div>
      )}

      {receivedFile && downloadUrl && (
        <div className="download-box">
          <div>
            <strong>{receivedFile.name}</strong>
            <span>
              {formatBytes(receivedFile.size)} | {formatFileType(receivedFile.type)}
            </span>
          </div>
          <a className="btn btn-primary" href={downloadUrl} download={receivedFile.name}>
            Save file
          </a>
        </div>
      )}

      {status === 'waiting' && pendingRequest && <p className="message">Waiting for sender approval...</p>}
      {status === 'waiting' && !pendingRequest && <p className="message">Attempting connection...</p>}
      {status === 'connected' && <p className="message message--success">Sender approved. Press Receive file.</p>}
      {noticeMessage && !errorMessage && <p className="message">{noticeMessage}</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default ReceiverView
