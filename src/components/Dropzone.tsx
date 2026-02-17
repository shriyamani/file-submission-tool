import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

interface DropzoneProps {
  file: File | null
  disabled?: boolean
  onFileSelected: (file: File) => void
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`
}

const Dropzone = ({ file, disabled = false, onFileSelected }: DropzoneProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const openPicker = (): void => {
    if (disabled) {
      return
    }

    inputRef.current?.click()
  }

  const selectFile = (incomingFile: File | undefined): void => {
    if (!incomingFile || disabled) {
      return
    }

    onFileSelected(incomingFile)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragActive(false)

    const droppedFile = event.dataTransfer.files?.[0]
    selectFile(droppedFile)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    openPicker()
  }

  return (
    <div
      className={`dropzone${dragActive ? ' dropzone--active' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) {
          setDragActive(true)
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        setDragActive(false)
      }}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Choose file"
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        disabled={disabled}
        onChange={(event) => {
          selectFile(event.target.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      <p className="dropzone-title">Drop file here or click to browse</p>
      <p className="dropzone-subtitle">No server upload. File streams directly peer-to-peer.</p>
      {file && (
        <div className="dropzone-file">
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)}</span>
        </div>
      )}
    </div>
  )
}

export default Dropzone
