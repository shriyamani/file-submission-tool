import { encryptChunk as secureEncryptChunk, decryptChunk as secureDecryptChunk } from '../utils/crypto.js'

import {
  type ProgressCallback,
  type ReceivedFile,
  type ReceiverApprovalRequest,
  type SessionInfo,
  type TransferConnection,
} from './transferTypes'

type RequestState = 'pending' | 'approved' | 'rejected'

interface PendingReceiverRequest extends ReceiverApprovalRequest {
  state: RequestState
}

interface SentFileMeta {
  name: string
  size: number
  type: string
  sentAt: number
}

interface MockSession {
  receiverConnected: boolean
  pendingFile?: File
  pendingFileMeta: SentFileMeta | null
  receiverRequest: PendingReceiverRequest | null
  transferCompleted: boolean
  encryptedChunks?: ArrayBuffer[]
  dummyKey?: CryptoKey
}

interface FileAvailabilityResult {
  file?: File
  meta?: SentFileMeta
}

const mockSessions = new Map<string, MockSession>()

const REQUEST_POLL_INTERVAL_MS = 220
const REQUEST_APPROVAL_TIMEOUT_MS = 90_000
const FILE_POLL_INTERVAL_MS = 280
const FILE_AVAILABILITY_TIMEOUT_MS = 60_000
const STORAGE_KEY_PREFIX = 'beam-mock-session:'

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

  const session: MockSession = {
    receiverConnected: false,
    pendingFileMeta: null,
    receiverRequest: null,
    transferCompleted: false,
    encryptedChunks: [],
  }
  mockSessions.set(sessionId, session)
  return session
}

const getStorageKey = (sessionId: string): string => {
  return `${STORAGE_KEY_PREFIX}${sessionId}`
}

const createRandomId = (): string => {
  const value = Math.floor(Math.random() * 10 ** 8)
  return `beam-${value.toString(36)}`
}

const createReceiverLabel = (): string => {
  const value = Math.floor(1000 + Math.random() * 9000)
  return `receiver-${value}`
}

const asPublicRequest = (request: PendingReceiverRequest): ReceiverApprovalRequest => {
  return {
    requestId: request.requestId,
    receiverLabel: request.receiverLabel,
    requestedAt: request.requestedAt,
  }
}

const isValidRequestState = (state: unknown): state is RequestState => {
  return state === 'pending' || state === 'approved' || state === 'rejected'
}

const isValidSentFileMeta = (meta: unknown): meta is SentFileMeta => {
  if (!meta || typeof meta !== 'object') {
    return false
  }

  const candidate = meta as {
    name?: unknown
    size?: unknown
    type?: unknown
    sentAt?: unknown
  }

  return (
    typeof candidate.name === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.type === 'string' &&
    typeof candidate.sentAt === 'number'
  )
}

const hydrateSessionFromStorage = (sessionId: string, session: MockSession): void => {
  try {
    const raw = window.localStorage.getItem(getStorageKey(sessionId))
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw) as {
      receiverConnected?: unknown
      receiverRequest?: unknown
      pendingFileMeta?: unknown
      transferCompleted?: unknown
    }

    if (typeof parsed.receiverConnected === 'boolean') {
      session.receiverConnected = parsed.receiverConnected
    }

    if (typeof parsed.transferCompleted === 'boolean') {
      session.transferCompleted = parsed.transferCompleted
    }

    if (isValidSentFileMeta(parsed.pendingFileMeta)) {
      session.pendingFileMeta = parsed.pendingFileMeta
    } else {
      session.pendingFileMeta = null
    }

    const maybeRequest = parsed.receiverRequest
    if (!maybeRequest || typeof maybeRequest !== 'object') {
      session.receiverRequest = null
      return
    }

    const request = maybeRequest as {
      requestId?: unknown
      receiverLabel?: unknown
      requestedAt?: unknown
      state?: unknown
    }

    if (
      typeof request.requestId === 'string' &&
      typeof request.receiverLabel === 'string' &&
      typeof request.requestedAt === 'number' &&
      isValidRequestState(request.state)
    ) {
      session.receiverRequest = {
        requestId: request.requestId,
        receiverLabel: request.receiverLabel,
        requestedAt: request.requestedAt,
        state: request.state,
      }
      return
    }

    session.receiverRequest = null
  } catch {
  }
}

const persistSessionToStorage = (sessionId: string, session: MockSession): void => {
  try {
    window.localStorage.setItem(
      getStorageKey(sessionId),
      JSON.stringify({
        receiverConnected: session.receiverConnected,
        receiverRequest: session.receiverRequest,
        pendingFileMeta: session.pendingFileMeta,
        transferCompleted: session.transferCompleted,
      }),
    )
  } catch {
  }
}

const getSession = (sessionId: string): MockSession => {
  const session = ensureSession(sessionId)
  hydrateSessionFromStorage(sessionId, session)
  return session
}

const emitProgress = async (onProgress: ProgressCallback, durationMs: number): Promise<void> => {
  const steps = 20
  onProgress(0)

  for (let step = 1; step <= steps; step += 1) {
    await delay(durationMs / steps)
    onProgress(Math.round((step / steps) * 100))
  }
}

const waitForFileAvailability = async (
  sessionId: string,
  timeoutMs: number,
  onProgress?: ProgressCallback,
): Promise<FileAvailabilityResult | null> => {
  const session = getSession(sessionId)
  const timeoutAt = Date.now() + timeoutMs
  let waitingProgress = 2

  while (Date.now() < timeoutAt) {
    hydrateSessionFromStorage(sessionId, session)

    if (session.pendingFile) {
      return { file: session.pendingFile }
    }

    if (session.pendingFileMeta) {
      return { meta: session.pendingFileMeta }
    }

    if (onProgress) {
      waitingProgress = Math.min(waitingProgress + 1, 24)
      onProgress(waitingProgress)
    }

    await delay(FILE_POLL_INTERVAL_MS)
  }

  return null
}

export const createSession = (): SessionInfo => {
  const sessionId = createRandomId()
  const session = ensureSession(sessionId)
  session.receiverConnected = false
  session.pendingFile = undefined
  session.pendingFileMeta = null
  session.receiverRequest = null
  session.transferCompleted = false
  persistSessionToStorage(sessionId, session)

  const shareUrl = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`

  return {
    sessionId,
    shareUrl,
    createdAt: Date.now(),
  }
}

export const isTransferCompleted = (sessionId: string): boolean => {
  const session = getSession(sessionId)
  return session.transferCompleted
}

export const getPendingReceiverRequest = (sessionId: string): ReceiverApprovalRequest | null => {
  const session = getSession(sessionId)
  const request = session.receiverRequest

  if (!request || request.state !== 'pending') {
    return null
  }

  return asPublicRequest(request)
}

export const requestReceiverConnection = async (sessionId: string): Promise<ReceiverApprovalRequest> => {
  const session = getSession(sessionId)

  await delay(420)

  const request: PendingReceiverRequest = {
    requestId: createRandomId(),
    receiverLabel: createReceiverLabel(),
    requestedAt: Date.now(),
    state: 'pending',
  }

  session.receiverConnected = false
  session.receiverRequest = request
  persistSessionToStorage(sessionId, session)

  return asPublicRequest(request)
}

export const approveReceiverRequest = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  const session = getSession(sessionId)
  const request = session.receiverRequest

  const connectedResponse: TransferConnection = {
    id: `sender-${sessionId}`,
    sessionId,
    role: 'sender',
    connected: true,
  }

  if (!request) {
    if (session.receiverConnected) {
      return connectedResponse
    }

    throw new Error('No pending receiver request to approve.')
  }

  if (request.requestId !== requestId && request.state !== 'pending') {
    throw new Error('Receiver request is stale.')
  }

  if (request.state === 'approved') {
    session.receiverConnected = true
    session.receiverRequest = null
    persistSessionToStorage(sessionId, session)
    return connectedResponse
  }

  if (request.state !== 'pending') {
    throw new Error('Receiver request is no longer pending.')
  }

  await delay(320)
  request.state = 'approved'
  session.receiverConnected = true
  session.receiverRequest = null
  persistSessionToStorage(sessionId, session)

  return connectedResponse
}

export const rejectReceiverRequest = async (sessionId: string, requestId: string): Promise<void> => {
  const session = getSession(sessionId)
  const request = session.receiverRequest

  if (!request) {
    return
  }

  if (request.requestId !== requestId && request.state !== 'pending') {
    throw new Error('Receiver request is stale.')
  }

  if (request.state !== 'pending') {
    session.receiverRequest = null
    session.receiverConnected = false
    persistSessionToStorage(sessionId, session)
    return
  }

  await delay(220)
  request.state = 'rejected'
  session.receiverConnected = false
  persistSessionToStorage(sessionId, session)
}

export const waitForSenderApproval = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  const session = getSession(sessionId)
  const timeoutAt = Date.now() + REQUEST_APPROVAL_TIMEOUT_MS

  const receiverConnection: TransferConnection = {
    id: `receiver-${sessionId}`,
    sessionId,
    role: 'receiver',
    connected: true,
  }

  while (Date.now() < timeoutAt) {
    hydrateSessionFromStorage(sessionId, session)
    const request = session.receiverRequest

    if (!request || request.requestId !== requestId) {
      if (session.receiverConnected) {
        return receiverConnection
      }

      await delay(REQUEST_POLL_INTERVAL_MS)
      continue
    }

    if (request.state === 'approved') {
      session.receiverConnected = true
      session.receiverRequest = null
      persistSessionToStorage(sessionId, session)
      return receiverConnection
    }

    if (request.state === 'rejected') {
      session.receiverConnected = false
      session.receiverRequest = null
      persistSessionToStorage(sessionId, session)
      throw new Error('Sender rejected the receiver request.')
    }

    await delay(REQUEST_POLL_INTERVAL_MS)
  }

  if (session.receiverRequest?.requestId === requestId && session.receiverRequest.state === 'pending') {
    session.receiverRequest = null
  }

  session.receiverConnected = false
  persistSessionToStorage(sessionId, session)
  throw new Error('Timed out waiting for sender approval.')
}

export const sendFile = async (
  connection: TransferConnection,
  file: File,
  onProgress: ProgressCallback,
): Promise<void> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  const session = getSession(connection.sessionId)

  if (!session.receiverConnected) {
    throw new Error('Receiver is not connected yet.')
  }

  session.transferCompleted = false
  session.pendingFile = file
  session.pendingFileMeta = {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    sentAt: Date.now(),
  }
  persistSessionToStorage(connection.sessionId, session)

  session.encryptedChunks = [];

  // TODO [Shriya]: Mocking the session key here for now so my encryption 
  // code runs. When you implement the WebRTC key exchange, you'll generate 
  // this shared session key properly using `deriveSessionKey()` instead :)
  const dummyKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  ) as CryptoKey;
  session.dummyKey = dummyKey;

  const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let offset = 0;
  let chunkIndex = 0;

  while (offset < file.size) {
    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE);
    const chunkBuffer = await chunkBlob.arrayBuffer();

    // Encrypt the file chunk before we send it 
    const encryptedBuffer = await encryptChunk(chunkBuffer, dummyKey);

    // TODO [Shriya]: Instead of saving to this mock array, this is where you can send the `encryptedBuffer` over the network using your PeerJS connection
    session.encryptedChunks.push(encryptedBuffer);

    offset += CHUNK_SIZE;
    chunkIndex++;
    onProgress(Math.round((chunkIndex / totalChunks) * 100));

    // Tiny delay to mock network speeds
    await delay(10);
  }

  persistSessionToStorage(connection.sessionId, session)
}

export const receiveFile = async (
  connection: TransferConnection,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  const session = getSession(connection.sessionId)

  if (!session.receiverConnected) {
    throw new Error('Sender approval is required before receiving.')
  }

  onProgress(2)
  const availablePayload = await waitForFileAvailability(connection.sessionId, FILE_AVAILABILITY_TIMEOUT_MS, onProgress)
  if (!availablePayload) {
    throw new Error('Timed out waiting for sender file.')
  }

  let output: ReceivedFile

  // If the mock session contains our encrypted chunks 
  if (session.encryptedChunks && session.encryptedChunks.length > 0 && session.dummyKey) {
    const decryptedBlobs: Blob[] = [];
    let chunkIndex = 0;
    const totalChunks = session.encryptedChunks.length;

    // TODO [Shriya]: For WebRTC, you will be listening for incoming chunks via `peer.on('data')` instead of looping over this mock array. As they arrive, you can feed them to my decrypt method
    for (const encryptedBuffer of session.encryptedChunks) {
      // Decrypt the chunk as it arrives from the network
      const decryptedBuffer = await decryptChunk(encryptedBuffer, session.dummyKey);
      decryptedBlobs.push(new Blob([decryptedBuffer]));

      chunkIndex++;
      onProgress(Math.round((chunkIndex / totalChunks) * 100));
      await delay(10);
    }

    const fileMeta = availablePayload.meta || session.pendingFileMeta!;
    const finalBlob = new Blob(decryptedBlobs, { type: fileMeta.type });

    output = {
      name: fileMeta.name,
      size: finalBlob.size,
      type: fileMeta.type,
      blob: finalBlob,
    }
  } else {
    // Cross-tab mock fallback (localStorage doesn't support ArrayBuffers that well)
    await emitProgress(onProgress, 2200)
    const fileMeta = availablePayload.meta as SentFileMeta
    const fallbackBlob = new Blob(
      [
        `Beam mock transfer copy.\nOriginal file: ${fileMeta.name}\nOriginal size: ${fileMeta.size} bytes\nThis mock copy is generated for cross-tab demo mode.`,
      ],
      { type: 'text/plain' },
    )
    output = {
      name: fileMeta.name,
      size: fallbackBlob.size,
      type: fallbackBlob.type,
      blob: fallbackBlob,
    }
  }

  session.transferCompleted = true
  persistSessionToStorage(connection.sessionId, session)

  return output
}

export const deriveSessionKey = async (sessionId: string): Promise<CryptoKey | null> => {
  void sessionId

  // TODO: Use Web Crypto (ECDH/AES-GCM) to derive a per-session key
  return null
}

export const encryptChunk = async (
  payload: ArrayBuffer,
  sessionKey: CryptoKey | null,
): Promise<ArrayBuffer> => {
  if (!sessionKey) return payload
  return await secureEncryptChunk(payload, sessionKey)
}

export const decryptChunk = async (
  payload: ArrayBuffer,
  sessionKey: CryptoKey | null,
): Promise<ArrayBuffer> => {
  if (!sessionKey) return payload
  return await secureDecryptChunk(payload, sessionKey)
}
