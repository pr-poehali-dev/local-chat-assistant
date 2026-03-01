import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { ApiSession, ApiMessage, ApiFact, ApiSettings, ApiProfile } from "@/lib/api";

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
}

const CONSOLIDATION_SYSTEM = `You are a memory curator for a personal AI assistant.
You receive all facts stored about the user. Your job: restructure, deduplicate, and improve them.

Return ONLY valid JSON (no markdown):
{
  "operations": [
    {"op": "update", "id": "...", "category": "...", "subcategory": "...", "text": "..."},
    {"op": "delete", "id": "..."},
    {"op": "merge", "keep_id": "...", "delete_ids": ["..."], "text": "..."}
  ],
  "summary": "brief description of what was done"
}

Rules:
- Merge near-duplicate facts (same meaning, different wording) → keep best phrasing
- Split overcrowded subcategories if needed, create new descriptive ones
- Rename vague subcategories (null/"Общее") → give them proper names based on content
- Correct wrong category assignments
- Delete facts that are clearly outdated, trivial or contradicted by better facts
- Keep atomic facts (one fact = one sentence)
- Preserve all IDs exactly as given
- If nothing to improve → return {"operations":[], "summary":"All facts look good"}
- Available categories: О компании, Финансы, Команда, Рынок, Другое`;

const MEMORY_GATE_SYSTEM = `You are a memory extractor for a personal AI assistant.
Your job: extract ALL valuable long-term facts from the conversation, regardless of what's already stored.
Return ONLY valid JSON (no markdown):
{"should_write":false,"reason":"...","facts":[]}

ALWAYS SAVE facts that are:
- Personal context (name, location, role, background story, how they started)
- Business info (company name, product, market, customers, team size, revenue, history)
- Stable preferences (work style, likes/dislikes, values)
- Explicit decisions/policies ("we always do X")
- Goals, challenges, plans

DO NOT save:
- Pure small talk or greetings with zero information
- Assistant's own suggestions or questions
- Exact duplicates of EXISTING FACTS (same meaning, same wording)

Rules:
- Extract as many facts as the conversation contains — no artificial limit
- If the user tells a story → decompose it into separate atomic facts
- EXISTING FACTS are shown only to avoid exact duplicates. DO NOT use them to block new or complementary facts on the same topic.
- Each fact: text (short atomic sentence in Russian), category (О компании|Финансы|Команда|Рынок|Другое), subcategory (1-3 words), confidence 0..1
- Skip only facts with confidence < 0.6
- reason: one short sentence (for logs)`;

const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "Ты — персональный ИИ-ассистент для анализа данных и принятия деловых решений. Отвечай чётко, структурированно и по делу.",
  autoExtract: true,
  antiDuplicates: true,
  topFacts: true,
  autoSpeak: false,
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
  };
}

export function useChatStore() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [config, setConfig] = useState<LLMConfig>(DEFAULT_CONFIG);
  const [isThinking, setIsThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState<string | null>(null);
  const [lastSavedCount, setLastSavedCount] = useState(0);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

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
        const [apiSessions, apiFacts, apiSettings, apiSummaries] = await Promise.all([
          api.sessions.list(),
          api.facts.list(),
          api.settings.get(),
          api.summaries.list().catch(() => []),
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
        for (const s of apiSummaries) summaryMap[s.category] = s.summary;
        setSummaries(summaryMap);
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

    let result: { operations: Array<{ op: string; id?: string; keep_id?: string; delete_ids?: string[]; text?: string; category?: string; subcategory?: string }>; summary: string };
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : raw);
    } catch {
      throw new Error("Не удалось разобрать ответ LLM");
    }

    let applied = 0;
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
        }
      } catch (e) {
        console.warn("[CONSOLIDATION] op failed", op, e);
      }
    }

    // Обновляем список фактов
    const freshFacts = await api.facts.list();
    setFacts(freshFacts.map(apiFactToFact));

    return `${result.summary} (операций: ${applied})`;
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

    const CATEGORIES = ["О компании", "Финансы", "Команда", "Рынок", "Другое"];
    const byCategory: Record<string, Fact[]> = {};
    for (const cat of CATEGORIES) byCategory[cat] = [];
    for (const f of facts) {
      const cat = f.category || "Другое";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(f);
    }

    const newSummaries: Record<string, string> = {};
    let updated = 0;

    for (const cat of CATEGORIES) {
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
          max_tokens: 800,
          messages: [
            { role: "system", content: SUMMARY_SYSTEM },
            { role: "user", content: `Категория: ${cat}\n\nФакты:\n${factLines}` },
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
    return `Обновлено резюме для ${updated} ${updated === 1 ? "категории" : updated < 5 ? "категорий" : "категорий"}`;
  }, [config, facts]);

  const runMemoryGate = useCallback(async (userMsg: string, assistantMsg: string, currentFacts: Fact[], cfg = config) => {
    console.log("[GATE] start", { autoExtract: cfg.autoExtract, hasKey: !!cfg.apiKey, hasUrl: !!cfg.baseUrl });
    if (!cfg.autoExtract || !cfg.apiKey || !cfg.baseUrl) return;
    try {
      const existingSample = currentFacts.slice(0, 8)
        .map((f) => `- [${f.category}] ${f.content}`)
        .join("\n") || "none";

      const userContent = `USER: ${userMsg}\n\nASSISTANT: ${assistantMsg}\n\nEXISTING FACTS (do not duplicate):\n${existingSample}`;

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
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
      if (!result.should_write || !result.facts?.length) return;

      const newFacts: Fact[] = [];
      for (const item of result.facts) {
        if (!item.text || item.confidence < 0.6) continue;
        try {
          const saved = await api.facts.create(item.text, item.category || "Другое", "memory_gate" as "manual", item.subcategory || undefined);
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
      }
    } catch (e) {
      console.warn("[GATE] failed", e);
    }
  }, [config]);

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
          // Если фактов мало (≤15) — берём все. Иначе — релевантные по запросу.
          let relevantFacts = facts;
          if (facts.length > 15) {
            try {
              const fetched = await api.facts.relevant(text, 10);
              if (fetched.length > 0) {
                relevantFacts = fetched.map((f) => ({
                  id: f.id,
                  content: f.text,
                  category: f.category,
                  subcategory: f.subcategory ?? undefined,
                  addedAt: "",
                  source: f.source,
                }));
              }
            } catch {
              // fallback: все факты
            }
          }

          // Конспекты категорий — общая картина
          const summaryLines = Object.entries(summaries)
            .filter(([, s]) => s)
            .map(([cat, s]) => `### ${cat}\n${s}`)
            .join("\n\n");

          // Релевантные факты — детали
          const factLines = relevantFacts.length > 0
            ? relevantFacts.map((f) => `- [${f.subcategory ? `${f.category} / ${f.subcategory}` : f.category}] ${f.content}`).join("\n")
            : "";

          const factContext = summaryLines || factLines
            ? `\n\n---\nПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ:\n${summaryLines ? `## Конспект по категориям\n${summaryLines}` : ""}${factLines ? `\n\n## Релевантные факты\n${factLines}` : ""}`
            : "";

          const currentMsgs = activeSession?.messages ?? [];
          const history = currentMsgs
            .filter((m) => m.id !== tempId)
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }));

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
                { role: "system", content: config.systemPrompt + factContext },
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

      // Memory Gate — фоново, не блокирует UI
      console.log("[SEND] assistantContent ok?", !!assistantContent, assistantContent?.slice(0, 30));
      if (assistantContent && !assistantContent.startsWith("⚠️") && !assistantContent.startsWith("Ошибка")) {
        runMemoryGate(text, assistantContent, facts, config);
      }
    },
    [activeSessionId, activeSession, config, facts, isThinking, runMemoryGate]
  );

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
        },
      });
    } catch (_) {
      setAppError("Не удалось сохранить настройки");
    }
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    facts,
    summaries,
    config,
    isThinking,
    loading,
    appError,
    lastSavedCount,
    createSession,
    selectSession,
    sendMessage,
    addFact,
    deleteFact,
    saveConfig,
    runConsolidation,
    runSummaries,
  };
}