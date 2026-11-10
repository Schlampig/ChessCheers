/**
 * ChessCheers — 结算页逻辑（code/html/result.html）
 *
 * 功能：还原上一局结果并展示结局文案、阵营插画与语音，支持导出棋谱与沿用配置重开。
 * 模块：状态还原 · 文案生成 · 素材与语音 · 文本导出 · 跳转
 * 设计：
 *   - 完整对局数据存放在 sessionStorage，URL 只带少量参数，避免长棋谱撑爆地址栏；
 *     两者同时存在时以 sessionStorage 为准，URL 仅作兜底；
 *   - 结局以 outcome 为准反推 winner，保证「胜负」与「插画」永远自洽——
 *     只带 outcome 的入口（如手动打开本页）也不会出现标题与画面矛盾；
 *   - 交互绑定先于渲染执行，即使素材缺失或渲染异常，按钮依然可用。
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'chesscheers_last_game';
    // 与 HTML 中静态资源版本号保持一致；跳转时携带，强制浏览器拉取最新页面
    var BUILD = '202611101655';

    // ELO 档位名（与首页一致）
    var ELO_NAMES = {
        '500': '初生牛犊', '600': '灵机一动', '1100': '激流勇进',
        '1600': '福至心灵', '2100': '行云流水', '2600': '随心所欲', '3000': '返璞归真'
    };

    var state = {
        outcome: 'draw',
        reason: '',
        winner: null,
        mode: 'pve',
        side: 'w',
        wf: '',
        bf: '',
        board: '标准',
        elo: '600',
        san: [],
        finished: true
    };

    var dom = {};
    var voicePlayed = false;
    var pendingVoice = null;

    function $(id) { return document.getElementById(id); }

    function initDom() {
        dom.modal = $('result-modal');
        dom.content = $('result-content');
        dom.title = $('result-title');
        dom.subtitle = $('result-subtitle');
        dom.buttons = $('result-buttons');
        dom.asset = $('result-asset');
        dom.assetImg = $('result-asset-img');
        dom.replay = $('replay-btn');
        dom.print = $('print-btn');
        dom.confirm = $('confirm-btn');
        dom.toast = $('toast');
    }

    // ==================== 数据读取 ====================
    function parseUrl() {
        var params = {};
        var qs = window.location.search.substring(1);
        if (!qs) return params;
        var pairs = qs.split('&');
        for (var i = 0; i < pairs.length; i++) {
            var kv = pairs[i].split('=');
            if (kv.length >= 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
        }
        return params;
    }

    // 优先 sessionStorage（含完整棋谱），URL 仅兜底
    function loadState() {
        var params = parseUrl();
        var cached = null;
        try {
            var raw = window.sessionStorage.getItem(STORAGE_KEY);
            if (raw) cached = JSON.parse(raw);
        } catch (e) {
            cached = null;
        }

        var src = cached || {};
        state.outcome = src.outcome || params.outcome || 'draw';
        state.reason = src.reason || '';
        // winner 必须与 outcome 自洽：pvp 的 whiteWin/blackWin 直接反推胜方，
        // 避免只带 outcome 参数（无 sessionStorage）时误判为白方获胜
        if (state.outcome === 'whiteWin') state.winner = 'white';
        else if (state.outcome === 'blackWin') state.winner = 'black';
        else state.winner = src.winner || null;        state.mode = src.mode || params.mode || 'pve';
        state.side = src.side || params.side || 'w';
        state.wf = src.wf || params.wf || '';
        state.bf = src.bf || params.bf || '';
        state.board = src.board || params.board || '标准';
        state.elo = src.elo || params.elo || '600';
        state.san = src.san || [];
        state.finished = src.finished !== false;
    }

    // ==================== 文案 ====================
    function colorName(c) { return c === 'w' || c === 'white' ? '白' : '黑'; }

    function eloName() { return ELO_NAMES[state.elo] || '灵机一动'; }

    // 回合数：按完整回合（一白一黑）计
    function roundCount() { return Math.ceil(state.san.length / 2); }

    // 回合文案：一步未走时不应显示「0回合」
    function roundText() {
        var rounds = roundCount();
        return rounds > 0 ? '在' + rounds + '回合内' : '，尚未开局即';
    }

    // 玩家阵营：pve 为执棋方，pvp 默认白方（side 兼容 'b'/'black' 两种写法）
    function isPlayerBlack() { return state.side === 'b' || state.side === 'black'; }

    function playerCamp() {
        return isPlayerBlack() ? state.bf : state.wf;
    }

    // 结算素材归属阵营：pvp 取获胜方，其余取玩家方
    function assetCamp() {
        if (state.mode === 'pvp') {
            if (state.winner === 'black') return state.bf;
            return state.wf;
        }
        return playerCamp();
    }

    // 素材目录：win / lose / draw
    function assetKey() {
        if (state.outcome === 'draw') return 'draw';
        if (state.outcome === 'lose') return 'lose';
        return 'win';
    }

    function buildText() {
        var camp = playerCamp();
        var color = colorName(state.side);
        var when = roundText();

        if (state.mode === 'pvp') {
            if (state.outcome === 'draw') {
                return { title: '达成共识', sub: '白方' + state.wf + ' 与黑方' + state.bf + when + '握手言和' };
            }
            // 人 vs 人：同屏两人，用客观语气描述结果
            var winColor = state.winner === 'black' ? '黑方' : '白方';
            var winCamp = state.winner === 'black' ? state.bf : state.wf;
            var loseCamp = state.winner === 'black' ? state.wf : state.bf;
            return { title: '恭喜，' + winColor + '获胜', sub: winColor + '，率领' + winCamp + when + '战胜' + loseCamp };
        }

        if (state.outcome === 'draw') {
            return { title: '达成共识', sub: '执' + color + '，率领' + camp +
                when + '与' + eloName() + '对手达成平局' };
        }
        if (state.outcome === 'win') {
            return { title: '恭喜获胜', sub: '执' + color + '，率领' + camp +
                when + '战胜' + eloName() + '对手' };
        }
        return { title: '遗憾失败', sub: '执' + color + '，率领' + camp +
            when + '被' + eloName() + '对手击败' };
    }

    // ==================== 素材 ====================
    var toastTimer = null;

    function showToast(msg) {
        if (!dom.toast) return;
        dom.toast.textContent = msg;
        dom.toast.className = 'toast show';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { dom.toast.className = 'toast'; }, 2400);
    }

    // 把素材挂到卡片与整页背景上
    function applyAssetVisual(src) {
        if (dom.content) dom.content.classList.add('with-asset');
        if (dom.assetImg) {
            dom.assetImg.src = src;
            // 下一帧再加类，确保淡入与轻微缩放能被触发
            window.requestAnimationFrame(function () {
                dom.assetImg.classList.add('is-visible');
            });
        } else if (dom.asset) {
            // 兼容旧版 DOM：没有 img 元素时退回背景图
            dom.asset.style.backgroundImage = 'url("' + src + '")';
            dom.asset.style.backgroundSize = 'contain';
            dom.asset.style.backgroundRepeat = 'no-repeat';
            dom.asset.style.backgroundPosition = 'center';
        }
        // 素材同时作为整页虚化背景，营造结算氛围
        document.documentElement.style.setProperty('--result-bg', 'url("' + src + '")');
        document.body.classList.add('has-result-bg');
    }

    // 加载结算图与语音；失败则退回无素材布局（PRD 三.4）
    function loadAsset() {
        var camp = assetCamp();
        var key = assetKey();
        var src = window.AssetLoader.getResultAssetPath(camp, key, false);

        if (!src) { applyPlainLayout(); return; }

        var img = new Image();
        img.onload = function () {
            applyAssetVisual(src);
            playVoice(camp, key);
        };
        img.onerror = function () {
            applyPlainLayout();
        };
        img.src = src;
    }

    // 无素材：按钮竖排、弹窗灰透、尺寸紧凑
    function applyPlainLayout() {
        if (dom.content) dom.content.classList.remove('with-asset');
        if (dom.assetImg) dom.assetImg.removeAttribute('src');
        if (dom.asset) dom.asset.style.backgroundImage = '';
    }

    // 播放结算语音；受自动播放策略拦截时留待首次手势补播
    function playVoice(camp, key) {
        var src = window.AssetLoader.getResultAssetPath(camp, key, true);
        if (!src) return;
        pendingVoice = src;
        tryPlayVoice();
    }

    function tryPlayVoice() {
        if (!pendingVoice || voicePlayed) return;
        var audio = new Audio(pendingVoice);
        var p = audio.play();
        if (p && p.then) {
            p.then(function () { voicePlayed = true; })
             .catch(function () { voicePlayed = false; });
        } else {
            voicePlayed = true;
        }
    }

    // ==================== 打印 ====================
    function printRecord() {
        var now = new Date();
        var lines = [];
        var text = buildText();

        lines.push('ChessCheers 对局记录');
        lines.push('================================');
        lines.push('打印时间：' + formatDateTime(now));
        lines.push('');
        lines.push('【对局配置】');
        lines.push('棋盘：' + state.board);
        lines.push('白方阵营：' + state.wf);
        lines.push('黑方阵营：' + state.bf);
        lines.push('对局模式：' + (state.mode === 'pve' ? '人 vs 机' : '人 vs 人'));
        if (state.mode === 'pve') {
            lines.push('执棋颜色：' + colorName(state.side));
            lines.push('对弈难度：' + state.elo + '（' + eloName() + '）');
        }
        lines.push('');
        lines.push('【走法记录】');
        appendMoves(lines);
        lines.push('');
        lines.push(state.finished
            ? '【结算】' + text.title + '：' + text.sub
            : '【结算】棋局未完结');

        download('ChessCheers_对局记录_' + stamp(now) + '.txt', lines.join('\n'));
        showToast('棋谱已导出');
    }

    function appendMoves(lines) {
        if (!state.san.length) { lines.push('（暂无走法）'); return; }
        for (var i = 0; i < state.san.length; i += 2) {
            var row = (Math.floor(i / 2) + 1) + '. ' + (state.san[i] || '');
            if (state.san[i + 1]) row += ' ' + state.san[i + 1];
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

    // ==================== 跳转 ====================
    // 再来一盘：沿用本局配置
    function replay() {
        var params = [
            'wf=' + encodeURIComponent(state.wf),
            'bf=' + encodeURIComponent(state.bf),
            'board=' + encodeURIComponent(state.board),
            'mode=' + encodeURIComponent(state.mode)
        ];
        if (state.mode === 'pve') {
            params.push('elo=' + encodeURIComponent(state.elo));
            params.push('side=' + encodeURIComponent(isPlayerBlack() ? 'black' : 'white'));
        }
        params.push('v=' + BUILD);
        window.location.href = 'game.html?' + params.join('&');
    }

    function bindEvents() {
        if (dom.replay) dom.replay.addEventListener('click', replay);
        if (dom.print) dom.print.addEventListener('click', printRecord);
        // 首次手势补播被拦截的结算语音
        document.addEventListener('pointerdown', function () {
            if (window.AssetLoader) window.AssetLoader.unlockAudio();
            tryPlayVoice();
        });
    }

    // 文本渲染：标题 + 小标题 + 结局标记
    function renderText() {
        var text = buildText();
        if (dom.title) dom.title.textContent = text.title;
        if (dom.subtitle) dom.subtitle.textContent = text.sub;
        // 结局标记：驱动标题配色与光效（win / lose / draw）
        if (dom.content) dom.content.setAttribute('data-outcome', assetKey());
    }

    function init() {
        initDom();
        loadState();
        bindEvents();          // 先绑定交互，避免后续渲染异常导致按钮失效
        if (window.AssetLoader && window.AssetLoader.applyBranding) {
            window.AssetLoader.applyBranding();
        }
        try {
            renderText();
            loadAsset();
        } catch (e) {
            console.warn('[result] 渲染异常，已降级', e);
        }
        console.log('[result] 渲染完成：' + state.mode + ' / ' + state.outcome);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
