import { useState } from 'react'
import Dropzone from '../components/Dropzone'
import ProgressBar from '../components/ProgressBar'
import StatusPill from '../components/StatusPill'
import { createSession, sendFile, waitForReceiver } from '../lib/mockTransfer'
import { type SessionInfo, type TransferConnection, type TransferStatus } from '../lib/transferTypes'

const SenderView = () => {
  const [file, setFile] = useState<File | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [connection, setConnection] = useState<TransferConnection | null>(null)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const handleCreateSession = async (): Promise<void> => {
    setErrorMessage('')
    setProgress(0)
    setCopyState('idle')

    const nextSession = createSession()
    setSession(nextSession)
    setConnection(null)
    setStatus('waiting')

    try {
      // TODO: Wait for PeerJS/WebRTC data channel events instead of a mock timeout.
      const senderConnection = await waitForReceiver(nextSession.sessionId)
      setConnection(senderConnection)
      setStatus('connected')
    } catch {
      setStatus('error')
      setErrorMessage('Receiver connection failed. Try generating a new link.')
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!file || !connection) {
      return
    }

    setErrorMessage('')
    setStatus('transferring')

    try {
      await sendFile(connection, file, (nextProgress) => {
        setProgress(nextProgress)
      })

      setStatus('done')
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

  const canGenerate = status !== 'waiting' && status !== 'transferring'
  const canSend = Boolean(file && connection && status !== 'transferring')

  return (
    <section className="beam-card">
      <header className="card-header card-header--compact">
        <StatusPill status={status} />
      </header>

      <Dropzone
        file={file}
        onFileSelected={(nextFile) => {
          setFile(nextFile)
          setProgress(0)
          setErrorMessage('')

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

      <div className="action-row">
        <button className="btn btn-primary" type="button" onClick={handleCreateSession} disabled={!canGenerate}>
          {session ? 'Regenerate link' : 'Generate share link'}
        </button>
        <button className="btn btn-secondary" type="button" onClick={handleSend} disabled={!canSend}>
          Send
        </button>
      </div>

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
        </div>
      )}

      {(status === 'transferring' || status === 'done') && (
        <ProgressBar value={progress} label="Upload progress" />
      )}

      {status === 'waiting' && <p className="message">Waiting for receiver connection...</p>}
      {status === 'connected' && <p className="message message--success">Receiver connected. Press Send.</p>}
      {errorMessage && <p className="message message--error">{errorMessage}</p>}
    </section>
  )
}

export default SenderView
