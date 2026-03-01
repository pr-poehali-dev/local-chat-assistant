import { useState, useEffect } from "react";
import type { Fact } from "@/hooks/useChatStore";
import FactsPanelHeader from "./facts/FactsPanelHeader";
import CategoryBlock from "./facts/CategoryBlock";

interface FactsPanelProps {
  facts: Fact[];
  summaries?: Record<string, string>;
  prevSummaries?: Record<string, string>;
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
  prevSummaries = {},
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
  apiKey = "",
  baseUrl = "",
}: FactsPanelProps) {
  const [consolidating, setConsolidating] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [openSubcategories, setOpenSubcategories] = useState<Set<string>>(new Set());
  const [diffCategories, setDiffCategories] = useState<Set<string>>(new Set());
  const [voiceComment, setVoiceComment] = useState<{ cat: string; text: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  // Сбрасываем подсветку новых фактов через 5 сек
  useEffect(() => {
    if (newFactIds.size > 0) {
      const timer = setTimeout(() => { onMarkFactsSeen?.(); }, 5000);
      return () => clearTimeout(timer);
    }
  }, [newFactIds, onMarkFactsSeen]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleConsolidate = async () => {
    if (!onConsolidate) return;
    setConsolidating(true);
    setConsolidateResult(null);
    try {
      setConsolidateResult(await onConsolidate());
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
      setConsolidateResult(await onSummarize());
      setOpenCategories((prev) => {
        const next = new Set(prev);
        updatedSummaryCategories.forEach((c) => next.add(c));
        return next;
      });
      const diffCats = new Set<string>();
      updatedSummaryCategories.forEach((c) => { if (prevSummaries[c]) diffCats.add(c); });
      setDiffCategories(diffCats);
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
            onSendMessage(`[По резюме категории "${cat}"] ${transcript}`);
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
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  };

  // ── Дерево категорий ──────────────────────────────────────────

  const tree: Record<string, Record<string, Fact[]>> = {};
  for (const fact of facts) {
    const cat = fact.category || "Другое";
    if (!tree[cat]) tree[cat] = {};
    const sub = fact.subcategory || "Общее";
    if (!tree[cat][sub]) tree[cat][sub] = [];
    tree[cat][sub].push(fact);
  }
  for (const cat of Object.keys(summaries)) {
    if (!tree[cat]) tree[cat] = {};
  }
  const allCats = Object.keys(tree).sort();

  const totalByCat = (cat: string) =>
    Object.values(tree[cat] || {}).reduce((s, arr) => s + arr.length, 0);

  const newCountByCat = (cat: string) =>
    Object.values(tree[cat] || {}).reduce(
      (s, arr) => s + arr.filter((f) => newFactIds.has(f.id)).length,
      0
    );

  return (
    <div className="flex flex-col h-full">
      <FactsPanelHeader
        factsCount={facts.length}
        newFactsCount={newFactIds.size}
        consolidating={consolidating}
        summarizing={summarizing}
        clearing={clearing}
        consolidateResult={consolidateResult}
        onConsolidate={onConsolidate ? handleConsolidate : undefined}
        onSummarize={onSummarize ? handleSummarize : undefined}
        onClear={onClear ? handleClear : undefined}
        onProfileCommand={onProfileCommand}
        onAdd={onAdd}
        existingCategories={allCats}
      />

      <div className="flex-1 overflow-y-auto py-2">
        {facts.length === 0 && Object.keys(summaries).length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm px-6">
            Нет фактов. Поговорите с ассистентом — он начнёт запоминать.
          </div>
        )}

        {allCats.map((cat) => (
          <CategoryBlock
            key={cat}
            cat={cat}
            subcats={Object.entries(tree[cat] || {})}
            count={totalByCat(cat)}
            newCount={newCountByCat(cat)}
            isOpen={openCategories.has(cat)}
            summaryUpdated={updatedSummaryCategories.has(cat)}
            inDiffMode={diffCategories.has(cat)}
            oldSummary={prevSummaries[cat]}
            newSummary={summaries[cat]}
            newFactIds={newFactIds}
            openSubcategories={openSubcategories}
            voiceAvailable={!!apiKey && !!baseUrl}
            recording={recording}
            voiceCommentCat={voiceComment?.cat ?? null}
            onToggleCategory={toggleCategory}
            onToggleSubcategory={toggleSubcategory}
            onEnableDiff={(c) => setDiffCategories((p) => new Set([...p, c]))}
            onDisableDiff={(c) => setDiffCategories((p) => { const n = new Set(p); n.delete(c); return n; })}
            onStartVoice={startVoiceComment}
            onStopVoice={stopVoiceComment}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
