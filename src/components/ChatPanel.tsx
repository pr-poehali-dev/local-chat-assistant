import { useState, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  sessionId: string;
}

const DEMO_MESSAGES: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Добро пожаловать. Я готов помочь с анализом данных и деловыми решениями. Подключите LLM в настройках и начните диалог.",
    timestamp: new Date(),
  },
];

export default function ChatPanel({ sessionId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(DEMO_MESSAGES);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);

    setTimeout(() => {
      setIsThinking(false);
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "LLM не подключён. Настройте API-ключ и base URL в разделе «Настройки», чтобы получать реальные ответы.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    }, 1200);
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
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className="animate-fade-in"
            style={{ animationDelay: `${i * 0.03}s` }}
          >
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="max-w-[72%]">
                  <div className="message-user px-4 py-3 text-sm leading-relaxed">
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
                  <div className="message-assistant px-4 py-3 text-sm leading-relaxed">
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
              placeholder="Введите запрос... (Enter — отправить, Shift+Enter — перенос)"
              rows={1}
              className="w-full resize-none border border-border bg-card text-sm px-4 py-3 pr-4 focus:outline-none focus:border-foreground transition-colors placeholder:text-muted-foreground font-sans leading-relaxed"
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
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
          <span>Сессия: {sessionId.slice(0, 8)}...</span>
        </div>
      </div>
    </div>
  );
}
