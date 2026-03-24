import { useEffect, useState } from 'react'
import ReceiverView from './views/ReceiverView'
import SenderView from './views/SenderView'
import type { TransferMode } from './lib/transferTypes'
import './App.css'

type InfoPage = 'transfer' | 'how' | 'safety' | 'faq'
type Theme = 'light' | 'dark'

interface TransferRoute {
  mode: TransferMode
  sessionId: string | null
}

interface FlowStep {
  eyebrow: string
  title: string
  body: string
}

const THEME_STORAGE_KEY = 'beam-theme'
const FAQ_ITEMS = [
  {
    question: 'How is Beam different from other sharing methods?',
    answer:
      'Beam is built around a live handoff instead of a passive upload link. The sender approves the receiver first, then the receiver reviews the file before accepting it.',
  },
  {
    question: 'Why is Beam trustworthy?',
    answer:
      'Trust comes from visible checkpoints: the sender must approve the receiver, the receiver sees file details before accepting, and both sides stay in the loop throughout the transfer.',
  },
  {
    question: 'What should I do for another computer?',
    answer:
      'Open Beam from a reachable network address first, then generate the share link from that page. A localhost link only works on the same machine.',
  },
  {
    question: 'How does Beam handle privacy, consent, and Menlo ethics?',
    answer:
      'Beam combines privacy with consent checkpoints: it limits unnecessary oversight, keeps sender approval in place, gives the receiver file context before download, and adds usage guidance so law, beneficence, and fairness are all addressed in one flow.',
  },
]

const HOW_STEPS: FlowStep[] = [
  {
    eyebrow: 'Step 01',
    title: 'Generate the link',
    body: 'Open Beam on the sender side, keep that tab open, and create a fresh session link for this transfer.',
  },
  {
    eyebrow: 'Step 02',
    title: 'Share and connect',
    body: 'Send the link to the receiver. They open it and press Connect so the sender gets the approval request.',
  },
  {
    eyebrow: 'Step 03',
    title: 'Approve the receiver',
    body: 'The sender reviews the request and approves it before any file step can continue.',
  },
  {
    eyebrow: 'Step 04',
    title: 'Offer the file',
    body: 'The sender drops in the file or clicks browse, then presses Send to offer that file to the receiver.',
  },
  {
    eyebrow: 'Step 05',
    title: 'Receive and save',
    body: 'The receiver accepts the popup, receives the file, and saves it locally once the transfer completes.',
  },
]

const SAFETY_STEPS: FlowStep[] = [
  {
    eyebrow: 'Safety 01',
    title: 'Share links carefully',
    body: 'Treat each Beam link like an invitation. Only send it to the exact person who should receive the file.',
  },
  {
    eyebrow: 'Safety 02',
    title: 'Sender approval stays in control',
    body: 'A receiver cannot continue until the sender approves that specific request from the sender tab.',
  },
  {
    eyebrow: 'Safety 03',
    title: 'Receiver checks the file first',
    body: 'The receiver sees the file name, size, and type before accepting the incoming transfer.',
  },
  {
    eyebrow: 'Safety 04',
    title: 'Use a reachable address',
    body: 'For another computer, generate the link from a Beam page the other device can actually open.',
  },
  {
    eyebrow: 'Safety 05',
    title: 'Keep the tabs open',
    body: 'Closing either side during approval, sending, or receiving can interrupt the transfer and require a fresh link.',
  },
  {
    eyebrow: 'Safety 06',
    title: 'This is still a dev build',
    body: 'Beam is designed for direct transfer, but this project should not be treated as hardened long-term storage.',
  },
]

const isLocalHost = (hostName: string): boolean => {
  return hostName === 'localhost' || hostName === '127.0.0.1'
}

const readTransferModeFromLocation = (): TransferMode => {
  const url = new URL(window.location.href)
  const fromQuery = url.searchParams.get('mode')

  if (fromQuery === 'local' || fromQuery === 'network') {
    return fromQuery
  }

  return isLocalHost(url.hostname) ? 'local' : 'network'
}

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

const readTransferRouteFromLocation = (): TransferRoute => {
  return {
    mode: readTransferModeFromLocation(),
    sessionId: readSessionIdFromLocation(),
  }
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

const SunIcon = () => {
  return (
    <svg aria-hidden="true" className="theme-slider__icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4.25" fill="currentColor" />
      <path
        d="M12 1.75v3.1M12 19.15v3.1M4.85 4.85l2.2 2.2M16.95 16.95l2.2 2.2M1.75 12h3.1M19.15 12h3.1M4.85 19.15l2.2-2.2M16.95 7.05l2.2-2.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

const MoonIcon = () => {
  return (
    <svg aria-hidden="true" className="theme-slider__icon" viewBox="0 0 24 24">
      <path
        d="M15.4 3.75a8.75 8.75 0 1 0 5 15.4 9.2 9.2 0 0 1-3.15.55 9.2 9.2 0 0 1-9.2-9.2 9.2 9.2 0 0 1 7.35-8.99Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path d="M17.7 5.2v2.1M16.65 6.25h2.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

const App = () => {
  const [transferRoute, setTransferRoute] = useState<TransferRoute>(() => {
    return readTransferRouteFromLocation()
  })
  const [activePage, setActivePage] = useState<InfoPage>('transfer')
  const [theme, setTheme] = useState<Theme>(() => {
    return readInitialTheme()
  })

  useEffect(() => {
    const syncFromUrl = (): void => {
      setTransferRoute(readTransferRouteFromLocation())
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

  const renderFlowPanel = (title: string, intro: string, steps: FlowStep[], note: string) => {
    return (
      <section className="beam-card beam-card--info">
        <h2>{title}</h2>
        <p className="flow-intro">{intro}</p>
        <div className="flow-stack">
          {steps.map((step, index) => {
            return (
              <div className="flow-segment" key={step.eyebrow}>
                <article className="flow-card">
                  <div className="flow-card__top">
                    <span className="flow-card__eyebrow">{step.eyebrow}</span>
                    <span className="flow-card__dot" aria-hidden />
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
                {index < steps.length - 1 && (
                  <div className="flow-arrow" aria-hidden>
                    <span />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="info-note">{note}</p>
      </section>
    )
  }

  const renderInfoPanel = () => {
    if (activePage === 'how') {
      return renderFlowPanel(
        'How it works',
        'Beam moves through a fixed handoff: link first, approval second, file transfer last.',
        HOW_STEPS,
        'Use a fresh session link for each transfer and keep the sender tab open until the receiver has saved the file.',
      )
    }

    if (activePage === 'safety') {
      return renderFlowPanel(
        'Privacy & Safety',
        'The goal is simple: keep control with the sender, keep context with the receiver, and keep the link private.',
        SAFETY_STEPS,
        'Beam is best for trusted person-to-person transfers. Do not share harmful or illegal content, and regenerate the link for every new session.',
      )
    }

    return (
      <section className="beam-card beam-card--info">
        <h2>FAQ</h2>
        <p className="flow-intro">Quick answers for the questions people usually ask before they send the link.</p>
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
                className={`beam-tab${activePage === 'safety' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('safety')
                }}
              >
                Privacy &amp; Safety
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
              <div
                className={`theme-slider${theme === 'dark' ? ' theme-slider--dark' : ''}`}
                role="group"
                aria-label="Theme mode"
              >
                <button
                  className={`theme-slider__button${theme === 'light' ? ' theme-slider__button--active' : ''}`}
                  type="button"
                  aria-label="Light mode"
                  aria-pressed={theme === 'light'}
                  data-tooltip="Light mode"
                  title="Light mode"
                  onClick={() => {
                    setTheme('light')
                  }}
                >
                  <SunIcon />
                </button>
                <button
                  className={`theme-slider__button${theme === 'dark' ? ' theme-slider__button--active' : ''}`}
                  type="button"
                  aria-label="Dark mode"
                  aria-pressed={theme === 'dark'}
                  data-tooltip="Dark mode"
                  title="Dark mode"
                  onClick={() => {
                    setTheme('dark')
                  }}
                >
                  <MoonIcon />
                </button>
              </div>
              <div className="mode-badge">{transferRoute.sessionId ? 'Receiver mode' : 'Sender mode'}</div>
            </div>
          </header>

          <div className="beam-hero">
            <div className="beam-wordmark">BEAM</div>
            <h1>Send files in one link.</h1>
          </div>

          <div className="beam-panel">
            {activePage === 'transfer' &&
              (transferRoute.sessionId ? (
                <ReceiverView sessionId={transferRoute.sessionId} transportMode={transferRoute.mode} />
              ) : (
                <SenderView />
              ))}
            {activePage !== 'transfer' && renderInfoPanel()}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
