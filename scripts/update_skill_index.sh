#!/usr/bin/env bash
set -euo pipefail

python3 "$(dirname "$0")/generate_skill_index.py"
python3 "$(dirname "$0")/generate_readme_skill_sections.py"
