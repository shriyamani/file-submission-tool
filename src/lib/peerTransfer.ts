import {
  approveReceiverRequest as approveMockReceiverRequest,
  createSession as createMockSession,
  deriveSessionKey as deriveMockSessionKey,
  getPendingFileMeta as getMockPendingFileMeta,
  isTransferCompleted,
  publishPendingFileMeta as publishMockPendingFileMeta,
  receiveFile as receiveMockFile,
  rejectReceiverRequest as rejectMockReceiverRequest,
  requestReceiverConnection as requestMockReceiverConnection,
  sendFile as sendMockFile,
  waitForSenderApproval as waitForMockSenderApproval,
} from './mockTransfer'
import type {
  ProgressCallback,
  ReceivedFile,
  ReceiverApprovalRequest,
  SessionInfo,
  TransferConnection,
  TransferFileMeta,
  PeerRole,
} from './transferTypes'

const REQUEST_POLL_INTERVAL_MS = 180
const FILE_APPROVAL_POLL_INTERVAL_MS = 180
const FILE_APPROVAL_TIMEOUT_MS = 90_000
const FILE_APPROVAL_KEY_PREFIX = 'beam-file-approval:'
const SESSION_STORAGE_KEY_PREFIX = 'beam-mock-session:'
const BROADCAST_CHANNEL_NAME = 'beam-local-transfer'

type FileApprovalState = 'pending' | 'approved' | 'declined'
type ReceiverDecision = 'approved' | 'rejected'

type BeamChannelMessage =
  | {
      type: 'receiver-request'
      sessionId: string
      request: ReceiverApprovalRequest
    }
  | {
      type: 'sender-response'
      sessionId: string
      requestId: string
      decision: ReceiverDecision
    }
  | {
      type: 'file-approval'
      sessionId: string
      state: FileApprovalState
    }

let senderRequestPollId: number | null = null
let activeSenderSessionId: string | null = null
let activeReceiverSessionId: string | null = null
let lastPendingRequestKey: string | null = null
let senderStorageListener: ((event: StorageEvent) => void) | null = null
let beamChannel: BroadcastChannel | null = null
let senderChannelListener: ((event: MessageEvent<BeamChannelMessage>) => void) | null = null
let receiverResponseListener: ((event: MessageEvent<BeamChannelMessage>) => void) | null = null
let receiverFileApprovalListener: ((event: MessageEvent<BeamChannelMessage>) => void) | null = null

const getFileApprovalStorageKey = (sessionId: string): string => {
  return `${FILE_APPROVAL_KEY_PREFIX}${sessionId}`
}

const getBeamChannel = (): BroadcastChannel | null => {
  if (typeof window.BroadcastChannel === 'undefined') {
    return null
  }

  if (!beamChannel) {
    beamChannel = new window.BroadcastChannel(BROADCAST_CHANNEL_NAME)
  }

  return beamChannel
}

const getSessionStorageKey = (sessionId: string): string => {
  return `${SESSION_STORAGE_KEY_PREFIX}${sessionId}`
}

const readFileApprovalState = (sessionId: string): FileApprovalState | null => {
  const raw = window.localStorage.getItem(getFileApprovalStorageKey(sessionId))

  if (raw === 'pending' || raw === 'approved' || raw === 'declined') {
    return raw
  }

  return null
}

const readPendingReceiverRequest = (sessionId: string): ReceiverApprovalRequest | null => {
  try {
    const raw = window.localStorage.getItem(getSessionStorageKey(sessionId))
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as {
      receiverRequest?: {
        requestId?: unknown
        receiverLabel?: unknown
        requestedAt?: unknown
        state?: unknown
      } | null
    }

    const request = parsed.receiverRequest
    if (!request || request.state !== 'pending') {
      return null
    }

    if (
      typeof request.requestId !== 'string' ||
      typeof request.receiverLabel !== 'string' ||
      typeof request.requestedAt !== 'number'
    ) {
      return null
    }

    return {
      requestId: request.requestId,
      receiverLabel: request.receiverLabel,
      requestedAt: request.requestedAt,
    }
  } catch {
    return null
  }
}

const writeFileApprovalState = (sessionId: string, state: FileApprovalState | null): void => {
  const storageKey = getFileApprovalStorageKey(sessionId)

  if (!state) {
    window.localStorage.removeItem(storageKey)
    return
  }

  window.localStorage.setItem(storageKey, state)
}

const stopSenderRequestPolling = (): void => {
  if (senderRequestPollId !== null) {
    window.clearInterval(senderRequestPollId)
    senderRequestPollId = null
  }

  if (senderStorageListener) {
    window.removeEventListener('storage', senderStorageListener)
    senderStorageListener = null
  }

  const channel = getBeamChannel()
  if (channel && senderChannelListener) {
    channel.removeEventListener('message', senderChannelListener)
    senderChannelListener = null
  }

  lastPendingRequestKey = null
}

export const createSession = (): SessionInfo => {
  const session = createMockSession()
  activeSenderSessionId = session.sessionId
  writeFileApprovalState(session.sessionId, null)
  return {
    ...session,
    mode: 'local',
  }
}

export { isTransferCompleted }

export const initSenderPeer = async (
  sessionId: string,
  onRequest: (request: ReceiverApprovalRequest) => void,
): Promise<void> => {
  stopSenderRequestPolling()
  activeSenderSessionId = sessionId
  writeFileApprovalState(sessionId, null)

  const emitPendingRequest = (): void => {
    const request = readPendingReceiverRequest(sessionId)

    if (!request) {
      lastPendingRequestKey = null
      return
    }

    const requestKey = `${request.requestId}:${request.requestedAt}`
    if (requestKey === lastPendingRequestKey) {
      return
    }

    lastPendingRequestKey = requestKey
    onRequest(request)
  }

  emitPendingRequest()
  senderRequestPollId = window.setInterval(() => {
    emitPendingRequest()
  }, REQUEST_POLL_INTERVAL_MS)
  senderStorageListener = (event: StorageEvent): void => {
    if (event.key !== getSessionStorageKey(sessionId)) {
      return
    }

    emitPendingRequest()
  }
  window.addEventListener('storage', senderStorageListener)

  const channel = getBeamChannel()
  if (channel) {
    senderChannelListener = (event: MessageEvent<BeamChannelMessage>): void => {
      const message = event.data
      if (message.type !== 'receiver-request' || message.sessionId !== sessionId) {
        return
      }

      const requestKey = `${message.request.requestId}:${message.request.requestedAt}`
      if (requestKey === lastPendingRequestKey) {
        return
      }

      lastPendingRequestKey = requestKey
      onRequest(message.request)
    }

    channel.addEventListener('message', senderChannelListener)
  }
}

export const approveReceiverRequest = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  activeSenderSessionId = sessionId
  const connection = await approveMockReceiverRequest(sessionId, requestId)
  getBeamChannel()?.postMessage({
    type: 'sender-response',
    sessionId,
    requestId,
    decision: 'approved',
  } satisfies BeamChannelMessage)
  return {
    ...connection,
    mode: 'local',
  }
}

export const rejectReceiverRequest = async (sessionId: string, requestId: string): Promise<void> => {
  await rejectMockReceiverRequest(sessionId, requestId)
  writeFileApprovalState(sessionId, null)
  getBeamChannel()?.postMessage({
    type: 'sender-response',
    sessionId,
    requestId,
    decision: 'rejected',
  } satisfies BeamChannelMessage)
  stopSenderRequestPolling()
}

export const requestReceiverConnection = async (sessionId: string): Promise<ReceiverApprovalRequest> => {
  activeReceiverSessionId = sessionId
  const request = await requestMockReceiverConnection(sessionId)
  getBeamChannel()?.postMessage({
    type: 'receiver-request',
    sessionId,
    request,
  } satisfies BeamChannelMessage)
  return request
}

export const waitForSenderApproval = async (
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  activeReceiverSessionId = sessionId
  const channel = getBeamChannel()

  if (!channel) {
    return waitForMockSenderApproval(sessionId, requestId)
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      if (receiverResponseListener) {
        channel.removeEventListener('message', receiverResponseListener)
        receiverResponseListener = null
      }
    }

    receiverResponseListener = (event: MessageEvent<BeamChannelMessage>): void => {
      const message = event.data
      if (message.type !== 'sender-response' || message.sessionId !== sessionId || message.requestId !== requestId) {
        return
      }

      cleanup()

      if (message.decision === 'approved') {
        resolve({
          id: `receiver-${sessionId}`,
          sessionId,
          role: 'receiver',
          connected: true,
          mode: 'local',
        })
        return
      }

      reject(new Error('Sender rejected the receiver request.'))
    }

    channel.addEventListener('message', receiverResponseListener)

    waitForMockSenderApproval(sessionId, requestId)
      .then((connection) => {
        cleanup()
        resolve(connection)
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}

export const publishPendingFileMeta = (sessionId: string, file: File | null): void => {
  publishMockPendingFileMeta(sessionId, file)
  writeFileApprovalState(sessionId, file ? 'pending' : null)
}

export const getPendingFileMeta = (sessionId: string): TransferFileMeta | null => {
  return getMockPendingFileMeta(sessionId)
}

export const dismissPendingFileMeta = (sessionId: string): void => {
  publishMockPendingFileMeta(sessionId, null)
  writeFileApprovalState(sessionId, null)
}

export const waitForReceiverFileAcceptance = async (): Promise<void> => {
  if (!activeSenderSessionId) {
    throw new Error('No active sender session.')
  }

  const sessionId = activeSenderSessionId
  const channel = getBeamChannel()

  if (!channel) {
    const timeoutAt = Date.now() + FILE_APPROVAL_TIMEOUT_MS

    while (Date.now() < timeoutAt) {
      const state = readFileApprovalState(sessionId)

      if (state === 'approved') {
        return
      }

      if (state === 'declined') {
        throw new Error('Receiver declined the file.')
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, FILE_APPROVAL_POLL_INTERVAL_MS)
      })
    }

    throw new Error('Timed out waiting for receiver file approval.')
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for receiver file approval.'))
    }, FILE_APPROVAL_TIMEOUT_MS)

    const cleanup = (): void => {
      window.clearTimeout(timeoutId)
      if (receiverFileApprovalListener) {
        channel.removeEventListener('message', receiverFileApprovalListener)
        receiverFileApprovalListener = null
      }
    }

    const settleFromState = (state: FileApprovalState | null): boolean => {
      if (state === 'approved') {
        cleanup()
        resolve()
        return true
      }

      if (state === 'declined') {
        cleanup()
        reject(new Error('Receiver declined the file.'))
        return true
      }

      return false
    }

    if (settleFromState(readFileApprovalState(sessionId))) {
      return
    }

    receiverFileApprovalListener = (event: MessageEvent<BeamChannelMessage>): void => {
      const message = event.data
      if (message.type !== 'file-approval' || message.sessionId !== sessionId) {
        return
      }

      settleFromState(message.state)
    }

    channel.addEventListener('message', receiverFileApprovalListener)
  })
}

export const confirmIncomingFileReceipt = (sessionId?: string): void => {
  const resolvedSessionId = sessionId ?? activeReceiverSessionId

  if (!resolvedSessionId) {
    throw new Error('No active receiver session.')
  }

  activeReceiverSessionId = resolvedSessionId
  writeFileApprovalState(resolvedSessionId, 'approved')
  getBeamChannel()?.postMessage({
    type: 'file-approval',
    sessionId: resolvedSessionId,
    state: 'approved',
  } satisfies BeamChannelMessage)
}

export const declineIncomingFileReceipt = (sessionId: string): void => {
  writeFileApprovalState(sessionId, 'declined')
  getBeamChannel()?.postMessage({
    type: 'file-approval',
    sessionId,
    state: 'declined',
  } satisfies BeamChannelMessage)
}

export const deriveSessionKey = async (
  sessionId: string,
  role: PeerRole,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey | null> => {
  return deriveMockSessionKey(sessionId, role, privateKey, publicKey)
}

export const sendFile = async (
  connection: TransferConnection,
  file: File,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<void> => {
  await sendMockFile(connection, file, sessionKey, onProgress)
}

export const receiveFile = async (
  connection: TransferConnection,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  return receiveMockFile(connection, sessionKey, onProgress)
}
