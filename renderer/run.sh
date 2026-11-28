#!/bin/bash
# Lancement du navigateur sans écran, avec une surveillance : il arrive que Chromium démarre
# sans jamais ouvrir son interface DevTools. Le relais socat (port 9222) répond quand même,
# le service paraît sain et les outils échouent. Ici, si DevTools ne répond pas dans les
# 30 secondes qui suivent le démarrage, ou cesse de répondre trois fois de suite, le script
# s'arrête : Docker relance le conteneur (restart: unless-stopped).

socat TCP4-LISTEN:9222,fork TCP4:127.0.0.1:9223 &

/headless-shell/headless-shell \
  --no-sandbox \
  --use-gl=angle \
  --use-angle=swiftshader \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9223 \
  "$@" &
CHROME=$!

# DevTools répond-il sur son propre port (pas sur le relais) ?
alive() {
  timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/9223 \
    && printf "GET /json/version HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n" >&3 \
    && grep -q webSocketDebuggerUrl <&3' 2>/dev/null
}

stop() {
  echo "renderer: $1, restarting" >&2
  kill "$CHROME" 2>/dev/null
  exit 1
}

trap 'kill "$CHROME" 2>/dev/null; exit 0' TERM INT

started=0
for _ in $(seq 30); do
  kill -0 "$CHROME" 2>/dev/null || stop "Chromium exited"
  if alive; then started=1; break; fi
  sleep 1
done
[ "$started" = 1 ] || stop "DevTools did not answer within 30 s"
echo "renderer: DevTools ready" >&2

misses=0
while sleep 10; do
  kill -0 "$CHROME" 2>/dev/null || stop "Chromium exited"
  if alive; then misses=0; else misses=$((misses + 1)); fi
  [ "$misses" -ge 3 ] && stop "DevTools stopped answering"
done
