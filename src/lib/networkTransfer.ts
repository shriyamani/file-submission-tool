import Peer, { DataConnection } from 'peerjs'
import type {
  ProgressCallback,
  ReceivedFile,
  ReceiverApprovalRequest,
  SessionInfo,
  TransferConnection,
  TransferFileMeta,
  PeerRole,
} from './transferTypes'
import * as localTransfer from './peerTransfer'
import { getPendingReceiverRequest as getMockPendingReceiverRequest, seedReceiverRequest } from './mockTransfer'
import {
  exportPublicKey,
  importPublicKey,
  deriveSessionKey as cryptoDeriveSessionKey,
  encryptChunk as secureEncryptChunk,
  decryptChunk as secureDecryptChunk,
} from '../utils/crypto.js'

const REQUEST_APPROVAL_TIMEOUT_MS = 90_000
const REQUEST_RETRY_INTERVAL_MS = 500
const FILE_APPROVAL_TIMEOUT_MS = 90_000
const FILE_RECEIVE_TIMEOUT_MS = 90_000
const PUBKEY_EXCHANGE_TIMEOUT_MS = 30_000
const CHUNK_SIZE = 64 * 1024
const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
}

type FileApprovalDecision = 'approved' | 'declined'

interface RequestMessage {
  type: 'request'
  requestId: string
  receiverLabel: string
}

interface ApprovedMessage {
  type: 'approved'
  requestId: string
}

interface RejectedMessage {
  type: 'rejected'
  requestId: string
}

interface FileOfferMessage {
  type: 'file-offer'
  meta: TransferFileMeta
}

interface FileOfferClearedMessage {
  type: 'file-offer-cleared'
}

interface FileApprovalMessage {
  type: 'file-approval'
  decision: FileApprovalDecision
}

interface ChunkEnvelope {
  type: 'chunk'
  index: number
  total: number
  data: ArrayBuffer
}

interface DoneSignal {
  type: 'done'
  fileName: string
  fileType: string
  fileSize: number
}

interface PubKeyMessage {
  type: 'pubkey'
  role: PeerRole
  jwk: JsonWebKey
}

type PeerMessage =
  | RequestMessage
  | ApprovedMessage
  | RejectedMessage
  | FileOfferMessage
  | FileOfferClearedMessage
  | FileApprovalMessage
  | ChunkEnvelope
  | DoneSignal
  | PubKeyMessage

const isRequestMessage = (message: unknown): message is RequestMessage => {
  return typeof message === 'object' && message !== null && (message as RequestMessage).type === 'request'
}

const isApprovedMessage = (message: unknown): message is ApprovedMessage => {
  return typeof message === 'object' && message !== null && (message as ApprovedMessage).type === 'approved'
}

const isRejectedMessage = (message: unknown): message is RejectedMessage => {
  return typeof message === 'object' && message !== null && (message as RejectedMessage).type === 'rejected'
}

const isFileOfferMessage = (message: unknown): message is FileOfferMessage => {
  return typeof message === 'object' && message !== null && (message as FileOfferMessage).type === 'file-offer'
}

const isFileOfferClearedMessage = (message: unknown): message is FileOfferClearedMessage => {
  return typeof message === 'object' && message !== null && (message as FileOfferClearedMessage).type === 'file-offer-cleared'
}

const isFileApprovalMessage = (message: unknown): message is FileApprovalMessage => {
  return typeof message === 'object' && message !== null && (message as FileApprovalMessage).type === 'file-approval'
}

const isChunkEnvelope = (message: unknown): message is ChunkEnvelope => {
  return typeof message === 'object' && message !== null && (message as ChunkEnvelope).type === 'chunk'
}

const isDoneSignal = (message: unknown): message is DoneSignal => {
  return typeof message === 'object' && message !== null && (message as DoneSignal).type === 'done'
}

const isPubKeyMessage = (message: unknown): message is PubKeyMessage => {
  return typeof message === 'object' && message !== null && (message as PubKeyMessage).type === 'pubkey'
}

let senderPeer: Peer | null = null
let receiverPeer: Peer | null = null
let senderDataConn: DataConnection | null = null
let receiverDataConn: DataConnection | null = null
let onReceiverRequestCallback: ((request: ReceiverApprovalRequest) => void) | null = null
let onApprovalCallback: ((message: ApprovedMessage | RejectedMessage) => void) | null = null
let onSenderPubKeyCallback: ((message: PubKeyMessage) => void) | null = null
let onReceiverPubKeyCallback: ((message: PubKeyMessage) => void) | null = null
let onFileDataCallback: ((message: ChunkEnvelope | DoneSignal) => void) | null = null
let onFileApprovalCallback: ((message: FileApprovalMessage) => void) | null = null
let pendingReceiverRequest: ReceiverApprovalRequest | null = null
let pendingFileMeta: TransferFileMeta | null = null
let cachedSenderDecision: ApprovedMessage | RejectedMessage | null = null
let cachedSenderPubKey: PubKeyMessage | null = null
let cachedReceiverPubKey: PubKeyMessage | null = null
let cachedFileApproval: FileApprovalMessage | null = null
let stopReceiverRequestRetry: (() => void) | null = null
let resolvedReceiverPeerId: string | null = null
let localFallbackActive = false
let activeNetworkSenderSessionId: string | null = null
let activeNetworkReceiverSessionId: string | null = null
const completedTransfers = new Set<string>()

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

const createRandomId = (): string => {
  const value = Math.floor(Math.random() * 10 ** 8)
  return `beam-${value.toString(36)}`
}

const createReceiverLabel = (): string => {
  const value = Math.floor(1000 + Math.random() * 9000)
  return `receiver-${value}`
}

const buildTransferMeta = (file: File): TransferFileMeta => {
  return {
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    sentAt: Date.now(),
  }
}

const buildFallbackReceiverRequest = (peerId: string): ReceiverApprovalRequest => {
  return {
    requestId: peerId,
    receiverLabel: peerId,
    requestedAt: Date.now(),
  }
}

const waitForConnectionOpen = async (conn: DataConnection, timeoutMs = 15_000): Promise<void> => {
  const timeoutAt = Date.now() + timeoutMs

  while (Date.now() < timeoutAt) {
    if (conn.open) {
      return
    }

    await delay(120)
  }

  throw new Error('Receiver data channel did not open in time.')
}

const clearReceiverRequestRetry = (): void => {
  if (!stopReceiverRequestRetry) {
    return
  }

  stopReceiverRequestRetry()
  stopReceiverRequestRetry = null
}

const startReceiverRequestRetry = (conn: DataConnection, request: ReceiverApprovalRequest): void => {
  clearReceiverRequestRetry()

  const message = {
    type: 'request',
    requestId: request.requestId,
    receiverLabel: request.receiverLabel,
  } satisfies RequestMessage

  let stopped = false

  const sendRequest = (): void => {
    if (stopped || !conn.open) {
      return
    }

    conn.send(message)
  }

  sendRequest()

  const intervalId = window.setInterval(() => {
    sendRequest()
  }, REQUEST_RETRY_INTERVAL_MS)

  stopReceiverRequestRetry = () => {
    if (stopped) {
      return
    }

    stopped = true
    window.clearInterval(intervalId)
  }
}

const resetSenderState = (): void => {
  if (senderDataConn) {
    senderDataConn.close()
    senderDataConn = null
  }

  if (senderPeer) {
    senderPeer.destroy()
    senderPeer = null
  }

  pendingReceiverRequest = null
  cachedReceiverPubKey = null
  cachedFileApproval = null
  resolvedReceiverPeerId = null
  localFallbackActive = false
  activeNetworkSenderSessionId = null
}

const resetReceiverState = (): void => {
  clearReceiverRequestRetry()

  if (receiverDataConn) {
    receiverDataConn.close()
    receiverDataConn = null
  }

  if (receiverPeer) {
    receiverPeer.destroy()
    receiverPeer = null
  }

  pendingFileMeta = null
  cachedSenderDecision = null
  cachedSenderPubKey = null
  cachedFileApproval = null
  localFallbackActive = false
  activeNetworkReceiverSessionId = null
}

const setupSenderConnection = (conn: DataConnection): void => {
  conn.on('data', (raw: PeerMessage) => {
    if (isRequestMessage(raw)) {
      if (resolvedReceiverPeerId === conn.peer) {
        return
      }

      if (pendingReceiverRequest?.requestId === raw.requestId) {
        return
      }

      pendingReceiverRequest = {
        requestId: raw.requestId,
        receiverLabel: raw.receiverLabel,
        requestedAt: Date.now(),
      }

      if (onReceiverRequestCallback) {
        onReceiverRequestCallback(pendingReceiverRequest)
      }

      return
    }

    if (isPubKeyMessage(raw)) {
      cachedReceiverPubKey = raw
      if (onReceiverPubKeyCallback) {
        onReceiverPubKeyCallback(raw)
      }
      return
    }

    if (isFileApprovalMessage(raw)) {
      cachedFileApproval = raw
      if (onFileApprovalCallback) {
        onFileApprovalCallback(raw)
      }
    }
  })

  conn.on('close', () => {
    if (senderDataConn === conn) {
      senderDataConn = null
    }
  })
}

const setupReceiverConnection = (conn: DataConnection): void => {
  conn.on('data', (raw: PeerMessage) => {
    if (isApprovedMessage(raw) || isRejectedMessage(raw)) {
      clearReceiverRequestRetry()
      cachedSenderDecision = raw
      if (onApprovalCallback) {
        onApprovalCallback(raw)
      }
      return
    }

    if (isFileOfferMessage(raw)) {
      pendingFileMeta = raw.meta
      cachedFileApproval = null
      clearReceiverRequestRetry()

      if (!cachedSenderDecision) {
        cachedSenderDecision = {
          type: 'approved',
          requestId: 'implicit-file-offer',
        } satisfies ApprovedMessage
      }

      if (onApprovalCallback && isApprovedMessage(cachedSenderDecision)) {
        onApprovalCallback(cachedSenderDecision)
      }
      return
    }

    if (isFileOfferClearedMessage(raw)) {
      pendingFileMeta = null
      cachedFileApproval = null
      return
    }

    if (isPubKeyMessage(raw)) {
      cachedSenderPubKey = raw
      if (onSenderPubKeyCallback) {
        onSenderPubKeyCallback(raw)
      }
      return
    }

    if ((isChunkEnvelope(raw) || isDoneSignal(raw)) && onFileDataCallback) {
      onFileDataCallback(raw)
    }
  })

  conn.on('close', () => {
    clearReceiverRequestRetry()
    if (receiverDataConn === conn) {
      receiverDataConn = null
    }
  })
}

export const createSession = (): SessionInfo => {
  const sessionId = createRandomId()

  return {
    sessionId,
    shareUrl: `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}&mode=network`,
    createdAt: Date.now(),
    mode: 'network',
  }
}

export const isTransferCompleted = (sessionId: string): boolean => {
  return completedTransfers.has(sessionId)
}

export const initSenderPeer = async (
  sessionId: string,
  onRequest: (request: ReceiverApprovalRequest) => void,
): Promise<void> => {
  resetSenderState()
  activeNetworkSenderSessionId = sessionId
  onReceiverRequestCallback = onRequest
  await localTransfer.initSenderPeer(sessionId, onRequest)

  await new Promise<void>((resolve, reject) => {
    let isSettled = false
    const nextPeer = new Peer(sessionId, PEER_OPTIONS)
    senderPeer = nextPeer

    nextPeer.on('open', () => {
      isSettled = true
      resolve()
    })

    nextPeer.on('connection', (conn) => {
      if (senderDataConn && senderDataConn !== conn) {
        senderDataConn.close()
      }

      resolvedReceiverPeerId = null
      senderDataConn = conn
      cachedReceiverPubKey = null
      cachedFileApproval = null
      setupSenderConnection(conn)

      pendingReceiverRequest = getMockPendingReceiverRequest(sessionId) ?? buildFallbackReceiverRequest(conn.peer)
      onReceiverRequestCallback?.(pendingReceiverRequest)
    })

    nextPeer.on('error', (error) => {
      if (isSettled) {
        return
      }

      reject(error)
    })
  })
}

export const approveReceiverRequest = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  const effectiveRequestId = getMockPendingReceiverRequest(sessionId)?.requestId ?? requestId
  let approvedLocally = false

  try {
    await localTransfer.approveReceiverRequest(sessionId, effectiveRequestId)
    approvedLocally = true
    localFallbackActive = true
  } catch {
    // Ignore local fallback failures here. The network path may still succeed.
  }

  if (!senderDataConn) {
    if (approvedLocally) {
      pendingReceiverRequest = null
      return {
        id: `sender-${sessionId}`,
        sessionId,
        role: 'sender',
        connected: true,
        mode: 'network',
      }
    }

    throw new Error('No active receiver connection to approve.')
  }

  try {
    await waitForConnectionOpen(senderDataConn)
    senderDataConn.send({
      type: 'approved',
      requestId: effectiveRequestId,
    } satisfies ApprovedMessage)
  } catch (error) {
    if (!approvedLocally) {
      throw error
    }
  }

  resolvedReceiverPeerId = senderDataConn.peer
  pendingReceiverRequest = null

  return {
    id: `sender-${sessionId}`,
    sessionId,
    role: 'sender',
    connected: true,
    mode: 'network',
  }
}

export const rejectReceiverRequest = async (sessionId: string, requestId: string): Promise<void> => {
  const effectiveRequestId = getMockPendingReceiverRequest(sessionId)?.requestId ?? requestId
  let rejectedLocally = false

  try {
    await localTransfer.rejectReceiverRequest(sessionId, effectiveRequestId)
    rejectedLocally = true
    localFallbackActive = true
  } catch {
    // Ignore local fallback failures here. The network path may still succeed.
  }

  if (!senderDataConn) {
    if (rejectedLocally) {
      pendingReceiverRequest = null
      return
    }

    return
  }

  try {
    await waitForConnectionOpen(senderDataConn)
    senderDataConn.send({
      type: 'rejected',
      requestId: effectiveRequestId,
    } satisfies RejectedMessage)
  } catch (error) {
    if (!rejectedLocally) {
      throw error
    }
  }

  resolvedReceiverPeerId = senderDataConn.peer
  pendingReceiverRequest = null
  await delay(120)
  senderDataConn.close()
  senderDataConn = null
}

export const requestReceiverConnection = async (sessionId: string): Promise<ReceiverApprovalRequest> => {
  resetReceiverState()
  activeNetworkReceiverSessionId = sessionId

  const request: ReceiverApprovalRequest = {
    requestId: createRandomId(),
    receiverLabel: createReceiverLabel(),
    requestedAt: Date.now(),
  }

  seedReceiverRequest(sessionId, request)

  await new Promise<void>((resolve, reject) => {
    let isSettled = false
    const nextPeer = new Peer(undefined, PEER_OPTIONS)
    receiverPeer = nextPeer

    nextPeer.on('open', () => {
      const conn = nextPeer.connect(sessionId, { reliable: true })
      receiverDataConn = conn
      setupReceiverConnection(conn)

      conn.on('open', () => {
        isSettled = true
        startReceiverRequestRetry(conn, request)
        resolve()
      })

      conn.on('error', (error) => {
        if (isSettled) {
          return
        }

        reject(error)
      })
    })

    nextPeer.on('error', (error) => {
      if (isSettled) {
        return
      }

      reject(error)
    })
  })

  return request
}

export const waitForSenderApproval = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  const localWaitPromise = localTransfer.waitForSenderApproval(sessionId, requestId).then((connection) => {
    localFallbackActive = true
    return {
      ...connection,
      mode: 'network' as const,
    }
  })

  const localOfferFallbackPromise = new Promise<TransferConnection>((resolve) => {
    const pollForLocalOffer = (): void => {
      if (localTransfer.getPendingFileMeta(sessionId)) {
        clearReceiverRequestRetry()
        localFallbackActive = true
        resolve({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
          mode: 'network',
        })
        return
      }

      window.setTimeout(pollForLocalOffer, 220)
    }

    pollForLocalOffer()
  })

  const networkOfferFallbackPromise = new Promise<TransferConnection>((resolve) => {
    const pollForNetworkOffer = (): void => {
      if (pendingFileMeta) {
        clearReceiverRequestRetry()
        cachedSenderDecision = {
          type: 'approved',
          requestId: 'network-file-offer',
        } satisfies ApprovedMessage
        resolve({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
          mode: 'network',
        })
        return
      }

      window.setTimeout(pollForNetworkOffer, 220)
    }

    pollForNetworkOffer()
  })

  if (!receiverDataConn) {
    return Promise.race([localWaitPromise, localOfferFallbackPromise, networkOfferFallbackPromise])
  }

  if (cachedSenderDecision) {
    if (isApprovedMessage(cachedSenderDecision)) {
      clearReceiverRequestRetry()
      return {
        id: `receiver-${sessionId}`,
        sessionId,
        role: 'receiver',
        connected: true,
        mode: 'network',
      }
    }

    clearReceiverRequestRetry()
    throw new Error('Sender rejected the receiver request.')
  }

  const networkWaitPromise = new Promise<TransferConnection>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      onApprovalCallback = null
      clearReceiverRequestRetry()
      reject(new Error('Timed out waiting for sender approval.'))
    }, REQUEST_APPROVAL_TIMEOUT_MS)

    onApprovalCallback = (message) => {
      window.clearTimeout(timeoutId)
      onApprovalCallback = null
      clearReceiverRequestRetry()

      if (isApprovedMessage(message)) {
        resolve({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
          mode: 'network',
        })
        return
      }

      reject(new Error('Sender rejected the receiver request.'))
    }
  })

  return Promise.race([networkWaitPromise, localWaitPromise, localOfferFallbackPromise, networkOfferFallbackPromise])
}

export const publishPendingFileMeta = (sessionId: string, file: File | null): void => {
  localTransfer.publishPendingFileMeta(sessionId, file)
  pendingFileMeta = file ? buildTransferMeta(file) : null
  cachedFileApproval = null
  completedTransfers.delete(sessionId)

  const conn = senderDataConn
  if (!conn) {
    return
  }

  const message = file
    ? ({
        type: 'file-offer',
        meta: pendingFileMeta,
      } satisfies FileOfferMessage)
    : ({
        type: 'file-offer-cleared',
      } satisfies FileOfferClearedMessage)

  const sendOffer = (): void => {
    if (conn.open) {
      conn.send(message)
    }
  }

  if (conn.open) {
    sendOffer()
    return
  }

  void waitForConnectionOpen(conn)
    .then(() => {
      sendOffer()
    })
    .catch(() => {
      // Leave the sender UI responsive even if the network connection dropped.
    })
}

export const getPendingFileMeta = (): TransferFileMeta | null => {
  const localMeta = activeNetworkReceiverSessionId ? localTransfer.getPendingFileMeta(activeNetworkReceiverSessionId) : null

  if (!pendingFileMeta) {
    return localMeta
  }

  return { ...pendingFileMeta }
}

export const dismissPendingFileMeta = (): void => {
  pendingFileMeta = null
  if (activeNetworkReceiverSessionId) {
    localTransfer.dismissPendingFileMeta(activeNetworkReceiverSessionId)
  }
}

export const waitForReceiverFileAcceptance = async (): Promise<void> => {
  const localApprovalPromise = localTransfer.waitForReceiverFileAcceptance().then(() => {
    localFallbackActive = true
  })

  if (localFallbackActive) {
    await localApprovalPromise
    return
  }

  if (cachedFileApproval) {
    if (cachedFileApproval.decision === 'approved') {
      return
    }

    throw new Error('Receiver declined the file.')
  }

  const networkApprovalPromise = new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      onFileApprovalCallback = null
      reject(new Error('Timed out waiting for receiver file approval.'))
    }, FILE_APPROVAL_TIMEOUT_MS)

    onFileApprovalCallback = (message) => {
      window.clearTimeout(timeoutId)
      onFileApprovalCallback = null

      if (message.decision === 'approved') {
        resolve()
        return
      }

      reject(new Error('Receiver declined the file.'))
    }
  })

  await Promise.race([networkApprovalPromise, localApprovalPromise])
}

export const confirmIncomingFileReceipt = async (): Promise<void> => {
  let confirmedLocally = false

  try {
    localTransfer.confirmIncomingFileReceipt(activeNetworkReceiverSessionId ?? undefined)
    localFallbackActive = true
    confirmedLocally = true
  } catch {
    // Ignore local fallback failures and continue with the network path.
  }

  if (!receiverDataConn) {
    return
  }

  try {
    await waitForConnectionOpen(receiverDataConn)
    receiverDataConn.send({
      type: 'file-approval',
      decision: 'approved',
    } satisfies FileApprovalMessage)
  } catch (error) {
    if (!confirmedLocally) {
      throw error
    }
  }
}

export const declineIncomingFileReceipt = async (): Promise<void> => {
  let declinedLocally = false

  if (activeNetworkReceiverSessionId) {
    localTransfer.declineIncomingFileReceipt(activeNetworkReceiverSessionId)
    localFallbackActive = true
    declinedLocally = true
  }

  if (!receiverDataConn) {
    return
  }

  try {
    await waitForConnectionOpen(receiverDataConn)
    receiverDataConn.send({
      type: 'file-approval',
      decision: 'declined',
    } satisfies FileApprovalMessage)
  } catch (error) {
    if (!declinedLocally) {
      throw error
    }
  }
  pendingFileMeta = null
}

export const deriveSessionKey = async (
  sessionId: string,
  role: PeerRole,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey | null> => {
  if (localFallbackActive) {
    return localTransfer.deriveSessionKey(sessionId, role, privateKey, publicKey)
  }

  const conn = role === 'sender' ? senderDataConn : receiverDataConn

  if (!conn) {
    return localTransfer.deriveSessionKey(sessionId, role, privateKey, publicKey)
  }

  const otherRole: PeerRole = role === 'sender' ? 'receiver' : 'sender'

  const otherJwkPromise = new Promise<JsonWebKey>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      if (role === 'sender') {
        onReceiverPubKeyCallback = null
      } else {
        onSenderPubKeyCallback = null
      }

      reject(new Error(`Timed out waiting for ${otherRole} public key.`))
    }, PUBKEY_EXCHANGE_TIMEOUT_MS)

    if (role === 'sender' && cachedReceiverPubKey?.role === otherRole) {
      const cached = cachedReceiverPubKey
      cachedReceiverPubKey = null
      window.clearTimeout(timeoutId)
      resolve(cached.jwk)
      return
    }

    if (role === 'receiver' && cachedSenderPubKey?.role === otherRole) {
      const cached = cachedSenderPubKey
      cachedSenderPubKey = null
      window.clearTimeout(timeoutId)
      resolve(cached.jwk)
      return
    }

    if (role === 'sender') {
      onReceiverPubKeyCallback = (message) => {
        if (message.role !== otherRole) {
          return
        }

        window.clearTimeout(timeoutId)
        onReceiverPubKeyCallback = null
        cachedReceiverPubKey = null
        resolve(message.jwk)
      }

      return
    }

    onSenderPubKeyCallback = (message) => {
      if (message.role !== otherRole) {
        return
      }

      window.clearTimeout(timeoutId)
      onSenderPubKeyCallback = null
      cachedSenderPubKey = null
      resolve(message.jwk)
    }
  })

  const ownJwk = await exportPublicKey(publicKey)
  await waitForConnectionOpen(conn)
  conn.send({
    type: 'pubkey',
    role,
    jwk: ownJwk,
  } satisfies PubKeyMessage)

  const otherJwk = await otherJwkPromise
  const otherPublicKey = await importPublicKey(otherJwk)
  return cryptoDeriveSessionKey(privateKey, otherPublicKey)
}

export const sendFile = async (
  connection: TransferConnection,
  file: File,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<void> => {
  if (localFallbackActive || !senderDataConn?.open) {
    await localTransfer.sendFile(
      {
        ...connection,
        mode: 'local',
      },
      file,
      sessionKey,
      onProgress,
    )
    return
  }

  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  if (!senderDataConn) {
    throw new Error('No active sender connection.')
  }

  await waitForConnectionOpen(senderDataConn)

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  let offset = 0
  let chunkIndex = 0

  onProgress(0)

  while (offset < file.size) {
    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE)
    const chunkBuffer = await chunkBlob.arrayBuffer()
    const encryptedBuffer = await secureEncryptChunk(chunkBuffer, sessionKey)

    senderDataConn.send({
      type: 'chunk',
      index: chunkIndex,
      total: totalChunks,
      data: encryptedBuffer,
    } satisfies ChunkEnvelope)

    offset += CHUNK_SIZE
    chunkIndex += 1
    onProgress(Math.round((chunkIndex / totalChunks) * 100))
    await delay(12)
  }

  senderDataConn.send({
    type: 'done',
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
  } satisfies DoneSignal)

  completedTransfers.add(connection.sessionId)
}

export const receiveFile = async (
  connection: TransferConnection,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  if (localFallbackActive || !receiverDataConn?.open) {
    return localTransfer.receiveFile(
      {
        ...connection,
        mode: 'local',
      },
      sessionKey,
      onProgress,
    )
  }

  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  if (!receiverDataConn) {
    throw new Error('No active receiver connection.')
  }

  return new Promise((resolve, reject) => {
    const receivedChunks = new Map<number, ArrayBuffer>()
    let fileMeta: DoneSignal | null = null

    const timeoutId = window.setTimeout(() => {
      onFileDataCallback = null
      reject(new Error('Timed out waiting for sender file.'))
    }, FILE_RECEIVE_TIMEOUT_MS)

    onProgress(2)

    onFileDataCallback = async (message) => {
      try {
        if (isChunkEnvelope(message)) {
          receivedChunks.set(message.index, message.data)
          onProgress(Math.round((receivedChunks.size / message.total) * 100))
          return
        }

        fileMeta = message
        onFileDataCallback = null
        window.clearTimeout(timeoutId)

        const decryptedBlobs: Blob[] = []
        for (let index = 0; index < receivedChunks.size; index += 1) {
          const encryptedChunk = receivedChunks.get(index)
          if (!encryptedChunk) {
            reject(new Error(`Missing chunk at index ${index}.`))
            return
          }

          const decryptedBuffer = await secureDecryptChunk(encryptedChunk, sessionKey)
          decryptedBlobs.push(new Blob([decryptedBuffer]))
        }

        const finalBlob = new Blob(decryptedBlobs, { type: fileMeta.fileType })
        completedTransfers.add(connection.sessionId)

        resolve({
          name: fileMeta.fileName,
          size: finalBlob.size,
          type: fileMeta.fileType,
          blob: finalBlob,
        })
      } catch (error) {
        onFileDataCallback = null
        window.clearTimeout(timeoutId)
        reject(error)
      }
    }

    receiverDataConn.on('error', (error) => {
      onFileDataCallback = null
      window.clearTimeout(timeoutId)
      reject(error)
    })

    receiverDataConn.on('close', () => {
      if (!fileMeta) {
        onFileDataCallback = null
        window.clearTimeout(timeoutId)
        reject(new Error('Connection closed before transfer completed.'))
      }
    })
  })
}
