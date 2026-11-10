# ChessCheers 使用指南

**中文** | [English](UserGuide_en.md)

> 本指南分两部分：**第一部分给只想下棋的玩家**，**第二部分给想改代码、做二次开发的开发者**。
> 开头的公共部分两边都建议读一下。

## 目录

- [公共部分](#common)
  - [这是什么](#common-what)
  - [怎么打开](#common-open)
  - [三个核心概念](#common-concepts)
- [第一部分：给玩家](#part-player)
  - [页面地图](#player-map)
  - [首页：配置你的对局](#player-index)
  - [对弈页：怎么下棋](#player-game)
  - [结算页](#player-result)
  - [了解更多](#player-about)
  - [常见问题](#player-faq)
- [第二部分：给开发者](#part-dev)
  - [技术栈](#dev-stack)
  - [项目结构](#dev-layout)
  - [代码架构与数据流](#dev-arch)
  - [素材规范](#dev-assets)
  - [本地开发流程](#dev-workflow)
  - [测试](#dev-test)
  - [发布网页版](#dev-deploy)
  - [可以改什么 / 不要动什么](#dev-boundary)
  - [常见坑](#dev-pitfalls)
- [许可与声明](#license)

---

<a id="common"></a>

## 公共部分

<a id="common-what"></a>

### 这是什么

ChessCheers 是一个跑在浏览器里的国际象棋应用，有两种玩法：

- **人 vs 机**：你和 Stockfish 引擎对弈，难度可调
- **人 vs 人**：同一台设备上黑白轮流走，适合摆棋和练习

**它首先是一个同人游戏。** 棋子立绘与语音来自手机游戏[《明日方舟》](https://ak.hypergryph.com/)，作者出于对该游戏与国际象棋的喜爱而制作，与官方无任何关联。项目底层基于国际象棋引擎 [Stockfish](https://stockfishchess.org/) 完成算棋，用 Chess.js 管理行棋规则。

**其次它是一个通用框架。** 棋子和棋盘全部来自 `data/` 目录下的素材文件——理论上只要按规范替换图片、动画与音频，就能让任何自定义角色与棋盘出现在游戏里，换成你自己的 IP、原创角色或纯几何棋子都可以。

> 素材的版权归属与使用限制见 [许可与声明](#license)，使用或分发前请务必阅读。

<a id="common-open"></a>

### 怎么打开

> **推荐本地运行**。网页版的素材与 AI 引擎全靠网络下载，网速不稳时体验会明显打折，详见方式二。

**方式一：本地启动（推荐）**

```bash
git clone https://github.com/Schlampig/ChessCheers.git
cd ChessCheers
node tools/serve.js
```

浏览器会自动打开 <http://127.0.0.1:8766/>。

> 当前稳定版本为 [v1.0.1](https://github.com/Schlampig/ChessCheers/releases/latest)（Releases 页始终为最新版）。
> 想固定版本可 `git checkout v1.0.1`；不用 git 时，从该页下载源码包解压即可运行。

> ⚠️ **不要直接双击 `code/html/index.html`**。
> `file://` 协议下浏览器会拦截 Web Worker，AI 引擎起不来，你将只能看到棋盘而不能和机器对弈。
> 必须通过上面的 HTTP 方式访问。

**方式二：在线访问**

打开项目部署地址（形如 `https://<用户名>.github.io/ChessCheers/`）即可，无需安装任何东西。

> ⚠️ 网页版需要**网速流畅**才能畅玩：首次打开要下载棋盘、棋子预览图与 AI 引擎，
> 网络较差时可能要等十几秒，棋子动画会滞后，甚至**听得到语音却看不到动画**。
> 想稳定对弈请用方式一。

<a id="common-concepts"></a>

### 三个核心概念

| 概念 | 是什么 | 在哪里 |
|---|---|---|
| **阵营** | 一套棋子皮肤：6 种棋子 × 3 种状态的动画与语音，外加胜负结算插画 | `data/chesspiece/<阵营名>/` |
| **棋盘** | 一张正方形（严格 1:1）的图片 | `data/chessboard/<名字>.webp` |
| **棋谱** | 按国际象棋标准记谱法记录的走法，如 `1. e4 e5 2. Nf3` | 对弈页右侧边栏 |

---

<a id="part-player"></a>

## 第一部分：给玩家

<a id="player-map"></a>

### 页面地图

```
        ┌──────────────┐
        │   首页 index  │  选阵营 / 棋盘 / 模式 / 难度
        └──────┬───────┘
               │ 开始对局
               ▼
        ┌──────────────┐        ┌──────────────┐
        │  对弈页 game  │──结束──▶│ 结算页 result │
        └──────┬───────┘        └──────┬───────┘
               │ 退出                   │ 确认
               └──────────┬─────────────┘
                          ▼
                       回到首页
        ┌──────────────┐
        │ 了解更多 about │ ◀── 首页「了解更多」
        └──────────────┘
```

<a id="player-index"></a>

### 首页：配置你的对局

从上到下四张卡片，全部用下拉菜单选择。

#### ① 选择阵营

- 左边是**白方**的阵营，右边是**黑方**的阵营，各有一个「随机」选项
- 选好之后，下方会展开该阵营的文字介绍（如果素材作者写了 `阵营介绍.md`）
- 阵营数不足 2 个时，这里会显示 `Error：阵营人不齐！`，无法开局

#### ② 选择棋盘

- 列出 `data/chessboard/` 下所有**合格**（严格 1:1）的棋盘，默认选中「标准」
- 下方显示预览图与像素尺寸
- 如果有图片因为比例不对被跳过，会用黄字告诉你哪张、为什么

#### ③ 对局模式

- **人 vs 机**：与算法较量，会多出「执棋颜色」选项
  - 执白：你先走
  - 执黑：AI 先走，且棋盘会**自动翻转**，让你执的一方永远在屏幕下方
  - 随机：开局时决定
- **人 vs 人**：你自己操控黑白双方，此时没有难度可选

#### ④ 对弈难度

只在「人 vs 机」时出现，按 ELO 积分分七档，默认「600-1000：灵机一动」。

| 档位 | 名称 | 大致水平 |
|---|---|---|
| 500 以下 | 初生牛犊 | 随机性较强，适合第一次玩 |
| 600–1000 | 灵机一动 | 会看几步棋 |
| 1100–1500 | 激流勇进 | 有基本战术意识 |
| 1600–2000 | 福至心灵 | 接近业余好手 |
| 2100–2500 | 行云流水 | 接近专业水平 |
| 2600–3000 | 随心所欲 | 很强 |
| 3000 以上 | 返璞归真 | 最强档 |

配置下方的强度条会随选择变化。

#### 开始

点最下方的「开始对局」。也可以在顶部菜单点「来一局」，效果相同。

如果配置有问题（比如素材不够），顶部会弹出提示，不会跳转。

<a id="player-game"></a>

### 对弈页：怎么下棋

#### 走子

两种方式都支持：

- **点击**：先点自己的棋子（会高亮所有合法落点），再点目标格
- **拖拽**：按住棋子拖到目标格松开

规则完全遵循国际象棋标准。非法走法会让棋子「走一半再加速退回」，并提示「不能移动到那里！」。

> 任何棋子都能被选中观察（会播放选中动画），哪怕当前不能移动——方便你欣赏素材。

#### 特殊走法

王车易位、吃过路兵、兵升变都已实现。升变时会弹出选择框，选皇后/城堡/骑士/主教。

#### 右侧棋谱栏

棋盘右侧有个 `›` 箭头，点开是棋谱记录：

- 实时显示标准记谱法，最新一步高亮
- 下方三个按钮：**打印**（导出 TXT）/ **认输**（直接结束本局）/ **退出**（回首页，不保存）
- 再点右上角 `‹` 收起

#### 音效

棋盘右上角第一行的喇叭图标可以开关全部音效（默认开启）。

- 选棋子、落子、被吃都有对应语音
- 吃子时，被吃方与吃子方的动画和语音**同时**播放
- 结算时会自动播放对应结局的语音

> 浏览器有自动播放限制，如果结算语音没响，在页面上随便点一下就会补播。

#### 其他

- 顶部徽标显示双方阵营，轮到谁谁高亮
- 人机模式下 AI 思考时右下会出现「引擎思考中…」
- 人机执黑时，你的棋子永远在下方（棋盘上下翻转，坐标也随之变化）

<a id="player-result"></a>

### 结算页

对局结束会自动跳转。

- **人 vs 机**：你赢显示「恭喜获胜」，输显示「遗憾失败」，和棋显示「达成共识」
- **人 vs 人**：客观语气，如「恭喜，白方获胜」

画面会用当前阵营对应结局的插画（胜负和三种）铺满，并配上专属语音。

三个按钮：

| 按钮 | 作用 |
|---|---|
| 再来一盘 | 沿用本局所有配置（阵营/棋盘/难度/执色）立刻重开 |
| 打印 | 导出 TXT，含打印时间、对局配置、完整棋谱、结算文案 |
| 确认 | 回到首页 |

<a id="player-about"></a>

### 了解更多

顶部菜单的「了解更多」是一个 Markdown 文档页，右上角 `CN | EN` 可切换中英文。

左侧目录可折叠，点击目录项跳转到对应段落。

<a id="player-faq"></a>

### 常见问题

**Q：双击 html 文件打开，AI 不动？**
`file://` 下浏览器禁止 Web Worker。请用 `node tools/serve.js` 或任意 HTTP 服务器。

**Q：没有声音？**
先点一下页面（解锁音频），再检查右上角喇叭是否被关掉。

**Q：为什么我放的棋盘没出现在下拉里？**
棋盘必须是严格 1:1 的正方形。启动服务时终端会打印被跳过的原因，首页也有黄字提示。

**Q：为什么我放的阵营没出现在下拉里？**
需要 `King`、`Queen`、`Bishop`、`Knight`、`Rook`、`Pawn` 六个文件夹齐全，且每个里至少有一张视觉素材（webm/gif/png/jpg）。

**Q：AI 走得太慢/太快？**
难度越高，搜索越深、思考越久。低难度约 0.7 秒，最高难度约 2 秒。

---

<a id="part-dev"></a>

## 第二部分：给开发者

<a id="dev-stack"></a>

### 技术栈

| 层 | 选型 | 约束 |
|---|---|---|
| 规则 | Chess.js 0.10 | 该版本**没有** `board()` 方法，用 `get(square)` 代替 |
| AI | Stockfish WASM | 跑在 Web Worker，UCI 协议通信 |
| 前端 | HTML5 / CSS3 / 原生 JS | **ES5 语法**：不用箭头函数、`let/const`、模板字符串、`async/await` |
| 构建 | 无 | 改完直接刷新，没有打包步骤 |
| 部署 | GitHub Pages | 纯静态 |

代码风格约定：单函数 ≤ 30 行；IIFE 封装避免全局污染；核心逻辑写简短注释。

<a id="dev-layout"></a>

### 项目结构

```
ChessCheers/
├── index.html                  # 部署入口，meta refresh 跳到 code/html/index.html
├── .nojekyll                   # 关闭 GitHub Pages 的 Jekyll 处理
├── AGENTS.md                   # 给 AI 编码助手的项目约定
├── README.md                   # 项目介绍（英文版在 doc/README_en.md）
│
├── code/
│   ├── html/                   # index / game / result / about
│   ├── css/                    # 与页面一一对应，无共用样式文件
│   ├── js/
│   │   ├── assets.js           # 【生成物】素材清单，勿手改
│   │   ├── asset-loader.js     # 素材查询、棋子 DOM 构建、音效、logo
│   │   ├── stockfish-engine.js # Worker 封装、UCI 解析、难度映射
│   │   ├── index.js            # 首页：配置校验与跳转
│   │   ├── game.js             # 对弈页：渲染 / 动画 / 交互 / AI
│   │   ├── result.js           # 结算页：文案、素材、导出
│   │   ├── about.js            # 了解更多：Markdown 解析 + 目录
│   │   ├── chess.min.js        # 第三方：Chess.js
│   │   └── stockfish.wasm(.js) # 第三方：Stockfish
│   └── test/                   # CDP 自动化测试
│
├── data/
│   ├── chessboard/             # 棋盘图片
│   ├── chesspiece/             # 阵营素材
│   ├── chesslogo/              # 项目 logo
│   └── others/                 # 文档用示意图
│
├── doc/
│   ├── PRD.md                  # 项目设计方案
│   ├── UserGuide.md            # 本文（英文版 UserGuide_en.md）
│   ├── README_en.md            # README 英文版
│   └── intro/                  # 「了解更多」页面读取的中英文文档
│
└── tools/
    ├── serve.js                # 本地服务器（启动时自动扫描素材）
    ├── serve.command           # macOS 双击启动
    ├── scan-assets.js          # 素材扫描与规范检查，生成 assets.js
    ├── optimize-assets.py      # 图片转 webp、语音转 m4a（可选）
    ├── make-posters.js         # 生成棋子静止态预览图（可选）
    └── bump-version.js         # 批量更新静态资源版本号
```

<a id="dev-arch"></a>

### 代码架构与数据流

#### 为什么需要「素材清单」

纯静态站点**无法在运行时列举目录**（没有 `readdir`，也拿不到服务器目录索引）。
所以素材列表必须在启动/部署前扫描生成，写进 `code/js/assets.js`，页面再从这个 JS 变量读取。

```
data/ 目录
   │  node tools/scan-assets.js
   ▼
code/js/assets.js  (window.CHESS_ASSETS = { camps, boards, logo, ... })
   │
   ├── index.js     → 填下拉框、显示阵营介绍、校验配置
   ├── game.js      → 决定加载哪套棋子/棋盘素材
   └── result.js    → 决定结算插画与语音用哪个阵营
```

`assets.js` 是**生成物**，不要手动编辑；改素材后重新扫描即可。

#### 四个页面各自的职责

| 文件 | 职责 | 关键函数 |
|---|---|---|
| `index.js` | 读清单渲染配置项、校验、拼 URL 跳转 | `renderCamps` / `renderBoards` / `buildGameUrl` |
| `game.js` | 棋盘渲染、拖拽/点击、动画编排、AI 调度、棋谱 | `renderPieces` / `runMove` / `maybeTriggerAI` / `finishGame` |
| `result.js` | 胜负文案、结算素材与语音、TXT 导出、再来一盘 | `buildText` / `loadAsset` / `printRecord` |
| `about.js` | Markdown 逐行解析、目录生成、中英切换 | `parseMarkdown` / `generateToc` / `loadDocument` |

#### 对弈页的分层

`game.js` 内部按职责分层，读代码时建议按这个顺序：

```
几何     colOf / rowOf / viewCol / viewRow / placeAt / squareFromPoint
渲染     renderBoardBg / renderCoords / renderPieces / renderContextMarks
动画     runMove → slideThenCommit → commitMove → playImpactFx
交互     onPointerDown / onPointerMove / onPointerUp / requestMove
AI       initEngine / maybeTriggerAI / uciToMove
UI 控制  updateMoveList / updateTurnBadge / toggleSound / printRecord
结算     evaluateNext / finishGame / playKingCapture / goResult
```

**视角翻转**：`isFlipped()` 只在「人机 + 玩家执黑」时为真。翻转只影响呈现层（`placeAt`、`squareFromPoint`、坐标标签、棋盘背景旋转），规则层始终使用标准格号。新增任何涉及坐标的代码，都必须经过 `viewCol` / `viewRow`。

#### 页面之间的参数契约

首页 → 对弈页（URL 参数）：

```
game.html?wf=<白方阵营>&bf=<黑方阵营>&board=<棋盘名>&mode=pve|pvp[&elo=<分数>][&side=white|black|random]&v=<版本号>
```

对弈页 → 结算页：完整对局数据写入 `sessionStorage`（键名 `chesscheers_last_game`），
URL 只带 `outcome` 等少量参数作为兜底。**改任何一方都要同步另一边。**

#### 引擎

`stockfish-engine.js` 用一层 Worker 直连 `stockfish.wasm.js`，走 UCI 协议：

- `uci` → 等 `uciok` → `setoption` → `isready` → 等 `readyok` → 就绪
- 每步：`position fen <fen>` + `go depth <n>`
- 收到 `bestmove` 后按档位补足最短思考时长，再回调

难度表在 `ELO_LEVELS`，同时控制搜索深度、Skill Level 与最短思考时间。

<a id="dev-assets"></a>

### 素材规范

#### 棋盘

- 格式：`png` / `jpg` / `jpeg` / `webp`
- 长宽比：**严格 1:1**（容差 1%），否则会被判定不合格并跳过
- 命名：无限制，文件名（去扩展名）即下拉选项名
- 建议长边 ≤ 1024。若同时提供 `<名字>-mini.webp`，首页预览会用它（几十 KB），
  下拉框旁边不会再拉原图

#### 阵营

```
data/chesspiece/<阵营名>/
├── King/  Queen/  Bishop/  Knight/  Rook/  Pawn/    # 六个都必须存在
│   ├── 选中.webm    # 或 .gif / .png / .jpg / .jpeg / .webp
│   ├── 选中.wav     # 可选：.wav / .m4a / .mp3 / .ogg
│   ├── 落子.webm
│   ├── 落子.wav
│   ├── 被吃.webm
│   ├── 被吃.wav
│   └── 预览.webp    # 可选：静止态首帧，由 tools/make-posters.js 生成
├── 结算动画/                                        # 可选
│   ├── win/     赢棋.png + 赢棋.wav
│   ├── lose/    输棋.png + 输棋.wav
│   └── draw/    和棋.png + 和棋.wav
└── 阵营介绍.md                                      # 可选，选该阵营时展示
```

**合格判定**：六个棋子目录齐全，且每个至少有一张视觉素材。
不满足的阵营不会进入下拉，终端与首页会给缺失清单。

**状态映射**（`scan-assets.js` 的 `mapStates`）：

1. 优先按文件名前缀匹配 `选中` / `落子` / `被吃`
2. 匹配不上按文件名排序依次分配
3. 数量不足时循环复用

写代码时如果新增状态，要同时改 `STATES` 与 `asset-loader` 里的 `STATE_LABELS`。

#### 为什么要有「预览.webp」

棋子静止时，如果直接用 `<video preload="auto">` 展示首帧，棋盘上 32 个棋子会同时
下载几十 MB 视频——弱网下根本进不了对局。`tools/make-posters.js` 把每个棋子的
`选中.webm` 首帧截成 192px 的 `预览.webp`（含透明通道，单个 4~7KB），
页面静止态只加载它，视频只在真正播动画时才按需下载。

没有预览图也能正常运行，只是会退回视频首帧方案。**新增阵营后建议补跑一次**：

```bash
node tools/make-posters.js
```

#### 结算素材

三个结局各自独立，缺失时不会报错，只是结算页退回灰色简洁弹窗（无插画、无语音）。

图片建议 16:9 横图：结算页按此比例铺开，`object-fit: cover` 只裁掉极窄的边。

#### Logo

`data/chesslogo/` 下放一张名字含 `logo` 的图片即可用于首页展示与网页图标。
若同时提供带尺寸后缀的版本（如 `-128`），会优先用它作 favicon，避免每页加载大图。

<a id="dev-workflow"></a>

### 本地开发流程

```bash
node tools/serve.js          # 起服务，自动扫描素材，带规范检查报告
```

改完代码直接刷新浏览器。**但注意**：页面里的 css/js 引用带版本号 `?v=...`，
改了前端资源后要执行一次：

```bash
node tools/bump-version.js
```

它会把 5 个 HTML 的 `?v=` 与 3 个 JS 里的 `BUILD` 常量刷成同一个新值。
忘了这一步，浏览器可能继续用旧缓存，表现为「改了没生效」。

素材变了：

```bash
node tools/scan-assets.js    # 手动扫描（用 serve.js 时启动会自动跑）
```

### 素材瘦身（发布前必做）

网页版的瓶颈几乎总是素材体积而不是代码：原始素材动辄几十 MB，弱网下首屏根本打不开。
新增或替换素材后，按顺序跑：

```bash
python3 tools/optimize-assets.py   # 棋盘/结算图转 webp、语音转 m4a（需 Pillow）
node tools/make-posters.js         # 从「选中.webm」截首帧生成 预览.webp（需 Chrome）
node tools/scan-assets.js          # 重新生成清单
node tools/bump-version.js         # 刷新资源版本号
```

- 棋盘建议长边 ≤ 1024、结算图 ≤ 1600；`optimize-assets.py` 会顺带生成首页用的 `-mini` 缩略图
- `预览.webp` 是**棋子静止态**用的首帧图（每个几 KB）。没有它，棋盘上 32 个棋子会各自
  拉一段完整视频，首屏从几百 KB 变成几十 MB——这是网页版卡顿最常见的原因
- 原始文件建议先备份（仓库里默认放在 `.assets-original/`，已被 gitignore）

<a id="dev-test"></a>

### 测试

需要本机装有 Google Chrome，先起服务，再跑：

```bash
node code/test/cdp-check.js    # 对弈页：走子/AI/吃子/易位/过路兵/升变/非法退回/拖拽/翻转/结局
node code/test/cdp-index.js    # 首页：下拉填充/介绍/模式联动/跳转参数
node code/test/cdp-result.js   # 结算页：胜负判定/素材/按钮/打印/再来一盘
```

三个脚本都会启动 headless Chrome，通过 CDP 真实操作页面并断言结果。
端口默认 `8766`，可用 `CC_BASE=http://127.0.0.1:8080` 覆盖。

<a id="dev-deploy"></a>

### 发布网页版

把项目发布成可在浏览器直接访问的网址是**可选步骤**：只在自己电脑上玩，本地启动就够了。
如果希望分享给朋友，或者自己换台设备也能玩，可以按照下面的步骤部署到你自己的 GitHub Pages。

1. 把仓库推送到**你自己的** GitHub 账号
2. 进入仓库 → Settings → Pages → Source 选 `main` 分支、根目录
3. 等待约 1 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

注意事项：

- 部署前执行一次 `node tools/scan-assets.js`，确保素材清单与素材一致
- 根目录 `index.html` 负责跳转，`.nojekyll` 关闭 Jekyll（否则下划线开头的文件会被忽略）
- 页面与素材全部使用相对路径，部署到子目录（`/仓库名/`）也能正常工作

<a id="dev-boundary"></a>

### 可以改什么 / 不要动什么

#### 放心改

- `code/css/` —— 样式随你
- `code/js/index.js`、`result.js`、`about.js` —— 页面逻辑
- `code/js/game.js` —— 对弈核心（改动前建议先跑测试）
- `code/html/` —— 结构与文案
- `tools/` —— 工具脚本

#### 谨慎改

- `code/js/asset-loader.js` —— 改素材解析规则会影响全部页面
- `code/js/stockfish-engine.js` —— 改通信协议要考虑 Worker 的异步特性
- `code/js/assets.js` —— **不要手改**，它是 `scan-assets.js` 生成的

#### 不要动

- `data/` —— 素材本身。要加素材请新增目录，不要改动已有文件
- `doc/intro/` —— 「了解更多」页面运行时读取，删改会导致该页空白
- `code/js/chess.min.js`、`stockfish.wasm*` —— 第三方库，替换需自行验证兼容性

<a id="dev-pitfalls"></a>

### 常见坑

| 现象 | 原因 |
|---|---|
| AI 不走棋 | 用 `file://` 打开了页面，Worker 被拦截 |
| 改了 JS 没生效 | 忘了 `node tools/bump-version.js`，浏览器用了旧缓存 |
| 新素材不出现在下拉 | 忘了重新扫描；或素材不合格（看终端报告） |
| 棋盘格子颜色错位 | 只翻转了棋子没翻转棋盘背景，检查 `renderBoardBg` 与 `isFlipped` |
| 结算页标题不对 | `outcome` 与 `winner` 不一致，检查 `result.js` 的 `loadState` |
| 手机端布局溢出 | 用 `--window-size` 截图会误判，需用 CDP 的设备模拟验证 |

---

<a id="license"></a>

## 许可与声明

- **代码**：本项目仅供学习与交流，严禁商业用途。转载请注明出处。
- **第三方库**：
  - [Chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause
  - [Stockfish](https://github.com/official-stockfish/Stockfish) — GPL-3.0
  - [stockfish.wasm](https://github.com/lichess-org/stockfish.wasm) — GPL-3.0
- **素材（`data/` 目录）**：棋子立绘、配音等来自《明日方舟》同人创作与 [PRTS 中文维基](https://prts.wiki/)，版权归原权利方所有，**仅用于个人学习与非商业展示**。如有侵权，请通过 issue 联系，作者将立即下架相关素材。
- 本项目与上海鹰角网络科技有限公司无关。

### 引用规范

欢迎引用该项目，或基于该项目进行其他创作，引用格式如下：

- 项目名称：ChessCheers
- 项目地址：https://github.com/Schlampig/ChessCheers
- 项目作者：猪猪熊(PigPigBear/Kuyiking)
- 作者链接：https://github.com/Schlampig

---

<div align="center">
<sub>ChessCheers · 作者 <a href="https://github.com/Schlampig">PigPigBear</a></sub>
</div>
