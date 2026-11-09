#!/usr/bin/env node
/**
 * ChessCheers 素材清单生成器 + 规范检查器
 *
 * 纯静态站点无法在运行时列举目录，故在启动/部署前扫描 data/ 生成 code/js/assets.js。
 * 同时校验素材是否符合规范（PRD 四.1）：不合格的素材不会出现在网页选项中，并给出原因。
 *
 * 用法：
 *   node tools/scan-assets.js          # 扫描并输出报告
 *   require('./scan-assets').scan()    # 供 serve.js 等复用
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DATA_DIR = path.join(ROOT, 'data');
var PIECE_DIR = path.join(DATA_DIR, 'chesspiece');
var BOARD_DIR = path.join(DATA_DIR, 'chessboard');
var LOGO_DIR = path.join(DATA_DIR, 'chesslogo');
var OUT_FILE = path.join(ROOT, 'code', 'js', 'assets.js');

// 必须存在的 6 个棋子目录
var REQUIRED_PIECES = ['King', 'Queen', 'Bishop', 'Knight', 'Rook', 'Pawn'];

// 图片/音频扩展名（PRD 四.1；webp 用于体积优化后的素材）
var VIDEO_EXT = ['.webm', '.gif', '.png', '.jpg', '.jpeg', '.webp'];
var AUDIO_EXT = ['.wav', '.m4a', '.mp3', '.ogg'];
var BOARD_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
var LOGO_EXT = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];

// 棋盘缩略图后缀：<名字>-mini.webp 只用于首页预览，不单独算作一张棋盘
var BOARD_MINI_SUFFIX = '-mini';
// 棋子静止态预览图（tools/make-posters.js 生成），不参与「选中/落子/被吃」状态映射
var POSTER_PREFIX = '预览';

// 三种状态及其文件名关键字（PRD 四.2）
var STATES = [
    { key: 'select', names: ['选中'] },
    { key: 'drop', names: ['落子'] },
    { key: 'capture', names: ['被吃'] }
];

var OUTCOMES = [
    { key: 'win', names: ['赢棋', 'win'] },
    { key: 'lose', names: ['输棋', 'lose'] },
    { key: 'draw', names: ['和棋', 'draw'] }
];

// 棋盘长宽比容差：严格 1:1，允许 1% 的像素误差
var RATIO_TOLERANCE = 0.01;

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch (e) {
        return false;
    }
}

function extOf(name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.toLowerCase().slice(i);
}

// 按扩展名白名单过滤，忽略隐藏文件
function listFiles(dir, exts) {
    var out = [];
    if (!isDir(dir)) return out;
    var names = fs.readdirSync(dir).sort();
    for (var i = 0; i < names.length; i++) {
        if (names[i].charAt(0) === '.') continue;
        if (exts.indexOf(extOf(names[i])) < 0) continue;
        out.push(names[i]);
    }
    return out;
}

/**
 * 状态映射：把一组素材文件分配到「选中 / 落子 / 被吃」三个状态。
 *
 * 三级兜底的设计理由：素材作者的水平与习惯差异很大——
 *   1. 先按文件名匹配，尊重规范命名的作者；
 *   2. 再按排序分配，让「随手放的几张图」也能跑起来；
 *   3. 最后循环复用，保证只有一张图时三个状态仍有画面，不至于出现空棋子。
 * 宁可重复使用素材，也不让棋盘出现空洞。
 */
function mapStates(files, stateDefs) {
    var result = {};
    var used = {};

    matchByName(files, stateDefs, result, used);
    fillUnmatched(files, stateDefs, result, used);
    applyFallback(stateDefs, result);
    return result;
}

// 第一轮：文件名前缀匹配
function matchByName(files, stateDefs, result, used) {
    for (var i = 0; i < stateDefs.length; i++) {
        for (var j = 0; j < files.length; j++) {
            if (used[files[j]]) continue;
            if (startsWithAny(files[j], stateDefs[i].names)) {
                result[stateDefs[i].key] = files[j];
                used[files[j]] = true;
                break;
            }
        }
    }
}

function startsWithAny(name, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
        if (name.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
}

// 第二轮：按文件顺序填充未匹配的状态
function fillUnmatched(files, stateDefs, result, used) {
    var unused = [];
    var i;
    for (i = 0; i < files.length; i++) {
        if (!used[files[i]]) unused.push(files[i]);
    }
    var cursor = 0;
    for (i = 0; i < stateDefs.length; i++) {
        if (result[stateDefs[i].key]) continue;
        if (!unused.length) break;
        result[stateDefs[i].key] = unused[cursor % unused.length];
        cursor++;
    }
}

// 第三轮：仍为空时循环复用已有素材，避免出现空棋子
function applyFallback(stateDefs, result) {
    var fallback = null;
    var i;
    for (i = 0; i < stateDefs.length; i++) {
        if (result[stateDefs[i].key]) {
            fallback = result[stateDefs[i].key];
            break;
        }
    }
    for (i = 0; i < stateDefs.length; i++) {
        if (!result[stateDefs[i].key]) result[stateDefs[i].key] = fallback;
    }
}

// 扫描单个棋子目录
function scanPiece(campPath, pieceName) {
    var dir = path.join(campPath, pieceName);
    var all = listFiles(dir, VIDEO_EXT);
    var videos = [];
    var poster = null;
    for (var n = 0; n < all.length; n++) {
        if (all[n].indexOf(POSTER_PREFIX) === 0) {
            if (!poster) poster = all[n];
            continue;
        }
        videos.push(all[n]);
    }
    var audios = listFiles(dir, AUDIO_EXT);
    var vMap = mapStates(videos, STATES);
    var aMap = mapStates(audios, STATES);
    var entry = {};

    for (var i = 0; i < STATES.length; i++) {
        var key = STATES[i].key;
        entry[key] = { video: vMap[key] || null, audio: aMap[key] || null, poster: poster };
    }
    entry.poster = poster;
    entry.hasAssets = videos.length > 0;
    entry.videoCount = videos.length;
    entry.audioCount = audios.length;
    return entry;
}

// 扫描结算动画目录
function scanOutcome(campPath) {
    var base = path.join(campPath, '结算动画');
    var out = { win: null, lose: null, draw: null };
    for (var i = 0; i < OUTCOMES.length; i++) {
        var o = OUTCOMES[i];
        var dir = path.join(base, o.key);
        var imgs = listFiles(dir, ['.png', '.jpg', '.jpeg', '.gif', '.webp']);
        var auds = listFiles(dir, AUDIO_EXT);
        var img = null;
        var aud = null;
        var j, k;

        for (j = 0; j < imgs.length && !img; j++) {
            for (k = 0; k < o.names.length; k++) {
                if (imgs[j].indexOf(o.names[k]) === 0) { img = imgs[j]; break; }
            }
        }
        for (j = 0; j < auds.length && !aud; j++) {
            for (k = 0; k < o.names.length; k++) {
                if (auds[j].indexOf(o.names[k]) === 0) { aud = auds[j]; break; }
            }
        }
        out[o.key] = {
            image: img || (imgs.length ? imgs[0] : null),
            audio: aud || (auds.length ? auds[0] : null)
        };
    }
    return out;
}

// 扫描单个阵营，并给出规范检查结论
function scanCamp(name) {
    var campPath = path.join(PIECE_DIR, name);
    var missing = [];
    var pieces = {};

    for (var i = 0; i < REQUIRED_PIECES.length; i++) {
        var p = REQUIRED_PIECES[i];
        if (!isDir(path.join(campPath, p))) {
            missing.push(p);
            continue;
        }
        var entry = scanPiece(campPath, p);
        if (!entry.hasAssets) missing.push(p);
        pieces[p] = entry;
    }

    var result = scanOutcome(campPath);
    return {
        name: name,
        intro: readIntro(campPath),
        valid: missing.length === 0,
        missing: missing,
        reasons: collectReasons(missing, result),
        pieces: pieces,
        result: result
    };
}

// 阵营介绍：可选文件，缺失时为空串
function readIntro(campPath) {
    var introPath = path.join(campPath, '阵营介绍.md');
    return fs.existsSync(introPath) ? fs.readFileSync(introPath, 'utf8') : '';
}

// 规范检查结论：缺棋子会阻断，缺结算素材只提示
function collectReasons(missing, result) {
    var reasons = [];
    if (missing.length) {
        reasons.push('缺少可用棋子：' + missing.join('、') +
            '（每个子需至少 1 个 webm/gif/png/jpg 素材）');
    }
    ['win', 'lose', 'draw'].forEach(function (k) {
        if (!result[k] || (!result[k].image && !result[k].audio)) {
            reasons.push('结算动画「' + k + '」无素材（可用，但会退回灰色弹窗）');
        }
    });
    return reasons;
}

// 读取 PNG 尺寸
function pngSize(buf) {
    if (buf.length < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// 读取 JPEG 尺寸（解析 SOF 段）
function jpgSize(buf) {
    var i = 2;
    while (i < buf.length - 8) {
        if (buf[i] !== 0xff) { i++; continue; }
        var marker = buf[i + 1];
        // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
}

// 读取 WebP 尺寸（RIFF 容器，三种子格式的头部位置不同）
function webpSize(buf) {
    if (buf.length < 30) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (buf.toString('ascii', 8, 12) !== 'WEBP') return null;
    var chunk = buf.toString('ascii', 12, 16);

    if (chunk === 'VP8X') {
        return {
            width: 1 + buf.readUIntLE(24, 3),
            height: 1 + buf.readUIntLE(27, 3)
        };
    }
    if (chunk === 'VP8 ') {
        return {
            width: buf.readUInt16LE(26) & 0x3fff,
            height: buf.readUInt16LE(28) & 0x3fff
        };
    }
    if (chunk === 'VP8L') {
        var bits = buf.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1
        };
    }
    return null;
}

function imageSize(file) {
    try {
        var buf = fs.readFileSync(file);
        var ext = extOf(file);
        if (ext === '.png') return pngSize(buf);
        if (ext === '.jpg' || ext === '.jpeg') return jpgSize(buf);
        if (ext === '.webp') return webpSize(buf);
        return null;
    } catch (e) {
        return null;
    }
}

// 扫描棋盘，严格校验 1:1
function scanBoards() {
    var out = [];
    if (!isDir(BOARD_DIR)) return out;
    var names = fs.readdirSync(BOARD_DIR).sort();
    for (var i = 0; i < names.length; i++) {
        var entry = boardEntry(names[i]);
        if (entry) out.push(entry);
    }
    return out;
}

// 单个棋盘：过滤非图片与缩略图，并校验长宽比
function boardEntry(fileName) {
    if (fileName.charAt(0) === '.') return null;
    var ext = extOf(fileName);
    if (BOARD_EXT.indexOf(ext) < 0) return null;
    var base = fileName.slice(0, fileName.length - ext.length);
    // 首页预览用的缩略图不是一张独立棋盘
    if (base.slice(-BOARD_MINI_SUFFIX.length) === BOARD_MINI_SUFFIX) return null;

    var size = imageSize(path.join(BOARD_DIR, fileName));
    var check = checkSquare(size);
    var miniName = base + BOARD_MINI_SUFFIX + '.webp';
    var thumb = fs.existsSync(path.join(BOARD_DIR, miniName)) ? miniName : fileName;

    return {
        name: base,
        file: fileName,
        thumb: thumb,
        width: size ? size.width : 0,
        height: size ? size.height : 0,
        valid: check.valid,
        reason: check.reason
    };
}

function checkSquare(size) {
    if (!size) {
        return { valid: false, reason: '无法读取图片尺寸，请确认文件未损坏' };
    }
    var ratio = size.width / size.height;
    if (Math.abs(ratio - 1) > RATIO_TOLERANCE) {
        return { valid: false, reason: '长宽比必须为 1:1，当前 ' + size.width + '×' + size.height };
    }
    return { valid: true, reason: '' };
}

// 扫描项目 logo（data/chesslogo/）
// 三级尺寸：原图（品牌源文件）/ 展示图（-512，供页面使用）/ 图标（最小的 -128 等）。
// 页面只加载展示图与图标，原图不进入任何页面的请求，避免几 MB 的开销。
function scanLogo() {
    var files = listFiles(LOGO_DIR, LOGO_EXT);
    if (!files.length) return null;

    var pick = pickLogoFiles(files);
    var main = pick.main || files[0];
    var display = pick.display || main;
    var thumb = pick.thumb || display;

    return {
        file: main,
        path: '../../data/chesslogo/' + main,
        displayFile: display,
        displayPath: '../../data/chesslogo/' + display,
        thumbFile: thumb,
        thumbPath: '../../data/chesslogo/' + thumb
    };
}

// 从 logo 目录中挑出三档：原图 / 展示图 / 图标
function pickLogoFiles(files) {
    var main = null;
    var display = null;
    var thumb = null;
    var thumbSize = Infinity;

    for (var i = 0; i < files.length; i++) {
        var name = files[i];
        if (!/logo/i.test(name)) continue;

        var m = name.match(/-(\d+)\.(png|jpe?g|svg|webp)$/i);
        if (!m) {
            if (!main) main = name;
            continue;
        }
        var size = parseInt(m[1], 10);
        if (size <= 512 && isBetterDisplay(name, size, display)) display = name;
        if (size < thumbSize) { thumb = name; thumbSize = size; }
    }

    return { main: main, display: display, thumb: thumb };
}

// 展示图偏好：webp 优先（体积约为 png 的十分之一），同类取尺寸更大者
function isBetterDisplay(name, size, current) {
    if (!current) return true;
    var isWebp = /\.webp$/i.test(name);
    var curWebp = /\.webp$/i.test(current);
    if (isWebp !== curWebp) return isWebp;
    var m = current.match(/-(\d+)\./);
    return !m || size > parseInt(m[1], 10);
}

function buildPayload() {
    var camps = [];
    if (isDir(PIECE_DIR)) {
        var dirs = fs.readdirSync(PIECE_DIR).sort();
        for (var i = 0; i < dirs.length; i++) {
            if (dirs[i].charAt(0) === '.') continue;
            if (!isDir(path.join(PIECE_DIR, dirs[i]))) continue;
            camps.push(scanCamp(dirs[i]));
        }
    }
    var boards = scanBoards();
    var validCamps = camps.filter(function (c) { return c.valid; });
    var validBoards = boards.filter(function (b) { return b.valid; });

    return {
        generatedAt: new Date().toISOString(),
        // 页面位于 code/html/，需向上两级回到仓库根再进 data/
        pieceRoot: '../../data/chesspiece/',
        boardRoot: '../../data/chessboard/',
        camps: camps,
        boards: boards,
        logo: scanLogo(),
        ready: validCamps.length >= 2 && validBoards.length >= 1
    };
}

function writeManifest(payload) {
    var content = '/**\n' +
        ' * ChessCheers 素材清单（由 tools/scan-assets.js 自动生成，请勿手工编辑）\n' +
        ' * 生成时间: ' + payload.generatedAt + '\n' +
        ' */\n' +
        'window.CHESS_ASSETS = ' + JSON.stringify(payload, null, 2) + ';\n';
    fs.writeFileSync(OUT_FILE, content, 'utf8');
    return OUT_FILE;
}

function report(payload) {
    var validCamps = payload.camps.filter(function (c) { return c.valid; });
    var validBoards = payload.boards.filter(function (b) { return b.valid; });

    console.log('[scan-assets] 已生成 ' + path.relative(ROOT, OUT_FILE));
    console.log('');
    console.log('  阵营：共 ' + payload.camps.length + ' 个，可用 ' + validCamps.length + ' 个');
    payload.camps.forEach(function (c) {
        console.log('    ' + (c.valid ? '✅' : '❌') + ' ' + c.name +
            (c.valid ? '' : ' —— ' + c.reasons.join('；')));
    });
    console.log('');
    console.log('  棋盘：共 ' + payload.boards.length + ' 张，可用 ' + validBoards.length + ' 张');
    payload.boards.forEach(function (b) {
        console.log('    ' + (b.valid ? '✅' : '❌') + ' ' + b.name +
            (b.width ? '（' + b.width + '×' + b.height + '）' : '') +
            (b.valid ? '' : ' —— ' + b.reason));
    });
    console.log('');
    console.log('  Logo：' + (payload.logo ? payload.logo.file : '未提供（使用内置图标）'));
    console.log('  开局就绪：' + (payload.ready ? '是' : '否（需至少 2 个可用阵营 + 1 张合格棋盘）'));
    if (!payload.ready) {
        var tips = [];
        if (validCamps.length < 2) tips.push('可用阵营不足 2 个');
        if (validBoards.length < 1) tips.push('合格棋盘不足 1 张（必须 1:1 正方形）');
        console.log('    原因：' + tips.join('；'));
    }
}

// 对外接口：扫描 + 写清单
function scan(options) {
    options = options || {};
    var payload = buildPayload();
    writeManifest(payload);
    if (options.quiet !== true) report(payload);
    return payload;
}

module.exports = { scan: scan, buildPayload: buildPayload, writeManifest: writeManifest, report: report };

// CLI 直接执行时扫描一次
if (require.main === module) {
    scan();
}
