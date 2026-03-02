import { useState } from "react";
import Icon from "@/components/ui/icon";

interface FactsPanelHeaderProps {
  factsCount: number;
  newFactsCount: number;
  consolidating: boolean;
  summarizing: boolean;
  clearing: boolean;
  portraying: boolean;
  portrait: string;
  consolidateResult: string | null;
  onConsolidate?: () => void;
  onSummarize?: () => void;
  onClear?: () => void;
  onProfileCommand?: () => void;
  onPortrait?: () => void;
  onAdd: (text: string, category: string) => void;
  existingCategories: string[];
}

export default function FactsPanelHeader({
  factsCount,
  newFactsCount,
  consolidating,
  summarizing,
  clearing,
  portraying,
  portrait,
  consolidateResult,
  onConsolidate,
  onSummarize,
  onClear,
  onProfileCommand,
  onPortrait,
  onAdd,
  existingCategories,
}: FactsPanelHeaderProps) {
  const [showPortrait, setShowPortrait] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    const text = newFact.trim();
    const cat = newCategory.trim() || "Личное";
    if (!text) return;
    onAdd(text, cat);
    setNewFact("");
    setNewCategory("");
    setIsAdding(false);
  };

  return (
    <div className="px-6 py-4 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">База знаний</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {factsCount} фактов · подмешиваются в контекст
            {newFactsCount > 0 && (
              <span className="ml-2 text-violet-500 font-medium">+{newFactsCount} новых</span>
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
          {onConsolidate && factsCount > 0 && (
            <button
              onClick={onConsolidate}
              disabled={consolidating || summarizing}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
            >
              <Icon name={consolidating ? "Loader" : "Sparkles"} size={13} />
              {consolidating ? "Структурирую..." : "Структурировать"}
            </button>
          )}
          {onSummarize && factsCount > 0 && (
            <button
              onClick={onSummarize}
              disabled={summarizing || consolidating}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
            >
              <Icon name={summarizing ? "Loader" : "FileText"} size={13} />
              {summarizing ? "Резюмирую..." : "Резюме"}
            </button>
          )}
          {onPortrait && factsCount > 0 && (
            <button
              onClick={() => { onPortrait(); setShowPortrait(true); }}
              disabled={portraying || consolidating || summarizing}
              title={portrait ? "Обновить портрет" : "Сгенерировать портрет пользователя"}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40"
            >
              <Icon name={portraying ? "Loader" : "Contact"} size={13} />
              {portraying ? "Генерирую..." : portrait ? "Обновить портрет" : "Портрет"}
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
              onClick={onClear}
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

      {portrait && showPortrait && (
        <div className="mt-3 px-3 py-3 border border-border bg-secondary text-xs text-foreground leading-relaxed animate-fade-in relative">
          <button
            onClick={() => setShowPortrait(false)}
            className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
          >
            <Icon name="X" size={12} />
          </button>
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground font-medium uppercase tracking-wide text-[10px]">
            <Icon name="Contact" size={11} />
            Портрет
          </div>
          <p>{portrait}</p>
        </div>
      )}
      {portrait && !showPortrait && (
        <button
          onClick={() => setShowPortrait(true)}
          className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="Contact" size={11} />
          Показать портрет
        </button>
      )}

      {consolidateResult && (
        <div className="mt-2 px-3 py-2 border border-border bg-secondary text-xs text-muted-foreground flex items-start gap-2 animate-fade-in">
          <Icon name="CheckCircle" size={13} className="flex-shrink-0 mt-0.5" />
          <span>{consolidateResult}</span>
        </div>
      )}

      {isAdding && (
        <div className="mt-3 space-y-2 animate-slide-up border border-border p-3">
          <div className="relative">
            <input
              list="category-suggestions"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Категория (например: Личное, Здоровье, Хобби...)"
              className="w-full text-xs border border-border bg-card px-3 py-2 focus:outline-none focus:border-foreground font-mono placeholder:text-muted-foreground"
            />
            <datalist id="category-suggestions">
              {existingCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
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
  );
}