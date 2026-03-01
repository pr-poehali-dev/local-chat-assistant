const BASE = "https://functions.poehali.dev/5a867386-9601-4226-87b2-b0486113195c";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Types ──────────────────────────────────────────────────────

export interface ApiSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  preview?: string;
}

export interface ApiMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface ApiFact {
  id: string;
  text: string;
  category: string;
  source: "manual" | "auto";
  created_at: string;
  updated_at: string;
}

export interface ApiSettings {
  id: number;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  toggles_json: string;
  toggles?: { autoExtract: boolean; antiDuplicates: boolean; topFacts: boolean };
}

// ── Sessions ───────────────────────────────────────────────────

export const api = {
  sessions: {
    list: () => request<ApiSession[]>("/sessions"),
    create: (title = "Новый диалог") =>
      request<ApiSession>("/sessions", { method: "POST", body: JSON.stringify({ title }) }),
    delete: (id: string) =>
      request<{ deleted: string }>(`/sessions/${id}`, { method: "DELETE" }),
  },

  messages: {
    list: (sessionId: string) =>
      request<ApiMessage[]>(`/sessions/${sessionId}/messages`),
    create: (sessionId: string, role: string, content: string) =>
      request<ApiMessage>(`/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content }),
      }),
  },

  facts: {
    list: (params?: { category?: string; q?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.category && params.category !== "Все") qs.set("category", params.category);
      if (params?.q) qs.set("q", params.q);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return request<ApiFact[]>(`/facts${query}`);
    },
    create: (text: string, category: string, source: "manual" | "auto" = "manual") =>
      request<ApiFact>("/facts", {
        method: "POST",
        body: JSON.stringify({ text, category, source }),
      }),
    delete: (id: string) =>
      request<{ deleted: string }>(`/facts/${id}`, { method: "DELETE" }),
  },

  settings: {
    get: () => request<ApiSettings>("/settings"),
    save: (data: {
      base_url: string;
      api_key: string;
      model: string;
      temperature: number;
      max_tokens: number;
      system_prompt: string;
      toggles: { autoExtract: boolean; antiDuplicates: boolean; topFacts: boolean };
    }) =>
      request<{ saved: boolean }>("/settings", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
};
