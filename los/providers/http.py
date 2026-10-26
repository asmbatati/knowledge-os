"""Providers reached over HTTPS with an API key, on the standard library alone (no SDK, no new dependency).

Two wire formats cover every provider in the registry: Anthropic's Messages API, and the OpenAI-compatible chat API
(OpenAI, Gemini's compatibility endpoint, OpenRouter, Ollama, LM Studio, vLLM and the like). The key comes from the
environment the server was started with (the Obsidian plugin hands it over from Obsidian's keychain); it is sent only
to the provider's own address and never written anywhere. Transient failures (429 with a short wait, 5xx, a dropped
connection) are retried twice; anything else is reported as it is.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

ANTHROPIC_VERSION = "2023-06-01"
MAX_OUTPUT = 8000


class HttpProviderError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def post_json(url: str, headers: dict, body: dict, timeout: int, retries: int = 2, sleep=time.sleep) -> dict:
    data = json.dumps(body).encode("utf-8")
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            wait = _retry_after(e.headers.get("retry-after"))
            if attempt < retries and (e.code >= 500 or (e.code == 429 and wait is not None and wait <= 30)):
                attempt += 1
                sleep(wait if wait is not None else 2 * attempt)
                continue
            raise HttpProviderError(e.code, _message(e.code, text)) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < retries:
                attempt += 1
                sleep(2 * attempt)
                continue
            raise HttpProviderError(0, f"could not reach {url.split('/')[2]}: {getattr(e, 'reason', e)}") from None


def _retry_after(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def _message(status: int, text: str) -> str:
    detail = text[:300]
    try:
        j = json.loads(text)
        err = j.get("error")
        detail = (err.get("message") if isinstance(err, dict) else err) or j.get("message") or detail
    except (json.JSONDecodeError, AttributeError):
        pass
    if status in (401, 403):
        return f"the provider refused the API key ({status}): {detail}"
    if status == 429:
        return f"the provider's rate limit or quota was reached: {detail}"
    return f"the provider answered {status}: {detail}"


class AnthropicAPI:
    def __init__(self, key: str, model: str, base_url: str = "https://api.anthropic.com", post=post_json):
        self.key, self.model, self.base, self.post = key, model, base_url.rstrip("/"), post

    def complete(self, system: str, prompt: str, timeout: int):
        from . import Reply
        out = self.post(f"{self.base}/v1/messages",
                        {"x-api-key": self.key, "anthropic-version": ANTHROPIC_VERSION},
                        {"model": self.model, "max_tokens": MAX_OUTPUT, "system": system,
                         "messages": [{"role": "user", "content": prompt}]}, timeout)
        if out.get("stop_reason") == "refusal":
            raise RuntimeError("the model declined this request")
        text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
        u = out.get("usage") or {}
        return Reply(text=text, input_tokens=int(u.get("input_tokens") or 0)
                     + int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0),
                     output_tokens=int(u.get("output_tokens") or 0))


class OpenAICompat:
    """Chat completions. JSON mode is asked for when the prompt asks for JSON, and dropped if the server refuses it."""

    def __init__(self, key: str, model: str, base_url: str, post=post_json):
        self.key, self.model, self.base, self.post = key, model, base_url.rstrip("/"), post
        self.json_mode = True

    def complete(self, system: str, prompt: str, timeout: int):
        from . import Reply
        body = {"model": self.model, "messages": [{"role": "system", "content": system},
                                                   {"role": "user", "content": prompt}]}
        if self.json_mode and "json" in (system + prompt).lower():
            body["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self.key}"} if self.key else {}
        try:
            out = self.post(f"{self.base}/chat/completions", headers, body, timeout)
        except HttpProviderError as e:
            if e.status == 400 and "response_format" in body and any(
                    k in str(e).lower() for k in ("response_format", "json", "not supported")):
                self.json_mode = False
                body.pop("response_format")
                out = self.post(f"{self.base}/chat/completions", headers, body, timeout)
            else:
                raise
        choices = out.get("choices") or []
        if not choices:
            raise RuntimeError("the provider returned no answer")
        msg = choices[0].get("message") or {}
        if msg.get("refusal"):
            raise RuntimeError(f"the model refused: {msg['refusal']}")
        u = out.get("usage") or {}
        return Reply(text=str(msg.get("content") or ""), input_tokens=int(u.get("prompt_tokens") or 0),
                     output_tokens=int(u.get("completion_tokens") or 0))
