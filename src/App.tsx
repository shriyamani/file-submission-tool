import { useEffect, useState } from 'react'
import ReceiverView from './views/ReceiverView'
import SenderView from './views/SenderView'
import { generateECDHKeyPair } from './utils/crypto'
import './App.css'

type InfoPage = 'transfer' | 'how' | 'security' | 'faq'
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'beam-theme'
const FAQ_ITEMS = [
  {
    question: 'How does Beam address Menlo Report ethics concerns?',
    answer:
      'Beam balances privacy with harm reduction through interface design. It provides user guidance, consent checkpoints, and clear transfer context instead of broad server-side surveillance.',
  },
  {
    question: 'How does Beam support Respect for Law and Public Interest?',
    answer:
      'Beam includes visible usage guidance that reminds users not to share illegal or harmful content and to use the platform responsibly.',
  },
  {
    question: 'How does Beam support Beneficence?',
    answer:
      'Receivers can review file name, size, and type before they accept a transfer. The app also encourages users to share links only through trusted communication channels.',
  },
  {
    question: 'How does Beam respond to Justice concerns?',
    answer:
      'Because receivers face higher risk than senders, Beam adds a confirmation prompt before file receipt so the receiver keeps control over whether to continue.',
  },
]

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

  const renderInfoPanel = () => {
    if (activePage === 'how') {
      return (
        <section className="beam-card beam-card--info">
          <h2>How it works</h2>
          <ol className="info-list">
            <li>
              <strong>Sender chooses a file and creates a share link.</strong>
              <span>
                The app creates a temporary session ID and adds it to the URL so a receiver can join the same session.
              </span>
            </li>
            <li>
              <strong>Receiver opens the link and requests access.</strong>
              <span>
                Sender must approve the request first, so only the intended receiver can continue.
              </span>
            </li>
            <li>
              <strong>Sender presses Send and receiver presses Receive file.</strong>
              <span>
                Transfer progress updates in both tabs, then the receiver gets a local Save file button.
              </span>
            </li>
            <li>
              <strong>The received file never uploads to a permanent cloud store in this demo.</strong>
              <span>
                This build keeps data in-browser for session simulation while full networking integration is in progress.
              </span>
            </li>
          </ol>
          <p className="info-note">
            Current dev status: transport is mocked, so cross-device reliability depends on the networking layer that is
            still being integrated.
          </p>
        </section>
      )
    }

    if (activePage === 'security') {
      return (
        <section className="beam-card beam-card--placeholder">
          <h2>Security</h2>
          <p>Security details are still being documented. For now you can generate a sample key pair below.</p>
          <div style={{ marginTop: '20px' }}>
            <button onClick={handleGenerateKeys} className="beam-tab beam-tab--active">
              {keysGenerated ? 'Keys Generated (Check the Console)' : 'Generate Security Keys'}
            </button>
          </div>
        </section>
      )
    }

    return (
      <section className="beam-card beam-card--info">
        <h2>FAQ</h2>
        <div className="faq-list">
          {FAQ_ITEMS.map((item, index) => {
            return (
              <details className="faq-item" key={item.question} open={index === 0}>
                <summary className="faq-question">{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            )
          })}
        </div>
        <p className="info-note">
          Beam intentionally minimizes centralized oversight to preserve privacy, while these design choices provide
          practical safeguards for safer use.
        </p>
      </section>
    )
  }

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
            {activePage !== 'transfer' && renderInfoPanel()}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
