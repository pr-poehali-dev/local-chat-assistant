import Icon from "@/components/ui/icon";
import type { Fact } from "@/hooks/useChatStore";
import { computeDiff } from "./facts-diff";

interface CategoryBlockProps {
  cat: string;
  subcats: [string, Fact[]][];
  count: number;
  newCount: number;
  isOpen: boolean;
  summaryUpdated: boolean;
  inDiffMode: boolean;
  oldSummary: string | undefined;
  newSummary: string | undefined;
  newFactIds: Set<string>;
  openSubcategories: Set<string>;
  voiceAvailable: boolean;
  recording: boolean;
  voiceCommentCat: string | null;
  onToggleCategory: (cat: string) => void;
  onToggleSubcategory: (key: string) => void;
  onEnableDiff: (cat: string) => void;
  onDisableDiff: (cat: string) => void;
  onStartVoice: (cat: string) => void;
  onStopVoice: () => void;
  onDelete: (id: string) => void;
}

export default function CategoryBlock({
  cat,
  subcats,
  count,
  newCount,
  isOpen,
  summaryUpdated,
  inDiffMode,
  oldSummary,
  newSummary,
  newFactIds,
  openSubcategories,
  voiceAvailable,
  recording,
  voiceCommentCat,
  onToggleCategory,
  onToggleSubcategory,
  onEnableDiff,
  onDisableDiff,
  onStartVoice,
  onStopVoice,
  onDelete,
}: CategoryBlockProps) {
  return (
    <div className="border-b border-border last:border-b-0">
      {/* Заголовок категории */}
      <button
        onClick={() => onToggleCategory(cat)}
        className="w-full flex items-center gap-2 px-6 py-3 hover:bg-secondary transition-colors text-left"
      >
        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} className="text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium flex-1">{cat}</span>
        {newCount > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-violet-500/15 text-violet-500 rounded-sm">
            +{newCount} new
          </span>
        )}
        {summaryUpdated && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-500/15 text-amber-500 rounded-sm">
            резюме ↑
          </span>
        )}
        <span className="text-xs font-mono text-muted-foreground ml-1">{count}</span>
      </button>

      {isOpen && (
        <div className="pb-1">
          {/* Блок резюме */}
          {newSummary && (
            <div className="mx-4 mb-2 border border-border bg-secondary/30">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60">
                <span className="text-[10px] font-mono text-muted-foreground flex-1">Резюме раздела</span>
                {inDiffMode && oldSummary ? (
                  <button
                    onClick={() => onDisableDiff(cat)}
                    className="text-[10px] font-mono text-amber-500 hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <Icon name="Eye" size={10} />
                    скрыть diff
                  </button>
                ) : (oldSummary && summaryUpdated) ? (
                  <button
                    onClick={() => onEnableDiff(cat)}
                    className="text-[10px] font-mono text-amber-500 hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <Icon name="GitCompare" size={10} />
                    показать изменения
                  </button>
                ) : null}
                {voiceAvailable && (
                  recording && voiceCommentCat === cat ? (
                    <button
                      onMouseUp={onStopVoice}
                      onTouchEnd={onStopVoice}
                      className="text-[10px] font-mono text-red-500 animate-pulse flex items-center gap-1"
                    >
                      <Icon name="MicOff" size={10} />
                      отпустите...
                    </button>
                  ) : (
                    <button
                      onMouseDown={() => onStartVoice(cat)}
                      onTouchStart={() => onStartVoice(cat)}
                      disabled={recording}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-30"
                    >
                      <Icon name="Mic" size={10} />
                      голос
                    </button>
                  )
                )}
              </div>

              {/* Diff или обычный текст */}
              {inDiffMode && oldSummary ? (
                <div className="px-4 py-3 text-xs leading-relaxed">
                  <div className="text-[10px] font-mono text-muted-foreground mb-2 flex items-center gap-2">
                    <span className="px-1 bg-red-500/15 text-red-500">— удалено</span>
                    <span className="px-1 bg-green-500/15 text-green-500">+ добавлено</span>
                  </div>
                  <p className="whitespace-pre-wrap">
                    {computeDiff(oldSummary, newSummary).map((token, idx) => (
                      token.type === "same" ? (
                        <span key={idx}>{token.text}</span>
                      ) : token.type === "added" ? (
                        <mark key={idx} className="bg-green-500/20 text-green-700 dark:text-green-300 rounded-sm">{token.text}</mark>
                      ) : (
                        <del key={idx} className="bg-red-500/15 text-red-500 rounded-sm">{token.text}</del>
                      )
                    ))}
                  </p>
                </div>
              ) : (
                <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{newSummary}</p>
              )}
            </div>
          )}

          {/* Подкатегории и факты */}
          {subcats.map(([sub, subFacts]) => {
            const subKey = `${cat}::${sub}`;
            const subOpen = openSubcategories.has(subKey);

            return (
              <div key={sub}>
                <button
                  onClick={() => onToggleSubcategory(subKey)}
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
                            isNew ? "border-violet-400/50 bg-violet-500/5" : "border-border bg-card"
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
                              <Icon
                                name={fact.source === "memory_gate" ? "Shield" : fact.source === "auto" ? "Sparkles" : "User"}
                                size={10}
                              />
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
}
