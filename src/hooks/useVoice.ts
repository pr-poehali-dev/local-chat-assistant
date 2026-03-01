import { useState, useRef, useCallback } from "react";

export type VoiceState = "idle" | "recording" | "processing" | "speaking";

interface UseVoiceOptions {
  baseUrl: string;
  apiKey: string;
  onTranscript: (text: string) => void;
}

export function useVoice({ baseUrl, apiKey, onTranscript }: UseVoiceOptions) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setVoiceState("idle");
  }, []);

  const startRecording = useCallback(async () => {
    if (!apiKey || !baseUrl) {
      setError("Сначала настройте LLM-подключение");
      return;
    }

    // Останавливаем озвучку если играет
    stopSpeaking();
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 1000) {
          setVoiceState("idle");
          return;
        }

        setVoiceState("processing");
        try {
          const transcript = await transcribeAudio(blob, baseUrl, apiKey);
          if (transcript.trim()) {
            onTranscript(transcript.trim());
          }
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : "Ошибка распознавания");
        } finally {
          setVoiceState("idle");
        }
      };

      recorder.start();
      setVoiceState("recording");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Нет доступа к микрофону";
      setError(msg.includes("Permission") || msg.includes("NotAllowed")
        ? "Нет доступа к микрофону. Разрешите в настройках браузера."
        : msg);
      setVoiceState("idle");
    }
  }, [apiKey, baseUrl, onTranscript, stopSpeaking]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!apiKey || !baseUrl) return;
    if (voiceState === "speaking") {
      stopSpeaking();
      return;
    }

    setError(null);
    setVoiceState("speaking");
    try {
      const openaiBase = baseUrl.includes("openai.com")
        ? "https://api.openai.com/v1"
        : baseUrl;

      const res = await fetch(`${openaiBase}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text.slice(0, 4096),
          voice: "alloy",
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `TTS error ${res.status}`);
      }

      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setVoiceState("idle");
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setVoiceState("idle");
      };

      await audio.play();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка озвучки");
      setVoiceState("idle");
    }
  }, [apiKey, baseUrl, voiceState, stopSpeaking]);

  return { voiceState, error, startRecording, stopRecording, speak, stopSpeaking };
}

async function transcribeAudio(blob: Blob, baseUrl: string, apiKey: string): Promise<string> {
  const openaiBase = baseUrl.includes("openai.com")
    ? "https://api.openai.com/v1"
    : baseUrl;

  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("model", "whisper-1");
  form.append("language", "ru");
  form.append("response_format", "text");

  const res = await fetch(`${openaiBase}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Whisper error ${res.status}`);
  }

  return await res.text();
}
