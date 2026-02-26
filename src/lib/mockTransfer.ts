import {Peer, DataConnection} from 'peerjs'

import {
  type ProgressCallback,
  type ReceivedFile,
  type SessionInfo,
  type TransferConnection,
} from './transferTypes'

/*
  Represents elements of an active session
  - peer, connected or not?, sending or receiving?
  - (optional) receiver approving incoming connection?,
    the file being sent, the chunks of file
*/
interface ActiveSession {
  peer: Peer, 
  connection: DataConnection | null, 
  role: 'sender' | 'receiver', 
  onApprovalRequest?: (approve: boolean) => void, 
  pendingFile?: File,
  fileChunks?: ArrayBuffer[]
}

const activeSessions = new Map<string, ActiveSession>()

/*
  Generate random session IDs using WebCryptoAPI
*/
const createRandomId = (): string => {
  const uuid = self.crypto.randomUUID();
  return `beam-${uuid}`
}

/*
  Called when the sender clicks "Generate Link"
  Creates a PeerJS peer and returns the session info
  (PeerJS uses Google's public STUN servers by default)
*/
export const createSession = (): SessionInfo => {
  const sessionId = createRandomId()
  const peer = new Peer(sessionId)

  activeSessions.set(sessionId, {peer, connection: null, role: 'sender'})

  const shareUrl = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`

  return {
    sessionId,
    shareUrl,
    createdAt: Date.now(),
  }
}

  /*
    SENDER: waits for the receiver to connect with them
  */
export const waitForReceiver = async (sessionId: string): Promise<TransferConnection> => {
  const session = activeSessions.get(sessionId)
  if(!session || session.role !== 'sender') {
    throw new Error('Sender session is invalid.')
  }

  //wait asynchronously for receiver to connect.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connection timeout - receiver has not connected."))
    }, 600);

    (session.peer).on('connection', (conn: DataConnection) => {
      //check if a receiver has already connected
      if (session.connection) {
         conn.on('open', () => {
          conn.send({type: 'rejection', reason: 'existing_connection'})
          conn.close()
         })
        return
      }

      const approval = window.confirm("New connection request. Approve?")

      if (!approval) {
        conn.on('open', () => {
          conn.send({type: 'rejection', reason: 'denied approval'})
          conn.close()
        })
        clearTimeout(timeout)
        reject(new Error("Connection denied"))
        return
      }

      conn.on('open', () => {
        clearTimeout(timeout)
        session.connection = conn
        resolve ({
          id: conn.peer,
          sessionId,
          role: 'sender',
          connected: true,
        })
      });

      conn.on('error', () => {
        clearTimeout(timeout)
        reject(new Error("Error connecting."))
      });

      (session.peer).on('error', () => {
        clearTimeout(timeout)
        reject(new Error("Error with peer."))
      })

    })
  })
}

/*
  RECEIVER: attempts to connect with the sender to receive the file
*/
export const connectAsReceiver = async (sessionId: string): Promise<TransferConnection> => {
  const peer = new Peer()

  return new Promise((resolve, reject) => {
    peer.
  })

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
