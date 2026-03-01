import { useState, useCallback } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  messages: Message[];
}

export interface Fact {
  id: string;
  content: string;
  category: string;
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

const DEFAULT_FACTS: Fact[] = [
  { id: "f1", content: "Компания работает в сегменте B2B SaaS, основной рынок — Россия и СНГ", category: "О компании", addedAt: "27 фев", source: "manual" },
  { id: "f2", content: "Целевая выручка на 2026 год: 120 млн руб. Текущий темп роста: 18% QoQ", category: "Финансы", addedAt: "26 фев", source: "manual" },
  { id: "f3", content: "Команда: 34 человека, из них 12 в разработке, 8 в продажах", category: "Команда", addedAt: "25 фев", source: "auto" },
  { id: "f4", content: "Главный конкурент — AmoCRM, основное преимущество — отраслевая специализация", category: "Рынок", addedAt: "24 фев", source: "auto" },
];

const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "Ты — персональный ИИ-ассистент для анализа данных и принятия деловых решений. Отвечай чётко, структурированно и по делу. Используй данные и факты из контекста пользователя.",
  autoExtract: true,
  antiDuplicates: true,
  topFacts: true,
};

function generateId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeSession(): Session {
  return {
    id: generateId("sess"),
    title: "Новый диалог",
    createdAt: new Date(),
    messages: [
      {
        id: generateId("msg"),
        role: "assistant",
        content: "Готов к работе. Задайте вопрос по анализу данных или деловому решению.",
        timestamp: new Date(),
      },
    ],
  };
}

export function useChatStore() {
  const [sessions, setSessions] = useState<Session[]>(() => [makeSession()]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id ?? "");
  const [facts, setFacts] = useState<Fact[]>(DEFAULT_FACTS);
  const [config, setConfig] = useState<LLMConfig>(DEFAULT_CONFIG);
  const [isThinking, setIsThinking] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const createSession = useCallback(() => {
    const s = makeSession();
    setSessions((prev) => [s, ...prev]);
    setActiveSessionId(s.id);
    return s.id;
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const updateSessionTitle = useCallback((sessionId: string, messages: Message[]) => {
    const userMsg = messages.find((m) => m.role === "user");
    if (!userMsg) return;
    const title = userMsg.content.slice(0, 40) + (userMsg.content.length > 40 ? "..." : "");
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
    );
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isThinking) return;

      const userMsg: Message = {
        id: generateId("msg"),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, userMsg] }
            : s
        )
      );
      setIsThinking(true);

      let assistantContent = "";

      if (!config.apiKey || !config.baseUrl) {
        await new Promise((r) => setTimeout(r, 900));
        assistantContent =
          "⚠️ LLM не подключён. Откройте «Настройки», введите Base URL и API-ключ, нажмите «Сохранить».";
      } else {
        try {
          const currentSession = sessions.find((s) => s.id === activeSessionId);
          const history = (currentSession?.messages ?? [])
            .filter((m) => m.role !== "assistant" || m.content !== "Готов к работе.")
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }));

          const factContext =
            facts.length > 0
              ? `\n\nФакты о пользователе:\n${facts
                  .slice(0, 10)
                  .map((f) => `- [${f.category}] ${f.content}`)
                  .join("\n")}`
              : "";

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
            const err = await res.json().catch(() => ({}));
            assistantContent = `Ошибка API (${res.status}): ${err?.error?.message ?? res.statusText}`;
          } else {
            const data = await res.json();
            assistantContent =
              data?.choices?.[0]?.message?.content ?? "Пустой ответ от модели.";
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
          assistantContent = `Ошибка соединения: ${msg}`;
        }
      }

      const assistantMsg: Message = {
        id: generateId("msg"),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
      };

      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, assistantMsg] }
            : s
        );
        const updatedSession = updated.find((s) => s.id === activeSessionId);
        if (updatedSession) {
          const title =
            updatedSession.messages.find((m) => m.role === "user")?.content.slice(0, 40) ?? "Новый диалог";
          return updated.map((s) =>
            s.id === activeSessionId ? { ...s, title } : s
          );
        }
        return updated;
      });
      setIsThinking(false);
    },
    [activeSessionId, config, facts, isThinking, sessions]
  );

  const addFact = useCallback((content: string, category: string) => {
    const fact: Fact = {
      id: generateId("fact"),
      content,
      category,
      addedAt: "сейчас",
      source: "manual",
    };
    setFacts((prev) => [fact, ...prev]);
  }, []);

  const deleteFact = useCallback((id: string) => {
    setFacts((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const saveConfig = useCallback((newConfig: LLMConfig) => {
    setConfig(newConfig);
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    facts,
    config,
    isThinking,
    createSession,
    selectSession,
    sendMessage,
    addFact,
    deleteFact,
    saveConfig,
    updateSessionTitle,
  };
}
