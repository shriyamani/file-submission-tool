import {
  type ProgressCallback,
  type ReceivedFile,
  type SessionInfo,
  type TransferConnection,
} from './transferTypes'

interface MockSession {
  receiverConnected: boolean
  pendingFile?: File
}

const mockSessions = new Map<string, MockSession>()

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

const ensureSession = (sessionId: string): MockSession => {
  const existing = mockSessions.get(sessionId)
  if (existing) {
    return existing
  }

  const session: MockSession = { receiverConnected: false }
  mockSessions.set(sessionId, session)
  return session
}

const createRandomId = (): string => {
  const value = Math.floor(Math.random() * 10 ** 8)
  return `beam-${value.toString(36)}`
}

const emitProgress = async (onProgress: ProgressCallback, durationMs: number): Promise<void> => {
  const steps = 20
  onProgress(0)

  for (let step = 1; step <= steps; step += 1) {
    await delay(durationMs / steps)
    onProgress(Math.round((step / steps) * 100))
  }
}

export const createSession = (): SessionInfo => {
  const sessionId = createRandomId()
  const session = ensureSession(sessionId)
  session.receiverConnected = false

  const shareUrl = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`

  return {
    sessionId,
    shareUrl,
    createdAt: Date.now(),
  }
}

export const waitForReceiver = async (sessionId: string): Promise<TransferConnection> => {
  const session = ensureSession(sessionId)

  // TODO: Replace with PeerJS/WebRTC host signaling + data-channel readiness checks.
  await delay(1400)
  session.receiverConnected = true

  return {
    id: `sender-${sessionId}`,
    sessionId,
    role: 'sender',
    connected: true,
  }
}

export const connectAsReceiver = async (sessionId: string): Promise<TransferConnection> => {
  const session = ensureSession(sessionId)

  // TODO: Replace with PeerJS/WebRTC connection to sender by sessionId.
  await delay(900)
  session.receiverConnected = true

  return {
    id: `receiver-${sessionId}`,
    sessionId,
    role: 'receiver',
    connected: true,
  }
}

export const sendFile = async (
  connection: TransferConnection,
  file: File,
  onProgress: ProgressCallback,
): Promise<void> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  const session = ensureSession(connection.sessionId)

  // TODO: Replace with chunked PeerJS data-channel writes + optional Web Crypto encryption.
  await emitProgress(onProgress, 2200)
  session.pendingFile = file
}

export const receiveFile = async (
  connection: TransferConnection,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  const session = ensureSession(connection.sessionId)

  // TODO: Replace with streaming chunk reads and Web Crypto decryption.
  await emitProgress(onProgress, 2200)

  if (session.pendingFile) {
    const file = session.pendingFile

    return {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
    }
  }

  const fallbackBlob = new Blob(
    [
      'Beam mock mode: no sender file is available in this browser context. Connect both flows in one session for a full stubbed demo.',
    ],
    { type: 'text/plain' },
  )

  return {
    name: 'beam-demo.txt',
    size: fallbackBlob.size,
    type: fallbackBlob.type,
    blob: fallbackBlob,
  }
}

export const deriveSessionKey = async (sessionId: string): Promise<CryptoKey | null> => {
  void sessionId

  // TODO: Use Web Crypto (ECDH/AES-GCM) to derive a per-session key.
  return null
}

export const encryptChunk = async (
  payload: ArrayBuffer,
  sessionKey: CryptoKey | null,
): Promise<ArrayBuffer> => {
  void sessionKey

  // TODO: Use SubtleCrypto.encrypt when real session keys are enabled.
  return payload
}

export const decryptChunk = async (
  payload: ArrayBuffer,
  sessionKey: CryptoKey | null,
): Promise<ArrayBuffer> => {
  void sessionKey

  // TODO: Use SubtleCrypto.decrypt when real session keys are enabled.
  return payload
}
