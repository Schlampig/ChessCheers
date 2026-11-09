/**
 * ChessCheers — 素材加载器（全站共用）
 *
 * 功能：把 code/js/assets.js 生成的清单解析成页面可直接使用的素材地址与 DOM 元素。
 * 模块：清单查询 · 路径编码 · 棋子视觉构建 · 动画播放 · 音效 · 品牌资源（logo）
 * 设计：
 *   - 素材路径统一分段编码，兼容中文目录与空格文件名；
 *   - 视觉素材既可能是视频也可能是静态图，按扩展名分流，缺失时回退到 Unicode 棋子，
 *     保证任何素材缺口都不会让棋盘出现空洞；
 *   - 放置态停在视频首帧，避免未交互的棋子在棋盘上持续播放动画，干扰观察局面。
 */
(function () {
    'use strict';

    var MANIFEST = (typeof window !== 'undefined' && window.CHESS_ASSETS) ? window.CHESS_ASSETS : null;

    var soundEnabled = true;
    var warmCache = {};

    // 棋子类型映射：Chess.js 代号 -> 素材目录名
    var PIECE_DIRS = {
        'p': 'Pawn', 'r': 'Rook', 'n': 'Knight',
        'b': 'Bishop', 'q': 'Queen', 'k': 'King'
    };

    // 状态中文名（用于兜底提示）
    var STATE_LABELS = { select: '选中', drop: '落子', capture: '被吃' };

    // Unicode 棋子符号（素材缺失时的兜底显示）
    var PIECE_SYMBOLS = {
        'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
    };

    function manifest() {
        return MANIFEST;
    }

    // 分段编码，保证中文/空格路径安全
    function encodePath(root) {
        var parts = String(root).split('/');
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            out.push(encodeURIComponent(parts[i]));
        }
        return out.join('/');
    }

    // 取可用阵营列表（PRD 三.1.4：只呈现可用阵营）
    function getCamps() {
        if (!MANIFEST) return [];
        var list = [];
        for (var i = 0; i < MANIFEST.camps.length; i++) {
            if (MANIFEST.camps[i].valid) list.push(MANIFEST.camps[i]);
        }
        return list;
    }

    // 按名称取阵营（找不到返回 null）
    function getCamp(name) {
        var camps = MANIFEST ? MANIFEST.camps : [];
        for (var i = 0; i < camps.length; i++) {
            if (camps[i].name === name) return camps[i];
        }
        return null;
    }

    // 可用棋盘：只返回通过规范检查（1:1 正方形）的素材
    function getBoards() {
        if (!MANIFEST || !MANIFEST.boards) return [];
        var out = [];
        for (var i = 0; i < MANIFEST.boards.length; i++) {
            if (MANIFEST.boards[i].valid !== false) out.push(MANIFEST.boards[i]);
        }
        return out;
    }

    // 按名称取棋盘（含不合格项，供兜底查找）
    function getBoard(name) {
        var boards = (MANIFEST && MANIFEST.boards) ? MANIFEST.boards : [];
        for (var i = 0; i < boards.length; i++) {
            if (boards[i].name === name) return boards[i];
        }
        var valid = getBoards();
        return valid.length ? valid[0] : (boards.length ? boards[0] : null);
    }

    // 被规范检查排除的棋盘（用于给用户提示）
    function getInvalidBoards() {
        var boards = (MANIFEST && MANIFEST.boards) ? MANIFEST.boards : [];
        var out = [];
        for (var i = 0; i < boards.length; i++) {
            if (boards[i].valid === false) out.push(boards[i]);
        }
        return out;
    }

    // 项目 logo（data/chesslogo/），未提供时返回 null
    function getLogo() {
        return (MANIFEST && MANIFEST.logo) ? MANIFEST.logo : null;
    }

    function pieceDirName(type) {
        return PIECE_DIRS[String(type).toLowerCase()] || String(type);
    }

    // 视觉素材可能是视频，也可能是静态图/动图（PRD 四.1 允许 png/jpg/jpeg/gif/webm）
    var VIDEO_EXT = /\.(webm|mp4|ogv|ogg|mov)$/i;

    function isVideoPath(src) {
        return VIDEO_EXT.test(String(src).split('?')[0]);
    }

    /**
     * 查询棋子素材绝对路径
     * @param {string} campName 阵营名
     * @param {string} pieceType Chess.js 棋子代号
     * @param {string} state select|drop|capture
     * @param {boolean} isAudio 是否取音频
     */
    function getPieceAssetPath(campName, pieceType, state, isAudio) {
        var camp = getCamp(campName);
        if (!camp) return null;
        var dir = camp.pieces[pieceDirName(pieceType)];
        if (!dir || !dir[state]) return null;
        var file = isAudio ? dir[state].audio : dir[state].video;
        if (!file) return null;
        return encodePath(MANIFEST.pieceRoot) +
            encodeURIComponent(campName) + '/' +
            encodeURIComponent(pieceDirName(pieceType)) + '/' +
            encodeURIComponent(file);
    }

    // 棋盘图片路径
    function getBoardPath(boardName) {
        var board = getBoard(boardName);
        if (!board) return null;
        return encodePath(MANIFEST.boardRoot) + encodeURIComponent(board.file);
    }

    // logo 绝对路径（页面展示用，优先中等尺寸，不加载几 MB 的原图）
    function getLogoPath() {
        var logo = getLogo();
        if (!logo) return null;
        return encodePath(logo.displayPath || logo.path);
    }

    // favicon 路径：优先缩略图
    function getFaviconPath() {
        var logo = getLogo();
        if (!logo) return null;
        return encodePath(logo.thumbPath || logo.path);
    }

    // 结算素材路径
    function getResultAssetPath(campName, outcome, isAudio) {
        var camp = getCamp(campName);
        if (!camp || !camp.result || !camp.result[outcome]) return null;
        var file = isAudio ? camp.result[outcome].audio : camp.result[outcome].image;
        if (!file) return null;
        return encodePath(MANIFEST.pieceRoot) +
            encodeURIComponent(campName) + '/' +
            encodeURIComponent('结算动画') + '/' +
            encodeURIComponent(outcome) + '/' +
            encodeURIComponent(file);
    }

    // 创建默认态（放置）视觉元素：显示选中素材首帧，不循环
    function createIdleVisual(campName, pieceType, symbolColor) {
        var wrap = document.createElement('div');
        wrap.className = 'piece-visual';

        var symbol = document.createElement('span');
        symbol.className = 'piece-symbol';
        symbol.textContent = PIECE_SYMBOLS[String(pieceType).toLowerCase()] || '?';
        symbol.style.color = symbolColor;
        wrap.appendChild(symbol);

        var src = getPieceAssetPath(campName, pieceType, 'select', false);
        if (!src) return wrap;

        wrap.appendChild(isVideoPath(src)
            ? buildIdleVideo(src, symbol)
            : buildIdleImage(src, symbol));
        return wrap;
    }

    // 视频版本的放置态元素：解码后停在首帧（PRD 四.3 放置态）
    function buildIdleVideo(src, symbol) {
        var video = document.createElement('video');
        video.className = 'piece-video';
        video.muted = true;
        video.loop = false;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.display = 'none';
        video.style.opacity = '0';
        video.src = src;

        video.addEventListener('loadeddata', function () {
            try { video.currentTime = 0; } catch (e) {}
            video.style.display = 'block';
            video.style.opacity = '';
            symbol.style.display = 'none';
        });
        video.addEventListener('error', function () {
            video.style.display = 'none';
            symbol.style.display = 'block';
        });
        return video;
    }

    // 静态图/动图版本的放置态元素（png/jpg/gif）
    function buildIdleImage(src, symbol) {
        var img = document.createElement('img');
        img.className = 'piece-video';
        img.alt = '';
        img.style.display = 'none';
        img.style.opacity = '0';
        img.addEventListener('load', function () {
            img.style.display = 'block';
            img.style.opacity = '';
            symbol.style.display = 'none';
        });
        img.addEventListener('error', function () {
            img.style.display = 'none';
            symbol.style.display = 'block';
        });
        img.src = src;
        return img;
    }

    /**
     * 播放一次性动画素材（视频或静态图/动图）
     * @param {HTMLElement} host 挂载容器
     * @param {string} src 素材地址
     * @param {boolean} loop 是否循环
     * @param {Function} onEnd 结束回调
     */
    function playVideoOnce(host, src, loop, onEnd) {
        if (!src) {
            if (onEnd) onEnd();
            return null;
        }
        if (!isVideoPath(src)) return playImageFx(host, src, loop, onEnd);

        var done = false;
        function finish() {
            if (done) return;
            done = true;
            if (onEnd) onEnd();
        }
        var video = buildFxVideo(src, loop, finish);
        host.appendChild(video);
        return video;
    }

    // 动画层视频：播完或出错都回调收尾
    function buildFxVideo(src, loop, finish) {
        var video = document.createElement('video');
        video.className = 'piece-video piece-video-fx';
        video.muted = true;
        video.loop = !!loop;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = src;

        video.addEventListener('ended', finish);
        video.addEventListener('error', finish);
        // 安全兜底：素材过长时强制收尾，避免动画拖住棋局
        setTimeout(finish, 2500);
        video.addEventListener('loadeddata', function () {
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
        });
        return video;
    }

    // 静态图/动图的表现层：加载完成即视为播放开始
    function playImageFx(host, src, loop, onEnd) {
        var img = document.createElement('img');
        img.className = 'piece-video piece-video-fx';
        img.alt = '';
        img.style.opacity = '0';

        var done = false;
        function finish() {
            if (done) return;
            done = true;
            if (onEnd) onEnd();
        }

        img.addEventListener('load', function () {
            img.style.opacity = '';
            // 动图会自行循环，静态图停留一小段以形成「播放」观感
            if (!loop) setTimeout(finish, 700);
        });
        img.addEventListener('error', finish);
        if (!loop) setTimeout(finish, 2500);

        img.src = src;
        host.appendChild(img);
        return img;
    }

    // 播放音效（不打断其他音效）
    function playSound(src) {
        if (!soundEnabled || !src) return;
        try {
            var audio = new Audio(src);
            audio.volume = 0.9;
            var p = audio.play();
            if (p && p.catch) {
                p.catch(function () {
                    console.warn('[AssetLoader] 音效播放被拦截:', src);
                });
            }
            audio.addEventListener('ended', function () {
                audio.src = '';
            });
        } catch (e) {
            console.warn('[AssetLoader] 音效播放失败:', e);
        }
    }

    // 按阵营+棋子+状态播放对应语音
    function playPieceSound(campName, pieceType, state) {
        playSound(getPieceAssetPath(campName, pieceType, state, true));
    }

    // 预热默认态素材：提前拉取，降低首帧等待
    function warmUp(campName) {
        var codes = { Pawn: 'p', Rook: 'r', Knight: 'n', Bishop: 'b', Queen: 'q', King: 'k' };
        for (var dir in codes) {
            if (!codes.hasOwnProperty(dir)) continue;
            var key = campName + '/' + dir;
            if (warmCache[key]) continue;
            var src = getPieceAssetPath(campName, codes[dir], 'select', false);
            if (!src) continue;
            var el;
            if (isVideoPath(src)) {
                el = document.createElement('video');
                el.muted = true;
                el.preload = 'auto';
                el.src = src;
            } else {
                el = new Image();
                el.src = src;
            }
            warmCache[key] = el;   // 持有引用，避免被回收导致预载中断
        }
    }

    // 极短静音音频，用于在用户手势中解锁浏览器音频策略
    var SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    var audioUnlocked = false;

    // 必须在真实用户手势（如 pointerdown）中调用
    function unlockAudio() {
        if (audioUnlocked) return;
        try {
            var a = new Audio(SILENT_WAV);
            var p = a.play();
            if (p && p.then) {
                p.then(function () { audioUnlocked = true; })
                 .catch(function () {});
            } else {
                audioUnlocked = true;
            }
        } catch (e) {
            audioUnlocked = false;
        }
    }

    function setSoundEnabled(enabled) {
        soundEnabled = !!enabled;
    }

    // 应用项目 logo：替换 favicon，并填充页面上标记了 data-brand-logo 的 <img>
    function applyBranding() {
        var iconPath = getFaviconPath();
        if (iconPath) {
            var link = document.querySelector('link[rel="icon"]');
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = iconPath;
        }
        var logoPath = getLogoPath();
        if (!logoPath) return;
        var nodes = document.querySelectorAll('[data-brand-logo]');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].tagName === 'IMG') nodes[i].src = logoPath;
            else nodes[i].style.backgroundImage = 'url("' + logoPath + '")';
        }
    }

    function isSoundEnabled() {
        return soundEnabled;
    }

    window.AssetLoader = {
        manifest: manifest,
        getCamps: getCamps,
        getCamp: getCamp,
        getBoards: getBoards,
        getBoard: getBoard,
        getInvalidBoards: getInvalidBoards,
        getLogo: getLogo,
        getLogoPath: getLogoPath,
        getFaviconPath: getFaviconPath,
        getBoardPath: getBoardPath,
        getPieceAssetPath: getPieceAssetPath,
        getResultAssetPath: getResultAssetPath,
        createIdleVisual: createIdleVisual,
        playVideoOnce: playVideoOnce,
        playSound: playSound,
        playPieceSound: playPieceSound,
        warmUp: warmUp,
        unlockAudio: unlockAudio,
        setSoundEnabled: setSoundEnabled,
        isSoundEnabled: isSoundEnabled,
        applyBranding: applyBranding,
        STATE_LABELS: STATE_LABELS,
        PIECE_SYMBOLS: PIECE_SYMBOLS
    };
})();
