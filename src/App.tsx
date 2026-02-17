import { useEffect, useState } from 'react'
import ReceiverView from './views/ReceiverView'
import SenderView from './views/SenderView'
import './App.css'

type InfoPage = 'transfer' | 'how' | 'security' | 'faq'

const readSessionIdFromLocation = (): string | null => {
  const url = new URL(window.location.href)
  const fromQuery = url.searchParams.get('session')

  if (fromQuery) {
    return fromQuery
  }

  const hashValue = window.location.hash.replace(/^#/, '').trim()
  if (!hashValue) {
    return null
  }

  const hashParams = new URLSearchParams(hashValue)
  const fromHashParam = hashParams.get('session')

  if (fromHashParam) {
    return fromHashParam
  }

  return decodeURIComponent(hashValue)
}

const App = () => {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return readSessionIdFromLocation()
  })
  const [activePage, setActivePage] = useState<InfoPage>('transfer')

  useEffect(() => {
    const syncFromUrl = (): void => {
      setSessionId(readSessionIdFromLocation())
    }

    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('hashchange', syncFromUrl)

    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('hashchange', syncFromUrl)
    }
  }, [])

  return (
    <div className="beam-shell">
      <main className="beam-layout">
        <section className="beam-frame">
          <div className="beam-orb beam-orb--left" aria-hidden />
          <div className="beam-orb beam-orb--right" aria-hidden />

          <header className="beam-topbar">
            <nav className="beam-nav" aria-label="Primary">
              <button
                className={`beam-tab${activePage === 'how' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('how')
                }}
              >
                How it works
              </button>
              <button
                className={`beam-tab${activePage === 'security' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('security')
                }}
              >
                Security
              </button>
              <button
                className={`beam-tab${activePage === 'faq' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('faq')
                }}
              >
                FAQ
              </button>
              <button
                className={`beam-tab${activePage === 'transfer' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('transfer')
                }}
              >
                Transfer
              </button>
            </nav>
            <div className="mode-badge">{sessionId ? 'Receiver mode' : 'Sender mode'}</div>
          </header>

          <div className="beam-hero">
            <div className="beam-wordmark">BEAM</div>
            <h1>Send files in one link.</h1>
          </div>

          <div className="beam-panel">
            {activePage === 'transfer' && (sessionId ? <ReceiverView sessionId={sessionId} /> : <SenderView />)}
            {activePage !== 'transfer' && (
              <section className="beam-card beam-card--placeholder">
                <h2>{activePage === 'how' ? 'How it works' : activePage === 'security' ? 'Security' : 'FAQ'}</h2>
                <p>TO BE ADDED...</p>
              </section>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
