#!/usr/bin/env bash
# Sube una imagen a la CDN de adjuntos de GitHub y devuelve el markdown listo
# para pegar en el cuerpo de una issue, PR o comentario.
#
# Uso:
#   attach-image.sh --paste                     # última imagen pegada en el chat (solo Claude Code)
#   attach-image.sh --file ruta/captura.png     # archivo en disco
#   attach-image.sh --clipboard                 # portapapeles (macOS o Linux)
#   attach-image.sh --last-screenshot           # captura más reciente (macOS o Linux)
#
# Opciones:
#   --repo owner/name   Repo destino (default: el del origin del directorio actual)
#   --alt "texto"       Texto alternativo del markdown (default: el nombre del archivo)
#   --transcript ruta   Transcript .jsonl explícito para --paste (default: el de la sesión activa)
#   --no-optimize       Sube el original sin pasarlo por ffmpeg
#
# Imprime en stdout el markdown (`![alt](url)`) y en stderr un resumen de tamaños.
set -euo pipefail

source_mode=""
source_file=""
repository=""
alt_text=""
transcript=""
optimize=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --paste)           source_mode="paste"; shift ;;
    --clipboard)       source_mode="clipboard"; shift ;;
    --last-screenshot) source_mode="last-screenshot"; shift ;;
    --file)            source_mode="file"; source_file="$2"; shift 2 ;;
    --repo)            repository="$2"; shift 2 ;;
    --alt)             alt_text="$2"; shift 2 ;;
    --transcript)      transcript="$2"; shift 2 ;;
    --no-optimize)     optimize=false; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$source_mode" ]] || { echo "Falta el origen: --paste, --file, --clipboard o --last-screenshot" >&2; exit 2; }

working_directory="$(mktemp -d)"
trap 'rm -rf "$working_directory"' EXIT

# Tamaño y fecha de modificación, portables: GNU coreutils (Linux) usa
# `-c%s`/`-c%Y` y BSD (macOS) `-f%z`/`-f%m`. La variante equivocada no
# devuelve vacío: aborta con "invalid option", así que el script moría antes
# de subir nada. Se prueba primero la de Linux porque es la que corre en CI.
file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}

file_mtime() {
  stat -c%Y "$1" 2>/dev/null || stat -f%m "$1"
}

# --- 1. Obtener el archivo original ------------------------------------------

case "$source_mode" in
  file)
    [[ -f "$source_file" ]] || { echo "No existe el archivo: $source_file" >&2; exit 1; }
    original="$source_file"
    ;;

  paste)
    # Claude Code guarda las imágenes pegadas como base64 dentro del transcript
    # de la sesión. Se toma la última que aparece.
    if [[ -z "$transcript" ]]; then
      project_slug="$(printf '%s' "$PWD" | tr '/.' '--')"
      transcript_directory="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$project_slug"
      transcript="$(ls -t "$transcript_directory"/*.jsonl 2>/dev/null | head -1 || true)"
    fi
    [[ -n "$transcript" && -f "$transcript" ]] || { echo "No se encontró el transcript de la sesión: --paste solo funciona en Claude Code; en otro agente usa --clipboard o --file" >&2; exit 1; }

    image_record="$(jq -r 'select(.message.content|type=="array")
                           | .message.content[]?
                           | select(.type=="image")
                           | [.source.media_type, .source.data] | @tsv' "$transcript" | tail -1)"
    [[ -n "$image_record" ]] || { echo "No hay ninguna imagen pegada en este transcript" >&2; exit 1; }

    media_type="${image_record%%$'\t'*}"
    case "$media_type" in
      image/png)  extension="png"  ;;
      image/jpeg) extension="jpg"  ;;
      image/gif)  extension="gif"  ;;
      image/webp) extension="webp" ;;
      *) echo "Tipo de imagen no soportado: $media_type" >&2; exit 1 ;;
    esac

    # `-d` es GNU; el base64 de BSD/macOS antiguo solo entiende `-D`. Se
    # prueba con datos vacíos antes de tocar la imagen real, porque el pipe
    # ya no se puede rebobinar si la primera pasada consume el stdin.
    if printf '' | base64 -d >/dev/null 2>&1; then
      base64_decode_flag="-d"
    else
      base64_decode_flag="-D"
    fi

    original="$working_directory/pegada.$extension"
    printf '%s' "${image_record#*$'\t'}" | base64 "$base64_decode_flag" > "$original"
    ;;

  clipboard)
    # No hay una sola API de portapapeles: se prueba cada herramienta según
    # esté instalada, en vez de ramificar por SO, porque un Linux puede tener
    # Wayland o X11 (o ninguno) y eso no lo dice `uname`.
    original="$working_directory/portapapeles.png"
    if command -v wl-paste >/dev/null 2>&1; then
      wl-paste --type image/png > "$original" 2>/dev/null \
        || { echo "El portapapeles no contiene una imagen (wl-paste)" >&2; exit 1; }
    elif command -v xclip >/dev/null 2>&1; then
      xclip -selection clipboard -t image/png -o > "$original" 2>/dev/null \
        || { echo "El portapapeles no contiene una imagen (xclip)" >&2; exit 1; }
    elif command -v osascript >/dev/null 2>&1; then
      osascript \
        -e "set destination to open for access POSIX file \"$original\" with write permission" \
        -e "write (the clipboard as «class PNGf») to destination" \
        -e "close access destination" >/dev/null 2>&1 \
        || { echo "El portapapeles no contiene una imagen" >&2; exit 1; }
    else
      echo "No hay ninguna herramienta de portapapeles disponible. Instala wl-clipboard (Wayland) o xclip (X11) en Linux." >&2
      exit 1
    fi
    ;;

  last-screenshot)
    # macOS guarda la carpeta de capturas en las preferencias de
    # screencapture; Linux no tiene ese concepto, así que se revisan las
    # carpetas habituales en orden de probabilidad. Se compara la fecha de
    # modificación entre todas para quedarse con la más reciente de verdad,
    # no solo la del primer directorio que tenga alguna imagen.
    screenshot_directories=()
    if command -v defaults >/dev/null 2>&1; then
      screenshot_directories+=("$(defaults read com.apple.screencapture location 2>/dev/null || echo "$HOME/Desktop")")
    else
      if command -v xdg-user-dir >/dev/null 2>&1; then
        pictures_directory="$(xdg-user-dir PICTURES 2>/dev/null || true)"
        if [[ -n "$pictures_directory" ]]; then
          screenshot_directories+=("$pictures_directory")
        fi
      fi
      screenshot_directories+=("$HOME/Pictures/Screenshots" "$HOME/Pictures" "$HOME/Desktop")
    fi

    original=""
    newest_mtime=0
    for directory in "${screenshot_directories[@]}"; do
      directory="${directory/#\~/$HOME}"
      [[ -d "$directory" ]] || continue
      while IFS= read -r -d '' candidate; do
        candidate_mtime="$(file_mtime "$candidate")"
        if (( candidate_mtime > newest_mtime )); then
          newest_mtime="$candidate_mtime"
          original="$candidate"
        fi
      done < <(find "$directory" -maxdepth 1 -type f \
        \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -print0 2>/dev/null)
    done
    [[ -n "$original" ]] || { echo "No se encontró ninguna captura en: ${screenshot_directories[*]}" >&2; exit 1; }
    ;;
esac

original_size="$(file_size "$original")"
(( original_size > 0 )) || { echo "La imagen está vacía (0 bytes): $original" >&2; exit 1; }

# --- 2. Optimizar -------------------------------------------------------------
# WebP lossless: en capturas de UI baja el peso ~65-80% sin tocar un solo pixel.
# Si no gana (imágenes ya comprimidas, fotos), se sube el original.

upload_file="$original"
if [[ "$optimize" == true ]] && command -v ffmpeg >/dev/null 2>&1; then
  candidate="$working_directory/optimizada.webp"
  if ffmpeg -v error -y -i "$original" -c:v libwebp -lossless 1 -compression_level 6 "$candidate" 2>/dev/null; then
    if [[ -s "$candidate" ]] && (( $(file_size "$candidate") < original_size )); then
      upload_file="$candidate"
    fi
  fi
fi

upload_size="$(file_size "$upload_file")"
if (( upload_size > 10485760 )); then
  echo "La imagen pesa $((upload_size / 1048576)) MB y GitHub corta en 10 MB." >&2
  echo "Reduce la resolución antes de subirla, por ejemplo:" >&2
  echo "  ffmpeg -i \"$original\" -vf \"scale=iw/2:ih/2:flags=lanczos\" -c:v libwebp -lossless 1 salida.webp" >&2
  exit 1
fi

case "$upload_file" in
  *.webp) content_type="image/webp" ;;
  *.png)  content_type="image/png"  ;;
  *.jpg|*.jpeg) content_type="image/jpeg" ;;
  *.gif)  content_type="image/gif"  ;;
  *) echo "Extensión no soportada: $upload_file" >&2; exit 1 ;;
esac

# --- 3. Subir -----------------------------------------------------------------
# Endpoint NO documentado por GitHub: es el mismo que usa el drag-and-drop de la
# web, pero acepta el token de `gh`. Si algún día deja de responder 201, el
# fallback es adjuntar la imagen a mano desde el navegador.

# `gh repo view` usa GraphQL, que la nube de Claude bloquea: el repo sale de
# GH_REPO o del origin, como en github-rest. Se lee la URL guardada y no la de
# `git remote get-url`, que aplica `insteadOf`; la nube usa un proxy en
# `http://…/git/<owner>/<repo>`.
if [[ -z "$repository" && -n "${GH_REPO:-}" ]]; then
  repository="${GH_REPO#*/}"
  [[ "$repository" == */* ]] || repository="$GH_REPO"
fi
if [[ -z "$repository" ]]; then
  origin_url="$(git config --get remote.origin.url || true)"
  origin_pattern='^(https://[^/]+/|https?://[^/]+/git/|git@[^:]+:|ssh://git@[^/]+/)([^/]+/[^/]+)$'
  if [[ "${origin_url%.git}" =~ $origin_pattern ]]; then
    repository="${BASH_REMATCH[2]}"
  fi
fi
[[ -n "$repository" ]] || { echo "No sé a qué repo subirla: usa --repo owner/name" >&2; exit 2; }
repository_id="$(gh api "repos/$repository" --jq .id)"
file_name="$(basename "$upload_file")"

response="$(curl -sS --fail-with-body \
  "https://uploads.github.com/user-attachments/assets?name=${file_name}&content_type=${content_type}&repository_id=${repository_id}" \
  -X POST \
  -H "Authorization: Bearer $(gh auth token)" \
  -H "Accept: application/json" \
  --data-binary "@$upload_file")" || {
    echo "Falló la subida a uploads.github.com:" >&2
    echo "$response" >&2
    exit 1
  }

asset_url="$(printf '%s' "$response" | jq -r '.url // empty')"
[[ -n "$asset_url" ]] || { echo "Respuesta inesperada del endpoint: $response" >&2; exit 1; }

[[ -n "$alt_text" ]] || alt_text="$(basename "$original")"

printf '%d -> %d bytes (%d%%) · %s\n' \
  "$original_size" "$upload_size" "$((100 * upload_size / original_size))" "$content_type" >&2
printf '![%s](%s)\n' "$alt_text" "$asset_url"
