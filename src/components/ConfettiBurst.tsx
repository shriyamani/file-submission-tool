import { useMemo, type CSSProperties } from 'react'

interface ConfettiBurstProps {
  active: boolean
  pieces?: number
}

type ConfettiStyle = CSSProperties & {
  '--drift': string
  '--spin': string
}

const ConfettiBurst = ({ active, pieces = 90 }: ConfettiBurstProps) => {
  const confettiPieces = useMemo(() => {
    return Array.from({ length: pieces }, (_, index) => {
      const style: ConfettiStyle = {
        left: `${Math.random() * 100}%`,
        width: `${8 + Math.random() * 8}px`,
        height: `${10 + Math.random() * 14}px`,
        animationDelay: `${Math.random() * 320}ms`,
        animationDuration: `${1700 + Math.random() * 1400}ms`,
        transform: `translate3d(0, -24px, 0) rotate(${Math.random() * 360}deg)`,
        backgroundColor: `var(--confetti-${(index % 5) + 1})`,
        '--drift': `${Math.random() * 320 - 160}px`,
        '--spin': `${Math.random() * 560 - 280}deg`,
      }

      return style
    })
  }, [active, pieces])

  if (!active) {
    return null
  }

  return (
    <div className="confetti-burst" aria-hidden>
      {confettiPieces.map((style, index) => {
        return <span key={`piece-${index}`} className="confetti-piece" style={style} />
      })}
    </div>
  )
}

export default ConfettiBurst
