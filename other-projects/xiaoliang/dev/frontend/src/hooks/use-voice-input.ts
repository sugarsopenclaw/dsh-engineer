import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@/api/client'
import { transcribeSpeechAudio } from '@/api/speech'

const RECORDING_CHUNK_MS = 250

function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]

  return candidates.find((item) => MediaRecorder.isTypeSupported(item)) ?? null
}

function extensionFromMimeType(mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a'
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('wav')) return 'wav'
  if (type.includes('aac')) return 'aac'
  return 'webm'
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    track.stop()
  })
}

export interface UseVoiceInputOptions {
  disabled?: boolean
  onTranscribedText: (text: string) => void
}

export interface UseVoiceInputResult {
  supported: boolean
  recording: boolean
  transcribing: boolean
  durationSeconds: number
  statusMessage: string | null
  startRecording: () => Promise<void>
  stopRecording: () => void
  toggleRecording: () => Promise<void>
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const { disabled = false, onTranscribedText } = options

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const durationTimerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number>(0)
  const statusTimerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [durationSeconds, setDurationSeconds] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const supported = useMemo(
    () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  )

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }, [])

  const clearDurationTimer = useCallback(() => {
    if (durationTimerRef.current !== null) {
      window.clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
  }, [])

  const flashStatus = useCallback((message: string, timeoutMs = 2600) => {
    clearStatusTimer()
    setStatusMessage(message)
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage(null)
      statusTimerRef.current = null
    }, timeoutMs)
  }, [clearStatusTimer])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) {
      return
    }

    if (recorder.state !== 'inactive') {
      recorder.stop()
      return
    }

    recorderRef.current = null
    clearDurationTimer()
    setRecording(false)
    setDurationSeconds(0)
    stopTracks(streamRef.current)
    streamRef.current = null
    chunksRef.current = []
  }, [clearDurationTimer])

  const startRecording = useCallback(async () => {
    if (disabled || recording || transcribing) {
      return
    }

    if (!supported) {
      flashStatus('当前环境不支持麦克风录音。')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMime = pickRecorderMimeType()
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream)

      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      clearStatusTimer()
      setStatusMessage('正在聆听，请开始讲话。')

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setRecording(false)
        clearDurationTimer()
        setDurationSeconds(0)
        recorderRef.current = null
        chunksRef.current = []
        stopTracks(stream)
        streamRef.current = null
        flashStatus('录音失败，请重试。')
      }

      recorder.onstop = async () => {
        setRecording(false)
        clearDurationTimer()
        setDurationSeconds(0)
        stopTracks(stream)
        streamRef.current = null

        const mimeType = recorder.mimeType || preferredMime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        recorderRef.current = null
        chunksRef.current = []

        if (blob.size === 0) {
          flashStatus('未检测到有效语音，请重试。')
          return
        }

        abortRef.current?.abort()
        abortRef.current = new AbortController()
        setTranscribing(true)
        setStatusMessage('语音识别中...')

        try {
          const ext = extensionFromMimeType(mimeType)
          const fileName = `voice-input-${Date.now()}.${ext}`
          const result = await transcribeSpeechAudio(blob, fileName, abortRef.current.signal)
          const text = result.text.trim()

          if (!text) {
            flashStatus('未识别到有效语音内容。')
            return
          }

          onTranscribedText(text)
          flashStatus('语音已转写并回填。', 2200)
        } catch (error) {
          if (abortRef.current?.signal.aborted) {
            return
          }
          flashStatus(getErrorMessage(error))
        } finally {
          setTranscribing(false)
        }
      }

      recorder.start(RECORDING_CHUNK_MS)
      setRecording(true)
      setDurationSeconds(0)
      startedAtRef.current = Date.now()
      clearDurationTimer()
      durationTimerRef.current = window.setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
        setDurationSeconds(elapsed)
      }, 1000)
    } catch (error) {
      flashStatus(getErrorMessage(error))
    }
  }, [clearDurationTimer, clearStatusTimer, disabled, flashStatus, onTranscribedText, recording, supported, transcribing])

  const toggleRecording = useCallback(async () => {
    if (recording) {
      stopRecording()
      return
    }

    await startRecording()
  }, [recording, startRecording, stopRecording])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      clearStatusTimer()
      clearDurationTimer()
      stopTracks(streamRef.current)
      streamRef.current = null
      recorderRef.current = null
      chunksRef.current = []
    }
  }, [clearDurationTimer, clearStatusTimer])

  return {
    supported,
    recording,
    transcribing,
    durationSeconds,
    statusMessage,
    startRecording,
    stopRecording,
    toggleRecording,
  }
}
