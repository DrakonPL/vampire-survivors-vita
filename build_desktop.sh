#!/bin/sh
# Anteprima sul Mac (raylib di Homebrew). Dati: VS_DATA=<cartella di tools/prepare.sh>.
# Prova automatica: VS_SCENE=chars|game|results VS_SHOT=<secondi> ./vs  -> shot.png
cd "$(dirname "$0")" && cc -O2 -Wall -Isrc -o vs src/*.c src/third_party/cJSON.c \
  $(pkg-config --cflags --libs raylib) -framework Cocoa -framework IOKit -framework OpenGL
