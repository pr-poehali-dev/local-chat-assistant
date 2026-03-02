import React, { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { ApiSession, ApiMessage, ApiFact, ApiSettings, ApiProfile, ApiEpisode, ApiPattern } from "@/lib/api";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  preview?: string;
  messages: Message[];
}

export interface Fact {
  id: string;
  content: string;
  category: string;
  subcategory?: string;
  addedAt: string;
  source: "manual" | "auto" | "memory_gate";
  confidence?: number;
  status?: "active" | "needs_review" | "archived";
}

export interface Episode {
  id: string;
  title: string;
  summary: string;
  sessionId?: string;
  happenedAt?: string;
  category: string;
  createdAt: string;
}

export interface Pattern {
  id: string;
  text: string;
  category: string;
  evidence?: string;
  count: number;
  lastSeen: string;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  autoExtract: boolean;
  antiDuplicates: boolean;
  topFacts: boolean;
  autoSpeak: boolean;
  speechRate: number;
  activePreset: string;
}

const CONSOLIDATION_SYSTEM = `You are a memory curator for a personal AI assistant.
You receive all facts stored about the user. Your job: restructure, deduplicate, improve, and flag conflicts.

Return ONLY valid JSON (no markdown):
{
  "operations": [
    {"op": "update", "id": "...", "category": "...", "subcategory": "...", "text": "..."},
    {"op": "delete", "id": "..."},
    {"op": "merge", "keep_id": "...", "delete_ids": ["..."], "text": "..."},
    {"op": "conflict", "ids": ["...", "..."], "reason": "one sentence explaining the contradiction"}
  ],
  "summary": "brief description of what was done"
}

Rules:
- Merge near-duplicate facts (same meaning, different wording) → keep best phrasing
- CONFLICT DETECTION: if two facts directly contradict each other (different values for the same attribute, e.g. revenue 40M vs 25M, different city, conflicting dates) → use op "conflict" with both IDs and a short reason. Do NOT delete or merge conflicting facts — flag them for human review.
- Only delete facts that are clearly trivial, redundant after a merge, or obviously superseded (e.g. old goal already achieved).
- Split overcrowded subcategories if needed, create new descriptive ones
- ALWAYS fix wrong category and subcategory assignments — this is critical:
  * Personal identity (name, surname, age, family, location) → category "Личное", subcategory "Имя и фамилия" / "Семья" / "Локация" / "Возраст"
  * Personal projects NOT related to main business → category "Личные проекты"
  * Main business facts → category matching the business name or "Бизнес"
  * Finances → category "Финансы"
  * Team/partners → category "Команда"
  * Market/competitors/clients → category "Рынок"
- You MAY create NEW categories if none of the existing ones fit — choose a clear Russian name
- Do NOT force-assign everything to "Другое" — use specific meaningful categories
- Keep atomic facts (one fact = one sentence)
- Preserve all IDs exactly as given
- If nothing to improve → return {"operations":[], "summary":"All facts look good"}`;

const MEMORY_GATE_SYSTEM = `You are a knowledge base builder for a personal AI assistant.
You receive a batch of recent conversation exchanges (multiple user/assistant turns).
Extract ALL facts found across the entire batch and return ONLY valid JSON (no markdown):
{"should_write":false,"reason":"...","facts":[]}

Each fact object MUST use this exact structure:
{"text":"...","category":"...","subcategory":"...","confidence":0.9}

CRITICAL: the field name is "text" (NOT "fact", NOT "content", NOT "value").

SAVE facts that are:
- Identity: full name, surname, age, location, family, background
- Business info: product, sales channels, clients, team, history, values, goals
- Personal projects separate from main business
- Stable preferences, work style, recurring patterns
- Explicit decisions, plans, challenges

DO NOT save:
- Small talk with zero informational value
- Assistant's own suggestions or questions
- Exact duplicates of EXISTING FACTS

Rules:
- NEVER write "пользователь" — use actual name (e.g. "Андрей") or "владелец"
- Each fact must be SELF-CONTAINED — readable without context
- One fact = one sentence
- Categories (Russian): "Личное", "Личные проекты", "О компании", "Финансы", "Команда", "Рынок"
- subcategory: 1-3 words (e.g. "Семья", "Возраст", "Локация")
- confidence 0..1 — skip if < 0.6`;

// Карта контекстных окон моделей (в токенах)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "llama-3.1-70b": 128000,
  "llama-3.1-8b": 128000,
  "gemini-1.5-pro": 1000000,
  "gemini-1.5-flash": 1000000,
};

// Грубая оценка токенов (символы / 3.5)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// Сжатый однострочный портрет из полного текста (первые 2 предложения)
function compactPortrait(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences.slice(0, 2).join(" ").trim();
}

function getModelContextLimit(model: string): number {
  const key = Object.keys(MODEL_CONTEXT_LIMITS).find((k) => model.toLowerCase().includes(k));
  return key ? MODEL_CONTEXT_LIMITS[key] : 32000;
}

// Умная обрезка истории с учётом бюджета токенов
function trimHistory(
  messages: Message[],
  systemTokens: number,
  maxTokens: number,
  contextLimit: number
): Array<{ role: string; content: string }> {
  // Резервируем токены: системный промпт + ответ модели + буфер 10%
  const budget = contextLimit - systemTokens - maxTokens - Math.ceil(contextLimit * 0.1);
  if (budget <= 0) return [];

  const all = messages.map((m) => ({ role: m.role, content: m.content }));
  let used = 0;
  const result: Array<{ role: string; content: string }> = [];

  // Берём с конца — самые свежие реплики приоритетны
  for (let i = all.length - 1; i >= 0; i--) {
    const t = estimateTokens(all[i].content);
    if (used + t > budget) break;
    used += t;
    result.unshift(all[i]);
  }
  return result;
}

const PORTRAIT_SYSTEM = `You are building a personal portrait of a person for their AI assistant.
You receive all known facts and category summaries about them.
Write a single cohesive narrative paragraph (3-7 sentences) in Russian that captures WHO this person is:
their name, age, location, what they do, key goals, key challenges, important personal context.

Rules:
- Write as if the assistant already knows this person well — warm, matter-of-fact tone
- Include specific details: numbers, names, places — they matter
- Do NOT use bullet points or headers — flowing prose only
- Do NOT start with "Это..." or "Пользователь..." — start with their name or role
- Maximum 120 words`;

const EPISODE_SYSTEM = `You are an episodic memory curator for a personal AI assistant.
Analyze this conversation and decide if it contains a notable EVENT or EXPERIENCE worth remembering as an episode.

An episode is: a specific thing that happened, a decision made, a trip taken, a problem solved, a meeting held, an emotion experienced, a milestone reached — something with temporal context.

NOT an episode: general facts about a person, preferences, abstract information.

Return ONLY valid JSON (no markdown):
{"has_episode": false, "episode": null}
OR
{"has_episode": true, "episode": {"title": "short title (5-8 words)", "summary": "2-4 sentences describing what happened", "category": "Событие|Путешествие|Встреча|Решение|Достижение|Проблема|Другое", "happened_at": "YYYY-MM-DD or null"}}

Be selective — only save genuinely noteworthy moments, not every conversation.`;

const PATTERN_SYSTEM = `You are a pattern recognition engine for a personal AI assistant.
Analyze the recent conversation history (multiple sessions) and identify RECURRING THEMES or PATTERNS.

A pattern is: a topic the person keeps returning to, an emotion they repeatedly express, a recurring problem, a habit, a consistent desire or concern.

Return ONLY valid JSON (no markdown):
{"patterns": [{"text": "one sentence describing the pattern", "category": "Эмоция|Тема|Привычка|Проблема|Желание", "evidence": "brief quote or reference from the conversation"}]}

Return empty array if no clear patterns found. Maximum 3 patterns per call. Be precise and specific.`;

// Получить embedding вектор текста через OpenAI embeddings API
async function getEmbedding(text: string, baseUrl: string, apiKey: string): Promise<number[] | null> {
  try {
    const embUrl = baseUrl.replace(/\/chat\/completions$/, "").replace(/\/$/, "") + "/embeddings";
    const res = await fetch(embUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "Ты — персональный ИИ-ассистент. В каждый диалог автоматически добавляется твоя долгосрочная память о владельце — используй её как само собой разумеющееся: обращайся по имени, учитывай контекст бизнеса и жизни, не переспрашивай то что уже знаешь. Отвечай чётко и по делу.",
  autoExtract: true,
  antiDuplicates: true,
  topFacts: true,
  autoSpeak: false,
  speechRate: 1.0,
  activePreset: "custom",
};

function apiMsgToMsg(m: ApiMessage): Message {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: new Date(m.created_at),
  };
}

function apiSessionToSession(s: ApiSession): Session {
  return {
    id: s.id,
    title: s.title,
    createdAt: new Date(s.created_at),
    preview: s.preview ?? undefined,
    messages: [],
  };
}

function apiFactToFact(f: ApiFact): Fact {
  return {
    id: f.id,
    content: f.text,
    category: f.category,
    subcategory: f.subcategory ?? undefined,
    addedAt: new Date(f.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
    source: f.source,
    confidence: f.confidence,
    status: f.status ?? "active",
  };
}

function apiEpisodeToEpisode(e: ApiEpisode): Episode {
  return {
    id: e.id,
    title: e.title,
    summary: e.summary,
    sessionId: e.session_id,
    happenedAt: e.happened_at,
    category: e.category,
    createdAt: e.created_at,
  };
}

function apiPatternToPattern(p: ApiPattern): Pattern {
  return {
    id: p.id,
    text: p.text,
    category: p.category,
    evidence: p.evidence,
    count: p.count,
    lastSeen: p.last_seen,
  };
}

function apiSettingsToConfig(s: ApiSettings): LLMConfig {
  const toggles = s.toggles ?? { autoExtract: true, antiDuplicates: true, topFacts: true };
  return {
    baseUrl: s.base_url,
    apiKey: s.api_key,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.max_tokens,
    systemPrompt: s.system_prompt,
    autoExtract: toggles.autoExtract,
    antiDuplicates: toggles.antiDuplicates,
    topFacts: toggles.topFacts,
    autoSpeak: (toggles as Record<string, boolean>).autoSpeak ?? false,
    speechRate: (toggles as Record<string, number>).speechRate ?? 1.0,
    activePreset: (toggles as Record<string, string>).activePreset ?? "custom",
  };
}

export function useChatStore() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [proactiveNote, setProactiveNote] = useState<string | null>(null);
  const [gateMessageCount, setGateMessageCount] = useState(0);
  const gateBatchRef = React.useRef<Array<{ user: string; assistant: string }>>([]);
  const [portrait, setPortrait] = useState<string>("");
  const loadLocalVoicePrefs = (): Partial<LLMConfig> => {
    try {
      return {
        autoSpeak: localStorage.getItem("autoSpeak") === "true",
        speechRate: parseFloat(localStorage.getItem("speechRate") ?? "1.0"),
      };
    } catch { return {}; }
  };

  const [config, setConfig] = useState<LLMConfig>({ ...DEFAULT_CONFIG, ...loadLocalVoicePrefs() });
  const [isThinking, setIsThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);
  const factsSinceConsolidationRef = React.useRef(0);
  const AUTO_CONSOLIDATE_THRESHOLD = 20;
  const runPortraitRef = React.useRef<(() => Promise<string>) | null>(null);
  const runConsolidationRef = React.useRef<(() => Promise<string>) | null>(null);
  const runPatternDetectorRef = React.useRef<((cfg?: LLMConfig) => Promise<void>) | null>(null);
  const [lastSavedCount, setLastSavedCount] = useState(0);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [newFactIds, setNewFactIds] = useState<Set<string>>(new Set());
  const [updatedSummaryCategories, setUpdatedSummaryCategories] = useState<Set<string>>(new Set());
  const [prevSummaries, setPrevSummaries] = useState<Record<string, string>>({});
  const [autoConsolidated, setAutoConsolidated] = useState(false);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await api.messages.list(sessionId);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, messages: msgs.map(apiMsgToMsg) } : s
        )
      );
    } catch (e) {
      console.warn("loadSessionMessages", e);
    }
  }, []);

  // Загружаем все данные при старте
  useEffect(() => {
    async function boot() {
      try {
        const [apiSessions, apiFacts, apiSettings, apiSummaries, apiEpisodes, apiPatterns] = await Promise.all([
          api.sessions.list(),
          api.facts.list({ include_review: true }),
          api.settings.get(),
          api.summaries.list().catch(() => []),
          api.episodes.list({ limit: 100 }).catch(() => []),
          api.patterns.list().catch(() => []),
        ]);

        const sessionsData = apiSessions.map(apiSessionToSession);
        setSessions(sessionsData);

        if (sessionsData.length > 0) {
          const firstId = sessionsData[0].id;
          setActiveSessionId(firstId);
          const msgs = await api.messages.list(firstId);
          setSessions((prev) =>
            prev.map((s) => (s.id === firstId ? { ...s, messages: msgs.map(apiMsgToMsg) } : s))
          );
        }

        setFacts(apiFacts.map(apiFactToFact));
        setConfig(apiSettingsToConfig(apiSettings));
        const summaryMap: Record<string, string> = {};
        for (const s of apiSummaries) {
          if (s.category === "__portrait__") {
            setPortrait(s.summary);
          } else {
            summaryMap[s.category] = s.summary;
          }
        }
        setSummaries(summaryMap);
        setEpisodes(apiEpisodes.map(apiEpisodeToEpisode));
        setPatterns(apiPatterns.map(apiPatternToPattern));
      } catch (_) {
        setAppError("Не удалось подключиться к серверу");
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const createSession = useCallback(async () => {
    try {
      const s = await api.sessions.create();
      const newSession = apiSessionToSession(s);
      const msgs = await api.messages.list(s.id);
      newSession.messages = msgs.map(apiMsgToMsg);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      return newSession.id;
    } catch (_) {
      setAppError("Не удалось создать сессию");
      return "";
    }
  }, []);

  const selectSession = useCallback(
    async (id: string) => {
      setActiveSessionId(id);
      const already = sessions.find((s) => s.id === id);
      if (!already || already.messages.length === 0) {
        await loadSessionMessages(id);
      }
    },
    [sessions, loadSessionMessages]
  );

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.sessions.delete(id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeSessionId && next.length > 0) {
          setActiveSessionId(next[0].id);
        }
        return next;
      });
    } catch (e) {
      console.warn("delete session", e);
    }
  }, [activeSessionId]);

  const runConsolidation = useCallback(async (): Promise<string> => {
    if (!config.apiKey || !config.baseUrl) return "LLM не подключён";
    if (facts.length === 0) return "База знаний пуста — нечего структурировать";

    const factsList = facts.map((f) =>
      `{"id":"${f.id}","category":"${f.category}","subcategory":"${f.subcategory ?? ""}","text":"${f.content}"}`
    ).join("\n");

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.0,
        max_tokens: 2048,
        messages: [
          { role: "system", content: CONSOLIDATION_SYSTEM },
          { role: "user", content: `Here are all facts about the user:\n\n${factsList}` },
        ],
      }),
    });

    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";

    let result: { operations: Array<{ op: string; id?: string; keep_id?: string; delete_ids?: string[]; ids?: string[]; text?: string; category?: string; subcategory?: string; status?: string; reason?: string }>; summary: string };
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : raw);
    } catch {
      throw new Error("Не удалось разобрать ответ LLM");
    }

    let applied = 0;
    let conflicts = 0;
    for (const op of result.operations ?? []) {
      try {
        if (op.op === "update" && op.id) {
          await api.facts.update(op.id, { text: op.text, category: op.category, subcategory: op.subcategory });
          applied++;
        } else if (op.op === "delete" && op.id) {
          await api.facts.delete(op.id);
          applied++;
        } else if (op.op === "merge" && op.keep_id) {
          if (op.text || op.category || op.subcategory) {
            await api.facts.update(op.keep_id, { text: op.text, category: op.category, subcategory: op.subcategory });
          }
          for (const did of op.delete_ids ?? []) {
            await api.facts.delete(did);
          }
          applied++;
        } else if (op.op === "conflict" && op.ids?.length) {
          // Помечаем все конфликтующие факты как needs_review
          for (const cid of op.ids) {
            await api.facts.update(cid, { status: "needs_review" });
          }
          conflicts++;
          console.log(`[CONSOLIDATION] conflict flagged: ${op.ids.join(", ")} — ${op.reason}`);
        }
      } catch (e) {
        console.warn("[CONSOLIDATION] op failed", op, e);
      }
    }

    // Обновляем список фактов
    const freshFacts = await api.facts.list();
    setFacts(freshFacts.map(apiFactToFact));

    // Сбрасываем счётчик автоконсолидации
    factsSinceConsolidationRef.current = 0;

    // Автоматически обновляем портрет после консолидации
    try {
      if (runPortraitRef.current) await runPortraitRef.current();
    } catch (e) {
      console.warn("[CONSOLIDATION] portrait update failed", e);
    }

    // Паттерны — после консолидации, когда память максимально свежая
    setTimeout(() => {
      runPatternDetectorRef.current?.(config);
    }, 2000);

    const conflictNote = conflicts > 0 ? `, конфликтов: ${conflicts}` : "";
    return `${result.summary} (операций: ${applied}${conflictNote})`;
  }, [config, facts]);

  const SUMMARY_SYSTEM = `You are a knowledge base curator. Given a list of facts about a person or their business under one category, write a comprehensive, dense summary that captures ALL important information.

Rules:
- Write in Russian
- Preserve all specific details: numbers, names, dates, addresses, URLs
- Do NOT omit anything that could be useful context
- Choose the format and length yourself based on the amount of information: few facts → compact, many facts → structured with line breaks or bullet points
- Do not add introductory phrases like "В данной категории..." — just write the content directly`;

  const runSummaries = useCallback(async (): Promise<string> => {
    if (!config.apiKey || !config.baseUrl) return "LLM не подключён";
    if (facts.length === 0) return "Нет фактов для резюмирования";

    // Группируем по всем реальным категориям из фактов
    const byCategory: Record<string, Fact[]> = {};
    for (const f of facts) {
      const cat = f.category || "Другое";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(f);
    }
    const allCategories = Object.keys(byCategory);

    // Сохраняем старые резюме для diff
    setPrevSummaries({ ...summaries });

    const newSummaries: Record<string, string> = {};
    let updated = 0;

    for (const cat of allCategories) {
      const catFacts = byCategory[cat];
      if (catFacts.length === 0) continue;

      const factLines = catFacts
        .map((f) => `- [${f.subcategory || "Общее"}] ${f.content}`)
        .join("\n");

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 1200,
          messages: [
            { role: "system", content: SUMMARY_SYSTEM },
            { role: "user", content: `Раздел: ${cat}\n\nФакты:\n${factLines}` },
          ],
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      const text: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) continue;

      await api.summaries.save(cat, text, catFacts.length).catch(() => null);
      newSummaries[cat] = text;
      updated++;
    }

    setSummaries((prev) => ({ ...prev, ...newSummaries }));
    setUpdatedSummaryCategories(new Set(Object.keys(newSummaries)));
    return `Обновлено резюме для ${updated} ${updated === 1 ? "категории" : updated < 5 ? "категорий" : "категорий"}`;
  }, [config, facts]);

  const runPortrait = useCallback(async (): Promise<string> => {
    if (!config.apiKey || !config.baseUrl) return "LLM не подключён";
    if (facts.length === 0) return "Нет фактов для портрета";

    const factLines = facts.map((f) => `- [${f.category}${f.subcategory ? ` / ${f.subcategory}` : ""}] ${f.content}`).join("\n");
    const summaryLines = Object.entries(summaries)
      .filter(([, s]) => s)
      .map(([cat, s]) => `### ${cat}\n${s}`)
      .join("\n\n");

    const input = `${summaryLines ? `РЕЗЮМЕ ПО РАЗДЕЛАМ:\n${summaryLines}\n\n` : ""}ВСЕ ФАКТЫ:\n${factLines}`;

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: "system", content: PORTRAIT_SYSTEM },
          { role: "user", content: input },
        ],
      }),
    });

    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Пустой ответ");

    await api.summaries.save("__portrait__", text, facts.length).catch(() => null);
    setPortrait(text);
    return text;
  }, [config, facts, summaries]);

  // ── Episodic Memory: детектор событий ─────────────────────────
  const runEpisodeDetector = useCallback(async (
    batch: Array<{ user: string; assistant: string }>,
    sessionId: string,
    cfg = config
  ) => {
    if (!cfg.apiKey || !cfg.baseUrl || batch.length === 0) return;
    try {
      const dialogText = batch
        .map((p) => `USER: ${p.user}\nASSISTANT: ${p.assistant}`)
        .join("\n\n");

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.0,
          max_tokens: 512,
          messages: [
            { role: "system", content: EPISODE_SYSTEM },
            { role: "user", content: dialogText },
          ],
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return;

      const result: { has_episode: boolean; episode?: { title: string; summary: string; category: string; happened_at?: string } } = JSON.parse(match[0]);
      if (!result.has_episode || !result.episode) return;

      const { title, summary, category, happened_at } = result.episode;
      const embedding = await getEmbedding(title + " " + summary, cfg.baseUrl, cfg.apiKey);

      const saved = await api.episodes.create({
        title,
        summary,
        session_id: sessionId,
        happened_at: happened_at ?? undefined,
        category,
        embedding: embedding ?? undefined,
      });

      setEpisodes((prev) => [apiEpisodeToEpisode(saved), ...prev]);
      console.log(`[EPISODE] saved: ${title}`);
    } catch (e) {
      console.warn("[EPISODE] failed", e);
    }
  }, [config]);

  // ── Pattern Detector: анализ дистиллированной памяти ─────────
  // Источник: факты + эпизоды + резюме (= вся история, уже сжатая)
  // Триггер: вызывается после консолидации/портрета, не чаще раза в день
  const runPatternDetector = useCallback(async (cfg = config) => {
    if (!cfg.apiKey || !cfg.baseUrl) return;

    // Не чаще раза в день
    try {
      const lastRun = localStorage.getItem("patternDetectorLastRun");
      if (lastRun && Date.now() - parseInt(lastRun) < 86400000) {
        console.log("[PATTERN] skipped — ran less than 24h ago");
        return;
      }
    } catch { /* ignore */ }

    try {
      // Вход: факты + эпизоды + резюме — вся дистиллированная память
      const factLines = facts
        .filter((f) => f.status === "active")
        .map((f) => `- [${f.category}${f.subcategory ? `/${f.subcategory}` : ""}] ${f.content}`)
        .join("\n");

      const episodeLines = episodes
        .map((e) => `- [${e.category}${e.happenedAt ? ` · ${e.happenedAt}` : ""}] ${e.title}: ${e.summary}`)
        .join("\n");

      const summaryLines = Object.entries(summaries)
        .filter(([cat]) => cat !== "__portrait__")
        .map(([cat, s]) => `${cat}: ${s}`)
        .join("\n");

      const input = [
        summaryLines ? `РЕЗЮМЕ ПО РАЗДЕЛАМ:\n${summaryLines}` : "",
        episodeLines ? `СОБЫТИЯ И ЭПИЗОДЫ:\n${episodeLines}` : "",
        factLines ? `ВСЕ ФАКТЫ:\n${factLines}` : "",
      ].filter(Boolean).join("\n\n");

      if (!input.trim()) return;

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 600,
          messages: [
            { role: "system", content: PATTERN_SYSTEM },
            { role: "user", content: input },
          ],
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return;

      const result: { patterns: Array<{ text: string; category: string; evidence: string }> } = JSON.parse(match[0]);
      if (!result.patterns?.length) return;

      for (const p of result.patterns) {
        const saved = await api.patterns.upsert({ text: p.text, category: p.category, evidence: p.evidence });
        console.log(`[PATTERN] ${saved.updated ? "updated" : "new"} (count=${saved.count}): ${p.text}`);
        if (saved.count >= 2) {
          setProactiveNote(p.text);
        }
      }

      const fresh = await api.patterns.list().catch(() => []);
      setPatterns(fresh.map(apiPatternToPattern));

      try { localStorage.setItem("patternDetectorLastRun", String(Date.now())); } catch { /* ignore */ }
    } catch (e) {
      console.warn("[PATTERN] failed", e);
    }
  }, [config, facts, episodes, summaries]);

  // ── Embedding для фактов (фоновый) ────────────────────────────
  const embedFactsBackground = useCallback(async (factIds: string[], factTexts: string[], cfg = config) => {
    if (!cfg.apiKey || !cfg.baseUrl) return;
    for (let i = 0; i < factIds.length; i++) {
      const emb = await getEmbedding(factTexts[i], cfg.baseUrl, cfg.apiKey);
      if (emb) {
        await api.facts.setEmbedding(factIds[i], emb).catch(() => null);
      }
    }
  }, [config]);

  // Регистрируем refs — для forward-ссылок между функциями
  runPortraitRef.current = runPortrait;
  runConsolidationRef.current = runConsolidation;
  runPatternDetectorRef.current = runPatternDetector;

  const runMemoryGate = useCallback(async (batch: Array<{ user: string; assistant: string }>, currentFacts: Fact[], cfg = config) => {
    console.log("[GATE] start batch", { count: batch.length, autoExtract: cfg.autoExtract, hasKey: !!cfg.apiKey, hasUrl: !!cfg.baseUrl });
    if (!cfg.autoExtract || !cfg.apiKey || !cfg.baseUrl || batch.length === 0) return;
    try {
      const batchText = batch.map((p, i) => `--- Exchange ${i + 1} ---\nUSER: ${p.user}\nASSISTANT: ${p.assistant}`).join("\n\n");
      const userContent = batchText;

      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.0,
          max_tokens: 1024,
          messages: [
            { role: "system", content: MEMORY_GATE_SYSTEM },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!res.ok) return;
      const data = await res.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";

      let result: { should_write: boolean; facts?: Array<{ text: string; category: string; subcategory?: string; confidence: number }> };
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        result = JSON.parse(match ? match[0] : raw);
      } catch {
        return;
      }

      console.log("[GATE]", result.should_write, (result as { reason?: string }).reason ?? "");
      console.log("[GATE] facts raw:", JSON.stringify(result.facts?.slice(0, 3)));
      if (!result.should_write || !result.facts?.length) return;

      const newFacts: Fact[] = [];
      for (const item of result.facts) {
        const itemText = item.text || item.fact || item.content || "";
        console.log(`[GATE] item: conf=${item.confidence} cat=${item.category} text=${itemText.slice(0,50)}`);
        if (!itemText || item.confidence < 0.6) {
          console.log(`[GATE] skip: text=${!!itemText} conf=${item.confidence}`);
          continue;
        }
        try {
          const saved = await api.facts.create(itemText, item.category || "Личное", "memory_gate" as "manual", item.subcategory || undefined);
          newFacts.push(apiFactToFact(saved));
          console.log(`[GATE] +fact [${item.category}/${item.subcategory}]: ${item.text}`);
        } catch (e) {
          console.warn("[GATE] save error", e);
        }
      }

      if (newFacts.length > 0) {
        setFacts((prev) => [...newFacts, ...prev]);
        setLastSavedCount(newFacts.length);
        setTimeout(() => setLastSavedCount(0), 4000);
        setNewFactIds((prev) => new Set([...prev, ...newFacts.map((f) => f.id)]));

        // Фоново генерируем embeddings для новых фактов
        setTimeout(() => {
          embedFactsBackground(
            newFacts.map((f) => f.id),
            newFacts.map((f) => f.content),
            cfg
          );
        }, 1000);

        // Автоконсолидация: накопилось достаточно новых фактов
        factsSinceConsolidationRef.current += newFacts.length;
        if (factsSinceConsolidationRef.current >= AUTO_CONSOLIDATE_THRESHOLD) {
          console.log(`[GATE] auto-consolidation triggered (${factsSinceConsolidationRef.current} new facts)`);
          setTimeout(() => {
            runConsolidationRef.current?.()
              .then(() => {
                setAutoConsolidated(true);
                setTimeout(() => setAutoConsolidated(false), 4000);
              })
              .catch((e) => console.warn("[AUTO-CONSOLIDATION] failed", e));
          }, 2000);
        }
      }
    } catch (e) {
      console.warn("[GATE] failed", e);
    }
  }, [config, embedFactsBackground]);

  const isProfileCommand = (t: string): boolean => {
    const q = t.toLowerCase().trim();
    return /\bмой\s+профиль\b|\bпрофиль\b|\bсводка\s+фактов\b|\bмоя\s+память\b|\bпокажи\s+память\b/.test(q);
  };

  const formatProfile = (data: ApiProfile): string => {
    const { profile, stats } = data;
    if (stats.facts_total === 0) {
      return "База знаний пока пуста. Поговорите со мной — я начну запоминать важные детали.";
    }
    const lines: string[] = [`**Профиль (по памяти)** · ${stats.facts_total} фактов · ${stats.categories} категорий`];
    for (const cat of profile) {
      lines.push(`\n### ${cat.category}`);
      for (const sec of cat.sections) {
        lines.push(`**${sec.subcategory}**`);
        for (const item of sec.items) {
          lines.push(`• ${item.text}`);
        }
      }
    }
    return lines.join("\n");
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isThinking || !activeSessionId) return;

      const tempId = `temp-${Date.now()}`;
      const userMsg: Message = {
        id: tempId,
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, userMsg], title: text.slice(0, 40) }
            : s
        )
      );
      setIsThinking(true);

      // Сохраняем user message
      try {
        await api.messages.create(activeSessionId, "user", text);
      } catch (e) {
        console.warn("save user msg", e);
      }

      let assistantContent = "";

      // ── Команда "профиль" — без LLM ──
      if (isProfileCommand(text)) {
        try {
          const profileData = await api.facts.profile(5);
          assistantContent = formatProfile(profileData);
        } catch {
          assistantContent = "Не удалось загрузить профиль. Попробуйте позже.";
        }

        const savedMsg = await api.messages.create(activeSessionId, "assistant", assistantContent).catch(() => null);
        const assistantMsg: Message = savedMsg
          ? { id: savedMsg.id, role: "assistant", content: assistantContent, timestamp: new Date(savedMsg.created_at) }
          : { id: `resp-${Date.now()}`, role: "assistant", content: assistantContent, timestamp: new Date() };

        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, messages: [...s.messages.filter((m) => m.id !== tempId), assistantMsg] }
              : s
          )
        );
        setIsThinking(false);
        return;
      }

      if (!config.apiKey || !config.baseUrl) {
        await new Promise((r) => setTimeout(r, 800));
        assistantContent =
          "⚠️ LLM не подключён. Откройте «Настройки», введите Base URL и API-ключ, нажмите «Сохранить».";
      } else {
        try {
          const currentMsgs = (activeSession?.messages ?? []).filter((m) => m.id !== tempId);
          const contextLimit = getModelContextLimit(config.model);

          // ── Стратегия памяти ──────────────────────────────────────────────
          //
          // Три слоя, фиксированный объём независимо от размера базы:
          //
          // 1. ПОРТРЕТ компактный (~100 токенов) — ВСЕГДА
          //    "Кто передо мной" — идентичность пользователя в каждом запросе
          //
          // 2. РЕЗЮМЕ: "О компании" + "Цели/проблемы" — ВСЕГДА (anchor)
          //    + остальные резюме — только если семантически близки к вопросу (RAG)
          //    Signal/noise: убираем нерелевантный шум из промпта
          //
          // 3. РЕЛЕВАНТНЫЕ ФАКТЫ по RAG (~200-300 токенов) — ВСЕГДА
          //    keywords → если < 3 результатов → ILIKE fallback → последние N
          //
          // Итого: ~600-900 токенов памяти, не растёт с размером базы
          // ─────────────────────────────────────────────────────────────────

          // Слой 1: компактный портрет
          const portraitCompact = portrait ? compactPortrait(portrait) : "";
          const portraitBlock = portraitCompact
            ? `\n\n[О пользователе: ${portraitCompact}]`
            : "";

          // Слой 2: RAG по тексту резюме — топ-3 по keyword-overlap с запросом
          // Матчим запрос против содержимого резюме, а не названия категории.
          // Это работает для любой сферы жизни: "как Маша?" → резюме Семьи содержит "Маша"
          const queryLower = text.toLowerCase();
          const queryWords = queryLower.replace(/[^\wа-яё\s]/gi, " ").split(/\s+/).filter((w) => w.length >= 3);

          const scoredSummaries = Object.entries(summaries)
            .filter(([cat, s]) => s && cat !== "__portrait__")
            .map(([cat, s]) => {
              const bodyLower = s.toLowerCase();
              const hits = queryWords.filter((w) => bodyLower.includes(w)).length;
              return { cat, s, hits };
            })
            .filter(({ hits }) => hits > 0)
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 3);

          const summaryLines = scoredSummaries
            .map(({ cat, s }) => `${cat}: ${s}`)
            .join("\n");
          const summaryBlock = summaryLines
            ? `\n\n[Контекст по разделам:\n${summaryLines}]`
            : "";

          // Слой 3: релевантные факты — гибридный RAG (semantic + keyword)
          let ragBlock = "";
          if (facts.length > 0) {
            let ragFacts: Array<{ category: string; subcategory?: string; content?: string; text?: string }> = [];
            if (facts.length <= 20) {
              ragFacts = facts;
            } else {
              try {
                // Сначала пробуем semantic search через embeddings
                const queryEmb = await getEmbedding(text, config.baseUrl, config.apiKey);
                if (queryEmb) {
                  const semFacts = await api.facts.semanticSearch(queryEmb, 8).catch(() => []);
                  if (semFacts.length >= 3) {
                    ragFacts = semFacts;
                  } else {
                    // Fallback: keyword RAG
                    const kwFacts = await api.facts.relevant(text, 8);
                    const combined = [...semFacts, ...kwFacts.filter((k) => !semFacts.find((s) => s.id === k.id))];
                    ragFacts = combined.slice(0, 8);
                  }
                } else {
                  // Embedding недоступен — keyword fallback
                  const fetched = await api.facts.relevant(text, 8);
                  if (fetched.length >= 3) {
                    ragFacts = fetched;
                  } else {
                    const fallback = facts.filter((f) => !fetched.find((r) => r.id === f.id));
                    ragFacts = [...fetched, ...fallback].slice(0, 8);
                  }
                }
              } catch {
                ragFacts = facts.slice(0, 8);
              }
            }
            const ragLines = ragFacts
              .map((f) => {
                const label = (f as Fact).subcategory ? `${f.category}/${(f as Fact).subcategory}` : f.category;
                const body = (f as Fact).content ?? (f as ApiFact).text ?? "";
                return `- [${label}] ${body}`;
              })
              .join("\n");
            if (ragLines) ragBlock = `\n\n[Детали:\n${ragLines}]`;
          }

          // Слой 4: релевантные эпизоды (события из прошлого)
          let episodeBlock = "";
          if (episodes.length > 0) {
            try {
              const relEpisodes = await api.episodes.relevant(text, 3);
              if (relEpisodes.length > 0) {
                const lines = relEpisodes.map((e) => `- [${e.category}${e.happened_at ? ` · ${e.happened_at}` : ""}] ${e.title}: ${e.summary}`).join("\n");
                episodeBlock = `\n\n[Из прошлого:\n${lines}]`;
              }
            } catch { /* ignore */ }
          }

          const systemContent = config.systemPrompt + portraitBlock + summaryBlock + ragBlock + episodeBlock;

          // История с умной обрезкой под финальный системный промпт
          const history = trimHistory(
            currentMsgs,
            estimateTokens(systemContent),
            config.maxTokens,
            contextLimit
          );

          const res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              temperature: config.temperature,
              max_tokens: config.maxTokens,
              messages: [
                { role: "system", content: systemContent },
                ...history,
                { role: "user", content: text },
              ],
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            assistantContent = `Ошибка API (${res.status}): ${errData?.error?.message ?? res.statusText}`;
          } else {
            const data = await res.json();
            assistantContent = data?.choices?.[0]?.message?.content ?? "Пустой ответ от модели.";
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
          assistantContent = `Ошибка соединения: ${msg}`;
        }
      }

      // Сохраняем ответ ассистента
      let savedMsg: Message | null = null;
      try {
        const saved = await api.messages.create(activeSessionId, "assistant", assistantContent);
        savedMsg = apiMsgToMsg(saved);
      } catch (e) {
        console.warn("save assistant msg", e);
      }

      const assistantMsg: Message = savedMsg ?? {
        id: `resp-${Date.now()}`,
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: [
                  ...s.messages.filter((m) => m.id !== tempId),
                  { ...userMsg, id: userMsg.id },
                  assistantMsg,
                ],
              }
            : s
        )
      );
      setIsThinking(false);

      // Memory Gate — батчинг: накапливаем пары, запускаем каждые 4 сообщения
      if (assistantContent && !assistantContent.startsWith("⚠️") && !assistantContent.startsWith("Ошибка")) {
        gateBatchRef.current.push({ user: text, assistant: assistantContent });
        const nextCount = gateMessageCount + 1;
        setGateMessageCount(nextCount);
        if (nextCount % 4 === 0) {
          const batch = [...gateBatchRef.current];
          gateBatchRef.current = [];
          runMemoryGate(batch, facts, config);

          // Episodic memory: ищем события в том же батче
          setTimeout(() => {
            runEpisodeDetector(batch, activeSessionId, config);
          }, 3000);
        }
      }
    },
    [activeSessionId, activeSession, config, facts, isThinking, runMemoryGate, gateMessageCount, runEpisodeDetector]
  );

  const clearFacts = useCallback(async () => {
    try {
      await api.facts.clear();
      setFacts([]);
      setSummaries({});
    } catch (_) {
      setAppError("Не удалось очистить базу знаний");
    }
  }, []);

  const addFact = useCallback(async (content: string, category: string) => {
    try {
      const f = await api.facts.create(content, category);
      setFacts((prev) => [apiFactToFact(f), ...prev]);
    } catch (_) {
      setAppError("Не удалось добавить факт");
    }
  }, []);

  const deleteFact = useCallback(async (id: string) => {
    setFacts((prev) => prev.filter((f) => f.id !== id));
    try {
      await api.facts.delete(id);
    } catch (e) {
      console.warn("delete fact", e);
    }
  }, []);

  const saveConfig = useCallback(async (newConfig: LLMConfig) => {
    setConfig(newConfig);
    try { localStorage.setItem("autoSpeak", String(newConfig.autoSpeak)); } catch { /* */ }
    try { localStorage.setItem("speechRate", String(newConfig.speechRate)); } catch { /* */ }
    try {
      await api.settings.save({
        base_url: newConfig.baseUrl,
        api_key: newConfig.apiKey,
        model: newConfig.model,
        temperature: newConfig.temperature,
        max_tokens: newConfig.maxTokens,
        system_prompt: newConfig.systemPrompt,
        toggles: {
          autoExtract: newConfig.autoExtract,
          antiDuplicates: newConfig.antiDuplicates,
          topFacts: newConfig.topFacts,
          autoSpeak: newConfig.autoSpeak,
          speechRate: newConfig.speechRate,
          activePreset: newConfig.activePreset,
        },
      });
    } catch (_) {
      setAppError("Не удалось сохранить настройки");
    }
  }, []);

  const dismissPattern = useCallback(async (id: string) => {
    setPatterns((prev) => prev.filter((p) => p.id !== id));
    await api.patterns.dismiss(id).catch(() => null);
  }, []);

  const archiveEpisode = useCallback(async (id: string) => {
    setEpisodes((prev) => prev.filter((e) => e.id !== id));
    await api.episodes.archive(id).catch(() => null);
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    facts,
    summaries,
    episodes,
    patterns,
    proactiveNote,
    clearProactiveNote: () => setProactiveNote(null),
    config,
    isThinking,
    loading,
    appError,
    lastSavedCount,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    addFact,
    deleteFact,
    clearFacts,
    saveConfig,
    runConsolidation,
    runSummaries,
    portrait,
    runPortrait,
    autoConsolidated,
    newFactIds,
    clearNewFactIds: () => setNewFactIds(new Set()),
    updatedSummaryCategories,
    clearUpdatedSummaries: () => setUpdatedSummaryCategories(new Set()),
    prevSummaries,
    dismissPattern,
    archiveEpisode,
    runEpisodeDetector,
    runPatternDetector,
  };
}