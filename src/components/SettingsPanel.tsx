import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { LLMConfig } from "@/hooks/useChatStore";

const PRESET_MODELS = [
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
  { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
  { label: "Claude 3 Haiku", value: "claude-3-haiku-20240307" },
  { label: "Llama 3.1 70B", value: "meta-llama/llama-3.1-70b-instruct" },
  { label: "Другая модель...", value: "__custom__" },
];

interface SettingsPanelProps {
  config: LLMConfig;
  onSave: (config: LLMConfig) => void;
}

export default function SettingsPanel({ config, onSave }: SettingsPanelProps) {
  const [local, setLocal] = useState<LLMConfig>({ ...config });
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const isCustom = !PRESET_MODELS.slice(0, -1).some((m) => m.value === local.model);

  const update = <K extends keyof LLMConfig>(field: K, value: LLMConfig[K]) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const connected = !!local.apiKey && !!local.baseUrl;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-5 border-b border-border">
        <h2 className="text-sm font-semibold">Подключение к LLM</h2>
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? "bg-green-500" : "bg-muted-foreground"}`} />
          <p className="text-xs text-muted-foreground">
            {connected ? `Настроен · ${local.model}` : "Не подключён — заполните API-ключ и Base URL"}
          </p>
        </div>
      </div>

      <div className="px-6 py-5 space-y-6">
        <section>
          <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Провайдер
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1.5">Base URL</label>
              <input
                type="text"
                value={local.baseUrl}
                onChange={(e) => update("baseUrl", e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                OpenAI-совместимый API. Работает с OpenRouter, Groq, Together и др.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5">API Ключ</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={local.apiKey}
                  onChange={(e) => update("apiKey", e.target.value)}
                  placeholder="sk-..."
                  className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono pr-10 focus:outline-none focus:border-foreground transition-colors"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Icon name={showKey ? "EyeOff" : "Eye"} size={15} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Модель
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1.5">Выбор модели</label>
              <select
                value={isCustom ? "__custom__" : local.model}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") update("model", e.target.value);
                }}
                className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
              >
                {PRESET_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {isCustom && (
              <div className="animate-slide-up">
                <label className="text-xs font-medium block mb-1.5">Название модели</label>
                <input
                  type="text"
                  value={local.model}
                  onChange={(e) => update("model", e.target.value)}
                  placeholder="provider/model-name"
                  className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5">
                  Температура <span className="font-mono text-muted-foreground">{local.temperature}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={local.temperature}
                  onChange={(e) => update("temperature", parseFloat(e.target.value))}
                  className="w-full accent-foreground"
                />
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-0.5">
                  <span>точно</span>
                  <span>творчески</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5">Макс. токенов</label>
                <input
                  type="number"
                  value={local.maxTokens}
                  onChange={(e) => update("maxTokens", parseInt(e.target.value))}
                  min={256}
                  max={32768}
                  step={256}
                  className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
                />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Системный промпт
          </h3>
          <textarea
            value={local.systemPrompt}
            onChange={(e) => update("systemPrompt", e.target.value)}
            rows={5}
            className="w-full resize-none border border-border bg-card px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-foreground transition-colors"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Релевантные факты из базы знаний добавляются автоматически.
          </p>
        </section>

        <section>
          <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Память фактов
          </h3>
          <div className="space-y-2">
            {(
              [
                { field: "autoExtract", label: "Автоизвлечение фактов", desc: "После каждого ответа ИИ ищет новые факты в диалоге" },
                { field: "antiDuplicates", label: "Анти-дубликаты", desc: "Схожие факты не добавляются повторно" },
                { field: "topFacts", label: "ТОП-10 релевантных фактов", desc: "В контекст подмешиваются только наиболее подходящие факты" },
              ] as { field: keyof LLMConfig; label: string; desc: string }[]
            ).map(({ field, label, desc }) => (
              <label key={field} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!local[field]}
                  onChange={(e) => update(field, e.target.checked as LLMConfig[typeof field])}
                  className="mt-0.5 accent-foreground"
                />
                <div>
                  <span className="text-sm font-medium block">{label}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Голос
          </h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!local.autoSpeak}
              onChange={(e) => update("autoSpeak", e.target.checked)}
              className="mt-0.5 accent-foreground"
            />
            <div>
              <span className="text-sm font-medium block">Авто-озвучка</span>
              <span className="text-xs text-muted-foreground">Каждый ответ ассистента будет автоматически озвучен (требует API с поддержкой TTS)</span>
            </div>
          </label>
        </section>

        <button
          onClick={handleSave}
          className={`w-full py-3 text-sm font-medium transition-all ${
            saved ? "bg-green-600 text-white" : "bg-foreground text-background hover:opacity-80"
          }`}
        >
          {saved ? (
            <span className="flex items-center justify-center gap-2">
              <Icon name="Check" size={15} />
              Сохранено
            </span>
          ) : "Сохранить настройки"}
        </button>
      </div>
    </div>
  );
}