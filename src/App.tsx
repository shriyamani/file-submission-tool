import { useEffect, useState } from 'react'
import ReceiverView from './views/ReceiverView'
import SenderView from './views/SenderView'
import './App.css'

type InfoPage = 'transfer' | 'how' | 'privacy' | 'faq'
type Theme = 'light' | 'dark'

interface JourneyItem {
  label: string
  title: string
  description: string
}

const THEME_STORAGE_KEY = 'beam-theme'

const HOW_STEPS: JourneyItem[] = [
  {
    label: 'STEP 01',
    title: 'Sender uploads the file',
    description:
      'The sender opens Beam, clicks the drop zone, and chooses the document to share.',
  },
  {
    label: 'STEP 02',
    title: 'Generate the share link',
    description:
      'The sender presses Generate share link. Beam creates a fresh session URL for that transfer.',
  },
  {
    label: 'STEP 03',
    title: 'Receiver opens the link and connects',
    description:
      'The sender shares that link by text or email. The receiver opens it and clicks Connect so the sender gets the access request.',
  },
  {
    label: 'STEP 04',
    title: 'Receiver confirms they want the file',
    description:
      'The receiver clicks Receive file. That confirms they are ready before the sender starts sending anything.',
  },
  {
    label: 'STEP 05',
    title: 'Sender presses Send',
    description:
      'The sender clicks Send. The transfer starts and both screens should show live progress updates.',
  },
  {
    label: 'STEP 06',
    title: 'Receiver saves the file',
    description:
      'When the file arrives, the receiver clicks Save file to download it locally. Success means both screens show completion and confetti.',
  },
]

const PRIVACY_ITEMS: JourneyItem[] = [
  {
    label: 'SAFETY 01',
    title: 'Sender approval comes first',
    description:
      'A receiver cannot continue just by opening a link. The sender must approve that specific connection request before the session can move forward.',
  },
  {
    label: 'SAFETY 02',
    title: 'Receiver consent stays explicit',
    description:
      'The receiver actively clicks Connect and then Receive file, so the handoff stays intentional on both sides instead of happening silently.',
  },
  {
    label: 'SAFETY 03',
    title: 'Each transfer gets its own session',
    description:
      'Beam creates a fresh session link for each handoff and uses a per-session key exchange before file data starts moving.',
  },
  {
    label: 'SAFETY 04',
    title: 'Privacy depends on link handling too',
    description:
      'Treat the Beam link like an invite. Send it only to the intended receiver and use a trusted channel such as direct text or email.',
  },
]

const FAQ_ITEMS = [
  {
    question: 'What is the easiest way to test Beam the first time?',
    answer:
      'Keep both Beam pages on the transfer view and leave the sender tab open from link generation through final download.',
  },
  {
    question: 'Why do both the sender and receiver have to click buttons?',
    answer:
      'Beam is built as a consent-based handoff. The sender approves who can connect, and the receiver confirms they are ready before the file is sent.',
  },
  {
    question: 'What if the receiver clicks Connect and nothing happens?',
    answer:
      'Check with the sender first. The sender still has to approve that request. If the request is stale, generate a fresh link and try again.',
  },
  {
    question: 'What if Receive file is clicked but the transfer does not start?',
    answer:
      'That usually means the sender has not pressed Send yet, or one of the transfer tabs was refreshed or closed. Keep both pages open and retry in order.',
  },
  {
    question: 'Should I reuse an old Beam link?',
    answer:
      'No. The safer workflow is to generate a fresh link for each transfer so each handoff starts with a clean session.',
  },
  {
    question: 'Does Beam act like a public file page?',
    answer:
      'No. Beam is designed around a direct sender-to-receiver handoff with approval and receiver confirmation, not a public browsing page for uploaded files.',
  },
  {
    question: 'Which file formats does Beam support?',
    answer:
      'Beam supports any file format: documents, images, videos, archives, or apps. Since the transfer happens as a binary stream, the tool stays format-agnostic.',
  },
  {
    question: 'Can I send a folder?',
    answer:
      'Beam handles single files per transfer. To send a folder, compress it into a .zip file first to preserve its internal structure.',
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

const SunIcon = () => {
  return (
    <svg
      className="theme-toggle__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.7" />
      <path d="M12 18.8v2.7" />
      <path d="M2.5 12h2.7" />
      <path d="M18.8 12h2.7" />
      <path d="M5.3 5.3l1.9 1.9" />
      <path d="M16.8 16.8l1.9 1.9" />
      <path d="M5.3 18.7l1.9-1.9" />
      <path d="M16.8 7.2l1.9-1.9" />
    </svg>
  )
}

const MoonIcon = () => {
  return (
    <svg
      className="theme-toggle__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.3A8 8 0 1 1 9.7 4 6.7 6.7 0 0 0 20 14.3Z" />
    </svg>
  )
}

const App = () => {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    return readSessionIdFromLocation()
  })
  const [activePage, setActivePage] = useState<InfoPage>('transfer')
  const [theme, setTheme] = useState<Theme>(() => {
    return readInitialTheme()
  })
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0)

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

  const renderJourney = (items: JourneyItem[], showArrows: boolean) => {
    return (
      <div className="journey-stack">
        {items.map((item, index) => {
          const isLast = index === items.length - 1

          return (
            <div className="journey-segment" key={item.label}>
              <article className="journey-card">
                <div className="journey-card__top">
                  <span className="journey-chip">{item.label}</span>
                  <span className="journey-dot" aria-hidden />
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
              {showArrows && !isLast && (
                <div className="journey-arrow" aria-hidden>
                  <span>&darr;</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderInfoPanel = () => {
    if (activePage === 'how') {
      return (
        <section className="beam-card beam-card--info-panel">
          <header className="info-section-header">
            <h2>How it works</h2>
            <p>Beam works best as a clean handoff: upload first, connect second, receive third, send fourth, save last.</p>
          </header>
          {renderJourney(HOW_STEPS, true)}
        </section>
      )
    }

    if (activePage === 'privacy') {
      return (
        <section className="beam-card beam-card--info-panel">
          <header className="info-section-header">
            <h2>Privacy &amp; Security</h2>
            <p>The goal is simple: keep control with the sender, keep consent with the receiver, and keep the link private.</p>
          </header>
          {renderJourney(PRIVACY_ITEMS, true)}
        </section>
      )
    }

    return (
      <section className="beam-card beam-card--info-panel">
        <header className="info-section-header">
          <h2>FAQ</h2>
          <p>Quick answers for the questions people usually ask before they send the link.</p>
        </header>
        <div className="faq-stack">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openFaqIndex === index

            return (
              <article className={`faq-entry${isOpen ? ' faq-entry--open' : ''}`} key={item.question}>
                <button
                  className="faq-entry__button"
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenFaqIndex((currentIndex) => {
                      return currentIndex === index ? null : index
                    })
                  }}
                >
                  <span>{item.question}</span>
                  <span className="faq-entry__icon" aria-hidden>
                    {isOpen ? '-' : '+'}
                  </span>
                </button>
                {isOpen && <p className="faq-entry__answer">{item.answer}</p>}
              </article>
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
                className={`beam-tab${activePage === 'privacy' ? ' beam-tab--active' : ''}`}
                type="button"
                onClick={() => {
                  setActivePage('privacy')
                }}
              >
                Privacy &amp; Security
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
              <div className="theme-toggle" role="group" aria-label="Theme">
                <button
                  className={`theme-toggle__button${theme === 'light' ? ' theme-toggle__button--active' : ''}`}
                  type="button"
                  aria-pressed={theme === 'light'}
                  aria-label="Use light mode"
                  onClick={() => {
                    setTheme('light')
                  }}
                >
                  <SunIcon />
                </button>
                <button
                  className={`theme-toggle__button${theme === 'dark' ? ' theme-toggle__button--active' : ''}`}
                  type="button"
                  aria-pressed={theme === 'dark'}
                  aria-label="Use dark mode"
                  onClick={() => {
                    setTheme('dark')
                  }}
                >
                  <MoonIcon />
                </button>
              </div>
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
