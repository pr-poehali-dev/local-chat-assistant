import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import type { Fact } from "@/hooks/useChatStore";

const CATEGORIES = ["О компании", "Финансы", "Команда", "Рынок", "Другое"];

interface FactsPanelProps {
  facts: Fact[];
  summaries?: Record<string, string>;
  newFactIds?: Set<string>;
  updatedSummaryCategories?: Set<string>;
  onAdd: (content: string, category: string) => void;
  onDelete: (id: string) => void;
  onClear?: () => Promise<void>;
  onProfileCommand?: () => void;
  onConsolidate?: () => Promise<string>;
  onSummarize?: () => Promise<string>;
  onSendMessage?: (text: string) => void;
  onMarkFactsSeen?: () => void;
  onMarkSummariesSeen?: () => void;
  apiKey?: string;
  baseUrl?: string;
}

export default function FactsPanel({
  facts,
  summaries = {},
  newFactIds = new Set(),
  updatedSummaryCategories = new Set(),
  onAdd,
  onDelete,
  onClear,
  onProfileCommand,
  onConsolidate,
  onSummarize,
  onSendMessage,
  onMarkFactsSeen,
  onMarkSummariesSeen,
  apiKey = "",
  baseUrl = "",
}: FactsPanelProps) {
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("О компании");
  const [isAdding, setIsAdding] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set(["О компании"]));
  const [openSubcategories, setOpenSubcategories] = useState<Set<string>>(new Set());
  const [voiceComment, setVoiceComment] = useState<{ cat: string; text: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  // Сбрасываем подсветку новых фактов при заходе в раздел
  useEffect(() => {
    if (newFactIds.size > 0) {
      const timer = setTimeout(() => {
        onMarkFactsSeen?.();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [newFactIds, onMarkFactsSeen]);

  const handleConsolidate = async () => {
    if (!onConsolidate) return;
    setConsolidating(true);
    setConsolidateResult(null);
    try {
      const result = await onConsolidate();
      setConsolidateResult(result);
    } catch {
      setConsolidateResult("Ошибка структурирования");
    } finally {
      setConsolidating(false);
    }
  };

  const handleSummarize = async () => {
    if (!onSummarize) return;
    setSummarizing(true);
    setConsolidateResult(null);
    try {
      const result = await onSummarize();
      setConsolidateResult(result);
      // Раскрываем категории с обновлённым резюме
      setOpenCategories((prev) => {
        const next = new Set(prev);
        updatedSummaryCategories.forEach((c) => next.add(c));
        return next;
      });
    } catch {
      setConsolidateResult("Ошибка резюмирования");
    } finally {
      setSummarizing(false);
    }
  };

  const handleClear = async () => {
    if (!onClear) return;
    if (!window.confirm("Удалить все факты и резюме? Это действие нельзя отменить.")) return;
    setClearing(true);
    try {
      await onClear();
      setConsolidateResult("База знаний очищена");
    } catch {
      setConsolidateResult("Ошибка очистки");
    } finally {
      setClearing(false);
    }
  };

  const handleAdd = () => {
    const text = newFact.trim();
    if (!text) return;
    onAdd(text, newCategory);
    setNewFact("");
    setIsAdding(false);
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  };

  const toggleSubcategory = (key: string) => {
    setOpenSubcategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  };

  const startVoiceComment = async (cat: string) => {
    if (!apiKey || !baseUrl) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 500) return;

        const openaiBase = baseUrl.includes("openai.com") ? "https://api.openai.com/v1" : baseUrl;
        const form = new FormData();
        form.append("file", blob, "audio.webm");
        form.append("model", "whisper-1");
        form.append("language", "ru");
        form.append("response_format", "text");

        try {
          const res = await fetch(`${openaiBase}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          const transcript = (await res.text()).trim();
          if (transcript && onSendMessage) {
            const prefix = `[По резюме категории "${cat}"] `;
            onSendMessage(prefix + transcript);
          }
        } catch (e) {
          console.warn("voice comment transcribe error", e);
        }
        setRecording(false);
        setVoiceComment(null);
        setMediaRecorder(null);
      };

      mr.start();
      setMediaRecorder(mr);
      setRecording(true);
      setVoiceComment({ cat, text: "" });
    } catch {
      console.warn("no mic access");
    }
  };

  const stopVoiceComment = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  };

  // Строим дерево: category → subcategory → facts
  const tree: Record<string, Record<string, Fact[]>> = {};
  for (const cat of CATEGORIES) tree[cat] = {};

  for (const fact of facts) {
    const cat = fact.category || "Другое";
    if (!tree[cat]) tree[cat] = {};
    const sub = fact.subcategory || "Общее";
    if (!tree[cat][sub]) tree[cat][sub] = [];
    tree[cat][sub].push(fact);
  }

  const totalByCat = (cat: string) =>
    Object.values(tree[cat] || {}).reduce((s, arr) => s + arr.length, 0);

  const newCountByCat = (cat: string) =>
    Object.values(tree[cat] || {}).reduce(
      (s, arr) => s + arr.filter((f) => newFactIds.has(f.id)).length,
      0
    );

  const voiceAvailable = !!apiKey && !!baseUrl;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">База знаний</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {facts.length} фактов · подмешиваются в контекст
              {newFactIds.size > 0 && (
                <span className="ml-2 text-violet-500 font-medium">+{newFactIds.size} новых</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {onProfileCommand && (
              <button
                onClick={onProfileCommand}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors"
              >
                <Icon name="User" size={13} />
                Профиль
              </button>
            )}
            {onConsolidate && facts.length > 0 && (
              <button
                onClick={handleConsolidate}
                disabled={consolidating || summarizing}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
              >
                <Icon name={consolidating ? "Loader" : "Sparkles"} size={13} />
                {consolidating ? "Структурирую..." : "Структурировать"}
              </button>
            )}
            {onSummarize && facts.length > 0 && (
              <button
                onClick={handleSummarize}
                disabled={summarizing || consolidating}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
              >
                <Icon name={summarizing ? "Loader" : "FileText"} size={13} />
                {summarizing ? "Резюмирую..." : "Резюме"}
              </button>
            )}
            <button
              onClick={() => setIsAdding(!isAdding)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                isAdding ? "bg-foreground text-background" : "border border-border hover:bg-secondary"
              }`}
            >
              <Icon name={isAdding ? "X" : "Plus"} size={13} />
              {isAdding ? "Отмена" : "Добавить"}
            </button>
            {onClear && (
              <button
                onClick={handleClear}
                disabled={clearing || consolidating || summarizing}
                title="Очистить всю базу знаний"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-40"
              >
                <Icon name={clearing ? "Loader" : "Trash2"} size={13} />
                {clearing ? "Очищаю..." : "Очистить"}
              </button>
            )}
          </div>
        </div>

        {consolidateResult && (
          <div className="mt-2 px-3 py-2 border border-border bg-secondary text-xs text-muted-foreground flex items-start gap-2 animate-fade-in">
            <Icon name="CheckCircle" size={13} className="flex-shrink-0 mt-0.5" />
            <span>{consolidateResult}</span>
          </div>
        )}

        {isAdding && (
          <div className="mt-3 space-y-2 animate-slide-up border border-border p-3">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="w-full text-xs border border-border bg-card px-3 py-2 focus:outline-none focus:border-foreground font-mono"
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <textarea
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="Опишите факт, который ассистент должен помнить..."
              rows={3}
              className="w-full resize-none border border-border bg-card text-sm px-3 py-2 focus:outline-none focus:border-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={handleAdd}
              disabled={!newFact.trim()}
              className="w-full py-2 bg-foreground text-background text-xs font-medium hover:opacity-80 disabled:opacity-30 transition-opacity"
            >
              Сохранить факт
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {facts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm px-6">
            Нет фактов. Поговорите с ассистентом — он начнёт запоминать.
          </div>
        )}

        {CATEGORIES.map((cat) => {
          const count = totalByCat(cat);
          if (count === 0 && !summaries[cat]) return null;
          const isOpen = openCategories.has(cat);
          const subcats = Object.entries(tree[cat]);
          const newCount = newCountByCat(cat);
          const summaryUpdated = updatedSummaryCategories.has(cat);

          return (
            <div key={cat} className="border-b border-border last:border-b-0">
              {/* Категория */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-2 px-6 py-3 hover:bg-secondary transition-colors text-left"
              >
                <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} className="text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium flex-1">{cat}</span>
                {newCount > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-violet-500/15 text-violet-500 rounded-sm">
                    +{newCount} new
                  </span>
                )}
                {summaryUpdated && !newCount && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/15 text-amber-500 rounded-sm">
                    резюме ↑
                  </span>
                )}
                <span className="text-xs font-mono text-muted-foreground ml-1">{count}</span>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {summaries[cat] && (
                    <div className={`mx-4 mb-2 px-4 py-3 border text-xs leading-relaxed whitespace-pre-wrap relative group/summary transition-colors ${
                      summaryUpdated
                        ? "border-amber-400/50 bg-amber-500/5 text-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground"
                    }`}>
                      {summaryUpdated && (
                        <span className="absolute top-2 right-2 text-[10px] font-mono text-amber-500 flex items-center gap-1">
                          <Icon name="RefreshCw" size={10} />
                          обновлено
                        </span>
                      )}
                      <p className={summaryUpdated ? "pr-16" : ""}>{summaries[cat]}</p>
                      {voiceAvailable && (
                        <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2">
                          {recording && voiceComment?.cat === cat ? (
                            <button
                              onMouseUp={stopVoiceComment}
                              onTouchEnd={stopVoiceComment}
                              className="flex items-center gap-1.5 text-[11px] font-mono text-red-500 animate-pulse"
                            >
                              <Icon name="MicOff" size={11} />
                              Отпустите для отправки...
                            </button>
                          ) : (
                            <button
                              onMouseDown={() => startVoiceComment(cat)}
                              onTouchStart={() => startVoiceComment(cat)}
                              disabled={recording}
                              className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                            >
                              <Icon name="Mic" size={11} />
                              Прокомментировать голосом
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {subcats.map(([sub, subFacts]) => {
                    const subKey = `${cat}::${sub}`;
                    const subOpen = openSubcategories.has(subKey);

                    return (
                      <div key={sub}>
                        <button
                          onClick={() => toggleSubcategory(subKey)}
                          className="w-full flex items-center gap-2 pl-10 pr-6 py-2 hover:bg-secondary/60 transition-colors text-left"
                        >
                          <Icon name={subOpen ? "ChevronDown" : "ChevronRight"} size={12} className="text-muted-foreground flex-shrink-0" />
                          <span className="text-xs font-mono text-muted-foreground flex-1">{sub}</span>
                          <span className="text-[11px] font-mono text-muted-foreground">{subFacts.length}</span>
                        </button>

                        {subOpen && (
                          <div className="space-y-1 pb-1">
                            {subFacts.map((fact) => {
                              const isNew = newFactIds.has(fact.id);
                              return (
                                <div
                                  key={fact.id}
                                  className={`group mx-4 pl-6 pr-3 py-2.5 border flex items-start gap-3 animate-fade-in transition-colors ${
                                    isNew
                                      ? "border-violet-400/50 bg-violet-500/5"
                                      : "border-border bg-card"
                                  }`}
                                >
                                  {isNew && (
                                    <span className="flex-shrink-0 mt-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" />
                                    </span>
                                  )}
                                  <p className="text-sm leading-relaxed flex-1">{fact.content}</p>
                                  <div className="flex-shrink-0 flex items-center gap-2">
                                    <span className={`text-[10px] font-mono ${
                                      fact.source === "memory_gate" ? "text-violet-500" :
                                      fact.source === "auto" ? "text-blue-500" : "text-muted-foreground"
                                    }`}>
                                      <Icon name={fact.source === "memory_gate" ? "Shield" : fact.source === "auto" ? "Sparkles" : "User"} size={10} />
                                    </span>
                                    <button
                                      onClick={() => onDelete(fact.id)}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                    >
                                      <Icon name="Trash2" size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
