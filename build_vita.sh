#!/bin/sh
# VPK per PS Vita (VitaSDK in ~/vitasdk con raylib, SDL2 e vitaGL installati come per FX-Ball).
set -e
cd "$(dirname "$0")"
export VITASDK="$HOME/vitasdk" PATH="$HOME/vitasdk/bin:$PATH"
cmake -S . -B build_vita -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build_vita -j8
