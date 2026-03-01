import Icon from "@/components/ui/icon";
import type { Session } from "@/hooks/useChatStore";

interface HistoryPanelProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

function formatDate(d: Date) {
  const now = new Date();
  const date = new Date(d);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "сегодня";
  if (diffDays === 1) return "вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export default function HistoryPanel({ sessions, activeSessionId, onSelectSession, onNewSession }: HistoryPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Icon name="Plus" size={15} />
          <span>Новый диалог</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {sessions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Нет диалогов
          </div>
        )}
        {sessions.map((session, i) => {
          const lastMsg = session.messages[session.messages.length - 1];
          const preview = lastMsg?.content.slice(0, 60) ?? "";
          const isActive = session.id === activeSessionId;

          return (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={`w-full text-left px-3 py-3 transition-colors animate-fade-in ${
                isActive
                  ? "bg-foreground text-background"
                  : "hover:bg-secondary text-foreground"
              }`}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm font-medium truncate">{session.title}</span>
                <span className={`text-[11px] font-mono flex-shrink-0 ${isActive ? "opacity-70" : "text-muted-foreground"}`}>
                  {formatDate(session.createdAt)}
                </span>
              </div>
              <div className={`text-xs truncate ${isActive ? "opacity-60" : "text-muted-foreground"}`}>
                {preview}
              </div>
              <div className={`flex items-center gap-1 mt-1.5 text-[11px] font-mono ${isActive ? "opacity-50" : "text-muted-foreground"}`}>
                <Icon name="MessageSquare" size={10} />
                <span>{session.messages.length} сообщ.</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t border-border">
        <div className="text-[11px] text-muted-foreground font-mono">
          {sessions.length} {sessions.length === 1 ? "диалог" : "диалогов"}
        </div>
      </div>
    </div>
  );
}
