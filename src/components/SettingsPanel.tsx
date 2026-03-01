import { useState } from "react";
import Icon from "@/components/ui/icon";

interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "Ты — персональный ИИ-ассистент для анализа данных и принятия деловых решений. Отвечай чётко, структурированно и по делу. Используй данные и факты из контекста пользователя.",
};

const PRESET_MODELS = [
  { label: "GPT-4o", value: "gpt-4o" },
  { label: "GPT-4o mini", value: "gpt-4o-mini" },
  { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
  { label: "Claude 3 Haiku", value: "claude-3-haiku-20240307" },
  { label: "Llama 3.1 70B", value: "meta-llama/llama-3.1-70b-instruct" },
  { label: "Другая модель...", value: "custom" },
];

export default function SettingsPanel() {
  const [config, setConfig] = useState<LLMConfig>(DEFAULT_CONFIG);
  const [showKey, setShowKey] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [saved, setSaved] = useState(false);

  const isCustom = !PRESET_MODELS.slice(0, -1).some((m) => m.value === config.model);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (field: keyof LLMConfig, value: string | number) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-5 border-b border-border">
        <h2 className="text-sm font-semibold">Подключение к LLM</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Настройте провайдера и параметры модели</p>
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
                value={config.baseUrl}
                onChange={(e) => update("baseUrl", e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Совместим с OpenAI API. Работает с OpenRouter, Groq, Together и другими провайдерами.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1.5">API Ключ</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={config.apiKey}
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
                value={isCustom ? "custom" : config.model}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    update("model", customModel);
                  } else {
                    update("model", e.target.value);
                  }
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
                  value={config.model}
                  onChange={(e) => { setCustomModel(e.target.value); update("model", e.target.value); }}
                  placeholder="provider/model-name"
                  className="w-full border border-border bg-card px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-foreground transition-colors"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1.5">
                  Температура <span className="font-mono text-muted-foreground">{config.temperature}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.temperature}
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
                  value={config.maxTokens}
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
            value={config.systemPrompt}
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
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-foreground" />
              <div>
                <span className="text-sm font-medium block">Автоизвлечение фактов</span>
                <span className="text-xs text-muted-foreground">После каждого ответа ИИ ищет новые факты в диалоге</span>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-foreground" />
              <div>
                <span className="text-sm font-medium block">Анти-дубликаты</span>
                <span className="text-xs text-muted-foreground">Схожие факты не добавляются повторно</span>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" defaultChecked className="mt-0.5 accent-foreground" />
              <div>
                <span className="text-sm font-medium block">ТОП-10 релевантных фактов</span>
                <span className="text-xs text-muted-foreground">В контекст подмешиваются только наиболее подходящие факты</span>
              </div>
            </label>
          </div>
        </section>

        <button
          onClick={handleSave}
          className={`w-full py-3 text-sm font-medium transition-all ${
            saved
              ? "bg-green-600 text-white"
              : "bg-foreground text-background hover:opacity-80"
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
