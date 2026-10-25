#!/bin/zsh
# 發佈到 https://makotofoto.github.io/film-darkroom/
#   ./deploy.sh ["commit message"]
set -e
cd "${0:A:h}"
git add -A
if git diff --cached --quiet; then
  echo "沒有變更，不需要發佈。"
  exit 0
fi
git commit -q -m "${1:-更新暗房}"
git push -q
echo "已推送。GitHub Pages 約 1–2 分鐘後更新："
echo "  https://makotofoto.github.io/film-darkroom/"
