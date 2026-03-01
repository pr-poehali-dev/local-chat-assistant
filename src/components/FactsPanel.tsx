import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { Fact } from "@/hooks/useChatStore";

const CATEGORIES = ["Все", "О компании", "Финансы", "Команда", "Рынок", "Другое"];

interface FactsPanelProps {
  facts: Fact[];
  onAdd: (content: string, category: string) => void;
  onDelete: (id: string) => void;
  onProfileCommand?: () => void;
  onConsolidate?: () => Promise<string>;
}

export default function FactsPanel({ facts, onAdd, onDelete, onProfileCommand, onConsolidate }: FactsPanelProps) {
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("О компании");
  const [filter, setFilter] = useState("Все");
  const [isAdding, setIsAdding] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);

  const handleConsolidate = async () => {
    if (!onConsolidate) return;
    setConsolidating(true);
    setConsolidateResult(null);
    try {
      const result = await onConsolidate();
      setConsolidateResult(result);
    } catch (e) {
      setConsolidateResult("Ошибка структурирования");
    } finally {
      setConsolidating(false);
    }
  };

  const handleAdd = () => {
    const text = newFact.trim();
    if (!text) return;
    onAdd(text, newCategory);
    setNewFact("");
    setIsAdding(false);
  };

  const filtered = filter === "Все" ? facts : facts.filter((f) => f.category === filter);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold">База знаний</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {facts.length} фактов · подмешиваются в контекст
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {onProfileCommand && (
              <button
                onClick={onProfileCommand}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors"
                title="Показать сводку по памяти в чате"
              >
                <Icon name="User" size={13} />
                Профиль
              </button>
            )}
            {onConsolidate && facts.length > 0 && (
              <button
                onClick={handleConsolidate}
                disabled={consolidating}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
                title="LLM структурирует, объединит дубли и переименует разделы"
              >
                <Icon name={consolidating ? "Loader" : "Sparkles"} size={13} />
                {consolidating ? "Структурирую..." : "Структурировать"}
              </button>
            )}
            <button
              onClick={() => setIsAdding(!isAdding)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                isAdding ? "bg-foreground text-background" : "border border-border hover:bg-secondary"
              }`}
            >
              <Icon name={isAdding ? "X" : "Plus"} size={13} />
              {isAdding ? "Отмена" : "Добавить факт"}
            </button>
          </div>
        </div>

        {consolidateResult && (
          <div className="mt-3 px-3 py-2 border border-border bg-secondary text-xs text-muted-foreground flex items-start gap-2 animate-fade-in">
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
              {CATEGORIES.filter((c) => c !== "Все").map((c) => (
                <option key={c}>{c}</option>
              ))}
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

        <div className="flex gap-1.5 overflow-x-auto mt-3 pb-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`flex-shrink-0 px-3 py-1 text-xs font-mono transition-colors ${
                filter === cat
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {filter === "Все" ? "Нет фактов. Добавьте первый!" : `Нет фактов в категории «${filter}»`}
          </div>
        )}
        {filtered.map((fact, i) => (
          <div
            key={fact.id}
            className="border border-border bg-card p-4 group animate-fade-in"
            style={{ animationDelay: `${i * 0.04}s` }}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-relaxed flex-1">{fact.content}</p>
              <button
                onClick={() => onDelete(fact.id)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-[11px] font-mono px-2 py-0.5 bg-secondary text-secondary-foreground">
                {fact.category}
              </span>
              {fact.subcategory && (
                <span className="text-[11px] font-mono px-2 py-0.5 border border-border text-muted-foreground">
                  {fact.subcategory}
                </span>
              )}
              <span className={`text-[11px] font-mono flex items-center gap-1 ${fact.source === "memory_gate" ? "text-violet-500" : fact.source === "auto" ? "text-blue-500" : "text-muted-foreground"}`}>
                <Icon name={fact.source === "memory_gate" ? "Shield" : fact.source === "auto" ? "Sparkles" : "User"} size={10} />
                {fact.source === "memory_gate" ? "gate" : fact.source === "auto" ? "авто" : "вручную"}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground ml-auto">{fact.addedAt}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}