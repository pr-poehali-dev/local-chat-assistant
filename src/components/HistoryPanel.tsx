import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { Session } from "@/hooks/useChatStore";

interface HistoryPanelProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession?: (id: string) => void;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function groupSessions(sessions: Session[], now: Date) {
  const today: Session[] = [];
  const yesterday: Session[] = [];
  const thisWeek: Session[] = [];
  const older: Session[] = [];

  for (const s of sessions) {
    const diff = daysBetween(new Date(s.createdAt), now);
    if (diff === 0) today.push(s);
    else if (diff === 1) yesterday.push(s);
    else if (diff <= 7) thisWeek.push(s);
    else older.push(s);
  }
  return { today, yesterday, thisWeek, older };
}

function highlight(text: string, query: string) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/40 text-inherit rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface SessionRowProps {
  session: Session;
  isActive: boolean;
  query: string;
  onSelect: () => void;
  onDelete?: () => void;
}

function SessionRow({ session, isActive, query, onSelect, onDelete }: SessionRowProps) {
  const preview = session.preview ?? session.messages[session.messages.length - 1]?.content ?? "";
  const msgCount = session.messages.length;

  return (
    <div className={`group relative flex items-stretch transition-colors ${isActive ? "bg-foreground text-background" : "hover:bg-secondary"}`}>
      <button
        onClick={onSelect}
        className="flex-1 text-left px-4 py-2.5 min-w-0"
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-xs font-medium truncate flex-1 ${isActive ? "text-background" : "text-foreground"}`}>
            {highlight(session.title, query)}
          </span>
          {msgCount > 0 && (
            <span className={`text-[10px] font-mono flex-shrink-0 ${isActive ? "opacity-50" : "text-muted-foreground"}`}>
              {msgCount}
            </span>
          )}
        </div>
        {preview && (
          <p className={`text-[11px] truncate ${isActive ? "opacity-50" : "text-muted-foreground"}`}>
            {highlight(preview.slice(0, 80), query)}
          </p>
        )}
      </button>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`opacity-0 group-hover:opacity-100 flex-shrink-0 flex items-center px-2 transition-opacity ${
            isActive ? "text-background/50 hover:text-background" : "text-muted-foreground hover:text-destructive"
          }`}
        >
          <Icon name="X" size={12} />
        </button>
      )}
    </div>
  );
}

interface GroupProps {
  label: string;
  sessions: Session[];
  activeSessionId: string;
  query: string;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  collapsed?: boolean;
}

function SessionGroup({ label, sessions, activeSessionId, query, onSelect, onDelete, collapsed = false }: GroupProps) {
  const [open, setOpen] = useState(!collapsed);
  if (sessions.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-mono text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors"
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={10} />
        {label}
        <span className="ml-auto">{sessions.length}</span>
      </button>
      {open && (
        <div className="space-y-px">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              query={query}
              onSelect={() => onSelect(s.id)}
              onDelete={onDelete ? () => onDelete(s.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HistoryPanel({ sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession }: HistoryPanelProps) {
  const [query, setQuery] = useState("");
  const now = new Date();

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.preview ?? "").toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered, now), [filtered]);
  const totalCount = sessions.length;
  const newCount = groups.today.length + groups.yesterday.length;

  return (
    <div className="flex flex-col h-full">
      {/* Шапка */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Icon name="Plus" size={14} />
          Новый диалог
        </button>
        <div className="relative">
          <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по переписке..."
            className="w-full pl-8 pr-8 py-1.5 text-xs border border-border bg-card focus:outline-none focus:border-foreground transition-colors font-mono placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Список */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-xs font-mono px-6">
            {query ? "Ничего не найдено" : "Нет диалогов"}
          </div>
        )}

        {query ? (
          // При поиске — плоский список без группировки
          <div className="space-y-px">
            {filtered.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                query={query}
                onSelect={() => onSelectSession(s.id)}
                onDelete={onDeleteSession ? () => onDeleteSession(s.id) : undefined}
              />
            ))}
          </div>
        ) : (
          // Без поиска — группировка по времени
          <div className="space-y-1">
            <SessionGroup label="Сегодня" sessions={groups.today} activeSessionId={activeSessionId} query="" onSelect={onSelectSession} onDelete={onDeleteSession} />
            <SessionGroup label="Вчера" sessions={groups.yesterday} activeSessionId={activeSessionId} query="" onSelect={onSelectSession} onDelete={onDeleteSession} />
            <SessionGroup label="На этой неделе" sessions={groups.thisWeek} activeSessionId={activeSessionId} query="" onSelect={onSelectSession} onDelete={onDeleteSession} />
            <SessionGroup label="Архив" sessions={groups.older} activeSessionId={activeSessionId} query="" onSelect={onSelectSession} onDelete={onDeleteSession} collapsed />
          </div>
        )}
      </div>

      {/* Футер */}
      <div className="px-4 py-2 border-t border-border flex items-center justify-between">
        <span className="text-[11px] font-mono text-muted-foreground">
          {totalCount} {totalCount === 1 ? "диалог" : totalCount < 5 ? "диалога" : "диалогов"}
        </span>
        {newCount > 0 && (
          <span className="text-[11px] font-mono text-muted-foreground">
            {newCount} за 2 дня
          </span>
        )}
      </div>
    </div>
  );
}
