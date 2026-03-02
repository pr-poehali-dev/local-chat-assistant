import { useRef, useEffect, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";
import type { Message } from "@/hooks/useChatStore";
import { useVoice } from "@/hooks/useVoice";

interface ChatPanelProps {
  messages: Message[];
  isThinking: boolean;
  onSend: (text: string) => void;
  sessionId: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  autoSpeak?: boolean;
  speechRate?: number;
}

export default function ChatPanel({
  messages,
  isThinking,
  onSend,
  sessionId,
  model,
  apiKey = "",
  baseUrl = "",
  autoSpeak = false,
  speechRate = 1.0,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMessagesLen = useRef(messages.length);

  const handleTranscript = useCallback((text: string) => {
    setInput(text);
    setTimeout(() => {
      onSend(text);
      setInput("");
    }, 100);
  }, [onSend]);

  const { voiceState, error: voiceError, startRecording: _startRecording, stopRecording: _stopRecording, speak, stopSpeaking } = useVoice({
    baseUrl,
    apiKey,
    speechRate,
    onTranscript: handleTranscript,
  });

  const voiceAvailable = !!apiKey && !!baseUrl;

  const toggleRecording = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (voiceState === "recording") {
      _stopRecording();
    } else {
      _startRecording();
    }
  }, [voiceState, _startRecording, _stopRecording]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Push-to-talk: левый Ctrl зажат → запись, отпущен → стоп
  useEffect(() => {
    if (!voiceAvailable) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ControlLeft" && !e.repeat && voiceState === "idle") {
        _startRecording();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ControlLeft") {
        _stopRecording();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [voiceAvailable, voiceState, _startRecording, _stopRecording]);

  // Авто-озвучка последнего ответа ассистента
  useEffect(() => {
    if (!autoSpeak || !apiKey || !baseUrl) return;
    if (messages.length <= prevMessagesLen.current) {
      prevMessagesLen.current = messages.length;
      return;
    }
    prevMessagesLen.current = messages.length;

    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && !last.content.startsWith("⚠️") && !last.content.startsWith("Ошибка")) {
      // Озвучиваем только первые 2 предложения — быстрее генерация TTS
      const sentences = last.content.match(/[^.!?]+[.!?]+/g) || [last.content];
      const shortText = sentences.slice(0, 2).join(" ").trim() || last.content.slice(0, 200);
      setSpeakingId(last.id);
      speak(shortText).finally(() => setSpeakingId(null));
    }
  }, [messages, autoSpeak, apiKey, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSpeakToggle = async (msg: Message) => {
    if (speakingId === msg.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(msg.id);
    await speak(msg.content);
    setSpeakingId(null);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isThinking) return;
    onSend(text);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  };

  const formatTime = (d: Date) =>
    new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const isRecording = voiceState === "recording";
  const isProcessing = voiceState === "processing";

  const VISIBLE = 10;
  const [showAll, setShowAll] = useState(false);
  const prevSessionId = useRef(sessionId);
  if (prevSessionId.current !== sessionId) {
    prevSessionId.current = sessionId;
    setShowAll(false);
  }
  const hiddenCount = messages.length > VISIBLE ? messages.length - VISIBLE : 0;
  const visibleMessages = showAll || hiddenCount === 0 ? messages : messages.slice(-VISIBLE);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {hiddenCount > 0 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground font-mono py-2 border border-border hover:bg-secondary transition-colors"
          >
            ↑ показать ещё {hiddenCount} сообщений за сегодня
          </button>
        )}
        {visibleMessages.map((msg, i) => (
          <div
            key={msg.id}
            className="animate-fade-in"
            style={{ animationDelay: `${Math.min(i * 0.03, 0.2)}s` }}
          >
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[72%]">
                  <div className="message-user px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 text-right font-mono">
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 group">
                <div className="w-7 h-7 flex-shrink-0 bg-foreground flex items-center justify-center mt-0.5">
                  <span className="text-background text-[10px] font-mono font-medium">AI</span>
                </div>
                <div className="max-w-[80%]">
                  <div className="message-assistant px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {formatTime(msg.timestamp)}
                    </span>
                    {voiceAvailable && (
                      <button
                        onClick={() => handleSpeakToggle(msg)}
                        title={speakingId === msg.id ? "Остановить" : "Озвучить"}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] font-mono ${
                          speakingId === msg.id
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon name={speakingId === msg.id ? "Square" : "Volume2"} size={12} />
                        {speakingId === msg.id ? "стоп" : ""}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {isThinking && (
          <div className="flex gap-3 animate-fade-in">
            <div className="w-7 h-7 flex-shrink-0 bg-foreground flex items-center justify-center">
              <span className="text-background text-[10px] font-mono font-medium">AI</span>
            </div>
            <div className="message-assistant px-4 py-3 flex items-center gap-1.5">
              <span className="thinking-dot w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
              <span className="thinking-dot w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
              <span className="thinking-dot w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {voiceError && (
        <div className="px-6 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive font-mono flex items-center gap-2">
          <Icon name="AlertCircle" size={12} />
          {voiceError}
        </div>
      )}

      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); adjustHeight(); }}
              onKeyDown={handleKeyDown}
              disabled={isThinking || isRecording || isProcessing}
              placeholder={
                isRecording ? "🎙 Говорите..." :
                isProcessing ? "Распознаю речь..." :
                isThinking ? "Ассистент отвечает..." :
                "Введите запрос... (Enter — отправить, Shift+Enter — перенос)"
              }
              rows={1}
              className="w-full resize-none border border-border bg-card text-sm px-4 py-3 focus:outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground font-sans leading-relaxed disabled:opacity-50"
              style={{ minHeight: "48px", maxHeight: "160px" }}
            />
          </div>

          {voiceAvailable && (
            <button
              onClick={toggleRecording}
              disabled={isThinking || isProcessing}
              title={isRecording ? "Нажмите чтобы остановить запись" : "Нажмите чтобы начать запись"}
              className={`flex-shrink-0 w-12 h-12 flex items-center justify-center transition-all disabled:opacity-30 ${
                isRecording
                  ? "bg-red-500 text-white scale-110"
                  : isProcessing
                  ? "bg-secondary text-muted-foreground"
                  : "border border-border hover:bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon
                name={isProcessing ? "Loader" : isRecording ? "MicOff" : "Mic"}
                size={18}
              />
            </button>
          )}

          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking || isRecording || isProcessing}
            className="flex-shrink-0 w-12 h-12 bg-foreground text-background flex items-center justify-center hover:opacity-80 disabled:opacity-30 transition-opacity"
          >
            <Icon name="ArrowUp" size={18} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
            <span>Сессия: {sessionId.slice(0, 12)}</span>
          </div>
          <div className="flex items-center gap-3">
            {voiceAvailable && (
              <span className={`flex items-center gap-1 ${isRecording ? "text-red-500" : ""}`}>
                <Icon name="Mic" size={10} />
                {isRecording ? "запись..." : "Ctrl — голос"}
              </span>
            )}
            {model && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-foreground inline-block" />
                <span>{model}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}