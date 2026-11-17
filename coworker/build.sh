#!/bin/sh
# Bundle the coworker's browser plugins in the module format the shell's loader reads. The answer card carries
# Pramanyx's own chart resolver from web/. React comes from the shell, so it is left out.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
# vega and vega-lite are the web app's own copies, so the chart here is drawn by the versions the app draws with.
modules="${PRAMANYX_WEB_MODULES:-$here/../web/node_modules}"
[ -d "$modules/vega" ] || { echo "build: no vega in $modules — run npm install in web/, or set PRAMANYX_WEB_MODULES" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# One browser bundle per plugin: its source and what it imports, wrapped as the shell's loader reads a module.
# The package name is the module's id, so it is read from the plugin's own manifest.
for plugin in "$here"/plugins/*/; do
  plugin=${plugin%/}
  [ -f "$plugin/src/client.js" ] || continue
  id=$(node -p "require('$plugin/package.json').name")
  NODE_PATH="$modules" npx -y esbuild@0.25.5 "$plugin/src/client.js" \
    --bundle --format=cjs --platform=browser --minify \
    --external:react --external:react-dom --external:react/jsx-runtime \
    --loader:.png=dataurl \
    "--alias:@=$here/../web" '--define:process.env.NODE_ENV="production"' \
    --log-level=warning --outfile="$tmp/bundle.cjs"
  {
    printf 'window.__ModuleLoader__.load({id:"%s",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' "$id"
    cat "$tmp/bundle.cjs"
    printf '\nreturn module.exports;}});\n'
  } > "$plugin/lib/client.js"
  echo "build: wrote ${plugin#"$here"/}/lib/client.js ($(wc -c < "$plugin/lib/client.js" | tr -d ' ') bytes)"
done

# 2026-11-17 — the map in the answer card. MapLibre and its worker as the package ships them (BSD-3-Clause, its licence
# copied beside them), and the shapes the install ships, served to the page by the card's own server (`lib/index.js`).
# The page loads them only when an answer is a map.
[ -d "$modules/maplibre-gl/dist" ] || { echo "build: no maplibre-gl in $modules — run npm install in web/" >&2; exit 1; }
map="$here/plugins/answer-card/lib/map"
mkdir -p "$map"
for f in maplibre-gl.mjs maplibre-gl-worker.mjs maplibre-gl.css; do cp "$modules/maplibre-gl/dist/$f" "$map/"; done
cp "$modules/maplibre-gl/LICENSE.txt" "$map/MAPLIBRE-LICENSE.txt"
cp "$here/../web/public/geo/world.json" "$here/../web/public/geo/us-states.json" "$map/"
echo "build: wrote plugins/answer-card/lib/map (MapLibre $(node -p "require('$modules/maplibre-gl/package.json').version") and the shapes)"
