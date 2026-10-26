"""The model providers the site can use, and what it knows about each model.

Prices are USD per 1M tokens, read from the providers' pages on 25 Oct 2026 (the same research as paper2chapter's
registry); they drive only the daily budget for pay-per-use providers (`metered`). A learner may type any model id the
provider accepts; an unknown id is priced as unknown, which the budget treats as free, said plainly on the Settings page.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
    input_price: float | None = None    # USD per 1M input tokens
    output_price: float | None = None
    notes: str = ""


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    kind: str                       # claude-cli | codex-cli | anthropic | openai-compat
    tier: str                       # subscription | paid | free-tier | local
    models: tuple = ()
    key_env: str = ""               # the environment variable holding the API key, if any
    key_required: bool = False
    base_url: str = ""
    metered: bool = False           # pay per use: counted against the daily budget (D9)
    shares_night_plan: bool = False  # the night jobs use the same plan: quiet hours apply (D8)
    grader_name: str = ""           # the name kept in the ledgers; "claude" for Claude Code, as before
    setup_hint: str = ""
    docs_url: str = ""
    notes: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def name(self) -> str:
        return self.grader_name or self.id

    def model(self, model_id: str) -> ModelInfo:
        for m in self.models:
            if m.id == model_id:
                return m
        return ModelInfo(model_id, model_id, notes="A model id typed by you: its price is unknown.")


def presets(cfg=None) -> dict[str, Preset]:
    """Every provider, with the base URLs and paths the settings give."""
    ollama_url = getattr(cfg, "ollama_base_url", "") or "http://localhost:11434/v1"
    custom_url = getattr(cfg, "custom_base_url", "") or ""
    custom_model = getattr(cfg, "custom_model", "") or "default"
    out = [
        Preset("claude-cli", "Claude subscription (Claude Code)", "claude-cli", "subscription",
               models=(ModelInfo("sonnet", "Claude Sonnet", notes="The latest Sonnet your plan offers."),
                       ModelInfo("opus", "Claude Opus", notes="The latest Opus your plan offers; uses the plan fastest."),
                       ModelInfo("haiku", "Claude Haiku", notes="The latest Haiku your plan offers; light on the plan.")),
               shares_night_plan=True, grader_name="claude",
               setup_hint="Install Claude Code, run `claude` once and sign in with your Claude Pro or Max account.",
               docs_url="https://claude.com/claude-code",
               notes="Uses your Claude plan through the Claude Code CLI: no API key, no per-token bill; the plan's "
                     "limits apply, and the night jobs share them, so quiet hours apply."),
        Preset("codex-cli", "ChatGPT subscription (Codex)", "codex-cli", "subscription",
               models=(ModelInfo("gpt-6.1-sol", "GPT-6.1 Sol", notes="Codex's first choice (Oct 2026)."),
                       ModelInfo("gpt-6-luna", "GPT-6 Luna", notes="Fast and light on the plan."),
                       ModelInfo("gpt-6-astra", "GPT-6 Astra", notes="The flagship; uses the plan fastest."),
                       ModelInfo("default", "Codex default", notes="Whatever model your Codex CLI picks.")),
               setup_hint="Install the Codex CLI (npm install -g @openai/codex), then run `codex login` with your "
                          "ChatGPT Plus or Pro account.",
               docs_url="https://developers.openai.com/codex/cli",
               notes="Uses your ChatGPT plan through the Codex CLI: no API key, no per-token bill."),
        Preset("anthropic", "Anthropic API", "anthropic", "paid",
               models=(ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5", 2.00, 10.00),
                       ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5", 0.10, 0.50, "Very cheap."),
                       ModelInfo("claude-opus-5-5", "Claude Opus 5.5", 4.00, 20.00)),
               key_env="ANTHROPIC_API_KEY", key_required=True, base_url="https://api.anthropic.com", metered=True,
               setup_hint="Enter an Anthropic API key in the plugin's settings (or set ANTHROPIC_API_KEY).",
               docs_url="https://platform.claude.com/docs"),
        Preset("openai", "OpenAI API", "openai-compat", "paid",
               models=(ModelInfo("gpt-6-luna", "GPT-6 Luna", 0.10, 0.50, "Cheapest."),
                       ModelInfo("gpt-5.4-mini", "GPT-5.4 mini", 0.75, 4.50),
                       ModelInfo("gpt-6.1-sol", "GPT-6.1 Sol", 2.00, 10.00)),
               key_env="OPENAI_API_KEY", key_required=True, base_url="https://api.openai.com/v1", metered=True,
               setup_hint="Enter an OpenAI API key in the plugin's settings (or set OPENAI_API_KEY).",
               docs_url="https://developers.openai.com/api/docs/pricing"),
        Preset("gemini", "Google Gemini", "openai-compat", "free-tier",
               models=(ModelInfo("gemini-3.8-flash", "Gemini 3.8 Flash", 0.75, 3.75),
                       ModelInfo("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", 0.30, 2.50)),
               key_env="GEMINI_API_KEY", key_required=True,
               base_url="https://generativelanguage.googleapis.com/v1beta/openai", metered=True,
               setup_hint="Enter a Google AI Studio key (or set GEMINI_API_KEY). Free-tier prompts may be used "
                          "to improve Google's products.",
               docs_url="https://ai.google.dev/gemini-api/docs/pricing"),
        Preset("openrouter", "OpenRouter", "openai-compat", "free-tier",
               models=(ModelInfo("nvidia/nemotron-3.5-super-vl:free", "Nemotron 3.5 Super (free)", 0.0, 0.0),
                       ModelInfo("google/gemma-4-31b-it:free", "Gemma 4 31B (free)", 0.0, 0.0)),
               key_env="OPENROUTER_API_KEY", key_required=True, base_url="https://openrouter.ai/api/v1", metered=True,
               setup_hint="Enter an OpenRouter key (or set OPENROUTER_API_KEY).",
               docs_url="https://openrouter.ai/models?max_price=0"),
        Preset("ollama", "Ollama (local)", "openai-compat", "local",
               models=(ModelInfo("qwen3.6:27b", "Qwen 3.6 27B", 0.0, 0.0, "Needs about 20 GB of memory."),
                       ModelInfo("gpt-oss:20b", "gpt-oss 20B", 0.0, 0.0, "Needs about 16 GB."),
                       ModelInfo("gemma4:12b", "Gemma 4 12B", 0.0, 0.0, "Needs about 10 GB.")),
               base_url=ollama_url,
               setup_hint="Install Ollama, pull a model (ollama pull qwen3.6:27b) and keep it running.",
               docs_url="https://ollama.com/library",
               notes="Runs on this machine: nothing leaves it."),
    ]
    if custom_url:
        out.append(Preset("custom", "Custom OpenAI-compatible", "openai-compat", "paid",
                          models=(ModelInfo(custom_model, custom_model),), key_env="CUSTOM_OPENAI_API_KEY",
                          base_url=custom_url, setup_hint="Set custom_base_url and custom_model in knowledge-os.json."))
    return {p.id: p for p in out}


def price(m: ModelInfo, input_tokens: int, output_tokens: int) -> float | None:
    if m.input_price is None or m.output_price is None:
        return None
    return round((input_tokens * m.input_price + output_tokens * m.output_price) / 1e6, 6)
