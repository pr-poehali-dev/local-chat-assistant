import Icon from "@/components/ui/icon";

interface Session {
  id: string;
  title: string;
  preview: string;
  date: string;
  messageCount: number;
}

const DEMO_SESSIONS: Session[] = [
  {
    id: "sess-001",
    title: "Анализ продаж Q4",
    preview: "Сравни динамику выручки по регионам...",
    date: "сегодня",
    messageCount: 14,
  },
  {
    id: "sess-002",
    title: "Стратегия выхода на рынок",
    preview: "Какие риски при запуске нового продукта...",
    date: "вчера",
    messageCount: 8,
  },
  {
    id: "sess-003",
    title: "KPI команды разработки",
    preview: "Помоги составить систему метрик...",
    date: "27 фев",
    messageCount: 22,
  },
  {
    id: "sess-004",
    title: "Анализ конкурентов",
    preview: "Составь сравнительную таблицу по ценам...",
    date: "25 фев",
    messageCount: 6,
  },
];

interface HistoryPanelProps {
  activeSession: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export default function HistoryPanel({ activeSession, onSelectSession, onNewSession }: HistoryPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-medium hover:bg-secondary transition-colors group"
        >
          <Icon name="Plus" size={15} />
          <span>Новый диалог</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {DEMO_SESSIONS.map((session, i) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={`w-full text-left px-3 py-3 transition-colors animate-fade-in ${
              session.id === activeSession
                ? "bg-foreground text-background"
                : "hover:bg-secondary text-foreground"
            }`}
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-sm font-medium truncate">{session.title}</span>
              <span className={`text-[11px] font-mono flex-shrink-0 ${session.id === activeSession ? "opacity-70" : "text-muted-foreground"}`}>
                {session.date}
              </span>
            </div>
            <div className={`text-xs truncate ${session.id === activeSession ? "opacity-60" : "text-muted-foreground"}`}>
              {session.preview}
            </div>
            <div className={`flex items-center gap-1 mt-1.5 text-[11px] font-mono ${session.id === activeSession ? "opacity-50" : "text-muted-foreground"}`}>
              <Icon name="MessageSquare" size={10} />
              <span>{session.messageCount} сообщ.</span>
            </div>
          </button>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border">
        <div className="text-[11px] text-muted-foreground font-mono">
          {DEMO_SESSIONS.length} диалогов
        </div>
      </div>
    </div>
  );
}
