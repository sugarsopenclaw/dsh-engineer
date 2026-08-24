import { requestApi } from '@/api/client'
import type { SpeechTranscriptionData } from '@/shared/backend-api'

export function transcribeSpeechAudio(audio: Blob, fileName: string, signal?: AbortSignal) {
  const formData = new FormData()
  formData.append('audio', audio, fileName)

  return requestApi<SpeechTranscriptionData>('/speech/transcribe', {
    method: 'POST',
    body: formData,
    signal,
  })
}
