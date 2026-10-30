/**
 * ChessCheers AI 引擎封装
 * 单层 Worker 直连 stockfish.wasm.js，UCI 协议收发。
 * 难度按 ELO 映射搜索深度与技能等级，并保证最短思考时长（PRD 六.2）。
 */
(function () {
    'use strict';

    var WORKER_PATH = '../js/stockfish.wasm.js';

    // ELO 档位 -> 搜索深度 / 技能等级 / 最短思考毫秒（PRD 二.2 与六.2）
    var ELO_LEVELS = [
        { max: 500, depth: 5, skill: 1, minThink: 500, label: '初生牛犊' },
        { max: 1000, depth: 8, skill: 5, minThink: 700, label: '灵机一动' },
        { max: 1500, depth: 12, skill: 10, minThink: 900, label: '激流勇进' },
        { max: 2000, depth: 15, skill: 14, minThink: 1200, label: '福至心灵' },
        { max: 2500, depth: 18, skill: 17, minThink: 1500, label: '行云流水' },
        { max: 3000, depth: 20, skill: 20, minThink: 1800, label: '随心所欲' },
        { max: Infinity, depth: 20, skill: 20, minThink: 2000, label: '返璞归真' }
    ];

    var worker = null;
    var ready = false;
    var failed = false;
    var options = {};
    var pendingStart = 0;
    var pendingTimer = null;
    var onBestMove = null;
    var onReadyCb = null;
    var onErrorCb = null;

    // 按 ELO 取档位
    function levelOf(elo) {
        var n = parseInt(elo, 10);
        if (isNaN(n)) n = 600;
        for (var i = 0; i < ELO_LEVELS.length; i++) {
            if (n <= ELO_LEVELS[i].max) return ELO_LEVELS[i];
        }
        return ELO_LEVELS[ELO_LEVELS.length - 1];
    }

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
            if (onReadyCb) onReadyCb();
            return;
        }

        if (line.indexOf('bestmove') === 0) {
            handleBestMove(line);
        }
    }

    // 收到 bestmove：补足最短思考时长后回调
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
            console.warn('[StockfishEngine] 引擎未就绪，忽略本次分析');
            if (callback) callback(null);
            return false;
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
