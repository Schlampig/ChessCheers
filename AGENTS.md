# AGENTS.md

This file provides guidance to agent（LLM） when working with code in this repository.

## 交互原则
- 执行时遇到认为不明确的地方，请询问用户，再根据用户反馈推进
- 本项目名称为ChessCheers

## 核心技术栈
- 前端：HTML5, CSS3, JavaScript (ES5标准语法，不使用ES6特性)
- 国际象棋走棋规则：Chess.js（code/js/chess.min.js，注意：该版本不包含board()方法，需使用get(square)代替）
- 国际象棋计算引擎：Stockfish WASM（code/js/stockfish.wasm.js + code/js/stockfish.wasm）
- 版本控制：Git
- 部署：GitHub Pages（github.io）
- 响应式布局和触屏事件兼容

# 代码风格
- 单函数不超过30行，超过需拆分或解耦成更细的功能代码块
- API调用必须包含错误处理和状态
- 核心代码段需写30字以内注释，说明其功能
- 使用IIFE封装避免全局污染

# 限制项
- 可以使用、但不要删除或更改doc/与data/目录下的任何内容
- 不使用ES6特性（箭头函数、let/const、async/await），使用标准ES5语法
- 使用Promise处理异步操作，但使用.then()语法

# 工作流
## 预备操作
- 阅读doc/PRD.md，了解整个ChessCheers项目的背景、设计方案、要求与计划
- 该项目已经完成了有限且可能包含错误的部分代码，请根据doc/PRD.md的信息，自由查找、阅读这些文档，并检查是否符合PRD的描述
- 基于以上掌握的信息，规划自己的工作事项与待办

## 开发流程
- 先列出该项目的整体代码框架，确定要开发的模块
- 每个模块中，细化功能点，对每个功能点先写定义与注释，然后写代码，最后写测试
- 排查问题时，先写复现测试，然后修复代码，最后验证测试，验证有问题需要重复以上流程直至问题解决

## 项目架构

### 目录结构
- `code/html/` - 4个页面：index.html(首页)、game.html(对弈)、result.html(结算)、about.html(了解更多)
- `code/css/` - 4个样式文件，与HTML一一对应
- `code/js/` - 核心脚本与第三方库
  - `chess.min.js` - Chess.js规则引擎
  - `stockfish.wasm.js` + `stockfish.wasm` - Stockfish WASM
  - `stockfish-engine.js` - Stockfish 引擎封装
  - `index.js`/`game.js`/`result.js`/`about.js` - 对应4个页面的逻辑
- `code/test/` - CDP自动化脚本
- `data/chessboard/` - 棋盘素材（图片，须为 1:1；`-mini` 为首页预览缩略图）
- `data/chesspiece/` - 阵营素材，每个阵营包含King/Queen/Bishop/Knight/Rook/Pawn文件夹
- `data/chesslogo/` - 项目logo（原图与各档尺寸，供页面与favicon使用）
- `data/others/` - 文档配图
- `doc/` - 项目文档（PRD、使用指南、README英文版、intro文档）
- `tools/` - 本地服务与素材工具（serve / scan-assets / optimize-assets / make-posters / bump-version）

### 页面流程
1. 首页 → 配置 → 对弈页面
2. 对弈页面 → 游戏结束 → 结算页面
3. 首页 → 了解更多 → about页面

## 关键配置与常量

### ELO难度映射（搜索深度与技能等级同步递增）
| ELO | 难度名称 | 搜索深度 | 技能等级 |
|-----|----------|----------|----------|
| ≤500 | 初生牛犊 | 3 | 0 |
| 600-1000 | 灵机一动 | 6 | 3 |
| 1100-1500 | 激流勇进 | 9 | 6 |
| 1600-2000 | 福至心灵 | 12 | 10 |
| 2100-2500 | 行云流水 | 15 | 14 |
| 2600-3000 | 随心所欲 | 18 | 18 |
| ≥3000 | 返璞归真 | 20 | 20 |

档位按「起始分下界」命中（`levelOf`），首页下拉的 value 即起始分；
该构建不提供 UCI_Elo / UCI_LimitStrength，技能等级是唯一的强度开关。

### 棋子类型映射（PIECE_TYPE_MAP）
- `'p'` → `'Pawn'` (兵)
- `'r'` → `'Rook'` (城堡)
- `'n'` → `'Knight'` (骑士)
- `'b'` → `'Bishop'` (主教)
- `'q'` → `'Queen'` (皇后)
- `'k'` → `'King'` (国王)

### 游戏模式
- `'pve'` - 人 vs 机
- `'pvp'` - 人 vs 人

## Chess.js 重要提示
当前版本Chess.js不包含board()方法，使用以下替代：
- `chess.get(square)` - 获取指定格子的棋子
- `chess.fen()` - 获取FEN字符串（传递给Stockfish）
- `chess.history()` - 获取走法历史
- `chess.moves({verbose: true})` - 获取详细走法列表

## 素材路径规范
- 棋子视觉：`data/chesspiece/{阵营}/{棋子类型}/{选中/落子/被吃}.{webm,gif,png,jpg,jpeg,webp}`
- 棋子静止态预览：`data/chesspiece/{阵营}/{棋子类型}/预览.webp`（由 `tools/make-posters.js` 生成）
- 棋子音效：`data/chesspiece/{阵营}/{棋子类型}/{选中/落子/被吃}.{wav,m4a,mp3,ogg}`
- 结算图片：`data/chesspiece/{阵营}/结算动画/{win/lose/draw}/{赢棋/输棋/和棋}.webp`
- 结算音效：`data/chesspiece/{阵营}/结算动画/{win/lose/draw}/{赢棋/输棋/和棋}.{wav,m4a}`
- 棋盘：`data/chessboard/{棋盘名称}.webp`，另生成 `{棋盘名称}-mini.webp` 供首页预览
- 以上路径均由 `tools/scan-assets.js` 扫描后写入 `code/js/assets.js`，代码中不硬编码素材名

## 代码组织模式
1. 使用IIFE封装避免全局污染
2. 使用`elements`对象缓存DOM引用，`initElements()`函数初始化
3. 每个页面`init()`流程：`initElements` → 初始化配置 → 渲染 → `bindEvents`
