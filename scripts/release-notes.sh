#!/usr/bin/env bash
# Собирает release notes из PR, коммиты которых попали в диапазон.
# Запуск: bash scripts/release-notes.sh <диапазон git, например 0.0.1..HEAD> <owner/repo>
# Нужен gh с доступом к репозиторию (в workflow — GH_TOKEN).
#
# Из каждого PR берутся пункты раздела «Для release notes» его описания.
# Раздел пустой — для feat и fix берётся заголовок PR без префикса, остальные PR пропускаются.
# Группы по типу из заголовка PR: feat — «Новое», fix — «Исправления», прочее — «Прочее».
set -euo pipefail

RANGE="$1"
REPO="$2"

declare -A SEEN
NEW=""
FIX=""
OTHER=""

for C in $(git rev-list --reverse --no-merges "$RANGE"); do
  # смерженный PR этого коммита (кроме релизных); коммит версии от бота PR не имеет — пропускаем
  PR='[.[] | select(.merged_at != null and (.head.ref | startswith("release/") | not))][0] // empty'
  NUM=$(gh api "repos/$REPO/commits/$C/pulls" --jq "$PR | .number")
  [ -n "$NUM" ] || continue
  [ -z "${SEEN[$NUM]:-}" ] || continue
  SEEN[$NUM]=1

  TITLE=$(gh api "repos/$REPO/pulls/$NUM" --jq .title)
  TYPE=$(sed -nE 's/^([a-z]+)(\([^)]*\))?!?:.*/\1/p' <<<"$TITLE")
  ITEMS=$(gh api "repos/$REPO/pulls/$NUM" --jq '.body // ""' | tr -d '\r' | awk '
    /^#+[[:space:]]*Для release notes/ { f = 1; next }
    /^#+[[:space:]]/ { f = 0 }
    /<!--/ { c = 1 }
    c { if (/-->/) c = 0; next }
    f && /^[-*][[:space:]]+[^[:space:]]/ { sub(/^[-*][[:space:]]+/, "- "); print }')

  if [ -z "$ITEMS" ]; then
    case "$TYPE" in
      feat | fix) ITEMS="- ${TITLE#*: }" ;;
      *) continue ;;
    esac
  fi
  case "$TYPE" in
    feat) NEW+="$ITEMS"$'\n' ;;
    fix) FIX+="$ITEMS"$'\n' ;;
    *) OTHER+="$ITEMS"$'\n' ;;
  esac
done

OUT=""
[ -z "$NEW" ] || OUT+="### Новое"$'\n'"$NEW"$'\n'
[ -z "$FIX" ] || OUT+="### Исправления"$'\n'"$FIX"$'\n'
[ -z "$OTHER" ] || OUT+="### Прочее"$'\n'"$OTHER"$'\n'
[ -n "$OUT" ] || OUT="Внутренние улучшения без видимых изменений."$'\n'
printf '%s' "$OUT"
