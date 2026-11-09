#!/usr/bin/env node
/**
 * ChessCheers 静态资源版本号升降器
 *
 * 纯静态站点没有构建流程，浏览器可能沿用缓存的 css/js。
 * 本脚本把「页面里的 ?v=xxx」与「js 里的 BUILD 常量」统一刷成同一个新值。
 *
 * 用法：
 *   node tools/bump-version.js          # 用当前时间生成新版本号
 *   node tools/bump-version.js 2       # 指定版本号
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

var HTML_FILES = [
    'index.html',
    'code/html/index.html',
    'code/html/game.html',
    'code/html/result.html',
    'code/html/about.html'
];

var JS_FILES = [
    'code/js/index.js',
    'code/js/game.js',
    'code/js/result.js'
];

function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        p(d.getHours()) + p(d.getMinutes());
}

function readVersion() {
    var s = fs.readFileSync(path.join(ROOT, 'code/html/game.html'), 'utf8');
    var m = s.match(/\?v=([\w]+)/);
    return m ? m[1] : null;
}

function bumpHtml(next) {
    var changed = 0;
    HTML_FILES.forEach(function (rel) {
        var file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) return;
        var s = fs.readFileSync(file, 'utf8');
        var out = s.replace(/\?v=[\w]+/g, '?v=' + next);
        if (out !== s) {
            fs.writeFileSync(file, out);
            changed++;
            console.log('  更新 ' + rel);
        }
    });
    return changed;
}

function bumpJs(next) {
    var changed = 0;
    JS_FILES.forEach(function (rel) {
        var file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) return;
        var s = fs.readFileSync(file, 'utf8');
        var out = s.replace(/var BUILD = '[\w]+';/, "var BUILD = '" + next + "';");
        if (out !== s) {
            fs.writeFileSync(file, out);
            changed++;
            console.log('  更新 ' + rel);
        }
    });
    return changed;
}

function main() {
    var next = process.argv[2] || stamp();
    var prev = readVersion();
    if (prev === next) next = next + 'a';

    var changed = bumpHtml(next) + bumpJs(next);
    console.log('[bump-version] ' + (prev || '(无)') + ' -> ' + next + '，共更新 ' + changed + ' 个文件');
}

main();
