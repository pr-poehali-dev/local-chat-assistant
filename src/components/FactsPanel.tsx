import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { Fact } from "@/hooks/useChatStore";

const CATEGORIES = ["О компании", "Финансы", "Команда", "Рынок", "Другое"];

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
  const [isAdding, setIsAdding] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set(["О компании"]));
  const [openSubcategories, setOpenSubcategories] = useState<Set<string>>(new Set());

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
              {isAdding ? "Отмена" : "Добавить"}
            </button>
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
          if (count === 0) return null;
          const isOpen = openCategories.has(cat);
          const subcats = Object.entries(tree[cat]);

          return (
            <div key={cat} className="border-b border-border last:border-b-0">
              {/* Категория */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-2 px-6 py-3 hover:bg-secondary transition-colors text-left"
              >
                <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} className="text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium flex-1">{cat}</span>
                <span className="text-xs font-mono text-muted-foreground">{count}</span>
              </button>

              {isOpen && (
                <div className="pb-1">
                  {subcats.map(([sub, subFacts]) => {
                    const subKey = `${cat}::${sub}`;
                    const subOpen = openSubcategories.has(subKey);

                    return (
                      <div key={sub}>
                        {/* Подкатегория */}
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
                            {subFacts.map((fact) => (
                              <div
                                key={fact.id}
                                className="group mx-4 pl-6 pr-3 py-2.5 border border-border bg-card flex items-start gap-3 animate-fade-in"
                              >
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
                            ))}
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