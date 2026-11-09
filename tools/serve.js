#!/usr/bin/env node
/**
 * ChessCheers 本地预览服务器
 *
 * 相比 `python3 -m http.server`，它多做三件事：
 *   1. 启动时自动扫描 data/ 并重新生成 code/js/assets.js —— 新增阵营/棋盘后重启即可生效
 *   2. 输出素材规范检查报告，不合格的素材不会进入网页选项
 *   3. 正确设置 .wasm / .webm / .m4a 的 MIME，并禁用缓存，避免改动看不到
 *
 * 用法：
 *   node tools/serve.js          # 默认 8766 端口
 *   node tools/serve.js 8080     # 指定端口
 *   node tools/serve.js 8080 -s  # 只起服务，不重新扫描素材
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '..');

var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wasm': 'application/wasm'
};

function parseArgs() {
    var args = process.argv.slice(2);
    var port = 8766;
    var skipScan = false;
    for (var i = 0; i < args.length; i++) {
        if (args[i] === '-s' || args[i] === '--skip-scan') skipScan = true;
        else if (/^\d+$/.test(args[i])) port = parseInt(args[i], 10);
    }
    return { port: port, skipScan: skipScan };
}

// 阻止 ../ 目录穿越
function resolveSafe(pathname) {
    var decoded = decodeURIComponent(pathname.split('?')[0]);
    var full = path.normalize(path.join(ROOT, decoded));
    if (full.indexOf(ROOT) !== 0) return null;
    return full;
}

function send(res, status, body, headers) {
    var h = headers || {};
    // 开发服务器统一禁用缓存：改完 css/js 刷新即生效，避免与浏览器缓存反复纠缠
    h['Cache-Control'] = 'no-store';
    res.writeHead(status, h);
    res.end(body);
}

function serveFile(res, file) {
    var ext = path.extname(file).toLowerCase();
    var type = MIME[ext] || 'application/octet-stream';
    fs.readFile(file, function (err, buf) {
        if (err) {
            send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
            return;
        }
        send(res, 200, buf, { 'Content-Type': type, 'Content-Length': buf.length });
    });
}

function handle(req, res) {
    var parsed = url.parse(req.url);
    var file = resolveSafe(parsed.pathname);
    if (!file) {
        send(res, 403, '403 Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    fs.stat(file, function (err, stat) {
        if (!err && stat.isDirectory()) {
            var index = path.join(file, 'index.html');
            fs.stat(index, function (e2, s2) {
                if (!e2 && s2.isFile()) serveFile(res, index);
                else send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
            });
            return;
        }
        if (err) {
            send(res, 404, '404 Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
            return;
        }
        serveFile(res, file);
    });
}

function openBrowser(port) {
    var target = 'http://127.0.0.1:' + port + '/';
    var cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
        childProcess.exec(cmd + ' ' + target);
    } catch (e) { /* 打不开就算了 */ }
}

function main() {
    var opts = parseArgs();

    console.log('==============================================');
    console.log('  ChessCheers 本地预览');
    console.log('==============================================');

    if (!opts.skipScan) {
        console.log('  正在检查 data/ 下的素材…');
        console.log('');
        try {
            require('./scan-assets.js').scan();
        } catch (e) {
            console.error('  素材扫描失败：' + e.message);
            console.error('  将以现有清单继续启动（可用 -s 参数跳过扫描）');
        }
        console.log('');
    }

    var server = http.createServer(handle);
    server.listen(opts.port, '127.0.0.1', function () {
        console.log('  访问地址: http://127.0.0.1:' + opts.port + '/');
        console.log('  停止服务: Ctrl + C');
        console.log('==============================================');
        console.log('');
        if (process.env.CC_NO_OPEN !== '1') openBrowser(opts.port);
    });

    server.on('error', function (e) {
        if (e.code === 'EADDRINUSE') {
            console.error('  端口 ' + opts.port + ' 已被占用，请换一个：node tools/serve.js 8080');
        } else {
            console.error('  服务启动失败：' + e.message);
        }
        process.exit(1);
    });
}

main();
