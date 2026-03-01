import { useState } from "react";
import Icon from "@/components/ui/icon";
import ChatPanel from "@/components/ChatPanel";
import HistoryPanel from "@/components/HistoryPanel";
import FactsPanel from "@/components/FactsPanel";
import SettingsPanel from "@/components/SettingsPanel";

type Tab = "chat" | "history" | "facts" | "settings";

const NAV_ITEMS: { id: Tab; icon: string; label: string }[] = [
  { id: "chat", icon: "MessageSquare", label: "Чат" },
  { id: "history", icon: "Clock", label: "История" },
  { id: "facts", icon: "Database", label: "Факты" },
  { id: "settings", icon: "Settings2", label: "Настройки" },
];

function generateSessionId() {
  return "sess-" + Math.random().toString(36).slice(2, 10);
}

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [sessionId, setSessionId] = useState(generateSessionId);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleNewSession = () => {
    setSessionId(generateSessionId());
    setActiveTab("chat");
  };

  const handleSelectSession = (id: string) => {
    setSessionId(id);
    setActiveTab("chat");
  };

  const PANEL_TITLES: Record<Tab, string> = {
    chat: "Диалог",
    history: "История диалогов",
    facts: "База знаний",
    settings: "Настройки LLM",
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside
        className={`flex-shrink-0 border-r border-border flex flex-col transition-all duration-200 ${
          sidebarOpen ? "w-64" : "w-14"
        }`}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
          {sidebarOpen && (
            <div className="animate-fade-in">
              <div className="text-sm font-semibold tracking-tight">Analyst</div>
              <div className="text-[10px] font-mono text-muted-foreground">personal assistant</div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-auto"
          >
            <Icon name={sidebarOpen ? "PanelLeftClose" : "PanelLeftOpen"} size={15} />
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={!sidebarOpen ? item.label : undefined}
              className={`flex items-center gap-3 px-2.5 py-2.5 text-sm transition-colors w-full text-left ${
                activeTab === item.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Icon name={item.icon} size={16} />
              {sidebarOpen && <span className="animate-fade-in truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-border animate-fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block" />
              <span className="text-[11px] font-mono text-muted-foreground">LLM не подключён</span>
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-1 overflow-hidden">
        {activeTab === "history" && (
          <div className="w-full border-r border-border overflow-hidden flex flex-col">
            <header className="h-14 border-b border-border px-6 flex items-center flex-shrink-0">
              <h1 className="text-sm font-semibold">{PANEL_TITLES[activeTab]}</h1>
            </header>
            <div className="flex-1 overflow-hidden">
              <HistoryPanel
                activeSession={sessionId}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
              />
            </div>
          </div>
        )}

        {activeTab === "chat" && (
          <>
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <header className="h-14 border-b border-border px-6 flex items-center justify-between flex-shrink-0">
                <h1 className="text-sm font-semibold">{PANEL_TITLES[activeTab]}</h1>
                <button
                  onClick={handleNewSession}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border hover:bg-secondary transition-colors font-medium"
                >
                  <Icon name="Plus" size={12} />
                  Новый диалог
                </button>
              </header>
              <div className="flex-1 overflow-hidden">
                <ChatPanel sessionId={sessionId} />
              </div>
            </div>

            <aside className="w-72 flex-shrink-0 border-l border-border flex flex-col overflow-hidden">
              <header className="h-14 border-b border-border px-5 flex items-center flex-shrink-0">
                <h2 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest">
                  Контекст · факты
                </h2>
              </header>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {[
                  { text: "B2B SaaS, Россия и СНГ", cat: "О компании" },
                  { text: "Цель: 120 млн руб. в 2026", cat: "Финансы" },
                  { text: "34 человека в команде", cat: "Команда" },
                  { text: "Конкурент — AmoCRM", cat: "Рынок" },
                ].map((f, i) => (
                  <div
                    key={i}
                    className="border border-border p-3 animate-fade-in"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <p className="text-xs leading-relaxed">{f.text}</p>
                    <span className="text-[10px] font-mono text-muted-foreground mt-1.5 block">{f.cat}</span>
                  </div>
                ))}
                <div className="text-[11px] text-muted-foreground font-mono pt-2 flex items-center gap-1.5">
                  <Icon name="Info" size={11} />
                  <span>ТОП-4 из 4 фактов</span>
                </div>
              </div>
            </aside>
          </>
        )}

        {(activeTab === "facts" || activeTab === "settings") && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-14 border-b border-border px-6 flex items-center flex-shrink-0">
              <h1 className="text-sm font-semibold">{PANEL_TITLES[activeTab]}</h1>
            </header>
            <div className="flex-1 overflow-hidden">
              {activeTab === "facts" && <FactsPanel />}
              {activeTab === "settings" && <SettingsPanel />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
