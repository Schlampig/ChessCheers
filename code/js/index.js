/**
 * ChessCheers — 首页逻辑（code/html/index.html）
 *
 * 功能：读取素材清单渲染阵营 / 棋盘 / 模式 / 难度，联动说明文案与预览，
 *       校验通过后拼接参数跳转到对弈页。
 * 模块：清单渲染 · 配置联动 · 校验与提示 · URL 组装
 * 设计：
 *   - 所有选项都来自 assets.js 清单而非硬编码，新增素材无需改动本文件；
 *   - 素材不合格不会从清单里悄悄消失，而是在页面上用提示说明原因，
 *     方便素材作者定位问题；
 *   - 校验不通过时禁用开始按钮并给出提示，避免把错误配置带进对局页。
 */
(function () {
    'use strict';

    var randomCamps = [];        // 可用阵营名列表
    var boardList = [];          // 可用棋盘列表
    var ready = false;           // 配置是否满足开局条件

    var CAMPS_OK = true;
    var BOARDS_OK = true;

    // 与 HTML 中静态资源版本号保持一致；跳转时携带，强制浏览器拉取最新页面
    var BUILD = '202611091928';

    var dom = {};

    // ELO 档位说明（与 stockfish-engine.js 的档位一致）
    var ELO_TIPS = {
        '500': '刚记住棋子走法，适合第一次上手。',
        '600': '会吃子也会防守，偶尔漏招。',
        '1100': '懂基本战术，能抓住明显失误。',
        '1600': '战术熟练，需要认真应对。',
        '2100': '接近专业水平，开局与残局都不弱。',
        '2600': '大师级压迫感，容错空间极小。',
        '3000': '引擎全力运转，几乎不给机会。'
    };

    // PRD 二.2：对局模式文案
    var MODE_DESC = {
        pve: '与算法展开较量！',
        pvp: '你来操控黑白双方，用于棋局模拟练习。'
    };

    var DEFAULT_BOARD = '标准';

    function $(id) { return document.getElementById(id); }

    function initDom() {
        dom.whiteFaction = $('white-faction');
        dom.blackFaction = $('black-faction');
        dom.factionIntro = $('faction-intro');
        dom.boardSelect = $('board-select');
        dom.boardPreview = $('board-preview');
        dom.boardDesc = $('board-desc');
        dom.gameMode = $('game-mode');
        dom.modeDesc = $('game-mode-desc');
        dom.colorItem = $('color-config-item');
        dom.playerColor = $('player-color');
        dom.eloSelect = $('elo-difficulty');
        dom.eloItem = $('elo-config-item');
        dom.eloDesc = $('elo-desc');
        dom.eloMeter = $('elo-meter');
        dom.startBtn = $('start-btn');
        dom.navPlay = $('nav-play');
        dom.toast = $('toast');
        dom.backTop = $('back-to-top');
    }

    // ==================== 提示 ====================
    var toastTimer = null;

    function showToast(msg, kind) {
        dom.toast.textContent = msg;
        dom.toast.className = 'toast show' + (kind ? ' ' + kind : '');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            dom.toast.className = 'toast' + (kind ? ' ' + kind : '');
        }, 2600);
    }

    // 转义后展示阵营介绍，避免 md 中的标记被当成 HTML 执行
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ==================== 阵营 ====================
    // 可用阵营不足 2 个时，下拉清空并报错（PRD 三.1.4）
    function renderCamps() {
        var camps = window.AssetLoader.getCamps();
        randomCamps = camps.map(function (c) { return c.name; });
        CAMPS_OK = randomCamps.length >= 2;

        dom.whiteFaction.innerHTML = '';
        dom.blackFaction.innerHTML = '';

        if (!CAMPS_OK) {
            renderIntro('Error：阵营人不齐！', true);
            return;
        }
        buildCampOptions(dom.whiteFaction);
        buildCampOptions(dom.blackFaction);
        renderIntro(null, false);
    }

    function buildCampOptions(select) {
        var random = document.createElement('option');
        random.value = 'random';
        random.textContent = '随机';
        select.appendChild(random);
        for (var i = 0; i < randomCamps.length; i++) {
            var opt = document.createElement('option');
            opt.value = randomCamps[i];
            opt.textContent = randomCamps[i];
            select.appendChild(opt);
        }
        select.value = 'random';
    }

    // 介绍区：按当前白/黑选择展示对应阵营说明
    function renderIntro(errorText, isError) {
        if (errorText) {
            dom.factionIntro.innerHTML = '<p class="config-desc' +
                (isError ? ' error' : '') + '">' + escapeHtml(errorText) + '</p>' +
                invalidCampTip();
            return;
        }
        var white = dom.whiteFaction.value;
        var black = dom.blackFaction.value;
        var parts = [];
        if (white !== 'random') parts.push(describe('白方', white));
        if (black !== 'random') parts.push(describe('黑方', black));
        if (!parts.length) {
            dom.factionIntro.innerHTML = '<p class="config-desc">随机阵营，开局时揭晓。</p>' +
                invalidCampTip();
            return;
        }
        dom.factionIntro.innerHTML =
            '<p class="config-desc">' + escapeHtml(parts.join('\n\n')) + '</p>' + invalidCampTip();
    }

    // 未通过规范检查的阵营：列出来便于作者补齐素材
    function invalidCampTip() {
        var manifest = window.AssetLoader.manifest ? window.AssetLoader.manifest() : null;
        var camps = manifest ? manifest.camps : [];
        var bad = [];
        for (var i = 0; i < camps.length; i++) {
            if (!camps[i].valid) bad.push(camps[i]);
        }
        if (!bad.length) return '';
        var items = [];
        for (var j = 0; j < bad.length; j++) {
            items.push(bad[j].name + '：' + (bad[j].reasons || []).join('；'));
        }
        return '<p class="config-desc warn">另有 ' + bad.length +
            ' 个阵营未通过检查已跳过 —— ' + escapeHtml(items.join(' ／ ')) + '</p>';
    }

    // 组装单个阵营的介绍文本
    function describe(side, name) {
        var camp = window.AssetLoader.getCamp(name);
        if (!camp) return side + '：' + name;
        var intro = (camp.intro || '').replace(/\s+$/, '');
        if (!intro) return '【' + side + '】' + name + '（暂无阵营介绍）';
        return '【' + side + '】' + name + '\n' + intro;
    }

    // ==================== 棋盘 ====================
    function renderBoards() {
        boardList = window.AssetLoader.getBoards();
        BOARDS_OK = boardList.length >= 1;
        dom.boardSelect.innerHTML = '';

        if (!BOARDS_OK) {
            dom.boardPreview.className = 'board-preview empty';
            dom.boardPreview.textContent = 'Error：找不到棋盘！';
            dom.boardDesc.textContent = 'Error：找不到棋盘！';
            dom.boardDesc.className = 'config-desc error';
            return;
        }
        for (var i = 0; i < boardList.length; i++) {
            var opt = document.createElement('option');
            opt.value = boardList[i].name;
            opt.textContent = boardList[i].name;
            dom.boardSelect.appendChild(opt);
        }
        // 默认选中「标准」，缺失则退回第一张（PRD 二.2）
        dom.boardSelect.value = pickDefaultBoard();
        dom.boardDesc.className = 'config-desc';
        updateBoardPreview();
    }

    function pickDefaultBoard() {
        for (var i = 0; i < boardList.length; i++) {
            if (boardList[i].name === DEFAULT_BOARD) return DEFAULT_BOARD;
        }
        return boardList[0].name;
    }

    function updateBoardPreview() {
        var name = dom.boardSelect.value;
        var src = window.AssetLoader.getBoardPath(name);
        if (!src) return;
        dom.boardPreview.className = 'board-preview';
        dom.boardPreview.style.backgroundImage = 'url("' + src + '")';
        dom.boardPreview.textContent = '';
        var board = window.AssetLoader.getBoard(name);
        var text = board && board.width
            ? name + '（' + board.width + '×' + board.height + '）'
            : name;
        // 提示被规范检查跳过的棋盘，方便作者修正
        var bad = window.AssetLoader.getInvalidBoards ? window.AssetLoader.getInvalidBoards() : [];
        if (bad.length) {
            text += '　·　另有 ' + bad.length + ' 张不合格已跳过（' +
                bad.map(function (b) { return b.name + '：' + b.reason; }).join('；') + '）';
        }
        dom.boardDesc.textContent = text;
        dom.boardDesc.className = bad.length ? 'config-desc warn' : 'config-desc';
    }

    // ==================== 模式与难度 ====================
    function updateMode() {
        var mode = dom.gameMode.value;
        dom.modeDesc.textContent = MODE_DESC[mode] || '';
        dom.colorItem.className = mode === 'pve' ? 'sub-field' : 'sub-field hidden';
        // 人 vs 人 没有 AI，隐藏难度；同时不发送 elo 参数
        dom.eloItem.className = mode === 'pve' ? 'card' : 'card hidden';
    }

    function updateElo() {
        var value = dom.eloSelect.value;
        dom.eloDesc.textContent = ELO_TIPS[value] || '';
        var bars = dom.eloMeter.querySelectorAll('.elo-bar');
        var index = dom.eloSelect.selectedIndex;
        for (var i = 0; i < bars.length; i++) {
            bars[i].className = i <= index ? 'elo-bar on' : 'elo-bar';
        }
    }

    // ==================== 校验与跳转 ====================
    function validate() {
        if (!ready) return false;
        if (!CAMPS_OK) return false;
        if (!BOARDS_OK) return false;
        return !!dom.boardSelect.value;
    }

    // 人 vs 人 不带难度与执棋颜色（与 AI 无关，避免传入无意义配置）
    function buildGameUrl() {
        var mode = dom.gameMode.value;
        var params = [
            'wf=' + encodeURIComponent(dom.whiteFaction.value || 'random'),
            'bf=' + encodeURIComponent(dom.blackFaction.value || 'random'),
            'board=' + encodeURIComponent(dom.boardSelect.value),
            'mode=' + encodeURIComponent(mode)
        ];
        if (mode === 'pve') {
            params.push('elo=' + encodeURIComponent(dom.eloSelect.value));
            params.push('side=' + encodeURIComponent(dom.playerColor.value || 'random'));
        }
        // 版本号：避免浏览器沿用缓存中的旧页面
        params.push('v=' + BUILD);
        return 'game.html?' + params.join('&');
    }

    // 开始按钮（PRD 三.1.7）
    function onStart() {
        if (!validate()) {
            showToast('配置错误，请检查！', 'warn');
            return;
        }
        window.location.href = buildGameUrl();
    }

    // 顶部「来一局」（PRD 二.2）
    function onNavPlay(e) {
        e.preventDefault();
        if (!validate()) {
            showToast('配置有误无法开局！', 'warn');
            return;
        }
        window.location.href = buildGameUrl();
    }

    // ==================== 交互绑定 ====================
    function bindEvents() {
        dom.whiteFaction.addEventListener('change', function () { renderIntro(null, false); });
        dom.blackFaction.addEventListener('change', function () { renderIntro(null, false); });
        dom.boardSelect.addEventListener('change', updateBoardPreview);
        dom.gameMode.addEventListener('change', updateMode);
        dom.eloSelect.addEventListener('change', updateElo);
        dom.startBtn.addEventListener('click', onStart);
        dom.navPlay.addEventListener('click', onNavPlay);
        dom.backTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        window.addEventListener('scroll', onScroll);
    }

    // 滚动离开顶部后出现返回顶部按钮
    function onScroll() {
        if (window.pageYOffset > 160) dom.backTop.classList.add('show');
        else dom.backTop.classList.remove('show');
    }

    // ==================== 启动 ====================
    function init() {
        initDom();

        if (!window.AssetLoader || !window.AssetLoader.manifest()) {
            ready = false;
            renderIntro('素材清单缺失，请先运行：node tools/scan-assets.js', true);
            dom.startBtn.disabled = true;
            showToast('素材清单缺失，无法开局', 'warn');
            return;
        }

        renderCamps();
        renderBoards();
        updateMode();
        updateElo();

        // 应用项目 logo（favicon + 抬头区）
        if (window.AssetLoader.applyBranding) window.AssetLoader.applyBranding();

        // 阵营或棋盘缺失时禁用开局（PRD 三.1.4 / 三.1.6）
        ready = CAMPS_OK && BOARDS_OK;
        dom.startBtn.disabled = !ready;
        if (!ready) showToast('素材不足，无法开局', 'warn');

        bindEvents();
        console.log('[index] 初始化完成', { camps: randomCamps, boards: boardList.length });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
