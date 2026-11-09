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

// 图片/音频扩展名（PRD 四.1）
var VIDEO_EXT = ['.webm', '.gif', '.png', '.jpg', '.jpeg'];
var AUDIO_EXT = ['.wav', '.m4a', '.mp3', '.ogg'];
var BOARD_EXT = ['.png', '.jpg', '.jpeg'];
var LOGO_EXT = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];

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
    var i, j;

    // 第一轮：文件名匹配
    for (i = 0; i < stateDefs.length; i++) {
        for (j = 0; j < files.length; j++) {
            if (used[files[j]]) continue;
            var hit = false;
            for (var k = 0; k < stateDefs[i].names.length; k++) {
                if (files[j].indexOf(stateDefs[i].names[k]) === 0) {
                    hit = true;
                    break;
                }
            }
            if (hit) {
                result[stateDefs[i].key] = files[j];
                used[files[j]] = true;
                break;
            }
        }
    }

    // 第二轮：按文件顺序填充未匹配的状态
    var unused = [];
    for (i = 0; i < files.length; i++) {
        if (!used[files[i]]) unused.push(files[i]);
    }
    var cursor = 0;
    for (i = 0; i < stateDefs.length; i++) {
        if (result[stateDefs[i].key]) continue;
        if (unused.length === 0) break;
        result[stateDefs[i].key] = unused[cursor % unused.length];
        cursor++;
    }

    // 第三轮：仍为空则循环复用已有素材
    var fallback = null;
    for (i = 0; i < stateDefs.length; i++) {
        if (result[stateDefs[i].key]) {
            fallback = result[stateDefs[i].key];
            break;
        }
    }
    for (i = 0; i < stateDefs.length; i++) {
        if (!result[stateDefs[i].key]) result[stateDefs[i].key] = fallback;
    }

    return result;
}

// 扫描单个棋子目录
function scanPiece(campPath, pieceName) {
    var dir = path.join(campPath, pieceName);
    var videos = listFiles(dir, VIDEO_EXT);
    var audios = listFiles(dir, AUDIO_EXT);
    var vMap = mapStates(videos, STATES);
    var aMap = mapStates(audios, STATES);
    var entry = {};

    for (var i = 0; i < STATES.length; i++) {
        var key = STATES[i].key;
        entry[key] = { video: vMap[key] || null, audio: aMap[key] || null };
    }
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
    var i;

    for (i = 0; i < REQUIRED_PIECES.length; i++) {
        var p = REQUIRED_PIECES[i];
        var dir = path.join(campPath, p);
        if (!isDir(dir)) {
            missing.push(p);
            continue;
        }
        var entry = scanPiece(campPath, p);
        if (!entry.hasAssets) missing.push(p);
        pieces[p] = entry;
    }

    var intro = '';
    var introPath = path.join(campPath, '阵营介绍.md');
    if (fs.existsSync(introPath)) {
        intro = fs.readFileSync(introPath, 'utf8');
    }

    var result = scanOutcome(campPath);
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

    return {
        name: name,
        intro: intro,
        valid: missing.length === 0,
        missing: missing,
        reasons: reasons,
        pieces: pieces,
        result: result
    };
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

function imageSize(file) {
    try {
        var buf = fs.readFileSync(file);
        var ext = extOf(file);
        if (ext === '.png') return pngSize(buf);
        if (ext === '.jpg' || ext === '.jpeg') return jpgSize(buf);
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
        if (names[i].charAt(0) === '.') continue;
        var ext = extOf(names[i]);
        if (BOARD_EXT.indexOf(ext) < 0) continue;
        var full = path.join(BOARD_DIR, names[i]);
        var size = imageSize(full);
        var ratioOk = true;
        var reason = '';

        if (!size) {
            ratioOk = false;
            reason = '无法读取图片尺寸，请确认文件未损坏';
        } else {
            var ratio = size.width / size.height;
            if (Math.abs(ratio - 1) > RATIO_TOLERANCE) {
                ratioOk = false;
                reason = '长宽比必须为 1:1，当前 ' + size.width + '×' + size.height;
            }
        }

        out.push({
            name: names[i].slice(0, names[i].length - ext.length),
            file: names[i],
            width: size ? size.width : 0,
            height: size ? size.height : 0,
            valid: ratioOk,
            reason: reason
        });
    }
    return out;
}

// 扫描项目 logo（data/chesslogo/）
// 三级尺寸：原图（品牌源文件）/ 展示图（-512，供页面使用）/ 图标（最小的 -128 等）。
// 页面只加载展示图与图标，原图不进入任何页面的请求，避免几 MB 的开销。
function scanLogo() {
    var files = listFiles(LOGO_DIR, LOGO_EXT);
    if (!files.length) return null;

    var main = null;
    var display = null;
    var displaySize = 0;
    var thumb = null;
    var thumbSize = Infinity;
    var i;

    for (i = 0; i < files.length; i++) {
        var name = files[i];
        if (!/logo/i.test(name)) continue;

        var m = name.match(/-(\d+)\.(png|jpe?g|svg|webp)$/i);
        if (m) {
            var size = parseInt(m[1], 10);
            // 512 一档用于页面展示，其余按最小尺寸作 favicon
            if (size <= 512 && size > displaySize) { display = name; displaySize = size; }
            if (size < thumbSize) { thumb = name; thumbSize = size; }
            continue;
        }
        if (!main) main = name;
    }

    if (!main) main = files[0];
    if (!display) display = main;
    if (!thumb) thumb = display;

    return {
        file: main,
        path: '../../data/chesslogo/' + main,
        displayFile: display,
        displayPath: '../../data/chesslogo/' + display,
        thumbFile: thumb,
        thumbPath: '../../data/chesslogo/' + thumb
    };
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
