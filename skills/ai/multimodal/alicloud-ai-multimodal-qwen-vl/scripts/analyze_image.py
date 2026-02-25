#!/usr/bin/env python3
"""Analyze an image with Alibaba Cloud Model Studio Qwen VL models.

Usage:
  python scripts/analyze_image.py --request '{"prompt":"...","image":"https://..."}'
  python scripts/analyze_image.py --file request.json --print-response
"""

from __future__ import annotations

import argparse
import base64
import configparser
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("Error: requests is not installed. Run: pip install requests", file=sys.stderr)
    sys.exit(1)


DEFAULT_MODEL = "qwen3-vl-plus"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MAX_TOKENS = 512
DEFAULT_TEMPERATURE = 0.2
DEFAULT_DETAIL = "auto"


def _find_repo_root(start: Path) -> Path | None:
    for parent in [start] + list(start.parents):
        if (parent / ".git").exists():
            return parent
    return None


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _load_env() -> None:
    _load_dotenv(Path.cwd() / ".env")
    repo_root = _find_repo_root(Path(__file__).resolve())
    if repo_root:
        _load_dotenv(repo_root / ".env")


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


def load_request(args: argparse.Namespace) -> dict[str, Any]:
    if args.request:
        return json.loads(args.request)
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            return json.load(f)
    raise ValueError("Either --request or --file must be provided")


def _path_to_data_url(path: Path) -> str:
    data = path.read_bytes()
    mime_type, _ = mimetypes.guess_type(path.name)
    if not mime_type:
        mime_type = "application/octet-stream"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def resolve_image_input(image_value: str) -> str:
    if image_value.startswith("http://") or image_value.startswith("https://"):
        return image_value
    if image_value.startswith("data:"):
        return image_value
    path = Path(image_value)
    if path.exists() and path.is_file():
        return _path_to_data_url(path)
    return image_value


def call_analyze(req: dict[str, Any]) -> dict[str, Any]:
    prompt = req.get("prompt")
    image = req.get("image")
    if not prompt:
        raise ValueError("prompt is required")
    if not image:
        raise ValueError("image is required")

    model = req.get("model", DEFAULT_MODEL)
    base_url = req.get("base_url", DEFAULT_BASE_URL).rstrip("/")
    image_url = resolve_image_input(image)
    detail = req.get("detail", DEFAULT_DETAIL)

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url, "detail": detail}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "max_tokens": req.get("max_tokens", DEFAULT_MAX_TOKENS),
        "temperature": req.get("temperature", DEFAULT_TEMPERATURE),
    }

    response = requests.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {os.environ['DASHSCOPE_API_KEY']}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=int(req.get("timeout_s", 120)),
    )
    response.raise_for_status()

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("No choices returned by DashScope")

    message = choices[0].get("message") or {}
    content = message.get("content")
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=True)

    return {
        "text": text,
        "model": data.get("model", model),
        "usage": data.get("usage", {}),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze image with qwen3-vl-plus")
    parser.add_argument("--request", help="Inline JSON request string")
    parser.add_argument("--file", help="Path to JSON request file")
    parser.add_argument(
        "--output",
        default="",
        help="Optional output JSON path, e.g. output/ai-multimodal-qwen-vl/result.json",
    )
    parser.add_argument("--print-response", action="store_true", help="Print normalized response JSON")
    args = parser.parse_args()

    _load_env()
    _load_dashscope_api_key_from_credentials()
    if not os.environ.get("DASHSCOPE_API_KEY"):
        print(
            "Error: DASHSCOPE_API_KEY is not set. Configure it via env/.env or ~/.alibabacloud/credentials.",
            file=sys.stderr,
        )
        print("Example .env:\n  DASHSCOPE_API_KEY=your_key_here", file=sys.stderr)
        print(
            "Example credentials:\n  [default]\n  dashscope_api_key=your_key_here",
            file=sys.stderr,
        )
        sys.exit(1)

    req = load_request(args)
    result = call_analyze(req)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding="utf-8")

    if args.print_response:
        print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
