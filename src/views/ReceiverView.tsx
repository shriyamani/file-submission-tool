import { useEffect, useMemo, useState } from 'react'
import ConfettiBurst from '../components/ConfettiBurst'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import {
  confirmIncomingFileReceipt,
  declineIncomingFileReceipt,
  deriveSessionKey,
  dismissPendingFileMeta,
  getPendingFileMeta,
  receiveFile,
  requestReceiverConnection,
  waitForSenderApproval,
} from '../lib/transferClient'
import {
  type ReceivedFile,
  type ReceiverApprovalRequest,
  type TransferMode,
  type TransferConnection,
  type TransferFileMeta,
  type TransferStatus,
} from '../lib/transferTypes'
import { generateECDHKeyPair } from '../utils/crypto'

interface ReceiverViewProps {
  sessionId: string
  transportMode: TransferMode
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

const getConnectionErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'Could not connect to sender. Verify the session link and retry.'
  }

  const normalized = error.message.toLowerCase()

  if (normalized.includes('rejected')) {
    return 'Sender rejected your connection request. Ask them to approve and try again.'
  }

  if (normalized.includes('timed out')) {
    return 'Sender did not approve in time. Press Connect and try again.'
  }

  if (
    normalized.includes('could not connect to peer') ||
    normalized.includes('peer unavailable') ||
    normalized.includes('no active connection')
  ) {
    return 'Could not reach the sender session. Make sure the sender kept the page open and shared a reachable session link.'
  }

  if (normalized.includes('network') || normalized.includes('server')) {
    return 'Could not reach the connection server. Check internet access on both devices and reload the page.'
  }

  return `Could not connect to sender. ${error.message}`
}

const ReceiverView = ({ sessionId, transportMode }: ReceiverViewProps) => {
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
  const [showReceivePrompt, setShowReceivePrompt] = useState(false)
  const [isReceivePromptBusy, setIsReceivePromptBusy] = useState(false)
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null)

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
      return 'File ready to download'
    }

    if (status === 'transferring') {
      return 'Download progress'
    }

    if (status === 'connected') {
      if (pendingFileMeta) {
        return 'Incoming file ready to review'
      }

      return 'Sender approved. Waiting for sender file'
    }

    if (status === 'waiting') {
      return pendingRequest ? 'Waiting for sender approval' : 'Connecting to sender'
    }

    return 'Press Connect to request access'
  }, [pendingFileMeta, pendingRequest, status])

  useEffect(() => {
    const syncMeta = (): void => {
      const nextMeta = getPendingFileMeta(transportMode, sessionId)
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
  }, [sessionId, transportMode])

  useEffect(() => {
    if (!pendingFileMeta || receivedFile) {
      return
    }

    if (!connection) {
      setConnection({
        id: `receiver-${sessionId}`,
        sessionId,
        role: 'receiver',
        connected: true,
        mode: transportMode,
      })
    }

    if (status === 'waiting') {
      setPendingRequest(null)
      setStatus('connected')
    }

    if (!keyPair) {
      void generateECDHKeyPair()
        .then((generatedKeys) => {
          setKeyPair(generatedKeys)
        })
        .catch(() => {
          setStatus('error')
          setErrorMessage('Failed to prepare secure receive step. Reload and try again.')
        })
    }
  }, [connection, keyPair, pendingFileMeta, receivedFile, sessionId, status, transportMode])

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
    if (!pendingFileMeta || receivedFile || !connection || !keyPair) {
      setShowReceivePrompt(false)
      return
    }

    setShowReceivePrompt(true)
  }, [connection, keyPair, pendingFileMeta, receivedFile])

  useEffect(() => {
    if (!showConfetti) {
      return
    }

    const timerId = window.setTimeout(() => {
      setShowConfetti(false)
    }, 3000)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [showConfetti])

  const handleConnect = async (): Promise<void> => {
    setErrorMessage('')
    setNoticeMessage('')
    setProgress(0)
    setReceivedFile(null)
    setConnection(null)
    setKeyPair(null)
    setPendingRequest(null)
    setPendingFileMeta(null)
    setShowReceivePrompt(false)
    setShowConfetti(false)
    setStatus('waiting')

    try {
      const request = await requestReceiverConnection(transportMode, sessionId)
      setPendingRequest(request)

      const receiverConnection = await waitForSenderApproval(transportMode, sessionId, request.requestId)
      setConnection(receiverConnection)
      setPendingRequest(null)
      setStatus('connected')

      try {
        const generatedKeys = await generateECDHKeyPair()
        setKeyPair(generatedKeys)
      } catch {
        setStatus('error')
        setErrorMessage('Failed to generate encryption keys. Press Connect and try again.')
      }
    } catch (error) {
      setStatus('error')
      setPendingRequest(null)
      setErrorMessage(getConnectionErrorMessage(error))
    }
  }

  const handleReceive = async (): Promise<void> => {
    setErrorMessage('')
    setNoticeMessage('')
    setProgress(0)
    setIsReceivePromptBusy(true)

    try {
      const nextConnection =
        connection ??
        ({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
          mode: transportMode,
        } satisfies TransferConnection)

      const nextKeyPair = keyPair ?? (await generateECDHKeyPair())

      if (!connection) {
        setConnection(nextConnection)
      }

      if (!keyPair) {
        setKeyPair(nextKeyPair)
      }

      await confirmIncomingFileReceipt(transportMode, nextConnection.sessionId)
      setPendingRequest(null)
      setShowReceivePrompt(false)
      setStatus('transferring')

      const sessionKey = await deriveSessionKey(
        transportMode,
        nextConnection.sessionId,
        'receiver',
        nextKeyPair.privateKey,
        nextKeyPair.publicKey,
      )

      if (!sessionKey) {
        throw new Error('Failed to derive session key.')
      }

      const file = await receiveFile(transportMode, nextConnection, sessionKey, (nextProgress: number) => {
        setProgress(nextProgress)
      })

      setReceivedFile(file)
      dismissPendingFileMeta(transportMode, nextConnection.sessionId)
      setPendingFileMeta(null)
      setNoticeMessage('File received. Save it to this device.')
      setStatus('done')
    } catch (error) {
      setStatus('connected')
      setShowReceivePrompt(Boolean(pendingFileMeta))

      if (error instanceof Error && error.message.toLowerCase().includes('timed out waiting for sender file')) {
        setErrorMessage('Sender has not finished the file send yet. Ask sender to press Send again, then accept the popup.')
        return
      }

      setErrorMessage('Failed to receive the file. Reconnect and try again.')
    } finally {
      setIsReceivePromptBusy(false)
    }
  }

  const handleDeclineReceive = (): void => {
    if (!connection) {
      return
    }

    try {
      void declineIncomingFileReceipt(transportMode, connection.sessionId)
    } catch {
      // Keep the UI responsive even if the sender connection dropped.
    }

    dismissPendingFileMeta(transportMode, connection.sessionId)
    setPendingFileMeta(null)
    setShowReceivePrompt(false)
    setNoticeMessage('Receive canceled.')
    setErrorMessage('')
  }

  const handleDownload = (): void => {
    setShowConfetti(true)
    setNoticeMessage('Download started.')
  }

  return (
    <section className="beam-card">
      <ConfettiBurst active={showConfetti} />

      <header className="card-header">
        <div>
          <h2>Receiver</h2>
          <p>Connect, review the file, receive it, then save it locally.</p>
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
      </div>

      {showReceivePrompt && pendingFileMeta && (
        <div className="request-modal-backdrop" role="presentation">
          <div className="request-modal" role="dialog" aria-modal="true" aria-labelledby="receive-file-title">
            <div className="request-head">
              <strong id="receive-file-title">Receive this file?</strong>
              <span className="request-alert-chip">Ready</span>
            </div>
            <p className="request-note">
              Name: {pendingFileMeta.name}
              <br />
              Size: {formatBytes(pendingFileMeta.size)}
              <br />
              Type: {formatFileType(pendingFileMeta.type)}
            </p>
            <div className="action-row action-row--request">
              <button className="btn btn-primary" type="button" onClick={handleReceive} disabled={isReceivePromptBusy}>
                {isReceivePromptBusy ? 'Receiving...' : 'Receive file'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleDeclineReceive} disabled={isReceivePromptBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <ProgressBar value={stageProgress} label={stageLabel} />

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
          <a className="btn btn-primary" href={downloadUrl} download={receivedFile.name} onClick={handleDownload}>
            Save file
          </a>
        </div>
      )}

      {status === 'waiting' && pendingRequest && (
        <p className="message">
          Request sent as <strong>{pendingRequest.receiverLabel}</strong>. Waiting for sender approval...
        </p>
      )}
      {status === 'connected' && !pendingFileMeta && (
        <p className="message message--success">Connected. Waiting for sender to choose a file.</p>
      )}
      {status === 'connected' && pendingFileMeta && !receivedFile && (
        <p className="message message--success">Incoming file detected. Review the popup to accept or cancel.</p>
      )}
      {noticeMessage && !errorMessage && <p className="message">{noticeMessage}</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default ReceiverView
