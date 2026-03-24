import type {
  ProgressCallback,
  ReceivedFile,
  ReceiverApprovalRequest,
  SessionInfo,
  TransferConnection,
  TransferFileMeta,
  TransferMode,
  PeerRole,
} from './transferTypes'
import * as localTransfer from './peerTransfer'
import * as networkTransfer from './networkTransfer'

const isLocalHost = (hostName: string): boolean => {
  return hostName === 'localhost' || hostName === '127.0.0.1'
}

const normalizeShareBaseUrl = (shareBaseUrl?: string): string => {
  const fallback = `${window.location.origin}${window.location.pathname}`

  if (!shareBaseUrl.trim()) {
    return fallback
  }

  try {
    const parsed = new URL(shareBaseUrl)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return fallback
  }
}

export const buildSessionShareUrl = (baseUrl: string, sessionId: string, mode: TransferMode): string => {
  const nextUrl = new URL(baseUrl)
  nextUrl.searchParams.set('session', sessionId)
  nextUrl.searchParams.set('mode', mode)
  return nextUrl.toString()
}

const getTransport = (mode: TransferMode) => {
  return mode === 'network' ? networkTransfer : localTransfer
}

export const getDefaultTransferMode = (): TransferMode => {
  return isLocalHost(window.location.hostname) ? 'local' : 'network'
}

export const createSession = (mode: TransferMode, shareBaseUrl = ''): SessionInfo => {
  const transport = getTransport(mode)
  const session = transport.createSession()

  return {
    ...session,
    mode,
    shareUrl: buildSessionShareUrl(normalizeShareBaseUrl(shareBaseUrl), session.sessionId, mode),
  }
}

export const isTransferCompleted = (mode: TransferMode, sessionId: string): boolean => {
  return getTransport(mode).isTransferCompleted(sessionId)
}

export const initSenderPeer = async (
  mode: TransferMode,
  sessionId: string,
  onRequest: (request: ReceiverApprovalRequest) => void,
): Promise<void> => {
  await getTransport(mode).initSenderPeer(sessionId, onRequest)
}

export const approveReceiverRequest = async (
  mode: TransferMode,
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  return getTransport(mode).approveReceiverRequest(sessionId, requestId)
}

export const rejectReceiverRequest = async (
  mode: TransferMode,
  sessionId: string,
  requestId: string,
): Promise<void> => {
  await getTransport(mode).rejectReceiverRequest(sessionId, requestId)
}

export const requestReceiverConnection = async (
  mode: TransferMode,
  sessionId: string,
): Promise<ReceiverApprovalRequest> => {
  return getTransport(mode).requestReceiverConnection(sessionId)
}

export const waitForSenderApproval = async (
  mode: TransferMode,
  sessionId: string,
  requestId: string,
): Promise<TransferConnection> => {
  return getTransport(mode).waitForSenderApproval(sessionId, requestId)
}

export const publishPendingFileMeta = (mode: TransferMode, sessionId: string, file: File | null): void => {
  getTransport(mode).publishPendingFileMeta(sessionId, file)
}

export const getPendingFileMeta = (mode: TransferMode, sessionId: string): TransferFileMeta | null => {
  if (mode === 'network') {
    return networkTransfer.getPendingFileMeta()
  }

  return localTransfer.getPendingFileMeta(sessionId)
}

export const dismissPendingFileMeta = (mode: TransferMode, sessionId: string): void => {
  if (mode === 'network') {
    networkTransfer.dismissPendingFileMeta()
    return
  }

  localTransfer.dismissPendingFileMeta(sessionId)
}

export const waitForReceiverFileAcceptance = async (mode: TransferMode): Promise<void> => {
  if (mode === 'network') {
    await networkTransfer.waitForReceiverFileAcceptance()
    return
  }

  await localTransfer.waitForReceiverFileAcceptance()
}

export const confirmIncomingFileReceipt = async (mode: TransferMode, sessionId: string): Promise<void> => {
  if (mode === 'network') {
    await networkTransfer.confirmIncomingFileReceipt()
    return
  }

  localTransfer.confirmIncomingFileReceipt(sessionId)
}

export const declineIncomingFileReceipt = async (mode: TransferMode, sessionId: string): Promise<void> => {
  if (mode === 'network') {
    await networkTransfer.declineIncomingFileReceipt()
    return
  }

  localTransfer.declineIncomingFileReceipt(sessionId)
}

export const deriveSessionKey = async (
  mode: TransferMode,
  sessionId: string,
  role: PeerRole,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey | null> => {
  return getTransport(mode).deriveSessionKey(sessionId, role, privateKey, publicKey)
}

export const sendFile = async (
  mode: TransferMode,
  connection: TransferConnection,
  file: File,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<void> => {
  await getTransport(mode).sendFile(connection, file, sessionKey, onProgress)
}

export const receiveFile = async (
  mode: TransferMode,
  connection: TransferConnection,
  sessionKey: CryptoKey,
  onProgress: ProgressCallback,
): Promise<ReceivedFile> => {
  return getTransport(mode).receiveFile(connection, sessionKey, onProgress)
}
