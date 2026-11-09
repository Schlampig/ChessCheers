#!/usr/bin/env node
/**
 * ChessCheers 棋子预览图生成器
 *
 * 为什么需要它：棋子素材是带透明通道的 webm，单个 0.5~6MB。棋盘上 32 个棋子若都用
 * <video preload="auto"> 呈现静止状态，首屏要拉几十 MB，弱网下几乎无法进入对局。
 * 本工具把每个「选中.webm」的首帧截成 192px 的 webp（含透明通道），页面静止态用
 * 这张图，只有真正播放动画时才按需加载视频。
 *
 * 依赖：本机安装 Google Chrome（与 code/test 的 CDP 脚本一致）。
 * 用法：node tools/make-posters.js [阵营名...]
 *       node tools/make-posters.js --force     # 覆盖已存在的预览图
 */
var { spawn } = require('child_process');
var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PIECE_DIR = path.join(ROOT, 'data', 'chesspiece');
var CHROME = process.env.CC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var SIZE = 192;
var POSTER_NAME = '预览.webp';

var args = process.argv.slice(2);
var force = args.indexOf('--force') >= 0;
var only = args.filter(function (a) { return a.charAt(0) !== '-'; });

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function buildTasks() {
    var tasks = [];
    var camps = fs.readdirSync(PIECE_DIR).sort();
    camps.forEach(function (camp) {
        if (camp.charAt(0) === '.' || !isDir(path.join(PIECE_DIR, camp))) return;
        if (only.length && only.indexOf(camp) < 0) return;
        fs.readdirSync(path.join(PIECE_DIR, camp)).sort().forEach(function (piece) {
            var dir = path.join(PIECE_DIR, camp, piece);
            if (!isDir(dir)) return;
            var files = fs.readdirSync(dir);
            var video = files.filter(function (f) { return /\.(webm|mp4)$/i.test(f) && f.indexOf('选中') === 0; })[0] ||
                files.filter(function (f) { return /\.(webm|mp4)$/i.test(f); })[0];
            if (!video) return;
            var poster = path.join(dir, POSTER_NAME);
            if (!force && fs.existsSync(poster)) return;
            tasks.push({
                camp: camp,
                piece: piece,
                src: 'data/chesspiece/' + camp + '/' + piece + '/' + video,
                out: poster
            });
        });
    });
    return tasks;
}

var get = function (port, p) {
    return new Promise(function (resolve, reject) {
        http.get({ host: '127.0.0.1', port: port, path: p }, function (res) {
            var d = '';
            res.on('data', function (c) { d += c; });
            res.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
};
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
    var tasks = buildTasks();
    if (!tasks.length) {
        console.log('[make-posters] 没有需要生成的预览图（加 --force 可覆盖）');
        return;
    }

    var port = 9700 + Math.floor(Math.random() * 200);
    var profile = '/tmp/cc-poster-' + process.pid;
    var chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking', '--remote-allow-origins=*',
        '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: 'ignore' });

    var version = null;
    for (var i = 0; i < 60; i++) {
        try { version = await get(port, '/json/version'); break; } catch (e) { await sleep(200); }
    }
    if (!version) {
        console.error('[make-posters] Chrome 未能启动，请确认已安装 Google Chrome');
        chrome.kill();
        process.exit(1);
    }

    var targets = await get(port, '/json/list');
    var page = targets.filter(function (t) { return t.type === 'page'; })[0];
    var ws = new WebSocket(page.webSocketDebuggerUrl);
    var id = 0;
    var pending = new Map();
    var send = function (method, params) {
        return new Promise(function (resolve, reject) {
            var msgId = ++id;
            pending.set(msgId, { resolve: resolve, reject: reject });
            ws.send(JSON.stringify({ id: msgId, method: method, params: params || {} }));
        });
    };
    ws.onmessage = function (ev) {
        var msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            var p = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
    };
    await new Promise(function (r) { ws.onopen = r; });
    await send('Page.enable');
    await send('Runtime.enable');

    // 用本地服务打开任意页面，保证与素材同源（这里直接开首页，只借用其 origin）
    await send('Page.navigate', { url: process.env.CC_BASE || 'http://127.0.0.1:8766/code/html/index.html' });
    await sleep(1500);

    var ok = 0;
    var fail = 0;
    for (var t of tasks) {
        var expr = '(function(){' +
            'return new Promise(function(resolve){' +
            'var v=document.createElement("video");' +
            'v.muted=true;v.playsInline=true;v.preload="auto";' +
            'v.src=' + JSON.stringify(encodeURI('/' + t.src)) + ';' +
            'var done=false;' +
            'function draw(){' +
            '  if(done)return;done=true;' +
            '  var s=' + SIZE + ';' +
            '  var c=document.createElement("canvas");' +
            '  c.width=s;c.height=s;' +
            '  var g=c.getContext("2d");' +
            '  var vw=v.videoWidth||s, vh=v.videoHeight||s;' +
            '  var k=Math.min(s/vw, s/vh);' +
            '  var w=vw*k, h=vh*k;' +
            '  g.drawImage(v, (s-w)/2, (s-h)/2, w, h);' +
            '  try{ resolve(c.toDataURL("image/webp",0.88)); }catch(e){ resolve("ERR:"+e.message); }' +
            '}' +
            'v.addEventListener("loadeddata",function(){ try{v.currentTime=0.05;}catch(e){draw();} });' +
            'v.addEventListener("seeked",draw);' +
            'v.addEventListener("error",function(){ if(!done){done=true;resolve("ERR:load");} });' +
            'setTimeout(function(){ if(!done){ try{v.currentTime=0.05;}catch(e){} } },4000);' +
            '});})()';
        var r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        var data = r.result && r.result.value;
        if (typeof data === 'string' && data.indexOf('data:image/webp;base64,') === 0) {
            fs.writeFileSync(t.out, Buffer.from(data.split(',')[1], 'base64'));
            var kb = Math.round(fs.statSync(t.out).size / 1024);
            console.log('  ✅ ' + t.camp + '/' + t.piece + ' → ' + POSTER_NAME + '  ' + kb + 'KB');
            ok++;
        } else {
            console.log('  ❌ ' + t.camp + '/' + t.piece + ' → ' + (data || '无返回'));
            fail++;
        }
    }

    ws.close();
    chrome.kill();
    await sleep(200);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    console.log('[make-posters] 完成：成功 ' + ok + ' 个，失败 ' + fail + ' 个');
    process.exit(fail ? 1 : 0);
})().catch(function (e) {
    console.error('[make-posters] 失败:', e.message);
    process.exit(1);
});
