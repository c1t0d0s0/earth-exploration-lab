#!/usr/bin/env bash
# JAXA Earth API for JavaScript の型定義を取得する。
# 本体 (jaxa.earth.esm.js) は再配布せず、実行時に公式URLから読み込む (src/core/jaxaLoader.ts)。
set -euo pipefail
VERSION="2.0.1"
DIR="$(cd "$(dirname "$0")/.." && pwd)/src/vendor"
mkdir -p "$DIR"
curl -sSf -o "$DIR/jaxa.earth.esm.d.ts" "https://data.earth.jaxa.jp/api/javascript/v${VERSION}/jaxa.earth.esm.d.ts"
echo "fetched jaxa.earth.esm.d.ts v${VERSION}"
