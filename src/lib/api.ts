const BASE = "https://functions.poehali.dev/5a867386-9601-4226-87b2-b0486113195c";

// Все запросы идут на корневой URL с query-параметрами ?r=resource&a=action&id=...
async function request<T>(
  resource: string,
  action: string,
  options: RequestInit & { id?: string; qs?: Record<string, string> } = {}
): Promise<T> {
  const params = new URLSearchParams({ r: resource, a: action });
  if (options.id) params.set("id", options.id);
  if (options.qs) {
    Object.entries(options.qs).forEach(([k, v]) => { if (v) params.set(k, v); });
  }
  const url = `${BASE}?${params.toString()}`;
  const { id: _id, qs: _qs, ...fetchOptions } = options;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(fetchOptions.headers ?? {}) },
    ...fetchOptions,
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
  subcategory?: string | null;
  source: "manual" | "auto" | "memory_gate";
  created_at: string;
  updated_at?: string;
}

export interface ApiProfileItem {
  text: string;
  updated_at: string;
}
export interface ApiProfileSection {
  subcategory: string;
  items: ApiProfileItem[];
}
export interface ApiProfileCategory {
  category: string;
  sections: ApiProfileSection[];
}
export interface ApiProfile {
  profile: ApiProfileCategory[];
  stats: { facts_total: number; categories: number; subcategories: number };
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

// ── API ────────────────────────────────────────────────────────

export const api = {
  sessions: {
    list: () =>
      request<ApiSession[]>("sessions", "list"),
    create: (title = "Новый диалог") =>
      request<ApiSession>("sessions", "create", {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    delete: (id: string) =>
      request<{ deleted: string }>("sessions", "delete", { method: "DELETE", id }),
  },

  messages: {
    list: (sessionId: string) =>
      request<ApiMessage[]>("messages", "list", { id: sessionId }),
    create: (sessionId: string, role: string, content: string) =>
      request<ApiMessage>("messages", "create", {
        method: "POST",
        id: sessionId,
        body: JSON.stringify({ role, content }),
      }),
  },

  facts: {
    list: (params?: { category?: string; q?: string; limit?: number }) => {
      const qs: Record<string, string> = {};
      if (params?.category && params.category !== "Все") qs.category = params.category;
      if (params?.q) qs.q = params.q;
      if (params?.limit) qs.limit = String(params.limit);
      return request<ApiFact[]>("facts", "list", { qs });
    },
    create: (text: string, category: string, source: "manual" | "auto" = "manual", subcategory?: string) =>
      request<ApiFact>("facts", "create", {
        method: "POST",
        body: JSON.stringify({ text, category, source, subcategory }),
      }),
    delete: (id: string) =>
      request<{ deleted: string }>("facts", "delete", { method: "DELETE", id }),
    relevant: (q: string, limit = 8) =>
      request<ApiFact[]>("facts", "relevant", { qs: { q, limit: String(limit) } }),
    profile: (limitPerSection = 5) =>
      request<ApiProfile>("facts", "profile", { qs: { limit_per_section: String(limitPerSection) } }),
    update: (id: string, data: { text?: string; category?: string; subcategory?: string }) =>
      request<{ updated: string }>("facts", "update", { method: "POST", id, body: JSON.stringify(data) }),
    clear: () =>
      request<{ cleared: number }>("facts", "clear", { method: "POST" }),
  },

  summaries: {
    list: () => request<Array<{ category: string; summary: string; facts_count: number; updated_at: string }>>("summaries", "list"),
    save: (category: string, summary: string, facts_count: number) =>
      request<{ saved: boolean }>("summaries", "save", {
        method: "POST",
        body: JSON.stringify({ category, summary, facts_count }),
      }),
  },

  settings: {
    get: () => request<ApiSettings>("settings", "get"),
    save: (data: {
      base_url: string;
      api_key: string;
      model: string;
      temperature: number;
      max_tokens: number;
      system_prompt: string;
      toggles: { autoExtract: boolean; antiDuplicates: boolean; topFacts: boolean };
    }) =>
      request<{ saved: boolean }>("settings", "save", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
};