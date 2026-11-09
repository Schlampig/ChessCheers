/**
 * ChessCheers — AI 引擎封装（Stockfish WASM）
 *
 * 功能：在 Web Worker 中运行 Stockfish，按 ELO 档位控制搜索强度，向外提供单步走法回调。
 * 模块：Worker 生命周期 · UCI 收发与解析 · 难度映射 · 最短思考时长控制
 * 设计：
 *   - 引擎放在 Worker 里，搜索期间主线程仍可响应拖拽与动画，界面不会卡顿；
 *   - 难度同时由搜索深度、Skill Level 与最短思考时长三者决定：
 *     低档位若只降深度，引擎仍可能瞬间走出好棋，配合最短思考时间才有「思考」的观感；
 *   - 只设置引擎在 uciok 中声明过的选项，避免不同构建版本因未知指令报错。
 */
(function () {
    'use strict';

    var WORKER_PATH = '../js/stockfish.wasm.js';

    /**
     * 难度阶梯：按「分数段下界」对齐首页的七档选项，强度三项指标同步单调递增。
     * - min 为该档起始分（首页下拉的 value 就是它），比它小的档位不会命中；
     * - depth 与 skill 同向递增：只降深度不降 skill，引擎仍会精准选子；
     *   只降 skill 不降深度，弱档位又会因为看得太深而显得不像「新手」；
     * - Skill Level 是本引擎唯一可用的强度开关（该构建不提供 UCI_Elo /
     *   UCI_LimitStrength），因此低档位同时压低深度与技能等级，高档位才放开。
     */
    var ELO_LEVELS = [
        { min: 0,    depth: 3,  skill: 0,  minThink: 700,  label: '初生牛犊' },
        { min: 600,  depth: 6,  skill: 3,  minThink: 800,  label: '灵机一动' },
        { min: 1100, depth: 9,  skill: 6,  minThink: 1000, label: '激流勇进' },
        { min: 1600, depth: 12, skill: 10, minThink: 1200, label: '福至心灵' },
        { min: 2100, depth: 15, skill: 14, minThink: 1500, label: '行云流水' },
        { min: 2600, depth: 18, skill: 18, minThink: 1800, label: '随心所欲' },
        { min: 3000, depth: 20, skill: 20, minThink: 2000, label: '返璞归真' }
    ];

    // 按分数段取档位：取「起始分不超过给定值」的最高一档，
    // 保证分值越高档位越强，最高档（3000 以上）不会被前一档截走。
    function levelOf(elo) {
        var n = parseInt(elo, 10);
        if (isNaN(n)) n = 600;
        var level = ELO_LEVELS[0];
        for (var i = 0; i < ELO_LEVELS.length; i++) {
            if (n >= ELO_LEVELS[i].min) level = ELO_LEVELS[i];
        }
        return level;
    }

    var worker = null;
    var ready = false;
    var failed = false;
    var options = {};
    var pendingStart = 0;
    var pendingTimer = null;
    var onBestMove = null;
    var onReadyCb = null;
    var onErrorCb = null;
    // 引擎就绪前收到的分析请求。引擎是 640KB 的 wasm，弱网下要十几秒才可用，
    // 这期间玩家很可能已经走了一步——请求先排队，就绪后自动补发，避免 AI 漏走。
    var pendingAnalyses = [];

    function send(cmd) {
        if (!worker) return;
        try {
            worker.postMessage(cmd);
        } catch (e) {
            reportError('引擎指令发送失败: ' + cmd);
        }
    }

    function reportError(msg) {
        failed = true;
        console.error('[StockfishEngine]', msg);
        if (onErrorCb) onErrorCb(msg);
    }

    // 解析 UCI 输出行
    function handleLine(line) {
        if (typeof line !== 'string') return;

        if (line.indexOf('option name ') === 0) {
            var rest = line.slice('option name '.length);
            var idx = rest.indexOf(' type ');
            if (idx > 0) options[rest.slice(0, idx)] = true;
            return;
        }

        if (line.indexOf('uciok') === 0) {
            applyOptions();
            send('isready');
            return;
        }

        if (line.indexOf('readyok') === 0) {
            ready = true;
            send('ucinewgame');
            console.log('[StockfishEngine] 引擎就绪');
            flushPendingAnalyses();
            if (onReadyCb) onReadyCb();
            return;
        }

        if (line.indexOf('bestmove') === 0) {
            handleBestMove(line);
        }
    }

    // 收到 bestmove：补足最短思考时长后回调。
    // 低档位搜索极快，立即落子会显得「秒回」而缺乏对弈感，因此按档位补足等待；
    // 高档位本身耗时较长，计算出的 wait 自然为 0，不会额外拖延。
    function handleBestMove(line) {
        var parts = line.split(/\s+/);
        var move = parts[1] || '';
        var cb = onBestMove;
        onBestMove = null;

        if (!move || move === '(none)') {
            if (cb) cb(null);
            return;
        }

        var elapsed = Date.now() - pendingStart;
        var wait = Math.max(0, (pendingMinThink || 0) - elapsed);
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(function () {
            pendingTimer = null;
            if (cb) cb(move);
        }, wait);
    }

    var pendingMinThink = 0;

    // 只设置引擎确实声明过的选项，避免不兼容指令
    function applyOptions() {
        if (options['UCI_Variant']) {
            send('setoption name UCI_Variant value chess');
        }
        if (options['Skill Level']) {
            send('setoption name Skill Level value ' + currentSkill);
        }
        if (options['MultiPV']) {
            send('setoption name MultiPV value 1');
        }
    }

    var currentSkill = 20;

    /**
     * 初始化引擎
     * @param {Object} callbacks {onReady, onError, onInfo}
     */
    function init(callbacks) {
        callbacks = callbacks || {};
        onReadyCb = callbacks.onReady || null;
        onErrorCb = callbacks.onError || null;

        if (worker) return true;

        try {
            worker = new Worker(WORKER_PATH);
        } catch (e) {
            reportError('Worker 创建失败（请通过 HTTP 访问，file:// 下浏览器会拦截）');
            return false;
        }

        worker.onmessage = function (e) {
            handleLine(e.data);
        };
        worker.onerror = function (e) {
            reportError('Worker 运行错误: ' + (e.message || '未知'));
        };

        send('uci');
        return true;
    }

    // 引擎就绪后补发排队的分析。只保留最后一次：局面已经变了，更早的请求没有意义
    function flushPendingAnalyses() {
        if (!pendingAnalyses.length) return;
        var last = pendingAnalyses[pendingAnalyses.length - 1];
        pendingAnalyses = [];
        analyze(last.fen, last.elo, last.cb);
    }

    /**
     * 请求最佳走法
     * @param {string} fen 当前局面
     * @param {string|number} elo 难度分档
     * @param {Function} callback 收到 UCI 走法（如 e2e4）后回调
     */
    function analyze(fen, elo, callback) {
        if (!worker || failed) {
            if (callback) callback(null);
            return false;
        }
        if (!ready) {
            // 引擎还在下载/初始化：排队等待，就绪后自动补发
            console.log('[StockfishEngine] 引擎未就绪，本次分析已排队');
            pendingAnalyses.push({ fen: fen, elo: elo, cb: callback });
            return true;
        }

        var level = levelOf(elo);
        currentSkill = level.skill;
        pendingMinThink = level.minThink;
        pendingStart = Date.now();
        onBestMove = callback;

        if (options['Skill Level']) {
            send('setoption name Skill Level value ' + level.skill);
        }
        send('position fen ' + fen);
        send('go depth ' + level.depth);
        return true;
    }

    function isReady() {
        return ready && !failed;
    }

    function hasFailed() {
        return failed;
    }

    function destroy() {
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingAnalyses = [];
        if (worker) {
            try { worker.terminate(); } catch (e) {}
        }
        worker = null;
        ready = false;
        onBestMove = null;
    }

    window.StockfishEngine = {
        init: init,
        analyze: analyze,
        isReady: isReady,
        hasFailed: hasFailed,
        destroy: destroy,
        levelOf: levelOf
    };
})();
