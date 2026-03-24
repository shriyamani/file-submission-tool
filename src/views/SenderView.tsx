import { useEffect, useMemo, useState } from 'react'
import Dropzone from '../components/Dropzone'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import {
  approveReceiverRequest,
  createSession,
  deriveSessionKey,
  getDefaultTransferMode,
  initSenderPeer,
  publishPendingFileMeta,
  rejectReceiverRequest,
  sendFile,
  waitForReceiverFileAcceptance,
} from '../lib/transferClient'
import {
  type ReceiverApprovalRequest,
  type SessionInfo,
  type TransferConnection,
  type TransferStatus,
} from '../lib/transferTypes'
import { generateECDHKeyPair } from '../utils/crypto'

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
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null)
  const [isPreparingSession, setIsPreparingSession] = useState(false)
  const [isAwaitingReceiverDecision, setIsAwaitingReceiverDecision] = useState(false)
  const [requestAction, setRequestAction] = useState<'approve' | 'reject' | null>(null)

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
      if (isAwaitingReceiverDecision) {
        return 72
      }

      return Math.max(66, Math.round(progress))
    }

    if (pendingReceiver) {
      return 42
    }

    if (session && status === 'waiting') {
      return 22
    }

    return 0
  }, [isAwaitingReceiverDecision, pendingReceiver, progress, session, status])

  const stageLabel = useMemo(() => {
    if (status === 'done') {
      return 'Upload complete'
    }

    if (status === 'transferring') {
      return 'Upload progress'
    }

    if (status === 'connected') {
      if (isAwaitingReceiverDecision) {
        return 'Waiting for receiver to approve the file'
      }

      if (progress >= 90) {
        return 'Upload sent. Waiting for receiver download confirmation'
      }

      if (file) {
        return 'File selected. Press Send'
      }

      return 'Receiver approved. Choose a file to send'
    }

    if (pendingReceiver) {
      return 'Receiver requested access. Approval required'
    }

    if (session && status === 'waiting') {
      return 'Share the link and wait for a receiver request'
    }

    return 'Generate a share link to start'
  }, [file, isAwaitingReceiverDecision, pendingReceiver, progress, session, status])

  const formatSetupErrorMessage = (error: unknown): string => {
    if (!(error instanceof Error)) {
      return 'Failed to initialize the sender session. No share link was created.'
    }

    const normalized = error.message.toLowerCase()

    if (normalized.includes('network') || normalized.includes('server')) {
      return 'Could not reach the connection server. Check internet access, then try again.'
    }

    if (normalized.includes('ssl') || normalized.includes('certificate')) {
      return 'The browser rejected the local HTTPS certificate. Open the Beam page directly and accept the certificate warning first.'
    }

    return 'Failed to initialize the sender session. No share link was created.'
  }

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

  const handleCreateSession = async (): Promise<void> => {
    setIsPreparingSession(true)
    setErrorMessage('')
    setNoticeMessage('Preparing sender session...')
    setProgress(0)
    setCopyState('idle')
    setFile(null)
    setKeyPair(null)
    setSession(null)
    setConnection(null)
    setPendingReceiver(null)
    setIsAwaitingReceiverDecision(false)
    setRequestAction(null)
    setStatus('idle')

    const nextSession = createSession(getDefaultTransferMode(), `${window.location.origin}${window.location.pathname}`)

    try {
      const generatedKeys = await generateECDHKeyPair()
      await initSenderPeer(nextSession.mode, nextSession.sessionId, (request) => {
        setPendingReceiver(request)
        setConnection(null)
        setStatus('waiting')
        setErrorMessage('')
        setNoticeMessage('')
      })

      setKeyPair(generatedKeys)
      setSession(nextSession)
      setStatus('waiting')
      setNoticeMessage('')
    } catch (err) {
      console.error('Failed to initialize sender session', err)
      setKeyPair(null)
      setSession(null)
      setConnection(null)
      setPendingReceiver(null)
      setStatus('error')
      setIsAwaitingReceiverDecision(false)
      setRequestAction(null)
      setNoticeMessage('')
      setErrorMessage(formatSetupErrorMessage(err))
    } finally {
      setIsPreparingSession(false)
    }
  }

  const handleApproveReceiver = async (): Promise<void> => {
    if (!session || !pendingReceiver) {
      return
    }

    const receiverLabel = pendingReceiver.receiverLabel
    setErrorMessage('')
    setRequestAction('approve')

    try {
      const senderConnection = await approveReceiverRequest(session.mode, session.sessionId, pendingReceiver.requestId)
      setConnection(senderConnection)
      setPendingReceiver(null)
      setIsAwaitingReceiverDecision(false)
      setStatus('connected')
      setProgress((current) => {
        return Math.max(current, 66)
      })
      setNoticeMessage(`${receiverLabel} approved. Choose a file and send it.`)
    } catch (error) {
      setConnection(null)
      setStatus('waiting')
      setNoticeMessage('')
      setErrorMessage(
        error instanceof Error ? `${error.message} Wait a moment and try Approve again.` : 'Approval did not complete.',
      )
    } finally {
      setRequestAction(null)
    }
  }

  const handleRejectReceiver = async (): Promise<void> => {
    if (!session || !pendingReceiver) {
      return
    }

    const receiverLabel = pendingReceiver.receiverLabel
    setErrorMessage('')
    setRequestAction('reject')

    try {
      await rejectReceiverRequest(session.mode, session.sessionId, pendingReceiver.requestId)
      setCopyState('idle')
      setFile(null)
      setKeyPair(null)
      setSession(null)
      setPendingReceiver(null)
      setConnection(null)
      setProgress(0)
      setIsAwaitingReceiverDecision(false)
      setRequestAction(null)
      setStatus('idle')
      setNoticeMessage(`${receiverLabel} rejected. Generate a new share link to start again.`)
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof Error ? `${error.message} Try Reject again.` : 'Could not reject receiver request cleanly.',
      )
    } finally {
      setRequestAction(null)
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!file || !connection || !keyPair || !session) {
      return
    }

    const formatSendErrorMessage = (error: unknown): string => {
      if (!(error instanceof Error)) {
        return 'Transfer failed. Ask the receiver to approve the file, then try again.'
      }

      const normalized = error.message.toLowerCase()

      if (normalized.includes('receiver declined')) {
        return 'Receiver declined the file. Ask them to accept the popup, then press Send again.'
      }

      if (normalized.includes('timed out waiting for receiver file approval')) {
        return 'Receiver did not approve the file in time. Ask them to accept the popup, then press Send again.'
      }

      if (normalized.includes('public key')) {
        return 'Receiver did not finish the receive step. Ask them to accept the popup, then press Send again.'
      }

      if (normalized.includes('no active receiver connection') || normalized.includes('connection is not active')) {
        return 'The receiver connection was lost. Generate a new link and reconnect.'
      }

      return `Transfer failed. ${error.message}`
    }

    setErrorMessage('')
    setNoticeMessage('')
    setIsAwaitingReceiverDecision(true)

    try {
      const receiverApproval = waitForReceiverFileAcceptance(session.mode)
      publishPendingFileMeta(session.mode, session.sessionId, file)
      await receiverApproval

      setIsAwaitingReceiverDecision(false)
      setNoticeMessage('')
      setStatus('transferring')

      const sessionKey = await deriveSessionKey(
        session.mode,
        session.sessionId,
        'sender',
        keyPair.privateKey,
        keyPair.publicKey,
      )

      if (!sessionKey) {
        throw new Error('Failed to derive session key.')
      }

      await sendFile(session.mode, connection, file, sessionKey, (nextProgress: number) => {
        setProgress(nextProgress)
      })

      setProgress(100)
      setStatus('done')
      setNoticeMessage('File sent successfully. Receiver can now download it.')
    } catch (error) {
      publishPendingFileMeta(session.mode, session.sessionId, null)
      setIsAwaitingReceiverDecision(false)
      setStatus('connected')
      setProgress((current) => {
        return current >= 90 ? 66 : Math.max(current, 66)
      })
      setNoticeMessage('')
      setErrorMessage(formatSendErrorMessage(error))
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

  const canGenerate = status !== 'transferring' && !isPreparingSession
  const canSend = Boolean(
    file && connection && status !== 'transferring' && !pendingReceiver && !isAwaitingReceiverDecision && progress < 90,
  )
  const shouldShowDropzone = Boolean(connection || file)
  const shouldDisableDropzone = status === 'transferring' || status === 'done' || isAwaitingReceiverDecision

  return (
    <section className="beam-card">
      <header className="card-header card-header--compact">
        <StatusPill status={status} />
      </header>

      {!session && (
        <>
          <div className="share-box">
            <div className="share-head">
              <strong>Start transfer</strong>
              <span>Step 1</span>
            </div>
            <p className="message">Generate a share link first, then wait for the receiver to request access.</p>
          </div>
          <div className="action-row action-row--center">
            <button className="btn btn-primary" type="button" onClick={handleCreateSession} disabled={!canGenerate}>
              {isPreparingSession ? 'Preparing link...' : 'Generate share link'}
            </button>
          </div>
        </>
      )}

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
            <p className="request-note">Receiver clicked Connect. Approve or reject before the sender can continue.</p>
            <div className="action-row action-row--request">
              <button
                className="btn btn-primary"
                type="button"
                onClick={handleApproveReceiver}
                disabled={requestAction !== null}
              >
                {requestAction === 'approve' ? 'Approving...' : 'Approve receiver'}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={handleRejectReceiver}
                disabled={requestAction !== null}
              >
                {requestAction === 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
            {requestAction && <p className="request-note">Finalizing receiver request...</p>}
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
          {((!connection && !pendingReceiver) || status === 'done' || status === 'error') && (
            <div className="action-row">
              <button className="btn btn-ghost" type="button" onClick={handleCreateSession} disabled={!canGenerate}>
                {isPreparingSession ? 'Preparing link...' : 'Generate new link'}
              </button>
            </div>
          )}
        </div>
      )}

      {shouldShowDropzone && (
        <>
          <Dropzone
            file={file}
            disabled={shouldDisableDropzone}
            onFileSelected={(nextFile) => {
              setFile(nextFile)
              setErrorMessage('')
              setNoticeMessage('')
              setStatus('connected')
              setProgress((current) => {
                return current >= 90 ? 66 : current
              })
            }}
          />
          <div className="action-row action-row--center">
            <button className="btn btn-secondary" type="button" onClick={handleSend} disabled={!canSend}>
              Send
            </button>
          </div>
        </>
      )}

      {session && <ProgressBar value={stageProgress} label={stageLabel} />}

      {shouldWarnBeforeClose && (
        <p className="message message--warning transfer-alert">Do not close this tab while the transfer is active.</p>
      )}
      {status === 'waiting' && !pendingReceiver && (
        <p className="message">Waiting for receiver connection request...</p>
      )}
      {status === 'connected' && !file && (
        <p className="message message--success">Receiver approved. Choose a file to continue.</p>
      )}
      {status === 'connected' && isAwaitingReceiverDecision && (
        <p className="message message--success">Waiting for receiver to approve the incoming file.</p>
      )}
      {status === 'connected' && file && progress < 90 && !isAwaitingReceiverDecision && (
        <p className="message message--success">File ready. Press Send.</p>
      )}
      {status === 'connected' && progress >= 90 && (
        <p className="message message--success">Upload sent. Waiting for receiver to finish download.</p>
      )}
      {noticeMessage && status !== 'error' && <p className="message">{noticeMessage}</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default SenderView
