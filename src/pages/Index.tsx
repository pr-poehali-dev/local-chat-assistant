import { useState } from "react";
import Icon from "@/components/ui/icon";
import ChatPanel from "@/components/ChatPanel";
import HistoryPanel from "@/components/HistoryPanel";
import FactsPanel from "@/components/FactsPanel";
import SettingsPanel from "@/components/SettingsPanel";
import { useChatStore } from "@/hooks/useChatStore";
import { ASSISTANT_PRESETS } from "@/lib/presets";

type Tab = "chat" | "history" | "facts" | "settings";

const NAV_ITEMS: { id: Tab; icon: string; label: string }[] = [
  { id: "chat", icon: "MessageSquare", label: "Чат" },
  { id: "history", icon: "Clock", label: "История" },
  { id: "facts", icon: "Database", label: "Факты" },
  { id: "settings", icon: "Settings2", label: "Настройки" },
];

const PANEL_TITLES: Record<Tab, string> = {
  chat: "Диалог",
  history: "История диалогов",
  facts: "База знаний",
  settings: "Настройки LLM",
};

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const store = useChatStore();
  const {
    sessions,
    activeSession,
    activeSessionId,
    facts,
    summaries,
    config,
    loading,
    appError,
    isThinking,
    lastSavedCount,
    createSession,
    selectSession,
    sendMessage,
    addFact,
    deleteFact,
    clearFacts,
    saveConfig,
    runConsolidation,
    runSummaries,
    newFactIds,
    clearNewFactIds,
    updatedSummaryCategories,
    clearUpdatedSummaries,
    prevSummaries,
  } = store;

  const handleNewSession = () => {
    createSession();
    setActiveTab("chat");
  };

  const handleSelectSession = (id: string) => {
    selectSession(id);
    setActiveTab("chat");
  };

  const handleProfileCommand = () => {
    setActiveTab("chat");
    sendMessage("покажи мой профиль");
  };

  const connected = !!config.apiKey && !!config.baseUrl;
  const contextFacts = facts.slice(0, 4);

  // Если сессий нет — создаём первую автоматически
  const [autoCreating, setAutoCreating] = useState(false);
  if (!loading && !appError && sessions.length === 0 && !autoCreating) {
    setAutoCreating(true);
    createSession().finally(() => setAutoCreating(false));
  }

  if (loading || (sessions.length === 0 && !appError) || autoCreating) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="flex gap-1.5 justify-center mb-3">
            <span className="thinking-dot w-2 h-2 bg-foreground rounded-full inline-block" />
            <span className="thinking-dot w-2 h-2 bg-foreground rounded-full inline-block" />
            <span className="thinking-dot w-2 h-2 bg-foreground rounded-full inline-block" />
          </div>
          <p className="text-sm text-muted-foreground font-mono">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  if (appError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-sm px-6">
          <Icon name="AlertCircle" size={32} />
          <p className="mt-3 text-sm font-medium">{appError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-foreground text-background text-xs font-medium hover:opacity-80"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {lastSavedCount > 0 && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in">
          <div className="flex items-center gap-2.5 bg-foreground text-background px-4 py-2.5 text-sm font-mono shadow-lg">
            <Icon name="BookMarked" size={14} />
            Запомнил {lastSavedCount} {lastSavedCount === 1 ? "факт" : lastSavedCount < 5 ? "факта" : "фактов"}
          </div>
        </div>
      )}
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
              <span
                className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${
                  connected ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
              <span className="text-[11px] font-mono text-muted-foreground truncate">
                {config.model || "LLM не подключён"}
              </span>
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-1 overflow-hidden">
        {activeTab === "history" && (
          <div className="w-full overflow-hidden flex flex-col">
            <header className="h-14 border-b border-border px-6 flex items-center flex-shrink-0">
              <h1 className="text-sm font-semibold">{PANEL_TITLES[activeTab]}</h1>
            </header>
            <div className="flex-1 overflow-hidden">
              <HistoryPanel
                sessions={sessions}
                activeSessionId={activeSessionId}
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
                <div>
                  <h1 className="text-sm font-semibold">{activeSession?.title ?? "Диалог"}</h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    {(() => {
                      const preset = ASSISTANT_PRESETS.find(p => p.id === config.activePreset);
                      return preset ? (
                        <button
                          onClick={() => setActiveTab("settings")}
                          className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Icon name={preset.icon as Parameters<typeof Icon>[0]["name"]} size={10} />
                          {preset.label}
                        </button>
                      ) : null;
                    })()}
                  </div>
                </div>
                <button
                  onClick={handleNewSession}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border hover:bg-secondary transition-colors font-medium"
                >
                  <Icon name="Plus" size={12} />
                  Новый диалог
                </button>
              </header>
              <div className="flex-1 overflow-hidden">
                <ChatPanel
                  messages={activeSession?.messages ?? []}
                  isThinking={isThinking}
                  onSend={sendMessage}
                  sessionId={activeSessionId}
                  model={connected ? config.model : undefined}
                  apiKey={config.apiKey}
                  baseUrl={config.baseUrl}
                  autoSpeak={config.autoSpeak}
                  speechRate={config.speechRate}
                />
              </div>
            </div>

            <aside className="w-64 flex-shrink-0 border-l border-border flex flex-col overflow-hidden hidden lg:flex">
              <header className="h-14 border-b border-border px-5 flex items-center justify-between flex-shrink-0">
                <h2 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest">
                  Контекст · факты
                </h2>
                <button
                  onClick={() => setActiveTab("facts")}
                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  все →
                </button>
              </header>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {facts.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-8">
                    Нет фактов.{" "}
                    <button
                      onClick={() => setActiveTab("facts")}
                      className="underline hover:text-foreground"
                    >
                      Добавить →
                    </button>
                  </div>
                )}
                {contextFacts.map((f, i) => (
                  <div
                    key={f.id}
                    className="border border-border p-3 animate-fade-in"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <p className="text-xs leading-relaxed">{f.content}</p>
                    <span className="text-[10px] font-mono text-muted-foreground mt-1.5 block">
                      {f.subcategory ? `${f.category} / ${f.subcategory}` : f.category}
                    </span>
                  </div>
                ))}
                {facts.length > 4 && (
                  <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
                    <Icon name="Info" size={11} />
                    <span>Показано 4 из {facts.length} фактов</span>
                  </div>
                )}
                {!connected && (
                  <div className="mt-4 border border-dashed border-border p-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Для реальных ответов настройте{" "}
                      <button
                        onClick={() => setActiveTab("settings")}
                        className="underline hover:text-foreground"
                      >
                        LLM-подключение →
                      </button>
                    </p>
                  </div>
                )}
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
              {activeTab === "facts" && (
                <FactsPanel
                  facts={facts}
                  summaries={summaries}
                  prevSummaries={prevSummaries}
                  newFactIds={newFactIds}
                  updatedSummaryCategories={updatedSummaryCategories}
                  onAdd={addFact}
                  onDelete={deleteFact}
                  onClear={clearFacts}
                  onProfileCommand={handleProfileCommand}
                  onConsolidate={runConsolidation}
                  onSummarize={runSummaries}
                  onSendMessage={(text) => { sendMessage(text); setActiveTab("chat"); }}
                  onMarkFactsSeen={clearNewFactIds}
                  onMarkSummariesSeen={clearUpdatedSummaries}
                  apiKey={config.apiKey}
                  baseUrl={config.baseUrl}
                />
              )}
              {activeTab === "settings" && (
                <SettingsPanel config={config} onSave={saveConfig} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}