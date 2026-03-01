#!/usr/bin/env bash
set -u

BIN="/tmp/alicloud-skills-cli"
WITH_L4=0
SKIP_L3=0
TIMEOUT_MS=180000
OUT_DIR=""
APPS_DIR="apps"

usage() {
  cat <<'USAGE'
Usage: scripts/run_cli_test_plan.sh [options]

Options:
  --binary <path>      CLI binary path (default: /tmp/alicloud-skills-cli)
  --apps-dir <path>    Go module directory for CLI source (default: apps)
  --with-l4            Run additional L4 scenarios
  --skip-l3            Skip TTS<->ASR cross-validation cases
  --timeout-ms <ms>    Timeout for one-shot CLI cases (default: 180000)
  --out-dir <path>     Output directory (default: output/cli-test/YYYYMMDD-HHMMSS)
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BIN="${2:-}"
      shift 2
      ;;
    --with-l4)
      WITH_L4=1
      shift
      ;;
    --apps-dir)
      APPS_DIR="${2:-}"
      shift 2
      ;;
    --skip-l3)
      SKIP_L3=1
      shift
      ;;
    --timeout-ms)
      TIMEOUT_MS="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="output/cli-test/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$OUT_DIR"

SUMMARY_MD="$OUT_DIR/summary.md"
WATERFALL_TSV="$OUT_DIR/waterfall.tsv"
WATERFALL_MD="$OUT_DIR/waterfall.md"

declare -i PASS=0
declare -i FAIL=0
declare -i SKIP=0

record_result() {
  local layer="$1"
  local case_name="$2"
  local result="$3"
  local note="$4"

  case "$result" in
    pass) PASS+=1 ;;
    fail) FAIL+=1 ;;
    skip) SKIP+=1 ;;
  esac

  printf '| %s | %s | %s | %s |\n' "$layer" "$case_name" "$result" "$note" >> "$SUMMARY_MD"
}

run_cmd_log() {
  local log_file="$1"
  shift
  "$@" >"$log_file" 2>&1
  return $?
}

contains() {
  local needle="$1"
  local file="$2"
  grep -Eq "$needle" "$file"
}

contains_ci() {
  local needle="$1"
  local file="$2"
  grep -Eiq "$needle" "$file"
}

now_ms() {
  date +%s%3N
}

record_case() {
  local layer="$1"
  local case_name="$2"
  local result="$3"
  local note="$4"
  local start_ms="$5"

  local end_ms duration_ms note_clean
  end_ms="$(now_ms)"
  duration_ms=$((end_ms - start_ms))
  if [[ $duration_ms -lt 0 ]]; then
    duration_ms=0
  fi
  note_clean="${note//$'\t'/ }"
  note_clean="${note_clean//$'\n'/ }"

  record_result "$layer" "$case_name" "$result" "$note"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$layer" "$case_name" "$result" "$start_ms" "$end_ms" "$duration_ms" "$note_clean" >> "$WATERFALL_TSV"
}

init_summary() {
  local branch commit
  branch=$(git branch --show-current 2>/dev/null || echo "unknown")
  commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  cat > "$SUMMARY_MD" <<EOF_SUM
# CLI 测试汇总

- 日期：$(date '+%Y-%m-%d %H:%M:%S')
- 分支：$branch
- 提交：$commit
- 二进制：$BIN
- 输出目录：$OUT_DIR

| 层级 | 用例 | 结果 | 备注 |
| --- | --- | --- | --- |
EOF_SUM
  printf 'layer\tcase\tresult\tstart_ms\tend_ms\tduration_ms\tnote\n' > "$WATERFALL_TSV"
}

build_binary_if_needed() {
  echo "[info] building CLI binary: $BIN"
  if ! go -C "$APPS_DIR" build -o "$BIN" ./cmd/alicloud-skills >"$OUT_DIR/build-cli.log" 2>&1; then
    echo "[error] failed to build CLI, see $OUT_DIR/build-cli.log" >&2
    exit 1
  fi
}

run_l0() {
  local log
  local started_at
  started_at="$(now_ms)"

  log="$OUT_DIR/build-and-unit.log"
  {
    echo "== go -C $APPS_DIR test ./cmd/alicloud-skills/..."
    go -C "$APPS_DIR" test ./cmd/alicloud-skills/...
    echo "== go -C $APPS_DIR test ./internal/agent/..."
    go -C "$APPS_DIR" test ./internal/agent/...
    echo "== go -C $APPS_DIR build -o $BIN ./cmd/alicloud-skills"
    go -C "$APPS_DIR" build -o "$BIN" ./cmd/alicloud-skills
  } >"$log" 2>&1

  if [[ $? -eq 0 ]]; then
    record_case "L0" "构建+单测" "pass" "see $(basename "$log")" "$started_at"
  else
    record_case "L0" "构建+单测" "fail" "see $(basename "$log")" "$started_at"
  fi
}

run_l1() {
  local log1 log2 log3 log4
  log1="$OUT_DIR/help-root.log"
  log2="$OUT_DIR/help-shortcut.log"
  log3="$OUT_DIR/help-run.log"
  log4="$OUT_DIR/help-api.log"

  local s1 s2 s3 s4
  s1="$(now_ms)"; run_cmd_log "$log1" "$BIN" --help; local rc1=$?
  s2="$(now_ms)"; run_cmd_log "$log2" "$BIN" help; local rc2=$?
  s3="$(now_ms)"; run_cmd_log "$log3" "$BIN" run --help; local rc3=$?
  s4="$(now_ms)"; run_cmd_log "$log4" "$BIN" api --help; local rc4=$?

  if [[ $rc1 -eq 0 ]] && contains 'Usage of|Usage:' "$log1"; then
    record_case "L1" "--help" "pass" "root help ok" "$s1"
  else
    record_case "L1" "--help" "fail" "see $(basename "$log1")" "$s1"
  fi

  if [[ $rc2 -eq 0 ]] && contains 'Alibaba Cloud Agent CLI|Alibaba Cloud skill-powered CLI' "$log2"; then
    record_case "L1" "help" "pass" "shortcut help ok" "$s2"
  else
    record_case "L1" "help" "fail" "see $(basename "$log2")" "$s2"
  fi

  if [[ $rc3 -eq 0 ]] && contains 'run \[prompt\.\.\.\]|non-interactive prompt' "$log3"; then
    record_case "L1" "run --help" "pass" "subcommand help routed" "$s3"
  else
    record_case "L1" "run --help" "fail" "see $(basename "$log3")" "$s3"
  fi

  if [[ $rc4 -eq 0 ]] && contains 'API mode placeholder|Usage:|api \[flags\]' "$log4"; then
    record_case "L1" "api --help" "pass" "subcommand help routed" "$s4"
  else
    record_case "L1" "api --help" "fail" "see $(basename "$log4")" "$s4"
  fi
}

run_l2() {
  if [[ -z "${DASHSCOPE_API_KEY:-}" && ! -f "$HOME/.alibabacloud/credentials" ]]; then
    local started_skip
    started_skip="$(now_ms)"
    record_case "L2" "-e ping" "skip" "missing DASHSCOPE_API_KEY/credentials" "$started_skip"
    return
  fi
  local log rc
  local started_at
  started_at="$(now_ms)"
  log="$OUT_DIR/oneshot-ping.log"
  run_cmd_log "$log" "$BIN" -e "ping" --timeout-ms 120000
  rc=$?

  if [[ $rc -eq 0 ]] && contains_ci 'pong|ready to help|ready' "$log"; then
    record_case "L2" "-e ping" "pass" "one-shot flow ok" "$started_at"
  else
    record_case "L2" "-e ping" "fail" "see $(basename "$log")" "$started_at"
  fi
}

run_l3() {
  local s_zh s_en
  if [[ "$SKIP_L3" -eq 1 ]]; then
    s_zh="$(now_ms)"
    s_en="$(now_ms)"
    record_case "L3" "TTS→ASR 中文" "skip" "disabled by --skip-l3" "$s_zh"
    record_case "L3" "TTS→ASR 英文" "skip" "disabled by --skip-l3" "$s_en"
    return
  fi

  if [[ -z "${DASHSCOPE_API_KEY:-}" && ! -f "$HOME/.alibabacloud/credentials" ]]; then
    s_zh="$(now_ms)"
    s_en="$(now_ms)"
    record_case "L3" "TTS→ASR 中文" "skip" "missing DASHSCOPE_API_KEY/credentials" "$s_zh"
    record_case "L3" "TTS→ASR 英文" "skip" "missing DASHSCOPE_API_KEY/credentials" "$s_en"
    return
  fi

  local zh_prompt en_prompt zh_log en_log rc_zh rc_en

  zh_prompt="Use alicloud-ai-audio-tts to synthesize the exact text '欢迎使用阿里云。' with non-realtime mode, then use alicloud-ai-audio-asr with non-realtime mode to transcribe that generated audio, and return ONLY JSON: {\"input_text\":\"...\",\"asr_text\":\"...\",\"normalized_equal\":true/false,\"audio_url\":\"...\"}."
  en_prompt="Use alicloud-ai-audio-tts to synthesize the exact text 'Welcome to Alibaba Cloud.' with non-realtime mode, then use alicloud-ai-audio-asr with non-realtime mode to transcribe that generated audio, and return ONLY JSON: {\"input_text\":\"...\",\"asr_text\":\"...\",\"normalized_equal\":true/false,\"audio_url\":\"...\"}."

  zh_log="$OUT_DIR/tts-asr-zh.log"
  en_log="$OUT_DIR/tts-asr-en.log"

  s_zh="$(now_ms)"
  run_cmd_log "$zh_log" "$BIN" -e "$zh_prompt" --timeout-ms "$TIMEOUT_MS"
  rc_zh=$?
  if [[ $rc_zh -eq 0 ]] && contains '"normalized_equal"[[:space:]]*:[[:space:]]*true' "$zh_log" && contains 'https?://[^[:space:]]+' "$zh_log"; then
    record_case "L3" "TTS→ASR 中文" "pass" "round-trip consistent" "$s_zh"
  else
    record_case "L3" "TTS→ASR 中文" "fail" "see $(basename "$zh_log")" "$s_zh"
  fi

  s_en="$(now_ms)"
  run_cmd_log "$en_log" "$BIN" -e "$en_prompt" --timeout-ms "$TIMEOUT_MS"
  rc_en=$?
  if [[ $rc_en -eq 0 ]] && contains '"normalized_equal"[[:space:]]*:[[:space:]]*true' "$en_log" && contains 'https?://[^[:space:]]+' "$en_log"; then
    record_case "L3" "TTS→ASR 英文" "pass" "round-trip consistent" "$s_en"
  else
    record_case "L3" "TTS→ASR 英文" "fail" "see $(basename "$en_log")" "$s_en"
  fi
}

run_l4() {
  local s_a s_b s_c
  if [[ "$WITH_L4" -ne 1 ]]; then
    s_a="$(now_ms)"; s_b="$(now_ms)"; s_c="$(now_ms)"
    record_case "L4A" "典型业务 case" "skip" "disabled (use --with-l4)" "$s_a"
    record_case "L4B" "异常/边界 case" "skip" "disabled (use --with-l4)" "$s_b"
    record_case "L4C" "稳定性 case" "skip" "disabled (use --with-l4)" "$s_c"
    return
  fi

  local business_log negative_log stability_log
  local rc_a rc_b rc_c

  business_log="$OUT_DIR/l4-business.log"
  negative_log="$OUT_DIR/l4-negative.log"
  stability_log="$OUT_DIR/l4-stability.log"

  s_a="$(now_ms)"
  {
    printf '/skills\n/quit\n' | "$BIN"
    "$BIN" -e "Use alicloud-ai-image-qwen-image to generate a 512*512 minimalist icon about cloud and return output image url only." --timeout-ms "$TIMEOUT_MS"
  } >"$business_log" 2>&1
  rc_a=$?
  if [[ $rc_a -eq 0 ]] && contains 'alicloud-ai-audio-tts' "$business_log" && contains 'alicloud-ai-audio-asr' "$business_log"; then
    record_case "L4A" "典型业务 case" "pass" "skills listed + image case executed" "$s_a"
  else
    record_case "L4A" "典型业务 case" "fail" "see $(basename "$business_log")" "$s_a"
  fi

  s_b="$(now_ms)"
  {
    "$BIN" -e "Run EXACTLY this command and do not change any argument: python3 skills/ai/audio/alicloud-ai-audio-asr/scripts/transcribe_audio.py --audio https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3 --model qwen3-asr-flash-xxx --print-response ; return stdout and stderr only." --timeout-ms 120000
    "$BIN" -e "Use alicloud-ai-video-wan-video to generate a video and wait for final url." --timeout-ms 1000
  } >"$negative_log" 2>&1
  rc_b=$?
  local invalid_failed timeout_failed
  invalid_failed=0
  timeout_failed=0
  if contains_ci 'invalid model|not a valid model|HTTP 400|HTTP 404|\\[error\\]|run failed|ValueError|RuntimeError|ModuleNotFoundError' "$negative_log"; then
    invalid_failed=1
  fi
  if contains_ci 'deadline|timeout|context deadline exceeded' "$negative_log"; then
    timeout_failed=1
  fi
  if [[ $invalid_failed -eq 1 && $timeout_failed -eq 1 ]]; then
    record_case "L4B" "异常/边界 case" "pass" "invalid-model + timeout semantics observed" "$s_b"
  else
    record_case "L4B" "异常/边界 case" "fail" "see $(basename "$negative_log")" "$s_b"
  fi

  s_c="$(now_ms)"
  {
    for i in 1 2 3; do
      "$BIN" -e "Use alicloud-ai-audio-tts to synthesize 'Welcome to Alibaba Cloud.' and return only audio url." --timeout-ms "$TIMEOUT_MS"
    done
    printf '/model\n/new\n/session\n/quit\n' | "$BIN"
  } >"$stability_log" 2>&1
  rc_c=$?

  if [[ $rc_c -eq 0 ]] && contains '/model|model:' "$stability_log" && contains 'session' "$stability_log"; then
    record_case "L4C" "稳定性 case" "pass" "repeat + repl commands ok" "$s_c"
  else
    record_case "L4C" "稳定性 case" "fail" "see $(basename "$stability_log")" "$s_c"
  fi
}

finish_summary() {
  python3 - "$WATERFALL_TSV" "$WATERFALL_MD" <<'PY'
import csv, sys, datetime as dt
tsv, out = sys.argv[1], sys.argv[2]
rows = []
with open(tsv, encoding="utf-8") as f:
    r = csv.DictReader(f, delimiter="\t")
    for row in r:
        rows.append(row)

def fmt(ms):
    d = dt.datetime.fromtimestamp(int(ms)/1000.0)
    return d.strftime("%H:%M:%S")

total = 0
for row in rows:
    try:
        total += int(row["duration_ms"])
    except Exception:
        pass

with open(out, "w", encoding="utf-8") as f:
    f.write("# CLI 测试瀑布流\n\n")
    f.write("| 层级 | 用例 | 结果 | 开始 | 结束 | 耗时(ms) | 备注 |\n")
    f.write("| --- | --- | --- | --- | --- | ---: | --- |\n")
    for row in rows:
        f.write(
            f"| {row['layer']} | {row['case']} | {row['result']} | {fmt(row['start_ms'])} | {fmt(row['end_ms'])} | {row['duration_ms']} | {row['note']} |\n"
        )
    f.write("\n")
    f.write(f"- 总任务耗时（累计）: {total} ms\n")
    if rows:
        wall = int(rows[-1]["end_ms"]) - int(rows[0]["start_ms"])
        f.write(f"- 总墙钟耗时（首任务开始到末任务结束）: {wall} ms\n")
PY

  {
    echo
    echo "## 统计"
    echo
    echo "- pass: $PASS"
    echo "- fail: $FAIL"
    echo "- skip: $SKIP"
    echo
    echo "## 结论"
    echo
    echo "- 瀑布流明细：$(basename "$WATERFALL_MD")"
    if [[ $FAIL -eq 0 ]]; then
      echo
      echo "本轮测试通过（无失败项）。"
    else
      echo
      echo "本轮测试存在失败项，请查看对应日志。"
    fi
  } >> "$SUMMARY_MD"

  echo "[done] summary: $SUMMARY_MD"
  echo "[done] logs: $OUT_DIR"

  if [[ $FAIL -gt 0 ]]; then
    exit 1
  fi
}

init_summary
build_binary_if_needed
run_l0
run_l1
run_l2
run_l3
run_l4
finish_summary
