import { useEffect, useMemo, useState } from 'react'
import ConfettiBurst from '../components/ConfettiBurst'
import Dropzone from '../components/Dropzone'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import {
  approveReceiverRequest,
  createSession,
  getPendingReceiverRequest,
  isTransferCompleted,
  publishPendingFileMeta,
  rejectReceiverRequest,
  sendFile,
} from '../lib/mockTransfer'
import { generateECDHKeyPair } from '../utils/crypto'
import {
  type ReceiverApprovalRequest,
  type SessionInfo,
  type TransferConnection,
  type TransferStatus,
} from '../lib/transferTypes'

const SenderView = () => {
  const [file, setFile] = useState<File | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [connection, setConnection] = useState<TransferConnection | null>(null)
  const [pendingReceiver, setPendingReceiver] = useState<ReceiverApprovalRequest | null>(null)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')
  const [showConfetti, setShowConfetti] = useState(false)

  const shouldWarnBeforeClose = Boolean(
    session && (status === 'waiting' || status === 'connected' || status === 'transferring' || pendingReceiver),
  )

  const stageProgress = useMemo(() => {
    if (status === 'done') {
      return 100
    }

    if (status === 'transferring') {
      return progress
    }

    if (status === 'connected') {
      return Math.max(66, Math.round(progress))
    }

    if (pendingReceiver) {
      return 42
    }

    if (session && status === 'waiting') {
      return 22
    }

    return 0
  }, [pendingReceiver, progress, session, status])

  const stageLabel = useMemo(() => {
    if (status === 'done') {
      return 'Transfer complete'
    }

    if (status === 'transferring') {
      return 'Upload progress'
    }

    if (status === 'connected') {
      if (progress >= 90) {
        return 'Upload sent. Waiting for receiver download confirmation'
      }

      return 'Receiver approved. Ready to send'
    }

    if (pendingReceiver) {
      return 'Receiver requested access. Approval needed'
    }

    if (session && status === 'waiting') {
      return 'Waiting for receiver to click connect'
    }

    return 'Generate a share link to start'
  }, [pendingReceiver, session, status])

  useEffect(() => {
    if (!shouldWarnBeforeClose) {
      return
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [shouldWarnBeforeClose])

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

  useEffect(() => {
    if (!session || status === 'transferring') {
      return
    }

    const intervalId = window.setInterval(() => {
      const request = getPendingReceiverRequest(session.sessionId)
      if (!request) {
        if (pendingReceiver) {
          setPendingReceiver(null)
        }
        return
      }

      if (pendingReceiver && pendingReceiver.requestId === request.requestId) {
        return
      }

      setPendingReceiver(request)
      setConnection(null)
      setStatus('waiting')
      setErrorMessage('')
      setNoticeMessage('Receiver pressed Connect. Approve or reject first.')
    }, 320)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [pendingReceiver, session, status])

  useEffect(() => {
    if (!session) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (!isTransferCompleted(session.sessionId)) {
        return
      }

      setProgress(100)
      setStatus((current) => {
        if (current === 'error') {
          return current
        }

        return 'done'
      })
      setNoticeMessage('Receiver finished downloading the file.')
    }, 360)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [session])

  const handleCreateSession = async (): Promise<void> => {
    setErrorMessage('')
    setNoticeMessage('')
    setProgress(0)
    setCopyState('idle')

    const nextSession = createSession()
    if (file) {
      publishPendingFileMeta(nextSession.sessionId, file)
    }
    setSession(nextSession)
    setConnection(null)
    setPendingReceiver(null)
    setStatus('waiting')

    try {
      const generatedKeys = await generateECDHKeyPair()
      console.log('Session secured! Generated keys for Sender:', generatedKeys)
    } catch (err) {
      console.error('Failed to generate keys for session', err)
    }
  }

  const handleApproveReceiver = async (): Promise<void> => {
    if (!session || !pendingReceiver) {
      return
    }

    const receiverLabel = pendingReceiver.receiverLabel
    setErrorMessage('')

    try {
      const senderConnection = await approveReceiverRequest(session.sessionId, pendingReceiver.requestId)
      setConnection(senderConnection)
      setPendingReceiver(null)
      setStatus('connected')
      setProgress((current) => {
        return Math.max(current, 66)
      })
      setNoticeMessage(`${receiverLabel} approved. Ready to send.`)
    } catch {
      setPendingReceiver(null)
      setConnection(null)
      setStatus('waiting')
      setErrorMessage('')
      setNoticeMessage('Approval request expired. Ask receiver to press Connect again.')
    }
  }

  const handleRejectReceiver = async (): Promise<void> => {
    if (!session || !pendingReceiver) {
      return
    }

    const receiverLabel = pendingReceiver.receiverLabel
    setErrorMessage('')

    try {
      await rejectReceiverRequest(session.sessionId, pendingReceiver.requestId)
      setPendingReceiver(null)
      setConnection(null)
      setStatus('waiting')
      setNoticeMessage(`${receiverLabel} rejected. Waiting for another receiver request.`)
    } catch {
      setStatus('error')
      setErrorMessage('Could not reject receiver request cleanly. Regenerate the session link.')
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!file || !connection) {
      return
    }

    setErrorMessage('')
    setNoticeMessage('')
    setStatus('transferring')

    try {
      await sendFile(connection, file, (nextProgress) => {
        setProgress(nextProgress)
      })

      setProgress(90)
      setStatus('connected')
      setNoticeMessage('Upload complete. Waiting for receiver download confirmation.')
    } catch {
      setStatus('error')
      setErrorMessage('Transfer failed. Generate a new session and retry.')
    }
  }

  const handleCopyLink = async (): Promise<void> => {
    if (!session) {
      return
    }

    try {
      await navigator.clipboard.writeText(session.shareUrl)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const canGenerate = status !== 'transferring'
  const canSend = Boolean(file && connection && status !== 'transferring' && !pendingReceiver && progress < 90)

  return (
    <section className="beam-card">
      <ConfettiBurst active={showConfetti} />

      <header className="card-header card-header--compact">
        <StatusPill status={status} />
      </header>

      <Dropzone
        file={file}
        onFileSelected={(nextFile) => {
          setFile(nextFile)
          setProgress(0)
          setErrorMessage('')
          setNoticeMessage('')

          if (session) {
            publishPendingFileMeta(session.sessionId, nextFile)
          }

          if (connection) {
            setStatus('connected')
            return
          }

          if (session) {
            setStatus('waiting')
            return
          }

          setStatus('idle')
        }}
      />

      <div className="action-row action-row--sender">
        <button className="btn btn-primary" type="button" onClick={handleCreateSession} disabled={!canGenerate}>
          {session ? 'Regenerate link' : 'Generate share link'}
        </button>
        <button className="btn btn-secondary" type="button" onClick={handleSend} disabled={!canSend}>
          Send
        </button>
      </div>

      {pendingReceiver && (
        <div className="request-modal-backdrop" role="presentation">
          <div className="request-modal" role="dialog" aria-modal="true" aria-labelledby="incoming-request-title">
            <div className="request-head">
              <strong id="incoming-request-title">Incoming receiver request</strong>
              <span className="request-alert-chip">Action required</span>
            </div>
            <div className="request-head">
              <span>{pendingReceiver.receiverLabel}</span>
            </div>
            <p className="request-note">Receiver clicked Connect. Approve before the receiver can fully connect.</p>
            <div className="action-row action-row--request">
              <button className="btn btn-primary" type="button" onClick={handleApproveReceiver}>
                Approve receiver
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleRejectReceiver}>
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {session && (
        <div className="share-box">
          <div className="share-head">
            <strong>Share link</strong>
            <span>Session: {session.sessionId}</span>
          </div>
          <div className="share-actions">
            <input className="share-input" value={session.shareUrl} readOnly />
            <button className="btn btn-ghost" type="button" onClick={handleCopyLink}>
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
          </div>
          {copyState === 'failed' && (
            <p className="message message--error">Clipboard is unavailable. Copy the link manually.</p>
          )}
          <p className="message message--warning">
            Use Beam responsibly: do not share illegal or harmful content. Share the link only through trusted
            communication channels.
          </p>
        </div>
      )}

      {session && <ProgressBar value={stageProgress} label={stageLabel} />}

      {shouldWarnBeforeClose && (
        <p className="message message--warning transfer-alert">Do not close this tab while the transfer is active.</p>
      )}
      {status === 'waiting' && !pendingReceiver && (
        <p className="message">Waiting for receiver connection request...</p>
      )}
      {status === 'connected' && progress < 90 && <p className="message message--success">Receiver connected. Press Send.</p>}
      {status === 'connected' && progress >= 90 && (
        <p className="message message--success">Upload sent. Waiting for receiver to finish download.</p>
      )}
      {noticeMessage && status !== 'error' && <p className="message">{noticeMessage}</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default SenderView
