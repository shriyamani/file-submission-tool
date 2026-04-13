import Peer, { DataConnection } from 'peerjs'
import {
  type ProgressCallback,
  type ReceivedFile,
  type ReceiverApprovalRequest,
  type TransferConnection,
  type PeerRole,
} from './transferTypes'
import {
  exportPublicKey,
  importPublicKey,
  deriveSessionKey as cryptoDeriveSessionKey,
  encryptChunk as secureEncryptChunk,
  decryptChunk as secureDecryptChunk,
} from '../utils/crypto.js'

export {
  createSession,
  isTransferCompleted,
  publishPendingFileMeta,
  getPendingFileMeta,
} from './mockTransfer'

// const STORAGE_KEY_PREFIX = 'beam-mock-session:'
// const PUBKEY_POLL_INTERVAL_MS = 200
const PUBKEY_EXCHANGE_TIMEOUT_MS = 30_000
const CHUNK_SIZE = 16 * 1024 // 16KB keeps packets under conservative browser data-channel limits
const ACK_EVERY_CHUNKS = 8
const MAX_IN_FLIGHT_CHUNKS = 64
const CHUNK_ACK_TIMEOUT_MS = 30_000

const PEER_CONFIG = {
  config: {
    iceServers: [
      {
        urls: 'stun:stun.relay.metered.ca:80',
      },
      {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'e6a6ef99abba0455118bdf45',
        credential: 'JTR4jUC/RBCd6Ed3',
      },
      {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: 'e6a6ef99abba0455118bdf45',
        credential: 'JTR4jUC/RBCd6Ed3',
      },
      {
        urls: 'turn:global.relay.metered.ca:443',
        username: 'e6a6ef99abba0455118bdf45',
        credential: 'JTR4jUC/RBCd6Ed3',
      },
      {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: 'e6a6ef99abba0455118bdf45',
        credential: 'JTR4jUC/RBCd6Ed3',
      },
    ],
  },
}

interface RequestMessage {
  type: 'request'
  requestId: string
  receiverLabel: string
}

interface ApprovedMessage {
  type: 'approved'
}

interface RejectedMessage {
  type: 'rejected'
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

interface ReceiverReadyMessage {
  type: 'receiver-ready'
}

interface ReceiverCompleteMessage {
  type: 'receiver-complete'
}

interface ChunkAckMessage {
  type: 'chunk-ack'
  receivedChunks: number
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
  | ChunkEnvelope
  | DoneSignal
  | ReceiverReadyMessage
  | ReceiverCompleteMessage
  | ChunkAckMessage
  | PubKeyMessage

const isRequestMessage = (msg: unknown): msg is RequestMessage =>
  typeof msg === 'object' && msg !== null && (msg as RequestMessage).type === 'request'

const isApprovedMessage = (msg: unknown): msg is ApprovedMessage =>
  typeof msg === 'object' && msg !== null && (msg as ApprovedMessage).type === 'approved'

const isRejectedMessage = (msg: unknown): msg is RejectedMessage =>
  typeof msg === 'object' && msg !== null && (msg as RejectedMessage).type === 'rejected'

const isChunkEnvelope = (msg: unknown): msg is ChunkEnvelope =>
  typeof msg === 'object' && msg !== null && (msg as ChunkEnvelope).type === 'chunk'

const isDoneSignal = (msg: unknown): msg is DoneSignal =>
  typeof msg === 'object' && msg !== null && (msg as DoneSignal).type === 'done'

const isReceiverReadyMessage = (msg: unknown): msg is ReceiverReadyMessage =>
  typeof msg === 'object' && msg !== null && (msg as ReceiverReadyMessage).type === 'receiver-ready'

const isReceiverCompleteMessage = (msg: unknown): msg is ReceiverCompleteMessage =>
  typeof msg === 'object' && msg !== null && (msg as ReceiverCompleteMessage).type === 'receiver-complete'

const isChunkAckMessage = (msg: unknown): msg is ChunkAckMessage =>
  typeof msg === 'object' && msg !== null && (msg as ChunkAckMessage).type === 'chunk-ack'

const isPubKeyMessage = (msg: unknown): msg is PubKeyMessage =>
  typeof msg === 'object' && msg !== null && (msg as PubKeyMessage).type === 'pubkey'

let senderPeer: Peer | null = null
let senderDataConn: DataConnection | null = null
let receiverDataConn: DataConnection | null = null
let pendingReceiverRequest: ReceiverApprovalRequest | null = null
let onReceiverRequestCallback: ((request: ReceiverApprovalRequest) => void) | null = null
let onPubKeyCallback: ((msg: PubKeyMessage) => void) | null = null
let onReceiverPubKeyCallback: ((msg: PubKeyMessage) => void) | null = null
let onApprovalCallback: ((msg: ApprovedMessage | RejectedMessage) => void) | null = null
let onFileDataCallback: ((msg: ChunkEnvelope | DoneSignal) => void) | null = null
let onReceiverReadyCallback: (() => void) | null = null
let onReceiverCompleteCallback: (() => void) | null = null
let onChunkAckCallback: ((msg: ChunkAckMessage) => void) | null = null
let cachedReceiverPubKey: PubKeyMessage | null = null
let cachedReceiverReady = false
let cachedReceiverAckCount = 0
let senderCleanupTimeoutId: number | null = null

const cleanupSenderConnection = (): void => {
  if (senderCleanupTimeoutId !== null) {
    window.clearTimeout(senderCleanupTimeoutId)
    senderCleanupTimeoutId = null
  }

  cachedReceiverReady = false
  cachedReceiverAckCount = 0
  onReceiverReadyCallback = null
  onReceiverCompleteCallback = null
  onChunkAckCallback = null
  senderDataConn?.close()
  senderPeer?.destroy()
  senderPeer = null
  senderDataConn = null
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))

const createRandomId = (): string => {
  const value = Math.floor(Math.random() * 10 ** 8)
  return `beam-${value.toString(36)}`
}

const createReceiverLabel = (): string => {
  const value = Math.floor(1000 + Math.random() * 9000)
  return `receiver-${value}`
}

const setupReceiverDataRouter = (conn: DataConnection): void => {
  conn.on('data', (raw) => {
    if (isApprovedMessage(raw) || isRejectedMessage(raw)) {
      if (onApprovalCallback) {
        onApprovalCallback(raw as ApprovedMessage | RejectedMessage)
      }
    } else if (isPubKeyMessage(raw)) {
      if (onReceiverPubKeyCallback) {
        onReceiverPubKeyCallback(raw)
      }
    } else if (isChunkEnvelope(raw) || isDoneSignal(raw)) {
      if (onFileDataCallback) {
        onFileDataCallback(raw as ChunkEnvelope | DoneSignal)
      }
    }
  })
}

export const initSenderPeer = (
  sessionId: string,
  onRequest: (request: ReceiverApprovalRequest) => void,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (senderPeer) {
      cleanupSenderConnection()
    }

    onReceiverRequestCallback = onRequest
    onReceiverReadyCallback = null
    onReceiverCompleteCallback = null
    cachedReceiverReady = false
    senderPeer = new Peer(sessionId, PEER_CONFIG)

    senderPeer.on('open', (id) => {
      console.log('[sender] PeerJS registered with ID:', id)
      resolve()
    })

    senderPeer.on('connection', (conn) => {
      console.log('[sender] Incoming PeerJS connection')
      senderDataConn = conn

      conn.on('open', () => {
        console.log('[sender] Data channel open')
      })

      conn.on('data', (raw) => {
        if (isRequestMessage(raw)) {
          console.log('[sender] Received connection request from:', raw.receiverLabel)
          pendingReceiverRequest = {
            requestId: raw.requestId,
            receiverLabel: raw.receiverLabel,
            requestedAt: Date.now(),
          }
          if (onReceiverRequestCallback) {
            onReceiverRequestCallback(pendingReceiverRequest)
          }
        } else if (isReceiverReadyMessage(raw)) {
          if (onReceiverReadyCallback) {
            cachedReceiverReady = false
            onReceiverReadyCallback()
          } else {
            cachedReceiverReady = true
          }
        } else if (isReceiverCompleteMessage(raw)) {
          if (onReceiverCompleteCallback) {
            onReceiverCompleteCallback()
          }
        } else if (isChunkAckMessage(raw)) {
          cachedReceiverAckCount = Math.max(cachedReceiverAckCount, raw.receivedChunks)
          if (onChunkAckCallback) {
            onChunkAckCallback(raw)
          }
        } else if (isPubKeyMessage(raw)) {
          if (onPubKeyCallback) {
            onPubKeyCallback(raw)
          } else {
            cachedReceiverPubKey = raw
            console.log('[sender] Cached receiver public key for later use')
          }
        }
      })

      conn.on('error', (err) => {
        console.error('[sender] Data channel error:', err)
      })
    })

    senderPeer.on('error', (err) => {
      console.error('[sender] PeerJS error:', err)
      reject(err)
    })

    senderPeer.on('disconnected', () => {
      console.warn('[sender] PeerJS disconnected from signaling server')
    })

    senderPeer.on('close', () => {
      console.warn('[sender] PeerJS connection closed')
    })
  })
}

export const approveReceiverRequest = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  if (!senderDataConn) {
    throw new Error('No active receiver connection to approve.')
  }

  const approvedMsg: ApprovedMessage = { type: 'approved' }
  senderDataConn.send(approvedMsg)
  console.log('[sender] Sent approval to receiver')

  pendingReceiverRequest = null

  return {
    id: `sender-${sessionId}`,
    sessionId,
    role: 'sender',
    connected: true,
  }
}

export const rejectReceiverRequest = async (
  sessionId: string,
  requestId: string,
): Promise<void> => {
  if (!senderDataConn) {
    return
  }

  const rejectedMsg: RejectedMessage = { type: 'rejected' }
  senderDataConn.send(rejectedMsg)
  console.log('[sender] Sent rejection to receiver')

  senderDataConn = null
  pendingReceiverRequest = null
}

export const getPendingReceiverRequest = (): ReceiverApprovalRequest | null => {
  return pendingReceiverRequest
}

export const requestReceiverConnection = async (
  sessionId: string,
): Promise<ReceiverApprovalRequest> => {
  return new Promise((resolve, reject) => {
    if (receiverDataConn) {
      receiverDataConn.close()
      receiverDataConn = null
    }

    const peer = new Peer(PEER_CONFIG)

    peer.on('open', () => {
      console.log('[receiver] PeerJS open, connecting to sender:', sessionId)
      const conn = peer.connect(sessionId, { reliable: true })
      receiverDataConn = conn

      conn.on('open', () => {
        console.log('[receiver] Data channel open, sending request')
        setupReceiverDataRouter(conn)

        const request: ReceiverApprovalRequest = {
          requestId: createRandomId(),
          receiverLabel: createReceiverLabel(),
          requestedAt: Date.now(),
        }

        const requestMsg: RequestMessage = {
          type: 'request',
          requestId: request.requestId,
          receiverLabel: request.receiverLabel,
        }

        conn.send(requestMsg)
        console.log('[receiver] Sent connection request as:', request.receiverLabel)
        resolve(request)
      })

      conn.on('error', (err) => {
        console.error('[receiver] Connection error:', err)
        reject(err)
      })
    })

    peer.on('error', (err) => {
      console.error('[receiver] PeerJS error:', err)
      reject(err)
    })

    peer.on('disconnected', () => {
      console.warn('[receiver] PeerJS disconnected from signaling server')
    })
  })
}

export const waitForSenderApproval = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  return new Promise((resolve, reject) => {
    if (!receiverDataConn) {
      reject(new Error('No active connection to sender.'))
      return
    }

    const timeout = window.setTimeout(() => {
      onApprovalCallback = null
      reject(new Error('Timed out waiting for sender approval.'))
    }, 90_000)

    onApprovalCallback = (msg) => {
      if (isApprovedMessage(msg)) {
        window.clearTimeout(timeout)
        onApprovalCallback = null
        console.log('[receiver] Sender approved the connection')
        resolve({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
        })
      } else if (isRejectedMessage(msg)) {
        window.clearTimeout(timeout)
        onApprovalCallback = null
        console.log('[receiver] Sender rejected the connection')
        reject(new Error('Sender rejected the receiver request.'))
      }
    }
  })
}

export const deriveSessionKey = async (
  sessionId: string,
  role: PeerRole,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey | null> => {
  const conn = role === 'sender' ? senderDataConn : receiverDataConn

  if (!conn) {
    throw new Error(`No active ${role} connection for key exchange.`)
  }

  const otherRole: PeerRole = role === 'sender' ? 'receiver' : 'sender'

  const otherJwkPromise = new Promise<JsonWebKey>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      onPubKeyCallback = null
      reject(new Error(`Timed out waiting for ${otherRole} public key.`))
    }, PUBKEY_EXCHANGE_TIMEOUT_MS)

    if (role === 'sender') {
      if (cachedReceiverPubKey && cachedReceiverPubKey.role === otherRole) {
        console.log(`[sender] Using cached public key from receiver`)
        const jwk = cachedReceiverPubKey.jwk
        cachedReceiverPubKey = null
        window.clearTimeout(timeout)
        resolve(jwk)
        return
      }

      onPubKeyCallback = (msg: PubKeyMessage) => {
        if (msg.role === otherRole) {
          window.clearTimeout(timeout)
          onPubKeyCallback = null
          cachedReceiverPubKey = null
          console.log(`[${role}] Received public key from ${otherRole}`)
          resolve(msg.jwk)
        }
      }
    } else {
      onReceiverPubKeyCallback = (msg: PubKeyMessage) => {
        if (msg.role === otherRole) {
          window.clearTimeout(timeout)
          onReceiverPubKeyCallback = null
          console.log(`[${role}] Received public key from ${otherRole}`)
          resolve(msg.jwk)
        }
      }
    }
  })

  const ownJwk = await exportPublicKey(publicKey)
  const pubKeyMsg: PubKeyMessage = {
    type: 'pubkey',
    role,
    jwk: ownJwk,
  }
  conn.send(pubKeyMsg)
  console.log(`[${role}] Sent public key to peer`)

  const otherJwk = await otherJwkPromise

  const otherPublicKey = await importPublicKey(otherJwk)
  const sessionKey = await cryptoDeriveSessionKey(privateKey, otherPublicKey)

  const exported = await window.crypto.subtle.exportKey('raw', sessionKey)
  console.log(`[${role}] derived key:`, new Uint8Array(exported).toString())

  return sessionKey
}

export const subscribeToReceiverReady = (onReady: () => void): (() => void) => {
  onReceiverReadyCallback = onReady

  if (cachedReceiverReady) {
    cachedReceiverReady = false
    onReady()
  }

  return () => {
    if (onReceiverReadyCallback === onReady) {
      onReceiverReadyCallback = null
    }
  }
}

export const notifySenderReceiverReady = async (): Promise<void> => {
  if (!receiverDataConn) {
    throw new Error('No active PeerJS data connection.')
  }

  const readyMessage: ReceiverReadyMessage = { type: 'receiver-ready' }
  receiverDataConn.send(readyMessage)
}

export const sendFile = async (
  connection: TransferConnection,
  file: File,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<void> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  if (!senderDataConn) {
    throw new Error('No active PeerJS data connection.')
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  let offset = 0
  let chunkIndex = 0
  cachedReceiverAckCount = 0
  let ackedChunks = 0

  const waitForAck = (targetReceivedChunks: number): Promise<void> => {
    ackedChunks = Math.max(ackedChunks, cachedReceiverAckCount)

    if (ackedChunks >= targetReceivedChunks) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (onChunkAckCallback === handleAck) {
          onChunkAckCallback = null
        }
        reject(new Error('Timed out waiting for receiver chunk acknowledgement.'))
      }, CHUNK_ACK_TIMEOUT_MS)

      const handleAck = (msg: ChunkAckMessage): void => {
        ackedChunks = Math.max(ackedChunks, cachedReceiverAckCount, msg.receivedChunks)
        if (ackedChunks >= targetReceivedChunks) {
          window.clearTimeout(timeoutId)
          if (onChunkAckCallback === handleAck) {
            onChunkAckCallback = null
          }
          resolve()
        }
      }

      onChunkAckCallback = handleAck

      // If an ack arrived between the first pre-check and callback registration, resolve now.
      ackedChunks = Math.max(ackedChunks, cachedReceiverAckCount)
      if (ackedChunks >= targetReceivedChunks) {
        window.clearTimeout(timeoutId)
        if (onChunkAckCallback === handleAck) {
          onChunkAckCallback = null
        }
        resolve()
      }
    })
  }

  onProgress(0)

  while (offset < file.size) {
    const chunkBlob = file.slice(offset, offset + CHUNK_SIZE)
    const chunkBuffer = await chunkBlob.arrayBuffer()

    const encryptedBuffer = await secureEncryptChunk(chunkBuffer, sessionKey)

    const envelope: ChunkEnvelope = {
      type: 'chunk',
      index: chunkIndex,
      total: totalChunks,
      data: encryptedBuffer,
    }
    senderDataConn.send(envelope)

    offset += CHUNK_SIZE
    chunkIndex++
    onProgress(Math.round((chunkIndex / totalChunks) * 100))

    if (chunkIndex % ACK_EVERY_CHUNKS === 0) {
      await waitForAck(chunkIndex)
    }

    if (chunkIndex - ackedChunks >= MAX_IN_FLIGHT_CHUNKS) {
      await waitForAck(chunkIndex - MAX_IN_FLIGHT_CHUNKS + 1)
    }

    await delay(2)
  }

  await waitForAck(totalChunks)
  onChunkAckCallback = null

  const doneSignal: DoneSignal = {
    type: 'done',
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
  }
  senderDataConn.send(doneSignal)

  console.log('[sender] All chunks sent, done signal dispatched')

  const finishCleanup = (): void => {
    cleanupSenderConnection()
  }

  onReceiverCompleteCallback = () => {
    finishCleanup()
  }

  if (senderCleanupTimeoutId !== null) {
    window.clearTimeout(senderCleanupTimeoutId)
  }

  // Keep the channel open briefly so the receiver can confirm completion on slower networks.
  senderCleanupTimeoutId = window.setTimeout(() => {
    finishCleanup()
  }, 15_000)
}

export const receiveFile = async (
  connection: TransferConnection,
  sessionKey: CryptoKey | Promise<CryptoKey | null> | null,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  if (!connection.connected) {
    throw new Error('Connection is not active.')
  }

  if (!receiverDataConn) {
    throw new Error('No active PeerJS data connection.')
  }

  return new Promise((resolve, reject) => {
    const decryptedBlobs: Blob[] = []
    const outOfOrderChunks = new Map<number, ArrayBuffer>()
    let nextExpectedIndex = 0
    let receivedChunksCount = 0
    let totalChunksFromSender = 0
    let fileMeta: DoneSignal | null = null
    const sessionKeyPromise = Promise.resolve(sessionKey)

    const processChunk = async (encryptedChunk: ArrayBuffer): Promise<void> => {
      const resolvedSessionKey = await sessionKeyPromise
      if (!resolvedSessionKey) {
        throw new Error('Failed to derive session key.')
      }

      const decryptedBuffer = await secureDecryptChunk(encryptedChunk, resolvedSessionKey)
      decryptedBlobs.push(new Blob([decryptedBuffer]))
      receivedChunksCount += 1

      if (receiverDataConn) {
        const ack: ChunkAckMessage = {
          type: 'chunk-ack',
          receivedChunks: receivedChunksCount,
        }
        receiverDataConn.send(ack)
      }

      if (totalChunksFromSender > 0) {
        onProgress(Math.round((receivedChunksCount / totalChunksFromSender) * 100))
      }
    }

    sessionKeyPromise.catch((error) => {
      onFileDataCallback = null
      reject(error)
    })

    onProgress(2)

    onFileDataCallback = async (raw) => {
      try {
        if (isDoneSignal(raw)) {
          fileMeta = raw
          onFileDataCallback = null
          while (outOfOrderChunks.has(nextExpectedIndex)) {
            const bufferedChunk = outOfOrderChunks.get(nextExpectedIndex)
            outOfOrderChunks.delete(nextExpectedIndex)
            if (!bufferedChunk) {
              reject(new Error(`Missing buffered chunk at index ${nextExpectedIndex}`))
              return
            }
            await processChunk(bufferedChunk)
            nextExpectedIndex += 1
          }

          const expectedChunks =
            totalChunksFromSender > 0 ? totalChunksFromSender : Math.ceil(raw.fileSize / CHUNK_SIZE)

          if (receivedChunksCount !== expectedChunks) {
            reject(new Error(`Expected ${expectedChunks} chunks but received ${receivedChunksCount}.`))
            return
          }

          console.log(`Decrypted ${receivedChunksCount} chunks successfully`)

          const finalBlob = new Blob(decryptedBlobs, { type: fileMeta.fileType })

          try {
            const completeMessage: ReceiverCompleteMessage = { type: 'receiver-complete' }
            receiverDataConn?.send(completeMessage)
          } catch (error) {
            console.warn('[receiver] Could not confirm transfer completion to sender:', error)
          }

          resolve({
            name: fileMeta.fileName,
            size: finalBlob.size,
            type: fileMeta.fileType,
            blob: finalBlob,
          })

        } else if (isChunkEnvelope(raw)) {
          totalChunksFromSender = raw.total

          if (raw.index < nextExpectedIndex) {
            return
          }

          if (raw.index === nextExpectedIndex) {
            await processChunk(raw.data)
            nextExpectedIndex += 1

            while (outOfOrderChunks.has(nextExpectedIndex)) {
              const bufferedChunk = outOfOrderChunks.get(nextExpectedIndex)
              outOfOrderChunks.delete(nextExpectedIndex)
              if (!bufferedChunk) {
                reject(new Error(`Missing buffered chunk at index ${nextExpectedIndex}`))
                return
              }
              await processChunk(bufferedChunk)
              nextExpectedIndex += 1
            }
          } else {
            outOfOrderChunks.set(raw.index, raw.data)
          }
        }
      } catch (err) {
        onFileDataCallback = null
        reject(err)
      }
    }

    receiverDataConn!.on('error', (err) => {
      console.error('[receiver] data connection error:', err)
      reject(err)
    })

    receiverDataConn!.on('close', () => {
      if (!fileMeta) {
        reject(new Error('Connection closed before transfer completed.'))
      }
    })
  })
}
