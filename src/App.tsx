import { useEffect, useState } from 'react'
import ReceiverView from './views/ReceiverView'
import SenderView from './views/SenderView'
import { generateECDHKeyPair } from './utils/crypto'
import './App.css'

type InfoPage = 'transfer' | 'how' | 'security' | 'faq'
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'beam-theme'

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

const readInitialTheme = (): Theme => {
  try {
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (storedValue === 'light' || storedValue === 'dark') {
      return storedValue
    }
  } catch {
    // Ignore storage failures and fall back to system preference.
  }

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }

  return 'light'
}

const App = () => {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return readSessionIdFromLocation()
  })
  const [activePage, setActivePage] = useState<InfoPage>('transfer')
  const [theme, setTheme] = useState<Theme>(() => {
    return readInitialTheme()
  })
  const [keysGenerated, setKeysGenerated] = useState(false)

  const handleGenerateKeys = async () => {
    const keys = await generateECDHKeyPair()
    console.log('Generated Keys:', keys)
    setKeysGenerated(true)
  }

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage failures (for example, strict privacy mode).
    }
  }, [theme])

  return (
    <div className="beam-shell">
      <main className="beam-layout">
        <section className="beam-frame">
          <div className="beam-orb beam-orb--left" aria-hidden />
          <div className="beam-orb beam-orb--right" aria-hidden />

          <header className="beam-topbar">
            <nav className="beam-nav" aria-label="Primary">
              <button
                className={`beam-tab${activePage === 'transfer' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('transfer')
                }}
              >
                Transfer
              </button>
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
            </nav>
            <div className="topbar-right">
              <button
                className={`theme-slider${theme === 'dark' ? ' theme-slider--dark' : ''}`}
                type="button"
                role="switch"
                aria-checked={theme === 'dark'}
                aria-label="Toggle dark mode"
                onClick={() => {
                  setTheme((currentTheme) => {
                    return currentTheme === 'light' ? 'dark' : 'light'
                  })
                }}
              >
                <span className="theme-slider__label theme-slider__label--light">Light</span>
                <span className="theme-slider__label theme-slider__label--dark">Dark</span>
                <span className="theme-slider__thumb" aria-hidden />
              </button>
              <div className="mode-badge">{sessionId ? 'Receiver mode' : 'Sender mode'}</div>
            </div>
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
                {activePage === 'security' && (
                  <div style={{ marginTop: '20px' }}>
                    <button onClick={handleGenerateKeys} className="beam-tab beam-tab--active">
                      {keysGenerated ? 'Keys Generated (Check the Console)' : 'Generate Security Keys'}
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
