import { useRef, useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import type { Message } from "@/hooks/useChatStore";

interface ChatPanelProps {
  messages: Message[];
  isThinking: boolean;
  onSend: (text: string) => void;
  sessionId: string;
  model?: string;
}

export default function ChatPanel({ messages, isThinking, onSend, sessionId, model }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.map((msg, i) => (
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
              <div className="flex gap-3">
                <div className="w-7 h-7 flex-shrink-0 bg-foreground flex items-center justify-center mt-0.5">
                  <span className="text-background text-[10px] font-mono font-medium">AI</span>
                </div>
                <div className="max-w-[80%]">
                  <div className="message-assistant px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                    {formatTime(msg.timestamp)}
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

      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); adjustHeight(); }}
              onKeyDown={handleKeyDown}
              disabled={isThinking}
              placeholder={isThinking ? "Ассистент отвечает..." : "Введите запрос... (Enter — отправить, Shift+Enter — перенос)"}
              rows={1}
              className="w-full resize-none border border-border bg-card text-sm px-4 py-3 focus:outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground font-sans leading-relaxed disabled:opacity-50"
              style={{ minHeight: "48px", maxHeight: "160px" }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
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
          {model && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-foreground inline-block" />
              <span>{model}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}