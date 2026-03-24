export type TransferStatus = 'idle' | 'waiting' | 'connected' | 'transferring' | 'done' | 'error'

export type PeerRole = 'sender' | 'receiver'
export type TransferMode = 'local' | 'network'

export interface SessionInfo {
  sessionId: string
  shareUrl: string
  createdAt: number
  mode: TransferMode
}

export interface TransferConnection {
  id: string
  sessionId: string
  role: PeerRole
  connected: boolean
  mode: TransferMode
}

export interface ReceiverApprovalRequest {
  requestId: string
  receiverLabel: string
  requestedAt: number
}

export interface ReceivedFile {
  name: string
  size: number
  type: string
  blob: Blob
}

export interface TransferFileMeta {
  name: string
  size: number
  type: string
  sentAt: number
}

export type ProgressCallback = (progress: number) => void
