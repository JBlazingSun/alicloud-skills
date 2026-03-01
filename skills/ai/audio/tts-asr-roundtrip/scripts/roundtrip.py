#!/usr/bin/env python3
"""Roundtrip TTS -> ASR test.

Synthesizes text with qwen3-tts-flash, then transcribes with qwen3-asr-flash.
Returns JSON: {"input_text":"...","asr_text":"...","normalized_equal":true/false,"audio_url":"..."}
"""

from __future__ import annotations

import argparse
import configparser
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

try:
    import dashscope
except ImportError:
    print("Error: dashscope is not installed. Run: pip install dashscope", file=sys.stderr)
    sys.exit(1)


TTS_MODEL = "qwen3-tts-flash"
TTS_VOICE = "Cherry"
TTS_LANGUAGE = "Chinese"
ASR_MODEL = "qwen3-asr-flash"
ASR_SYNC_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"


def _load_dashscope_api_key_from_credentials() -> None:
    if os.environ.get("DASHSCOPE_API_KEY"):
        return
    credentials_path = Path(os.path.expanduser("~/.alibabacloud/credentials"))
    if not credentials_path.exists():
        return
    config = configparser.ConfigParser()
    try:
        config.read(credentials_path)
    except configparser.Error:
        return
    profile = os.getenv("ALIBABA_CLOUD_PROFILE") or os.getenv("ALICLOUD_PROFILE") or "default"
    if not config.has_section(profile):
        return
    key = config.get(profile, "dashscope_api_key", fallback="").strip()
    if not key:
        key = config.get(profile, "DASHSCOPE_API_KEY", fallback="").strip()
    if key:
        os.environ["DASHSCOPE_API_KEY"] = key


def _http_json(
    method: str,
    url: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import urllib.error
    body = None if payload is None else json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = urllib.request.Request(url=url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON response: {raw[:500]}") from exc


def tts_generate(text: str) -> dict[str, Any]:
    """Generate speech audio using qwen3-tts-flash."""
    dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"

    response = dashscope.MultiModalConversation.call(
        model=TTS_MODEL,
        api_key=os.getenv("DASHSCOPE_API_KEY"),
        text=text,
        voice=TTS_VOICE,
        language_type=TTS_LANGUAGE,
        stream=False,
    )

    audio = response.output.audio
    audio_url = audio.url
    return {
        "audio_url": audio_url,
        "sample_rate": audio.get("sample_rate"),
        "format": audio.get("format"),
    }


def asr_transcribe(audio_url: str) -> str:
    """Transcribe audio using qwen3-asr-flash (sync)."""
    payload = {
        "model": ASR_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": audio_url},
                    }
                ],
            }
        ],
        "stream": False,
    }

    resp = _http_json("POST", ASR_SYNC_ENDPOINT, os.getenv("DASHSCOPE_API_KEY"), payload)

    # Extract text from response
    choices = resp.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    return content.strip()

    return ""


def normalize_text(text: str) -> str:
    """Normalize text for comparison: strip punctuation and whitespace."""
    import re
    # Remove common Chinese and English punctuation
    text = re.sub(r'[,.!?。！？，、；：：""''""""（）()【】\[\]《》<>…—\-]', '', text)
    # Remove whitespace
    text = re.sub(r'\s+', '', text)
    return text.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="TTS -> ASR roundtrip test")
    parser.add_argument("--text", default="欢迎使用阿里云。", help="Input text to synthesize")
    parser.add_argument("--output", help="Output JSON file path")
    args = parser.parse_args()

    _load_dashscope_api_key_from_credentials()

    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        print(
            "Error: DASHSCOPE_API_KEY is not set. Configure it via env/.env or ~/.alibabacloud/credentials.",
            file=sys.stderr,
        )
        sys.exit(1)

    input_text = args.text

    # Step 1: TTS
    tts_result = tts_generate(input_text)
    audio_url = tts_result["audio_url"]

    # Step 2: ASR
    asr_text = asr_transcribe(audio_url)

    # Step 3: Compare normalized texts
    normalized_input = normalize_text(input_text)
    normalized_asr = normalize_text(asr_text)
    normalized_equal = normalized_input == normalized_asr

    result = {
        "input_text": input_text,
        "asr_text": asr_text,
        "normalized_equal": normalized_equal,
        "audio_url": audio_url,
    }

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
