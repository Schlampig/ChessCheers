# ChessCheers User Guide

[中文](UserGuide.md) | **English**

> This guide has two parts: **Part 1 is for players**, **Part 2 is for developers** who want to modify the code or build on it.
> The common section at the beginning is recommended for both.

## Contents

- [Common](#common)
  - [What this is](#common-what)
  - [How to open it](#common-open)
  - [Three key concepts](#common-concepts)
- [Part 1: For Players](#part-player)
  - [Page map](#player-map)
  - [Home: configure your game](#player-index)
  - [Game page: how to play](#player-game)
  - [Result page](#player-result)
  - [About](#player-about)
  - [FAQ](#player-faq)
- [Part 2: For Developers](#part-dev)
  - [Tech stack](#dev-stack)
  - [Project layout](#dev-layout)
  - [Architecture and data flow](#dev-arch)
  - [Asset specification](#dev-assets)
  - [Local development](#dev-workflow)
  - [Testing](#dev-test)
  - [Publishing a web version](#dev-deploy)
  - [What you can change / what to leave alone](#dev-boundary)
  - [Common pitfalls](#dev-pitfalls)
- [License and notices](#license)

---

<a id="common"></a>

## Common

<a id="common-what"></a>

### What this is

ChessCheers is a chess application that runs in the browser, with two modes:

- **Human vs AI**: play against the Stockfish engine, with adjustable difficulty
- **Human vs Human**: two players share one device, taking turns — handy for setting up positions and practising

**First and foremost, it is a fan game.** The piece artwork and voice lines come from the mobile game [*Arknights*](https://ak.hypergryph.com/). The author built it out of a love for that game and for chess; it is not affiliated with the official rights holders in any way. Under the hood, move calculation is powered by the chess engine [Stockfish](https://stockfishchess.org/), and move validation is handled by Chess.js.

**Second, it is a generic framework.** Pieces and boards all come from asset files under `data/`. In principle, as long as you follow the specification and replace the images, animations and audio, you can put any custom characters and boards into the game — your own IP, original characters, or plain geometric pieces.

> For copyright ownership and usage restrictions, see [License and notices](#license). Please read it before using or distributing anything.

<a id="common-open"></a>

### How to open it

> **Running locally is recommended.** The web version downloads both the assets and the AI engine;
> on an unstable connection the experience suffers a lot — see Option 2.

**Option 1: Run locally (recommended)**

```bash
git clone https://github.com/Schlampig/ChessCheers.git
cd ChessCheers
node tools/serve.js
```

Your browser will open <http://127.0.0.1:8766/> automatically.

> The current stable version is [v1.0.1](https://github.com/Schlampig/ChessCheers/releases/latest) (the Releases page always has the newest build).
> To pin it, run `git checkout v1.0.1`; without git, download the source archive from that page and run it.

> ⚠️ **Do not double-click `code/html/index.html`.**
> Under the `file://` protocol, browsers block Web Workers, so the AI engine cannot start — you will see the board but cannot play against the machine.
> You must access it over HTTP as shown above.

**Option 2: Online**

Open the deployment URL (of the form `https://<username>.github.io/ChessCheers/`). Nothing to install.

> ⚠️ The web version needs a **decent connection** to be enjoyable: the first visit downloads the
> board, the piece posters and the AI engine. On a slow link it may take ten-plus seconds, animations
> lag behind, and you may even hear the voice line without seeing the animation.
> For stable play, use Option 1.

<a id="common-concepts"></a>

### Three key concepts

| Concept | What it is | Where |
|---|---|---|
| **Faction** | A piece skin: animations and voice lines for 6 piece types × 3 states, plus win/lose/draw artwork | `data/chesspiece/<faction>/` |
| **Board** | A single square image (strictly 1:1) | `data/chessboard/<name>.webp` |
| **Move list** | Standard algebraic notation of the game, e.g. `1. e4 e5 2. Nf3` | Right sidebar on the game page |

---

<a id="part-player"></a>

## Part 1: For Players

<a id="player-map"></a>

### Page map

```
        ┌──────────────┐
        │  Home index  │  faction / board / mode / difficulty
        └──────┬───────┘
               │ Start game
               ▼
        ┌──────────────┐        ┌──────────────┐
        │  Game page   │──ends──▶│ Result page  │
        └──────┬───────┘        └──────┬───────┘
               │ Quit                   │ Confirm
               └──────────┬─────────────┘
                          ▼
                     Back to home
        ┌──────────────┐
        │ About page    │ ◀── "Learn more" on home
        └──────────────┘
```

<a id="player-index"></a>

### Home: configure your game

Four cards from top to bottom, all using dropdown menus.

#### 1. Choose factions

- The left dropdown is the **white** faction, the right one is **black**; each has a "random" option
- Once selected, the faction's description appears below (if the asset author provided `阵营介绍.md`)
- If fewer than 2 factions are available, the area shows `Error：阵营人不齐！` and you cannot start

#### 2. Choose a board

- Lists every **valid** board (strictly 1:1) under `data/chessboard/`, defaulting to "标准"
- A preview and pixel dimensions are shown below
- If an image was skipped due to a bad aspect ratio, a yellow note tells you which one and why

#### 3. Game mode

- **Human vs AI**: adds a "your side" option
  - White: you move first
  - Black: the AI moves first, and the board **flips automatically** so your side is always at the bottom
  - Random: decided at the start
- **Human vs Human**: you control both sides; difficulty is hidden

#### 4. Difficulty

Only shown in Human vs AI mode. Seven tiers by ELO, defaulting to "600-1000: 灵机一动".

| Tier | Name | Roughly |
|---|---|---|
| Under 500 | 初生牛犊 | Quite random, good for a first game |
| 600–1000 | 灵机一动 | Looks a few moves ahead |
| 1100–1500 | 激流勇进 | Basic tactical awareness |
| 1600–2000 | 福至心灵 | Close to a strong amateur |
| 2100–2500 | 行云流水 | Near expert level |
| 2600–3000 | 随心所欲 | Very strong |
| Above 3000 | 返璞归真 | Strongest tier |

The strength bar below the menu updates with your choice.

#### Start

Click "开始对局" at the bottom, or "来一局" in the top menu — both do the same thing.

If the configuration is invalid (for example, not enough assets), a toast appears and nothing happens.

<a id="player-game"></a>

### Game page: how to play

#### Moving pieces

Both interaction styles are supported:

- **Click**: click your piece (all legal destinations are highlighted), then click the target square
- **Drag**: press and drag the piece onto the target square

Rules follow standard chess. An illegal move makes the piece slide halfway and snap back, with a "不能移动到那里！" toast.

> Any piece can be selected just to look at it (the select animation plays), even if it cannot move — so you can enjoy the artwork.

#### Special moves

Castling, en passant and promotion are all implemented. Promotion opens a picker for queen / rook / knight / bishop.

#### Move list sidebar

There is a `›` arrow on the right edge of the board. Click it to open the move list:

- Standard notation, with the latest move highlighted
- Three buttons below: **Print** (export TXT) / **Resign** (end the game) / **Quit** (back to home, nothing saved)
- Click `‹` at the top-right to collapse it

#### Sound

The speaker icon in the board's top-right corner toggles all audio (on by default).

- Selecting, moving and capturing each have their own voice line
- On a capture, both the captured and the capturing side play their animation and voice **simultaneously**
- The result screen plays the corresponding ending voice automatically

> Browsers restrict autoplay. If the ending voice does not play, click anywhere on the page once and it will be retried.

#### Misc

- The badges at the top show both factions; the side to move is highlighted
- In Human vs AI mode, "引擎思考中…" appears in the corner while the AI thinks
- When you play black against the AI, your pieces stay at the bottom (the board is flipped, and coordinates flip with it)

<a id="player-result"></a>

### Result page

Opens automatically when the game ends.

- **Human vs AI**: shows "恭喜获胜" if you win, "遗憾失败" if you lose, "达成共识" for a draw
- **Human vs Human**: neutral phrasing, e.g. "恭喜，白方获胜"

The screen is filled with the winning/losing/drawing artwork of the relevant faction, along with its voice line.

Three buttons:

| Button | Effect |
|---|---|
| 再来一盘 | Restart immediately with the same setup (factions / board / difficulty / side) |
| 打印 | Export a TXT with timestamp, game setup, full move list and the result text |
| 确认 | Back to home |

<a id="player-about"></a>

### About

"了解更多" in the top menu opens a Markdown page. The `CN | EN` switch in the top-right toggles Chinese and English.

The left-hand table of contents can be collapsed; clicking an entry jumps to that section.

<a id="player-faq"></a>

### FAQ

**Q: I opened the HTML file directly and the AI does not move.**
Browsers block Web Workers under `file://`. Use `node tools/serve.js` or any HTTP server.

**Q: No sound?**
Click the page once (to unlock audio), then check that the speaker icon is not muted.

**Q: Why is my board missing from the dropdown?**
Boards must be strictly 1:1 (square). The terminal prints the reason on startup, and the home page shows a yellow note.

**Q: Why is my faction missing from the dropdown?**
It needs all six folders — `King`, `Queen`, `Bishop`, `Knight`, `Rook`, `Pawn` — and each must contain at least one visual asset (webm/gif/png/jpg).

**Q: The AI is too slow / too fast.**
Higher difficulty means deeper search and longer thinking. Low tiers take about 0.7s, the highest about 2s.

---

<a id="part-dev"></a>

## Part 2: For Developers

<a id="dev-stack"></a>

### Tech stack

| Layer | Choice | Constraint |
|---|---|---|
| Rules | Chess.js 0.10 | This version has **no** `board()` method; use `get(square)` |
| AI | Stockfish WASM | Runs in a Web Worker, speaks UCI |
| Frontend | HTML5 / CSS3 / vanilla JS | **ES5 only**: no arrow functions, `let/const`, template literals, `async/await` |
| Build | None | Edit and refresh, no bundling step |
| Deploy | GitHub Pages | Pure static hosting |

Code style: functions ≤ 30 lines; wrap modules in IIFEs to avoid globals; short comments on core logic.

<a id="dev-layout"></a>

### Project layout

```
ChessCheers/
├── index.html                  # Deploy entry, meta-refresh to code/html/index.html
├── .nojekyll                   # Disables Jekyll on GitHub Pages
├── AGENTS.md                   # Conventions for AI coding assistants
├── README.md                   # Project overview (English copy in doc/README_en.md)
│
├── code/
│   ├── html/                   # index / game / result / about
│   ├── css/                    # One stylesheet per page, no shared file
│   ├── js/
│   │   ├── assets.js           # [generated] asset manifest, do not edit
│   │   ├── asset-loader.js     # asset lookup, piece DOM, audio, logo
│   │   ├── stockfish-engine.js # worker wrapper, UCI parsing, difficulty map
│   │   ├── index.js            # home: validation and navigation
│   │   ├── game.js             # game page: rendering / animation / input / AI
│   │   ├── result.js           # result page: copy, artwork, export
│   │   ├── about.js            # about page: markdown parser + TOC
│   │   ├── chess.min.js        # third-party: Chess.js
│   │   └── stockfish.wasm(.js) # third-party: Stockfish
│   └── test/                   # CDP automation tests
│
├── data/
│   ├── chessboard/             # board images
│   ├── chesspiece/             # faction assets
│   ├── chesslogo/              # project logo
│   └── others/                 # images used by documentation
│
├── doc/
│   ├── PRD.md                  # design document (Chinese)
│   ├── UserGuide.md            # this file (Chinese version)
│   ├── README_en.md            # English README
│   └── intro/                  # markdown read by the About page
│
└── tools/
    ├── serve.js                # local server (scans assets on start)
    ├── serve.command           # double-click launcher for macOS
    ├── scan-assets.js          # asset scan + validation, writes assets.js
    └── bump-version.js         # bumps static asset version numbers
```

<a id="dev-arch"></a>

### Architecture and data flow

#### Why an "asset manifest" is needed

A pure static site **cannot list directories at runtime** — there is no `readdir`, and no directory index from the server.
So the asset list must be generated before start-up or deployment, written into `code/js/assets.js`, and read from that JS variable by the pages.

```
data/ directory
   │  node tools/scan-assets.js
   ▼
code/js/assets.js  (window.CHESS_ASSETS = { camps, boards, logo, ... })
   │
   ├── index.js     → populate dropdowns, show faction intro, validate config
   ├── game.js      → decide which piece/board assets to load
   └── result.js    → decide which faction's ending artwork and voice to use
```

`assets.js` is **generated**; do not edit it by hand. Re-run the scan after changing assets.

#### Responsibilities of the four pages

| File | Responsibility | Key functions |
|---|---|---|
| `index.js` | Render config from the manifest, validate, build the URL | `renderCamps` / `renderBoards` / `buildGameUrl` |
| `game.js` | Board rendering, drag/click, animation orchestration, AI scheduling, move list | `renderPieces` / `runMove` / `maybeTriggerAI` / `finishGame` |
| `result.js` | Result copy, ending artwork and voice, TXT export, rematch | `buildText` / `loadAsset` / `printRecord` |
| `about.js` | Line-based markdown parsing, TOC generation, language switch | `parseMarkdown` / `generateToc` / `loadDocument` |

#### Layers inside the game page

`game.js` is layered by responsibility; read it in this order:

```
Geometry   colOf / rowOf / viewCol / viewRow / placeAt / squareFromPoint
Render     renderBoardBg / renderCoords / renderPieces / renderContextMarks
Animation  runMove → slideThenCommit → commitMove → playImpactFx
Input      onPointerDown / onPointerMove / onPointerUp / requestMove
AI         initEngine / maybeTriggerAI / uciToMove
UI         updateMoveList / updateTurnBadge / toggleSound / printRecord
Result     evaluateNext / finishGame / playKingCapture / goResult
```

**Board flipping**: `isFlipped()` is true only for "human vs AI + player is black". Flipping affects presentation only (`placeAt`, `squareFromPoint`, coordinate labels, board background rotation); the rules layer always uses standard square names. Any new coordinate-related code must go through `viewCol` / `viewRow`.

#### Parameters between pages

Home → game page (URL parameters):

```
game.html?wf=<white faction>&bf=<black faction>&board=<board name>&mode=pve|pvp[&elo=<score>][&side=white|black|random]&v=<build>
```

Game page → result page: the full game record is written to `sessionStorage` (key `chesscheers_last_game`); the URL carries only `outcome` and a few fallbacks. **Changing one side requires changing the other.**

#### Engine

`stockfish-engine.js` wraps a worker that talks directly to `stockfish.wasm.js` over UCI:

- `uci` → wait for `uciok` → `setoption` → `isready` → wait for `readyok` → ready
- Per move: `position fen <fen>` + `go depth <n>`
- After `bestmove`, it pads the elapsed time up to the tier's minimum thinking time, then calls back

The difficulty table lives in `ELO_LEVELS` and controls search depth, Skill Level and minimum thinking time together.

<a id="dev-assets"></a>

### Asset specification

#### Boards

- Format: `png` / `jpg` / `jpeg` / `webp`
- Aspect ratio: **strictly 1:1** (1% tolerance), otherwise it is rejected and skipped
- Naming: anything; the filename (without extension) becomes the dropdown label
- Keep the long edge ≤ 1024. If a `<name>-mini.webp` exists, the home page preview uses it
  (tens of KB) instead of the full image

#### Factions

```
data/chesspiece/<faction>/
├── King/  Queen/  Bishop/  Knight/  Rook/  Pawn/    # all six required
│   ├── 选中.webm    # or .gif / .png / .jpg / .jpeg / .webp
│   ├── 选中.wav     # optional: .wav / .m4a / .mp3 / .ogg
│   ├── 落子.webm
│   ├── 落子.wav
│   ├── 被吃.webm
│   ├── 被吃.wav
│   └── 预览.webp    # optional: idle first frame, generated by tools/make-posters.js
├── 结算动画/                                        # optional
│   ├── win/     赢棋.png + 赢棋.wav
│   ├── lose/    输棋.png + 输棋.wav
│   └── draw/    和棋.png + 和棋.wav
└── 阵营介绍.md                                      # optional, shown when selected
```

**Valid means**: all six piece folders exist and each contains at least one visual asset.
Factions that fail do not appear in the dropdown; the terminal and the home page list what is missing.

**State mapping** (`mapStates` in `scan-assets.js`):

1. Match by filename prefix: `选中` / `落子` / `被吃`
2. Unmatched states are filled in filename order
3. If there are fewer files than states, they are reused cyclically

If you add a new state in code, update both `STATES` and `STATE_LABELS` in `asset-loader`.

#### Why `预览.webp` exists

If the idle state used `<video preload="auto">` to show the first frame, 32 pieces would
download tens of megabytes at once — unusable on a slow connection. `tools/make-posters.js`
grabs the first frame of each `选中.webm` into a 192px `预览.webp` (alpha preserved,
4–7KB each). The board only loads those; videos are fetched on demand when an animation plays.

The site still works without posters — it simply falls back to the video first frame.
**Re-run it after adding a faction**:

```bash
node tools/make-posters.js
```

#### Ending artwork

The three outcomes are independent. Missing files do not cause errors — the result page simply falls back to a plain grey dialog (no artwork, no voice).

16:9 landscape images are recommended: the result page lays them out at that ratio, and `object-fit: cover` trims only a sliver.

#### Logo

Drop an image whose name contains `logo` into `data/chesslogo/`; it is used for the home page and the site icon.
If a size-suffixed variant (e.g. `-128`) is also present, it is preferred as the favicon to avoid loading a large image on every page.

<a id="dev-workflow"></a>

### Local development

```bash
node tools/serve.js          # start server, scan assets, print the validation report
```

Refresh the browser after editing. **But note**: css/js references carry a version query `?v=...`.
After changing frontend assets, run:

```bash
node tools/bump-version.js
```

It rewrites the `?v=` in all five HTML files and the `BUILD` constant in three JS files to the same new value. Skip this and the browser may keep serving the old cache — which looks like "my change did nothing".

When assets change:

```bash
node tools/scan-assets.js    # manual scan (serve.js does this on start)
```

### Slimming assets (do this before publishing)

On the web, the bottleneck is almost always asset size rather than code: raw assets easily reach
tens of MB and the first load simply never finishes on a slow link. After adding or replacing
assets, run these in order:

```bash
python3 tools/optimize-assets.py   # boards/endings → webp, voice → m4a (needs Pillow)
node tools/make-posters.js         # first frame of 选中.webm → 预览.webp (needs Chrome)
node tools/scan-assets.js          # regenerate the manifest
node tools/bump-version.js         # refresh the asset version query
```

- Keep boards ≤ 1024 px and ending artwork ≤ 1600 px on the long edge; `optimize-assets.py` also
  emits the `-mini` thumbnail used by the home page preview
- `预览.webp` is the **idle** first-frame image (a few KB each). Without it, the 32 pieces on the
  board each pull a full video: the first load goes from a few hundred KB to tens of MB — the most
  common cause of a sluggish web build
- Back up the originals first (the repo keeps them in `.assets-original/`, which is gitignored)

<a id="dev-test"></a>

### Testing

Google Chrome is required. Start the server first, then run:

```bash
node code/test/cdp-check.js    # game page: moves / AI / capture / castling / en passant / promotion / illegal move / drag / flip / result
node code/test/cdp-index.js    # home: dropdowns / intro / mode switching / URL parameters
node code/test/cdp-result.js   # result page: outcome / assets / buttons / print / rematch
```

All three launch headless Chrome and drive the real page over CDP, asserting the outcome.
The default port is `8766`, overridable with `CC_BASE=http://127.0.0.1:8080`.

<a id="dev-deploy"></a>

### Publishing a web version

Publishing the project as a browsable URL is **optional**: if you only play on your own machine, running it locally is enough.
If you want to share it with friends, or play from another device, deploy it to your own GitHub Pages:

1. Push the repository to **your own** GitHub account
2. Repository → Settings → Pages → Source: `main` branch, root directory
3. Wait about a minute, then open `https://<your-username>.github.io/<repo-name>/`

Notes:

- Run `node tools/scan-assets.js` once before deploying so the manifest matches the assets
- The root `index.html` handles the redirect; `.nojekyll` disables Jekyll (which would ignore files starting with an underscore)
- All pages and assets use relative paths, so deploying into a subdirectory (`/repo-name/`) works fine

<a id="dev-boundary"></a>

### What you can change / what to leave alone

#### Safe to change

- `code/css/` — styling is up to you
- `code/js/index.js`, `result.js`, `about.js` — page logic
- `code/js/game.js` — core gameplay (run the tests before and after)
- `code/html/` — markup and copy
- `tools/` — helper scripts

#### Change with care

- `code/js/asset-loader.js` — asset parsing rules affect every page
- `code/js/stockfish-engine.js` — protocol changes must respect worker asynchrony
- `code/js/assets.js` — **do not edit by hand**; it is generated by `scan-assets.js`

#### Leave alone

- `data/` — the assets themselves. Add new folders instead of modifying existing files
- `doc/intro/` — read at runtime by the About page; deleting or editing breaks that page
- `code/js/chess.min.js`, `stockfish.wasm*` — third-party libraries; replacing them requires your own verification

<a id="dev-pitfalls"></a>

### Common pitfalls

| Symptom | Cause |
|---|---|
| The AI never moves | Opened via `file://`, so the worker is blocked |
| JS changes have no effect | Forgot `node tools/bump-version.js`, browser served the old cache |
| A new asset is missing from the dropdown | Did not rescan, or the asset is invalid (check the terminal report) |
| Square colours are misaligned after flipping | Flipped the pieces but not the board background; check `renderBoardBg` and `isFlipped` |
| Wrong result title | `outcome` and `winner` disagree; check `loadState` in `result.js` |
| Layout overflows on mobile | `--window-size` screenshots are misleading; verify with CDP device emulation |

---

<a id="license"></a>

## License and notices

- **Code**: this project is provided for learning and exchange purposes only. Commercial use is strictly prohibited. Please credit the source when redistributing.
- **Third-party libraries**:
  - [Chess.js](https://github.com/jhlywa/chess.js) — BSD-2-Clause
  - [Stockfish](https://github.com/official-stockfish/Stockfish) — GPL-3.0
  - [stockfish.wasm](https://github.com/lichess-org/stockfish.wasm) — GPL-3.0
- **Assets (`data/`)**: piece artwork and voice lines come from *Arknights* fan works and the [PRTS Chinese wiki](https://prts.wiki/). Copyright belongs to the respective rights holders; they are used **for personal learning and non-commercial display only**. If anything infringes, please open an issue and the author will take down the relevant assets immediately.
- This project is not affiliated with Shanghai Hypergryph Network Technology Co., Ltd.

### Citation guidelines

You are welcome to cite this project, or to create other works based on it. Please use the following citation format:

- Project Name: ChessCheers
- Project URL: https://github.com/Schlampig/ChessCheers
- Project Author: PigPigBear (Kuyiking)
- Author Link: https://github.com/Schlampig

---

<div align="center">
<sub>ChessCheers · by <a href="https://github.com/Schlampig">PigPigBear</a></sub>
</div>
