# 启动问题请参考 https://github.com/GUI-for-Cores/GUI.for.SingBox/pull/35/changes

# 场景速查表
#
# 运行场景	推荐写法
# 普通执行 (./run.sh 或 /path/run.sh)	SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 可能被 source 引入的 Bash 脚本	SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 脚本是软链接，需获取真实路径 (Linux)	SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# 脚本是软链接，需同时兼容 macOS/Linux	使用上方第 3 节的 while [ -L "$SOURCE" ] 循环


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
frontend_dir="$(cd $SCRIPT_DIR/../frontend || exit 1; pwd)"
cd "$frontend_dir" || exit 1
pnpm build
cd "$SCRIPT_DIR/.." || exit 1
wails build -m -s -trimpath -skipbindings -devtools -tags webkit2_41
