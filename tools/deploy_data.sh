#!/bin/sh
# Carica i dati preparati (tools/prepare.sh) sulla Vita via FTP (vitacompanion o VitaShell).
# Salta i file gia' presenti con la stessa dimensione. Va piano: l'FTP della Vita
# cede (e puo' bloccare la console) se lo si martella.
# Uso: tools/deploy_data.sh [cartella gamedata] [IP]
# PAUSA (secondi fra i file, default 1), TENTATIVI (default 3) e SOLO (regex sui
# percorsi, es. SOLO='^(data|lang|img)/') da ambiente.
SRC="${1:-gamedata}"
V="${2:-${VITA_IP:-192.168.178.152}}"
DST="ux0:/data/VampireSurvivors"
PAUSA="${PAUSA:-1}"
SOLO="${SOLO:-.}"
TENTATIVI="${TENTATIVI:-3}"
cd "$SRC" || exit 1
falliti=0
set -f  # niente glob sui nomi dei file

# aspetta il banner 220 sulla 1337 (max ~60 s), altrimenti esce: con la porta
# aperta ma senza banner il server e' appeso e serve `vita reboot`
porta() {
  i=0
  while ! printf 'QUIT\r\n' | nc -G 3 -w 5 "$V" 1337 2>/dev/null | grep -q '^220'; do
    i=$((i + 1)); [ $i -ge 12 ] && { echo "FTP $V:1337 non risponde (vita reboot?), mi fermo"; exit 2; }
    sleep 5
  done
}

porta
# dimensioni remote con un LIST per cartella: un HEAD per file (centinaia di
# connessioni di fila) basta ad appendere il server
remoti=$(mktemp)
for d in $(find . -type f | sed 's|^\./||;/\//!s|.*|.|;s|/[^/]*$||' | sort -u); do
  curl -s --connect-timeout 8 --max-time 30 "ftp://$V:1337/$DST/$d/" |
    tr -d '\r' | awk -v d="$d" '$1 ~ /^-/ { n = $9; for (i = 10; i <= NF; i++) n = n " " $i; print (d == "." ? "" : d "/") n "\t" $5 }' >> "$remoti"
  sleep "$PAUSA"
done
saltati=0
# save.json e' il salvataggio del desktop: mai sopra quello della Vita; font_*.cache sono del desktop
for f in $(find . -type f | sed 's|^\./||' | grep -E "$SOLO" | grep -v -e '^save\.json$' -e '\.cache$' | tr ' ' '\001'); do
  f=$(printf '%s' "$f" | tr '\001' ' ')
  url="ftp://$V:1337/$DST/$(printf '%s' "$f" | sed 's/ /%20/g')"
  size=$(stat -f %z "$f")
  grep -Fxq "$(printf '%s\t%s' "$f" "$size")" "$remoti" && { saltati=$((saltati + 1)); continue; }
  n=1
  while :; do
    [ $n -gt 1 ] && porta
    # tempo massimo proporzionale alla dimensione (>= 100 KB/s)
    if curl -s --ftp-create-dirs --connect-timeout 8 --max-time $((30 + size / 100000)) -T "$f" "$url"; then
      echo "ok $f"; break
    fi
    [ $n -ge "$TENTATIVI" ] && { echo "ERRORE $f"; falliti=$((falliti + 1)); break; }
    sleep $((n * 3)); n=$((n + 1))
  done
  sleep "$PAUSA"
done
rm -f "$remoti"
echo "saltati: $saltati, falliti: $falliti"
[ $falliti -eq 0 ]
