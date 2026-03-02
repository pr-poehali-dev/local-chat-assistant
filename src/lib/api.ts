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
  confidence?: number;
  status?: "active" | "needs_review" | "archived";
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
    list: (params?: { category?: string; q?: string; limit?: number; include_review?: boolean }) => {
      const qs: Record<string, string> = {};
      if (params?.category && params.category !== "Все") qs.category = params.category;
      if (params?.q) qs.q = params.q;
      if (params?.limit) qs.limit = String(params.limit);
      if (params?.include_review) qs.include_review = "1";
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
    update: (id: string, data: { text?: string; category?: string; subcategory?: string; status?: string; confidence?: number }) =>
      request<{ updated: string }>("facts", "update", { method: "POST", id, body: JSON.stringify(data) }),
    conflicts: () =>
      request<ApiFact[]>("facts", "conflicts"),
    resolveConflict: (id: string, action: "keep" | "discard") =>
      request<{ id: string; status: string }>("facts", "resolve_conflict", {
        method: "POST",
        id,
        body: JSON.stringify({ action }),
      }),
    clear: () =>
      request<{ cleared: number }>("facts", "clear", { method: "POST" }),
    semanticSearch: (embedding: number[], limit = 8) =>
      request<Array<ApiFact & { score: number }>>("facts", "semantic", {
        method: "POST",
        body: JSON.stringify({ embedding, limit }),
      }),
    setEmbedding: (id: string, embedding: number[]) =>
      request<{ updated: string }>("facts", "set_embedding", {
        method: "POST",
        id,
        body: JSON.stringify({ embedding }),
      }),
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

  episodes: {
    list: (params?: { session_id?: string; limit?: number }) => {
      const qs: Record<string, string> = {};
      if (params?.session_id) qs.session_id = params.session_id;
      if (params?.limit) qs.limit = String(params.limit);
      return request<ApiEpisode[]>("episodes", "list", { qs });
    },
    create: (data: { title: string; summary: string; session_id?: string; happened_at?: string; category?: string; embedding?: number[] }) =>
      request<ApiEpisode>("episodes", "create", { method: "POST", body: JSON.stringify(data) }),
    relevant: (q: string, limit = 5) =>
      request<ApiEpisode[]>("episodes", "relevant", { qs: { q, limit: String(limit) } }),
    archive: (id: string) =>
      request<{ archived: string }>("episodes", "delete", { method: "DELETE", id }),
  },

  patterns: {
    list: () => request<ApiPattern[]>("patterns", "list"),
    upsert: (data: { text: string; category?: string; evidence?: string }) =>
      request<{ id: string; count: number; updated: boolean }>("patterns", "upsert", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    dismiss: (id: string) =>
      request<{ dismissed: string }>("patterns", "dismiss", { method: "POST", id }),
  },

};

export interface ApiEpisode {
  id: string;
  title: string;
  summary: string;
  session_id?: string;
  happened_at?: string;
  category: string;
  created_at: string;
  updated_at?: string;
}

export interface ApiPattern {
  id: string;
  text: string;
  category: string;
  evidence?: string;
  count: number;
  last_seen: string;
  status: string;
  created_at: string;
}