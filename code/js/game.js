/**
 * ChessCheers — 对弈页主逻辑（code/html/game.html）
 *
 * 功能：渲染棋盘与棋子，处理点击/拖拽走子，编排走子与吃子动画，
 *       调度 Stockfish 走子，维护棋谱，并在终局时汇总结算数据。
 * 模块：几何 → 渲染 → 动画编排 → 交互 → AI → UI 控制 → 结算
 * 设计：
 *   - 规则层只认标准格号，展示层统一经 viewCol / viewRow 换算，
 *     因此「人机执黑翻转棋盘」不需要改动任何走子逻辑；
 *   - 动画采用「先平移、后落库」的顺序：棋子视觉先滑到目标格，
 *     再提交棋谱与重排 DOM，避免中途重绘造成跳变；
 *   - 所有交互入口都检查 state.locked 与 state.finished，
 *     防止 AI 思考或终局动画期间用户操作打乱局面。
 */
(function () {
    'use strict';

    var FILES = 'abcdefgh';
    var RANKS = '87654321';
    var CELL = 12.5;                 // 单格百分比
    var MOVE_MS = 300;               // 平移动画时长
    var DRAG_THRESHOLD = 4;          // 拖拽判定阈值（像素）
    var STORAGE_KEY = 'chesscheers_last_game';
    // 与 HTML 中静态资源版本号保持一致；跳转时携带，强制浏览器拉取最新页面
    var BUILD = '202611091759';

    // ---------- 运行时状态 ----------
    var state = {
        chess: null,
        mode: 'pve',
        playerColor: 'w',
        whiteCamp: '',
        blackCamp: '',
        board: '',
        elo: '600',
        sound: true,
        selected: null,
        selectedEl: null,
        locked: false,
        hintMoves: [],
        lastMove: null,
        finished: false,
        outcomeText: ''          // 结算文案，供打印棋谱使用（PRD 三.3 第3条）
    };

    var drag = { active: false, moved: false, startX: 0, startY: 0, pointerId: null };
    var dom = {};
    var promoteResolver = null;
    var fxGen = 0;               // 动画代次，用于丢弃过期收尾回调

    // ==================== 工具 ====================
    function $(id) { return document.getElementById(id); }

    function campOf(color) {
        return color === 'w' ? state.whiteCamp : state.blackCamp;
    }

    function colorName(color) {
        return color === 'w' ? '白' : '黑';
    }

    // ==================== 初始化 ====================
    function initDom() {
        dom.container = $('game-container');
        dom.boardInner = $('board-inner');
        dom.boardBg = $('board-bg');
        dom.markLayer = $('mark-layer');
        dom.pieceLayer = $('piece-layer');
        dom.fxLayer = $('fx-layer');
        dom.moveList = $('move-list');
        dom.toast = $('toast');
        dom.thinking = $('thinking');
        dom.sidebar = $('sidebar');
        dom.sidebarHandle = $('sidebar-handle');
        dom.soundBtn = $('sound-btn');
        dom.soundIcon = $('sound-icon');
        dom.badgeWhite = $('badge-white');
        dom.badgeBlack = $('badge-black');
        dom.coordCol = $('coord-col');
        dom.coordRow = $('coord-row');
        dom.modal = $('promotion-modal');
    }

    // 读取 URL 配置；缺省值退化为清单首项
    function readParams() {
        var params = {};
        var qs = window.location.search.substring(1);
        if (qs) {
            var pairs = qs.split('&');
            for (var i = 0; i < pairs.length; i++) {
                var kv = pairs[i].split('=');
                if (kv.length >= 2) {
                    params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
                }
            }
        }

        state.mode = params.mode === 'pvp' ? 'pvp' : 'pve';
        state.elo = params.elo || '600';
        state.whiteCamp = resolveCamp(params.wf, null);
        state.blackCamp = resolveCamp(params.bf, state.whiteCamp);
        state.board = resolveBoard(params.board);
        state.playerColor = resolveSide(params.side);
    }

    // 可用阵营名列表
    function campNames() {
        var camps = window.AssetLoader.getCamps();
        var out = [];
        for (var i = 0; i < camps.length; i++) out.push(camps[i].name);
        return out;
    }

    // 解析阵营：无效或 random 时随机，且尽量避开 exclude
    function resolveCamp(value, exclude) {
        var names = campNames();
        var pool = [];
        var i;
        for (i = 0; i < names.length; i++) {
            if (exclude && names[i] === exclude) continue;
            pool.push(names[i]);
        }
        if (!pool.length) pool = names;
        if (value && value !== 'random') {
            for (i = 0; i < names.length; i++) {
                if (names[i] === value) return value;
            }
        }
        if (!pool.length) return '';
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // 解析棋盘：无效时退回「标准」或首张
    function resolveBoard(value) {
        var boards = window.AssetLoader.getBoards();
        var i;
        if (value) {
            for (i = 0; i < boards.length; i++) {
                if (boards[i].name === value) return value;
            }
        }
        for (i = 0; i < boards.length; i++) {
            if (boards[i].name === '标准') return '标准';
        }
        return boards.length ? boards[0].name : '';
    }

    // 解析执棋颜色：random 时随机
    function resolveSide(value) {
        if (value === 'white') return 'w';
        if (value === 'black') return 'b';
        return Math.random() < 0.5 ? 'w' : 'b';
    }

    // ==================== 几何 ====================
    function colOf(sq) { return FILES.indexOf(sq.charAt(0)); }
    function rowOf(sq) { return RANKS.indexOf(sq.charAt(1)); }

    // 视角翻转：仅人机对弈且玩家执黑时，让黑方位于屏幕下方。
    // 人 vs 人 不翻转——两名玩家共用一块屏幕，固定白方在下更贴合棋谱与记谱习惯。
    function isFlipped() {
        return state.mode === 'pve' && state.playerColor === 'b';
    }

    // 逻辑列/行 -> 视口列/行
    function viewCol(col) { return isFlipped() ? 7 - col : col; }
    function viewRow(row) { return isFlipped() ? 7 - row : row; }

    function squareAt(col, row) {
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        return FILES.charAt(col) + RANKS.charAt(row);
    }

    // 用百分比定位，天然跟随棋盘尺寸（含视角翻转）
    function placeAt(el, sq) {
        el.style.left = (viewCol(colOf(sq)) * CELL) + '%';
        el.style.top = (viewRow(rowOf(sq)) * CELL) + '%';
    }

    // 棋盘内坐标 -> 格号（含视角翻转）
    function squareFromPoint(clientX, clientY) {
        var rect = dom.boardInner.getBoundingClientRect();
        if (!rect.width) return null;
        var col = Math.floor((clientX - rect.left) / (rect.width / 8));
        var row = Math.floor((clientY - rect.top) / (rect.height / 8));
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        return squareAt(viewCol(col), viewRow(row));
    }

    // ==================== 局面查询 ====================
    function pieceAt(sq) {
        return state.chess.get(sq);
    }

    function legalMoves(from) {
        return state.chess.moves({ square: from, verbose: true });
    }

    function findMove(from, to, promotion) {
        var moves = legalMoves(from);
        for (var i = 0; i < moves.length; i++) {
            var m = moves[i];
            // 升变分支需匹配具体晋升棋子，否则会出现多选歧义
            if (m.promotion && promotion && m.promotion !== promotion) continue;
            if (!m.promotion && promotion) continue;
            if (m.from === from && m.to === to) return m;
        }
        return null;
    }

    function isPromotionMove(move) {
        return move.flags.indexOf('p') >= 0;
    }

    // ==================== 渲染 ====================
    function renderBoardBg() {
        var src = window.AssetLoader.getBoardPath(state.board);
        if (src) dom.boardBg.style.backgroundImage = 'url("' + src + '")';
        // 翻转视角时棋盘图案同步旋转 180°，保证格子颜色与棋子对位
        dom.boardBg.style.transform = isFlipped() ? 'rotate(180deg)' : '';
    }

    function renderCoords() {
        var flipped = isFlipped();
        var html = '';
        var i;
        // 左侧行号：翻转后自上而下为 1..8
        for (i = 0; i < 8; i++) html += '<span>' + (flipped ? (i + 1) : (8 - i)) + '</span>';
        dom.coordCol.innerHTML = html;
        html = '';
        // 底部列号：翻转后自左而右为 h..a
        for (i = 0; i < 8; i++) html += '<span>' + FILES.charAt(flipped ? 7 - i : i) + '</span>';
        dom.coordRow.innerHTML = html;
    }

    function createPieceEl(piece, sq) {
        var el = document.createElement('div');
        el.className = 'piece';
        el.setAttribute('data-square', sq);
        el.setAttribute('data-color', piece.color);
        el.setAttribute('data-type', piece.type);
        var visual = window.AssetLoader.createIdleVisual(
            campOf(piece.color), piece.type, piece.color === 'w' ? '#f5f7ff' : '#2b2f45'
        );
        el.appendChild(visual);
        placeAt(el, sq);
        return el;
    }

    // 全量重建棋子层（用于初始化与动画收尾兜底）
    function renderPieces() {
        dom.pieceLayer.innerHTML = '';
        var occupied = allSquares();
        for (var i = 0; i < occupied.length; i++) {
            var sq = occupied[i];
            var piece = pieceAt(sq);
            if (piece) dom.pieceLayer.appendChild(createPieceEl(piece, sq));
        }
    }

    function allSquares() {
        var out = [];
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < 8; c++) out.push(squareAt(c, r));
        }
        return out;
    }

    function pieceElAt(sq) {
        return dom.pieceLayer.querySelector('.piece[data-square="' + sq + '"]');
    }

    // ==================== 标记层 ====================
    function clearMarks() {
        dom.markLayer.innerHTML = '';
    }

    function addMark(sq, kind) {
        var el = document.createElement('div');
        el.className = 'mark ' + kind;
        placeAt(el, sq);
        dom.markLayer.appendChild(el);
    }

    function renderContextMarks() {
        clearMarks();
        if (state.lastMove) {
            addMark(state.lastMove.from, 'mark-last');
            addMark(state.lastMove.to, 'mark-last');
        }
        if (state.chess.in_check()) {
            addMark(kingSquare(state.chess.turn()), 'mark-check');
        }
    }

    function kingSquare(color) {
        var squares = allSquares();
        for (var i = 0; i < squares.length; i++) {
            var p = pieceAt(squares[i]);
            if (p && p.type === 'k' && p.color === color) return squares[i];
        }
        return null;
    }

    // ==================== 提示 ====================
    var toastTimer = null;

    function showToast(msg, kind) {
        dom.toast.textContent = msg;
        dom.toast.className = 'toast show' + (kind ? ' ' + kind : '');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            dom.toast.className = 'toast' + (kind ? ' ' + kind : '');
        }, 2200);
    }

    function setThinking(on) {
        dom.thinking.className = on ? 'thinking show' : 'thinking';
    }

    // ==================== 选中 ====================
    function stopSelectAnim(el) {
        if (!el) return;
        el.classList.remove('selected');
        var fx = el.querySelectorAll('.piece-video-fx');
        for (var i = 0; i < fx.length; i++) fx[i].parentNode.removeChild(fx[i]);
        var idle = el.querySelector('.piece-video:not(.piece-video-fx)');
        if (idle) idle.style.opacity = '';
    }

    // 选中：播放循环动画与语音，并高亮全部合法落点
    function selectSquare(sq) {
        clearSelection();
        var piece = pieceAt(sq);
        if (!piece) return false;

        state.selected = sq;
        state.hintMoves = legalMoves(sq);

        var el = pieceElAt(sq);
        if (!el) return false;
        state.selectedEl = el;
        el.classList.add('selected');

        renderContextMarks();
        markHints(sq);

        var camp = campOf(piece.color);
        var src = window.AssetLoader.getPieceAssetPath(camp, piece.type, 'select', false);
        var visual = el.querySelector('.piece-visual');
        if (src && visual) {
            var base = visual.querySelector('.piece-video:not(.piece-video-fx)');
            if (base) base.style.opacity = '0';
            window.AssetLoader.playVideoOnce(visual, src, true);
        }
        window.AssetLoader.playPieceSound(camp, piece.type, 'select');
        return true;
    }

    // 高亮起点与全部合法落点（吃子格用不同标记）
    function markHints(sq) {
        addMark(sq, 'mark-from');
        for (var i = 0; i < state.hintMoves.length; i++) {
            var m = state.hintMoves[i];
            addMark(m.to, pieceAt(m.to) ? 'mark-capture' : 'mark-move');
        }
    }

    // 仅为非行棋方棋子播放一次选中表现，不做落点提示
    function previewSelect(sq) {
        var piece = pieceAt(sq);
        if (!piece) return;
        clearSelection();
        var el = pieceElAt(sq);
        if (!el) return;

        el.classList.add('selected');
        var camp = campOf(piece.color);
        var visual = el.querySelector('.piece-visual');
        var src = window.AssetLoader.getPieceAssetPath(camp, piece.type, 'select', false);

        if (src && visual) {
            var base = visual.querySelector('.piece-video:not(.piece-video-fx)');
            if (base) base.style.opacity = '0';
            window.AssetLoader.playVideoOnce(visual, src, true, function () {
                el.classList.remove('selected');
                if (base) base.style.opacity = '';
                var fx = visual.querySelectorAll('.piece-video-fx');
                for (var i = 0; i < fx.length; i++) visual.removeChild(fx[i]);
            });
        }
        window.AssetLoader.playPieceSound(camp, piece.type, 'select');
    }

    function clearSelection() {
        stopSelectAnim(state.selectedEl);
        state.selectedEl = null;
        state.selected = null;
        state.hintMoves = [];
        clearMarks();
        renderContextMarks();
    }

    // ==================== 动画编排 ====================
    function fxCell(sq, zIndex) {
        var cell = document.createElement('div');
        cell.className = 'fx-cell';
        placeAt(cell, sq);
        if (zIndex) cell.style.zIndex = zIndex;
        dom.fxLayer.appendChild(cell);
        return cell;
    }

    function clearFx() {
        dom.fxLayer.innerHTML = '';
    }

    // 播放一次性棋子动画：不改变逻辑状态，仅做表现
    function playFx(sq, camp, type, kind, zIndex, done) {
        var src = window.AssetLoader.getPieceAssetPath(camp, type, kind, false);
        if (!src) { if (done) done(); return; }
        var cell = fxCell(sq, zIndex);
        window.AssetLoader.playVideoOnce(cell, src, false, done);
        window.AssetLoader.playPieceSound(camp, type, kind);
    }

    // ==================== 走子主流程 ====================
    // 能否操作某色棋子：必须是当前行棋方，且 PvE 下必须是玩家一方
    function canOperate(color) {
        if (color !== state.chess.turn()) return false;
        if (state.mode === 'pvp') return true;
        return color === state.playerColor;
    }

    // 统一的落子入口，负责合法性、升变询问与执行
    function requestMove(from, to) {
        if (state.locked || state.finished) return;
        var piece = pieceAt(from);
        if (!piece || !canOperate(piece.color)) return;

        var move = findMove(from, to);
        if (move && isPromotionMove(move)) {
            var opts = [];
            var all = legalMoves(from);
            for (var i = 0; i < all.length; i++) {
                if (all[i].to === to && all[i].promotion) opts.push(all[i].promotion);
            }
            if (opts.length > 1) { askPromotion(from, to); return; }
        }
        if (!move) { rejectMove(from, to); return; }
        clearSelection();
        runMove(move);
    }

    // 非法移动：平移至半程后加速沿原路退回（PRD 四.3 第5条）
    function rejectMove(from, to) {
        var el = pieceElAt(from);
        if (!el) { clearSelection(); return; }

        var mid = {
            left: (viewCol(colOf(from)) + viewCol(colOf(to))) / 2 * CELL,
            top: (viewRow(rowOf(from)) + viewRow(rowOf(to))) / 2 * CELL
        };

        // 上半程：正常速度走向目标
        el.style.transition = 'left .16s ease-out, top .16s ease-out';
        el.style.left = mid.left + '%';
        el.style.top = mid.top + '%';

        // 下半程：倍速退回原位
        setTimeout(function () {
            el.style.transition = 'left .1s ease-in, top .1s ease-in';
            placeAt(el, from);
            setTimeout(function () { el.style.transition = ''; }, 120);
        }, 170);

        showToast('不能移动到那里！', 'warn');
        clearSelection();
    }

    // 收集走法上下文：被吃子、吃过路兵、王车易位
    function buildContext(move) {
        var ctx = { move: move, captured: null, capSquare: null, rook: null };
        ctx.isPromotion = isPromotionMove(move);
        if (move.flags.indexOf('e') >= 0) {
            ctx.capSquare = move.to.charAt(0) + move.from.charAt(1);
        } else if (pieceAt(move.to)) {
            ctx.capSquare = move.to;
        }
        if (ctx.capSquare) {
            var victim = pieceAt(ctx.capSquare);
            if (victim) ctx.captured = { color: victim.color, type: victim.type, camp: campOf(victim.color) };
        }
        if (move.flags.indexOf('k') >= 0 || move.flags.indexOf('q') >= 0) {
            var rank = move.from.charAt(1);
            var kingside = move.flags.indexOf('k') >= 0;
            ctx.rook = {
                from: (kingside ? 'h' : 'a') + rank,
                to: (kingside ? 'f' : 'd') + rank
            };
        }
        return ctx;
    }

    // 执行走法：逻辑先行，动画后补（PRD 四.3 第10条）
    function runMove(move) {
        state.locked = true;
        clearFx();
        restoreVisuals();     // 清掉上一步残留动画，避免棋子透明卡住
        slideThenCommit(buildContext(move));
    }

    // 无过渡地归位，保证平移动画从格心开始
    function snapTo(el, sq) {
        el.classList.add('static');
        placeAt(el, sq);
        void el.offsetWidth;
        el.classList.remove('static');
    }

    // 第一步：被吃子退出、棋子平移到目标格
    function slideThenCommit(ctx) {
        var move = ctx.move;
        var el = pieceElAt(move.from);
        var rookEl = ctx.rook ? pieceElAt(ctx.rook.from) : null;

        // 先移除被吃子，避免与移动方争夺同一格
        if (ctx.captured) removeElAt(ctx.capSquare);
        if (el) {
            snapTo(el, move.from);
            el.setAttribute('data-square', move.to);
            el.style.zIndex = 60;
        }
        if (rookEl) {
            snapTo(rookEl, ctx.rook.from);
            rookEl.setAttribute('data-square', ctx.rook.to);
        }
        if (rookEl) placeAt(rookEl, ctx.rook.to);
        if (el) placeAt(el, move.to);

        setTimeout(function () { commitMove(ctx); }, MOVE_MS + 30);
    }

    function removeElAt(sq) {
        var el = pieceElAt(sq);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    // 第二步：提交规则引擎，并立即放行交互（PRD：棋局逻辑优先于动画）
    function commitMove(ctx) {
        var result = state.chess.move(ctx.move);
        if (!result) {
            state.locked = false;
            renderPieces();
            showToast('走法被规则拒绝', 'warn');
            return;
        }
        state.lastMove = { from: result.from, to: result.to };
        playImpactFx(ctx, result);
        updateMoveList();
        renderContextMarks();
        updateTurnBadge();

        state.locked = false;
        if (ctx.isPromotion) {
            renderPieces();          // 升变后类型已变，立即重建保持 DOM 与逻辑一致
            playPromotionArrival(result.to);
        } else {
            evaluateNext();
        }
    }

    // 落子/被吃/易位同时编排：吃子方层级在上、被吃方压在下方，
    // 避免两段动画互相遮挡，也让「谁吃谁」一眼可辨。
    function playImpactFx(ctx, result) {
        var pending = 1;
        var gen = ++fxGen;

        function done() {
            pending--;
            if (pending > 0) return;
            // 期间若已开始新一步，交由新动画负责清理
            if (gen !== fxGen) return;
            clearFx();
            restoreVisuals();
        }

        hideVisual(pieceElAt(result.to));
        if (ctx.captured) {
            pending++;
            playFx(ctx.capSquare, ctx.captured.camp, ctx.captured.type, 'capture', 1, done);
        }
        if (ctx.rook) {
            hideVisual(pieceElAt(ctx.rook.to));
            pending++;
            playFx(ctx.rook.to, campOf(result.color), 'r', 'drop', 3, done);
        }
        playFx(result.to, campOf(result.color), ctx.move.piece, 'drop', 2, done);
    }

    // 隐藏静态形象，交由动画层表达
    function hideVisual(el) {
        if (!el) return;
        var visual = el.querySelector('.piece-visual');
        if (visual) visual.style.opacity = '0';
    }

    // 清除动画期间设置的透明度与层级
    function restoreVisuals() {
        var list = dom.pieceLayer.querySelectorAll('.piece');
        for (var i = 0; i < list.length; i++) {
            list[i].style.opacity = '';
            list[i].style.zIndex = '';
            var visual = list[i].querySelector('.piece-visual');
            if (visual) visual.style.opacity = '';
        }
    }

    // ==================== 升变 ====================
    function askPromotion(from, to) {
        promoteResolver = { from: from, to: to };
        dom.modal.classList.add('show');
    }

    function resolvePromotion(type) {
        if (!promoteResolver) return;
        var pair = promoteResolver;
        promoteResolver = null;
        dom.modal.classList.remove('show');
        var move = findMove(pair.from, pair.to, type);
        if (move) { clearSelection(); runMove(move); }
    }

    function bindPromotion() {
        var btns = dom.modal.querySelectorAll('.promo-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function (e) {
                var target = e.currentTarget;
                resolvePromotion(target.getAttribute('data-piece'));
            });
        }
        dom.modal.addEventListener('click', function (e) {
            if (e.target === dom.modal) {
                promoteResolver = null;
                dom.modal.classList.remove('show');
            }
        });
    }

    // 升变抵达：播放新棋子选中动画一遍后归位（PRD 四.3 升变条）
    function playPromotionArrival(sq) {
        var piece = pieceAt(sq);
        if (!piece) { evaluateNext(); return; }
        hideVisual(pieceElAt(sq));
        var gen = fxGen;
        playFx(sq, campOf(piece.color), piece.type, 'select', 3, function () {
            if (gen !== fxGen) return;
            clearFx();
            restoreVisuals();
        });
        evaluateNext();
    }

    // ==================== 局势判定 ====================
    function evaluateNext() {
        if (state.chess.in_checkmate()) {
            finishGame(state.chess.turn() === 'w' ? 'black' : 'white', 'checkmate');
            return;
        }
        if (state.chess.in_draw() || state.chess.in_stalemate()) {
            finishGame(null, 'draw');
            return;
        }
        if (state.chess.in_check()) showToast('将军！', 'warn');
        maybeTriggerAI();
    }

    function maybeTriggerAI() {
        if (state.mode !== 'pve' || state.finished) return;
        if (state.chess.turn() === state.playerColor) return;
        setThinking(true);
        var fen = state.chess.fen();
        window.StockfishEngine.analyze(fen, state.elo, function (uci) {
            setThinking(false);
            if (!uci) { showToast('引擎未返回结果，请重试', 'warn'); state.locked = false; return; }
            var move = uciToMove(uci);
            if (!move) { showToast('引擎走法非法，请重试', 'warn'); state.locked = false; return; }
            runMove(move);
        });
    }

    // UCI 字符串 -> Chess.js 走法对象
    function uciToMove(uci) {
        var from = uci.substring(0, 2);
        var to = uci.substring(2, 4);
        var promo = uci.length > 4 ? uci.charAt(4) : null;
        var moves = legalMoves(from);
        for (var i = 0; i < moves.length; i++) {
            if (moves[i].to !== to) continue;
            if (promo && moves[i].promotion !== promo) continue;
            if (!promo && moves[i].promotion) continue;
            return moves[i];
        }
        return null;
    }

    // ==================== 结束与结算 ====================
    function finishGame(winner, reason) {
        if (state.finished) return;
        state.finished = true;
        state.locked = true;

        // 以玩家视角归纳结局（winner 为 'white'/'black'，playerColor 为 'w'/'b'）
        var outcome = 'draw';
        if (winner) {
            if (state.mode === 'pvp') {
                outcome = winner === 'white' ? 'whiteWin' : 'blackWin';
            } else {
                var playerSide = state.playerColor === 'w' ? 'white' : 'black';
                outcome = winner === playerSide ? 'win' : 'lose';
            }
        }
        persistResult(outcome, reason, winner);
        state.outcomeText = buildOutcomeText(outcome, winner);

        var tip = outcome === 'win' ? '将死！你赢了' : (outcome === 'lose' ? '被将死，遗憾落败' : '和棋');
        if (state.mode === 'pvp') tip = '对局结束';
        showToast(tip, outcome === 'win' ? 'good' : 'warn');

        // 将杀：先让被将死方的国王播放被吃动画，全部结束再进结算（PRD 四.3 第5条）
        if (reason === 'checkmate' && winner) {
            playKingCapture(winner === 'white' ? 'b' : 'w', goResult);
        } else {
            setTimeout(goResult, 1400);
        }
    }

    // 将杀收尾：国王播放被吃动画与语音
    function playKingCapture(loserColor, done) {
        var ksq = kingSquare(loserColor);
        if (!ksq) { setTimeout(done, 800); return; }
        hideVisual(pieceElAt(ksq));
        playFx(ksq, campOf(loserColor), 'k', 'capture', 4, function () {
            clearFx();
            restoreVisuals();
            setTimeout(done, 700);
        });
    }

    function resignGame() {
        if (state.finished) return;
        state.finished = true;
        state.locked = true;
        // 认输：行棋方判负，对手获胜（winner 统一用 'white'/'black'）
        var winner = state.chess.turn() === 'w' ? 'black' : 'white';
        var outcome = 'lose';
        if (state.mode === 'pvp') {
            outcome = winner === 'white' ? 'whiteWin' : 'blackWin';
        } else {
            var playerSide = state.playerColor === 'w' ? 'white' : 'black';
            outcome = winner === playerSide ? 'win' : 'lose';
        }
        persistResult(outcome, 'resign', winner);
        state.outcomeText = buildOutcomeText(outcome, winner);
        showToast('认输，本局结束', 'warn');
        setTimeout(goResult, 1100);
    }

    // 结算数据落盘，避免棋谱撑爆 URL
    function persistResult(outcome, reason, winner) {
        var payload = {
            outcome: outcome,
            reason: reason,
            winner: winner,
            mode: state.mode,
            side: state.playerColor,
            wf: state.whiteCamp,
            bf: state.blackCamp,
            board: state.board,
            elo: state.elo,
            san: state.chess.history(),
            pgn: state.chess.pgn(),
            finished: true
        };
        try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('[game] 结算数据写入失败', e);
        }
    }

    function goResult() {
        var url = 'result.html?outcome=' + encodeURIComponent(readOutcomeCache()) +
            '&wf=' + encodeURIComponent(state.whiteCamp) +
            '&bf=' + encodeURIComponent(state.blackCamp) +
            '&mode=' + state.mode +
            '&elo=' + encodeURIComponent(state.elo) +
            '&v=' + BUILD;
        window.location.href = url;
    }

    function readOutcomeCache() {
        try {
            var raw = window.sessionStorage.getItem(STORAGE_KEY);
            return raw ? (JSON.parse(raw).outcome || 'draw') : 'draw';
        } catch (e) {
            return 'draw';
        }
    }

    // ==================== 棋谱 ====================
    function updateMoveList() {
        var history = state.chess.history();
        if (!history.length) {
            dom.moveList.innerHTML = '<div class="empty-tip">尚无走法，白方先行</div>';
            return;
        }
        var html = '';
        var lastIndex = history.length - 1;
        for (var i = 0; i < history.length; i += 2) {
            var no = Math.floor(i / 2) + 1;
            var w = history[i] || '';
            var b = history[i + 1] || '';
            html += '<div class="move-row">' +
                '<span class="move-no">' + no + '.</span>' +
                '<span class="move-cell' + (i === lastIndex ? ' latest' : '') + '">' + w + '</span>' +
                '<span class="move-cell' + (i + 1 === lastIndex ? ' latest' : '') + '">' + b + '</span>' +
                '</div>';
        }
        dom.moveList.innerHTML = html;
        dom.moveList.scrollTop = dom.moveList.scrollHeight;
    }

    function updateTurnBadge() {
        var turn = state.chess.turn();
        dom.badgeWhite.className = 'side-badge white' + (turn === 'w' ? ' active' : '');
        dom.badgeBlack.className = 'side-badge black' + (turn === 'b' ? ' active' : '');
    }

    function updateCampBadge() {
        dom.badgeWhite.textContent = '白 · ' + state.whiteCamp;
        dom.badgeBlack.textContent = '黑 · ' + state.blackCamp;
        updateTurnBadge();
    }

    // ==================== 打印棋谱 ====================
    // 结算文案：与结算页口径保持一致（PRD 三.3）
    function buildOutcomeText(outcome, winner) {
        var rounds = Math.ceil(state.chess.history().length / 2);
        var span = rounds > 0 ? '在' + rounds + '回合内' : '尚未开局即';
        if (state.mode === 'pvp') {
            if (!winner) return '达成共识：双方' + span + '握手言和';
            var winColor = winner === 'white' ? '白方' : '黑方';
            var winCamp = winner === 'white' ? state.whiteCamp : state.blackCamp;
            var loseCamp = winner === 'white' ? state.blackCamp : state.whiteCamp;
            return winColor + '获胜：' + winColor + '，率领' + winCamp + span + '战胜' + loseCamp;
        }
        var color = colorName(state.playerColor);
        var camp = state.playerColor === 'w' ? state.whiteCamp : state.blackCamp;
        var lvl = window.StockfishEngine.levelOf(state.elo).label;
        if (outcome === 'win') {
            return '恭喜获胜：执' + color + '，率领' + camp + span + '战胜' + lvl + '对手';
        }
        if (outcome === 'lose') {
            return '遗憾失败：执' + color + '，率领' + camp + span + '被' + lvl + '对手击败';
        }
        return '达成共识：执' + color + '，率领' + camp + span + '与' + lvl + '对手达成平局';
    }

    function printRecord() {
        var now = new Date();
        var lines = [];
        lines.push('ChessCheers 对局记录');
        lines.push('================================');
        lines.push('打印时间：' + formatDateTime(now));
        lines.push('');
        lines.push('【对局配置】');
        lines.push('棋盘：' + state.board);
        lines.push('白方阵营：' + state.whiteCamp);
        lines.push('黑方阵营：' + state.blackCamp);
        lines.push('对局模式：' + (state.mode === 'pve' ? '人 vs 机' : '人 vs 人'));
        if (state.mode === 'pve') {
            lines.push('执棋颜色：' + colorName(state.playerColor));
            lines.push('对弈难度：' + state.elo + '（' + window.StockfishEngine.levelOf(state.elo).label + '）');
        }
        lines.push('');
        lines.push('【走法记录】');
        appendSanLines(lines);
        lines.push('');
        lines.push(state.finished
            ? '【结算】' + (state.outcomeText || '本局已结束')
            : '【结算】棋局未完结');

        download('ChessCheers_对局记录_' + stamp(now) + '.txt', lines.join('\n'));
        showToast('棋谱已导出', 'good');
    }

    function appendSanLines(lines) {
        var history = state.chess.history();
        if (!history.length) { lines.push('（暂无走法）'); return; }
        for (var i = 0; i < history.length; i += 2) {
            var row = (Math.floor(i / 2) + 1) + '. ' + (history[i] || '');
            if (history[i + 1]) row += ' ' + history[i + 1];
            lines.push(row);
        }
    }

    function formatDateTime(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function stamp(d) {
        return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
            pad(d.getHours()) + pad(d.getMinutes());
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function download(filename, text) {
        var blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ==================== 交互 ====================
    function bindPointer() {
        dom.boardInner.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerDown(e) {
        window.AssetLoader.unlockAudio();   // 借真实手势解锁音频，避免首次音效被拦截
        if (state.locked || state.finished || promoteResolver) return;
        var sq = squareFromPoint(e.clientX, e.clientY);
        if (!sq) return;

        // 已选中时点其他格：当前行棋方的子改选，其余一律尝试走子（非法会退回提示）
        if (state.selected && sq !== state.selected) {
            var target = pieceAt(sq);
            if (target && target.color === state.chess.turn() && canOperate(target.color)) {
                beginInteraction(sq, e);
            } else {
                requestMove(state.selected, sq);
            }
            return;
        }
        var piece = pieceAt(sq);
        if (!piece) { clearSelection(); return; }
        // 非行棋方棋子也要能选中：只播动画，不进入可移动状态（PRD 四.3 第8条）
        if (!canOperate(piece.color)) { previewSelect(sq); return; }
        beginInteraction(sq, e);
    }

    function isHintTarget(sq) {
        for (var i = 0; i < state.hintMoves.length; i++) {
            if (state.hintMoves[i].to === sq) return true;
        }
        return false;
    }

    function beginInteraction(sq, e) {
        selectSquare(sq);
        drag.active = true;
        drag.moved = false;
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.pointerId = e.pointerId;
        var el = pieceElAt(sq);
        if (el) el.classList.add('dragging');
    }

    function onPointerMove(e) {
        if (!drag.active || !state.selectedEl) return;
        var dx = e.clientX - drag.startX;
        var dy = e.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        followPointer(e.clientX, e.clientY);
    }

    // 拖拽跟手：换算为棋盘百分比坐标
    function followPointer(clientX, clientY) {
        var rect = dom.boardInner.getBoundingClientRect();
        if (!rect.width) return;
        var x = ((clientX - rect.left) / rect.width) * 100;
        var y = ((clientY - rect.top) / rect.height) * 100;
        var el = state.selectedEl;
        el.style.left = Math.max(-6, Math.min(94, x - CELL / 2)) + '%';
        el.style.top = Math.max(-6, Math.min(94, y - CELL / 2)) + '%';
    }

    function onPointerUp(e) {
        if (!drag.active) return;
        drag.active = false;
        var from = state.selected;
        var el = state.selectedEl;
        if (el) el.classList.remove('dragging');
        if (!from) return;

        var to = squareFromPoint(e.clientX, e.clientY);
        if (!to || to === from) {
            // 点击未拖动：保留选中，便于第二次点击落子
            if (drag.moved) snapTo(el, from);
            return;
        }
        snapTo(el, from);
        requestMove(from, to);
    }

    // ==================== UI 控制 ====================
    function toggleSound() {
        state.sound = !state.sound;
        window.AssetLoader.setSoundEnabled(state.sound);
        dom.soundIcon.textContent = state.sound ? '🔊' : '🔇';
        dom.soundBtn.className = state.sound ? 'icon-btn' : 'icon-btn muted';
    }

    function toggleSidebar() {
        var collapsed = dom.sidebar.classList.toggle('collapsed');
        dom.sidebarHandle.className = collapsed ? 'sidebar-handle' : 'sidebar-handle hidden';
    }

    // 侧边栏初始折叠：PRD 三.3 要求「棋盘右上角第二行有向右箭头，点击展开」
    function applyDefaultSidebar() {
        dom.sidebar.classList.add('collapsed');
        dom.sidebarHandle.className = 'sidebar-handle';
    }

    function bindControls() {
        dom.soundBtn.addEventListener('click', toggleSound);
        dom.sidebarHandle.addEventListener('click', toggleSidebar);
        $('sidebar-close').addEventListener('click', toggleSidebar);
        $('print-btn').addEventListener('click', printRecord);
        $('resign-btn').addEventListener('click', resignGame);
    }

    // ==================== 启动 ====================
    function initChess() {
        if (typeof Chess === 'undefined') {
            showToast('规则引擎加载失败', 'warn');
            return false;
        }
        state.chess = new Chess();
        return true;
    }

    function initEngine() {
        window.StockfishEngine.init({
            onReady: function () {
                if (state.mode === 'pve') maybeTriggerAI();
            },
            onError: function (msg) {
                // file:// 下浏览器会拦截 Worker，需明确告知改用 HTTP
                var tip = location.protocol === 'file:'
                    ? '请通过本地服务器访问：引擎在 file:// 下无法运行'
                    : 'AI 引擎不可用，已切换为双人对弈';
                showToast(tip, 'warn');
                state.mode = 'pvp';
            }
        });
    }

    function init() {
        initDom();
        if (!window.AssetLoader.manifest()) {
            showToast('素材清单缺失，请先运行 node tools/scan-assets.js', 'warn');
            return;
        }
        readParams();
        if (!initChess()) return;

        window.AssetLoader.warmUp(state.whiteCamp);
        window.AssetLoader.warmUp(state.blackCamp);

        renderBoardBg();
        renderCoords();
        renderPieces();
        renderContextMarks();
        updateMoveList();
        if (window.AssetLoader.applyBranding) window.AssetLoader.applyBranding();
        updateCampBadge();
        applyDefaultSidebar();
        bindControls();
        bindPromotion();
        bindPointer();

        if (state.mode === 'pve') initEngine();
        console.log('[game] 初始化完成', state);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
