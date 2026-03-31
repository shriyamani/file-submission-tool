import { useEffect, useMemo, useState } from 'react'
import ConfettiBurst from '../components/ConfettiBurst'
import Dropzone from '../components/Dropzone'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import {
  approveReceiverRequest,
  createSession,
  initSenderPeer,
  publishPendingFileMeta,
  rejectReceiverRequest,
  sendFile,
  deriveSessionKey,
  subscribeToReceiverReady,
} from '../lib/peerTransfer'
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
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null)
  const [receiverReady, setReceiverReady] = useState(false)
  const [showReadyPrompt, setShowReadyPrompt] = useState(false)

  const shouldWarnBeforeClose = Boolean(
    session && (status === 'waiting' || status === 'connected' || status === 'transferring' || pendingReceiver),
  )
  const shouldShowProgress = Boolean(session && status !== 'idle' && (status !== 'done' || showConfetti))

  const stageProgress = useMemo(() => {
    if (status === 'done') {
      return 100
    }

    if (status === 'transferring') {
      return progress
    }

    if (status === 'connected') {
      if (receiverReady) {
        return Math.max(82, Math.round(progress))
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
  }, [pendingReceiver, progress, receiverReady, session, status])

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

      if (receiverReady) {
        return 'Receiver confirmed Receive file. Ready to send'
      }

      return 'Waiting for receiver to confirm Receive file'
    }

    if (pendingReceiver) {
      return 'Receiver requested access. Approval needed'
    }

    if (session && status === 'waiting') {
      return 'Waiting for receiver to click connect'
    }

    return 'Generate a share link to start'
  }, [pendingReceiver, progress, receiverReady, session, status])

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
    if (status !== 'connected' || !receiverReady) {
      return
    }

    setShowReadyPrompt(true)

    if (!file) {
      setNoticeMessage('Receiver is ready, but you still need to choose a file before Send can be enabled.')
      return
    }

    if (!keyPair) {
      setNoticeMessage('Receiver is ready. Beam is still preparing secure send on this page.')
      return
    }

    setNoticeMessage('')
  }, [file, keyPair, receiverReady, status])

  useEffect(() => {
    if (!session || status !== 'connected') {
      return
    }

    return subscribeToReceiverReady(() => {
      setReceiverReady(true)
    })
  }, [session, status])

  const handleCreateSession = async (): Promise<void> => {
    setErrorMessage('')
    setNoticeMessage('')
    setProgress(0)
    setCopyState('idle')
    setReceiverReady(false)
    setShowReadyPrompt(false)

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
      setKeyPair(generatedKeys)
    } catch (err) {
      console.error('Failed to generate keys for session', err)
    }

    try {
      await initSenderPeer(nextSession.sessionId, (request) => {
        setPendingReceiver(request)
        setConnection(null)
        setStatus('waiting')
        setReceiverReady(false)
        setShowReadyPrompt(false)
        setErrorMessage('')
        setNoticeMessage('Receiver pressed Connect. Approve or reject first.')
      })
    } catch (err) {
      setStatus('error')
      setErrorMessage('Failed to initialize session. Please try again.')
    }
  }

  const handleApproveReceiver = async (): Promise<void> => {
    if (!session || !pendingReceiver) {
      return
    }

    setErrorMessage('')

    try {
      const senderConnection = await approveReceiverRequest(session.sessionId, pendingReceiver.requestId)
      setConnection(senderConnection)
      setPendingReceiver(null)
      setStatus('connected')
      setReceiverReady(false)
      setShowReadyPrompt(false)
      setProgress((current) => {
        return Math.max(current, 66)
      })
      setNoticeMessage('')
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
      setReceiverReady(false)
      setShowReadyPrompt(false)
      setNoticeMessage(`${receiverLabel} rejected. Waiting for another receiver request.`)
    } catch {
      setStatus('error')
      setErrorMessage('Could not reject receiver request cleanly. Regenerate the session link.')
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!file || !session) {
      setErrorMessage('Choose a file and generate a share link first.')
      return
    }

    if (!receiverReady || status !== 'connected' || pendingReceiver) {
      setErrorMessage('Wait for the receiver to press Receive file before sending.')
      return
    }

    if (!keyPair) {
      setErrorMessage('Security setup is still loading. Wait a moment and try Send again.')
      return
    }

    const activeConnection: TransferConnection = connection ?? {
      id: `sender-${session.sessionId}`,
      sessionId: session.sessionId,
      role: 'sender',
      connected: true,
    }

    setErrorMessage('')
    setNoticeMessage('')
    setStatus('transferring')
    setShowReadyPrompt(false)
    setConnection(activeConnection)

    try {
      const sessionKey = await deriveSessionKey(
        session.sessionId,
        'sender',
        keyPair.privateKey,
        keyPair.publicKey,
      )

      if (!sessionKey) {
        throw new Error('Failed to derive session key.')
      }

      await sendFile(activeConnection, file, sessionKey, (nextProgress: number) => {
        setProgress(nextProgress)
      })

      setProgress(100)
      setStatus('done')
      setReceiverReady(false)
      setShowReadyPrompt(false)
      setNoticeMessage('')
    } catch {
      setStatus('error')
      setReceiverReady(false)
      setShowReadyPrompt(false)
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

  const canGenerate = Boolean(file) && status !== 'transferring'
  const canSend = Boolean(file && session && keyPair && receiverReady && status === 'connected' && !pendingReceiver && progress < 90)

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
            setReceiverReady(false)
            setShowReadyPrompt(false)
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
        onFileRemoved={() => {
          setFile(null)
          setProgress(0)
          setErrorMessage('')
          setReceiverReady(false)
          setShowReadyPrompt(false)
          setNoticeMessage('File removed. Choose another file before sending.')

          if (session) {
            publishPendingFileMeta(session.sessionId, null)
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

      {showReadyPrompt && status === 'connected' && receiverReady && !pendingReceiver && (
        <div className="request-modal-backdrop" role="presentation">
          <div className="request-modal request-modal--info" role="dialog" aria-modal="true" aria-labelledby="receiver-ready-title">
            <div className="request-head request-head--neutral">
              <strong id="receiver-ready-title">
                {canSend ? 'Receiver is ready to receive the file' : 'Receiver is ready'}
              </strong>
              <span className="request-alert-chip request-alert-chip--info">
                {canSend ? 'Send enabled' : 'Action needed'}
              </span>
            </div>
            <p className="request-note request-note--neutral">
              {canSend
                ? 'Click Send on the transfer page when you are ready.'
                : !file
                  ? 'The receiver is waiting. Choose a file on this page first, then click Send on the transfer page.'
                  : 'The receiver is waiting. Beam is still preparing secure send on this page.'}
            </p>
            <div className="action-row action-row--request">
              <button className="btn btn-primary" type="button" onClick={() => setShowReadyPrompt(false)}>
                OK
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

      {shouldShowProgress && <ProgressBar value={stageProgress} label={stageLabel} />}

      {shouldWarnBeforeClose && (
        <p className="message message--warning transfer-alert">Do not close this tab while the transfer is active.</p>
      )}
      {status === 'connected' && !receiverReady && (
        <p className="message">Receiver approved. Waiting for them to press Receive file.</p>
      )}
      {status === 'connected' && receiverReady && progress < 90 && (
        <p className="message message--success">Receiver is ready. Press Send now.</p>
      )}
      {status === 'connected' && receiverReady && !file && (
        <p className="message message--error transfer-alert transfer-alert--error">
          Choose a file on the sender page. Send stays locked until a file is selected.
        </p>
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
