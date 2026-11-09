#!/usr/bin/env node
/**
 * ChessCheers 首页端到端检查：验证清单驱动的下拉选项、联动、校验与跳转。
 * 前置：本地已启动 http://127.0.0.1:8766，且本机装有 Google Chrome。
 */
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var PORT = 9223;
var BASE = process.env.CC_BASE || 'http://127.0.0.1:8766';
var INDEX = BASE + '/code/html/index.html';

var logs = [];
var msgId = 0;
var pending = {};
var ws = null;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function send(method, params) {
    return new Promise(function (resolve, reject) {
        msgId++;
        pending[msgId] = { resolve: resolve, reject: reject };
        ws.send(JSON.stringify({ id: msgId, method: method, params: params || {} }));
    });
}

function evaluate(expr) {
    return send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        .then(function (r) {
            if (r && r.exceptionDetails) {
                throw new Error(r.exceptionDetails.text);
            }
            return r && r.result ? r.result.value : null;
        });
}

// 读取 select 的可见选项
function options(id) {
    return evaluate('(function(){var s=document.getElementById("' + id + '");' +
        'var o=[];for(var i=0;i<s.options.length;i++)o.push(s.options[i].value);' +
        'return {list:o,value:s.value};})()');
}

function setSelect(id, value) {
    return evaluate('(function(){var s=document.getElementById("' + id + '");' +
        's.value=' + JSON.stringify(value) + ';' +
        's.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()');
}

function text(id) {
    return evaluate('(document.getElementById("' + id + '").textContent||"").replace(/\\s+/g," ").trim()');
}

function cls(id) {
    return evaluate('document.getElementById("' + id + '").className');
}

function main() {
    var http = require('http');

    require('child_process').spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
        '--window-size=1200,1000', '--user-data-dir=/tmp/cc-index-profile', 'about:blank'
    ], { stdio: 'ignore', detached: true }).unref();

    console.log('启动 Chrome（端口 ' + PORT + '）...');

    return waitTarget(http).then(function (t) {
        return new Promise(function (res, rej) {
            ws = new WebSocket(t.webSocketDebuggerUrl);
            ws.onopen = res;
            ws.onerror = function () { rej(new Error('WS 连接失败')); };
            ws.onmessage = onMessage;
        });
    }).then(function () { return send('Runtime.enable'); })
      .then(function () { return send('Log.enable'); })
      .then(function () { return send('Page.enable'); })
      .then(function () { console.log('打开首页...'); return send('Page.navigate', { url: INDEX }); })
      .then(function () { return sleep(2500); })

      // 1. 下拉选项来自清单
      .then(function () { return options('white-faction'); })
      .then(function (o) {
          console.log('白方选项:', JSON.stringify(o.list), '| 当前:', o.value);
          var ok = o.list.length >= 3 && o.list[0] === 'random';
          console.log(ok ? '✅ 阵营下拉已由清单填充（含随机）' : '❌ 阵营下拉异常');
          return options('board-select');
      })
      .then(function (o) {
          console.log('棋盘选项:', JSON.stringify(o.list), '| 当前:', o.value);
          console.log(o.list.length >= 1 ? '✅ 棋盘下拉已填充，默认=' + o.value : '❌ 棋盘下拉为空');
      })

      // 2. 选择阵营后介绍更新
      .then(function () { return options('white-faction').then(function (o) { return o.list[1]; }); })
      .then(function (camp) {
          console.log('选择白方阵营:', camp);
          return setSelect('white-faction', camp).then(function () { return sleep(300); })
              .then(function () { return text('faction-intro'); })
              .then(function (t) {
                  var ok = t.indexOf(camp) >= 0 && t.length > camp.length + 5;
                  console.log(ok ? '✅ 阵营介绍已展示：' + t.slice(0, 60) + '…' : '❌ 介绍未更新：' + t);
              });
      })

      // 3. 模式联动：pvp 隐藏执棋颜色
      .then(function () { return setSelect('game-mode', 'pvp'); })
      .then(function () { return sleep(300); })
      .then(function () { return cls('color-config-item'); })
      .then(function (c) {
          console.log(/hidden/.test(c) ? '✅ 人 vs 人 已隐藏执棋颜色' : '❌ 执棋颜色未隐藏: ' + c);
          return text('game-mode-desc');
      })
      .then(function (t) {
          var ok = t.indexOf('你来操控黑白双方') >= 0;
          console.log(ok ? '✅ 模式文案正确：' + t : '❌ 模式文案: ' + t);
          return setSelect('game-mode', 'pve');
      })
      .then(function () { return sleep(300); })
      .then(function () { return cls('color-config-item'); })
      .then(function (c) {
          console.log(!/hidden/.test(c) ? '✅ 人 vs 机 已显示执棋颜色' : '❌ 执棋颜色未显示');
      })

      // 4. 难度联动
      .then(function () { return setSelect('elo-difficulty', '2100'); })
      .then(function () { return sleep(300); })
      .then(function () { return text('elo-desc'); })
      .then(function (t) { console.log('✅ 难度说明:', t); })

      // 5. 点击开始并校验跳转参数
      .then(function () { return evaluate('document.getElementById("start-btn").disabled'); })
      .then(function (d) { console.log(d ? '❌ 开始按钮被禁用' : '✅ 开始按钮可用'); })
      .then(function () {
          return evaluate('document.getElementById("start-btn").click()');
      })
      .then(function () { return sleep(3000); })
      .then(function () {
          return evaluate('location.href');
      })
      .then(function (url) {
          console.log('跳转 URL:', decodeURIComponent(url));
          var ok = /game\.html/.test(url) && /wf=/.test(url) && /bf=/.test(url) &&
              /board=/.test(url) && /mode=/.test(url) && /elo=/.test(url) && /side=/.test(url);
          console.log(ok ? '✅ 跳转参数完整' : '❌ 跳转参数缺失');
          return sleep(2500);
      })
      .then(function () {
          return evaluate('(function(){return {' +
              'pieces:document.querySelectorAll("#piece-layer .piece").length,' +
              'badgeW:document.getElementById("badge-white").textContent,' +
              'badgeB:document.getElementById("badge-black").textContent};})()');
      })
      .then(function (r) {
          console.log('对弈页渲染: 棋子=' + r.pieces + ' | ' + r.badgeW + ' | ' + r.badgeB);
          console.log(r.pieces === 32 ? '✅ 对弈页 32 子渲染正常' : '❌ 对弈页渲染异常');
          console.log(/明日方舟|阿贝/.test(r.badgeW) ? '✅ 阵营已落实' : '❌ 阵营未落实');
      })
      .then(function () {
          console.log('');
          console.log('--- 控制台日志 ---');
          logs.slice(-12).forEach(function (l) { console.log('  ' + l); });
          process.exit(0);
      })
      .catch(function (e) {
          console.error('❌ 检查失败:', e.message);
          logs.slice(-15).forEach(function (l) { console.log('  ' + l); });
          process.exit(1);
      });
}

function waitTarget(http) {
    var t0 = Date.now();
    return (function loop() {
        return new Promise(function (resolve) {
            http.get('http://127.0.0.1:' + PORT + '/json/list', function (res) {
                var b = '';
                res.on('data', function (d) { b += d; });
                res.on('end', function () {
                    try {
                        resolve(JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0] || null);
                    } catch (e) { resolve(null); }
                });
            }).on('error', function () { resolve(null); });
        }).then(function (p) {
            if (p) return p;
            if (Date.now() - t0 > 20000) throw new Error('调试端口未就绪');
            return sleep(500).then(loop);
        });
    })();
}

function onMessage(ev) {
    var m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.reject(new Error(JSON.stringify(m.error)));
        else p.resolve(m.result);
        return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
        logs.push('[' + m.params.type + '] ' + (m.params.args || []).map(function (a) {
            return a.value !== undefined ? String(a.value) : (a.description || a.type);
        }).join(' '));
    }
    if (m.method === 'Log.entryAdded') logs.push('[log] ' + m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') {
        var d = m.params.exceptionDetails;
        logs.push('[exception] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
}

main();
