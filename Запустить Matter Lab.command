#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if curl --silent --fail --max-time 2 http://127.0.0.1:4310/api/health >/dev/null 2>&1; then
  echo 'Matter Lab уже работает: http://127.0.0.1:4310/'
  exit 0
fi
for matter_lab_program in node npm; do
  if ! command -v "$matter_lab_program" >/dev/null 2>&1; then
    echo "Для запуска нужен $matter_lab_program. См. README.md"
    exit 1
  fi
done
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm run dev
