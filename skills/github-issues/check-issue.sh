#!/usr/bin/env bash
# Comprueba que el cuerpo de una issue respete la forma de `github-issues`.
# Uso: bash <carpeta de la skill>/check-issue.sh <archivo-del-cuerpo> <bug|feature>
# Sale con 1 y la lista de problemas si algo falla; con 0 si todo está bien.
# Los topes salen de la tabla "## Topes" del project.md de esta carpeta; un tipo
# que no está ahí (o sin project.md) usa los de la skill.
# No cuentan para el tope: los títulos de sección, los pasos para reproducir,
# la línea "Error:", los bloques de código (logs, stack traces) y la rama.

set -euo pipefail

source_body="${1:-}"
kind="${2:-}"
[ -n "$source_body" ] && [ -f "$source_body" ] || { echo "Uso: check-issue.sh <archivo> <bug|feature>" >&2; exit 2; }
case "$kind" in
  bug) max_words=150; first_label='**Qué falla:**' ;;
  feature) max_words=250; first_label='**Qué se pide:**' ;;
  *) echo "El tipo debe ser bug o feature (spike y documentation usan feature)." >&2; exit 2 ;;
esac

project="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/project.md"
if [ -f "$project" ]; then
  cap=$(tr -d '\r' < "$project" | awk -v kind="$kind" '
    /^## / { inside = ($0 == "## Topes"); next }
    inside && /^\|/ {
      n = split($0, cell, "|")
      for (i = 1; i <= n; i++) { gsub(/^[[:space:]`]+|[[:space:]`]+$/, "", cell[i]) }
      if (cell[2] != kind) next
      print (cell[3] ~ /^[0-9]+$/ && length(cell[3]) <= 6) ? cell[3] + 0 : "ilegible"
      exit
    }')
  if [ "$cap" = "ilegible" ]; then
    echo "Aviso: la fila de '$kind' en \"## Topes\" no se pudo leer (un número de hasta 6 cifras); uso el tope de la skill." >&2
  elif [ -n "$cap" ]; then
    max_words=$cap
  fi
fi

body=$(mktemp "${TMPDIR:-/tmp}/check-issue.XXXXXX")
trap 'rm -f "$body"' EXIT
tr -d '\r' < "$source_body" > "$body"

problems=()
add() { problems+=("$1"); }

expected=("$first_label" '**Por qué importa:**' '**Hecho cuando:**')
for index in 0 1 2; do
  line=$(awk -v n=$((index + 1)) 'NF { seen++ } seen == n { print; exit }' "$body")
  case "$line" in
    "${expected[$index]}"*) ;;
    *) add "La línea $((index + 1)) de la cabecera debe empezar con '${expected[$index]}'." ;;
  esac
done

export TITLE='^[*][*][^*]+[*][*]( [(].*[)])?$'

if grep -q '^\*\*Criterios de aceptación\*\*' "$body"; then
  criteria=$(awk '
    /^\*\*Criterios de aceptación\*\*/ { inside = 1; next }
    inside && $0 ~ ENVIRON["TITLE"] { exit }
    inside && /^- \[[ xX]\]/ { n++ }
    END { print n + 0 }' "$body")
  [ "$criteria" -ge 1 ] || add "Los criterios de aceptación están vacíos; hace falta al menos uno."
  [ "$criteria" -le 5 ] || add "Hay $criteria criterios de aceptación; el máximo es 5. Si no caben, la issue junta dos trabajos."
else
  criteria=0
  add "Faltan los '**Criterios de aceptación**'."
fi

if grep -Eq '^[[:space:]]+[-*] ' "$body"; then
  add "Hay viñetas anidadas; deja una sola altura."
fi

words=$(awk '
    /^```/ { fenced = !fenced; next }
    fenced { next }
    $0 ~ ENVIRON["TITLE"] { skip = ($0 ~ /^\*\*(Cómo reproducirlo|Slug de rama|Rama sugerida)\*\*/); next }
    skip { next }
    /^Error:/ { next }
    { print }' "$body" \
  | sed -E 's/!\[[^]]*\]\([^)]*\)//g' | wc -w | tr -d ' ')
[ "$words" -le "$max_words" ] || add "El cuerpo tiene $words palabras sin contar títulos, pasos, errores ni logs; el tope de '$kind' es $max_words. Recorta el detalle o parte la issue."

if [ "${#problems[@]}" -eq 0 ]; then
  echo "OK: $kind, $words palabras, $criteria criterios."
  exit 0
fi
printf -- '- %s\n' "${problems[@]}"
exit 1
