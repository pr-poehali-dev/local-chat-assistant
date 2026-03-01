import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import type { ApiSession, ApiMessage, ApiFact, ApiSettings } from "@/lib/api";

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
  source: "manual" | "auto";
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
}

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
        const [apiSessions, apiFacts, apiSettings] = await Promise.all([
          api.sessions.list(),
          api.facts.list(),
          api.settings.get(),
        ]);

        const sessionsData = apiSessions.map(apiSessionToSession);
        setSessions(sessionsData);

        if (sessionsData.length > 0) {
          const firstId = sessionsData[0].id;
          setActiveSessionId(firstId);
          // Загружаем сообщения первой сессии
          const msgs = await api.messages.list(firstId);
          setSessions((prev) =>
            prev.map((s) => (s.id === firstId ? { ...s, messages: msgs.map(apiMsgToMsg) } : s))
          );
        }

        setFacts(apiFacts.map(apiFactToFact));
        setConfig(apiSettingsToConfig(apiSettings));
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

      if (!config.apiKey || !config.baseUrl) {
        await new Promise((r) => setTimeout(r, 800));
        assistantContent =
          "⚠️ LLM не подключён. Откройте «Настройки», введите Base URL и API-ключ, нажмите «Сохранить».";
      } else {
        try {
          let relevantFacts = facts;
          try {
            const fetched = await api.facts.relevant(text, 8);
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
            // fallback: используем локальные факты
          }

          const factContext =
            relevantFacts.length > 0
              ? `\n\nПАМЯТЬ (релевантное):\n${relevantFacts
                  .map((f) => `- [${f.subcategory ? `${f.category} / ${f.subcategory}` : f.category}] ${f.content}`)
                  .join("\n")}`
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

      // Live-обновление фактов: бэкенд мог извлечь новые после ответа
      try {
        const freshFacts = await api.facts.list();
        setFacts(freshFacts.map(apiFactToFact));
      } catch (e) {
        console.warn("refresh facts", e);
      }
    },
    [activeSessionId, activeSession, config, facts, isThinking]
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
    config,
    isThinking,
    loading,
    appError,
    createSession,
    selectSession,
    sendMessage,
    addFact,
    deleteFact,
    saveConfig,
  };
}