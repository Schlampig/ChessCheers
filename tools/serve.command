#!/bin/bash
# ChessCheers 本地预览脚本（macOS 双击运行）
#
# 与直接起 python 静态服务的区别：
#   启动时会自动扫描 data/ 并重新生成素材清单，新增阵营/棋盘重启即可生效，
#   同时输出素材规范检查报告。
#
# 必须用 HTTP 方式访问：file:// 直接打开会被浏览器拦截 Worker，AI 无法工作。

cd "$(dirname "$0")/.." || exit 1

PORT="${1:-8766}"

if ! command -v node >/dev/null 2>&1; then
    echo "未找到 Node.js，请先安装（https://nodejs.org/）；"
    echo "或改用纯静态方式（需手动跑 node tools/scan-assets.js）："
    echo "  python3 -m http.server ${PORT} --bind 127.0.0.1"
    read -r -p "按回车键关闭…" _
    exit 1
fi

node tools/serve.js "${PORT}"
