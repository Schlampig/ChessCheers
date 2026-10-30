#!/usr/bin/env node
/**
 * ChessCheers 结算页与首页联动检查
 * A. 首页：人 vs 人 应隐藏难度卡片
 * B. PvE 认输 -> 结算页应显示「遗憾失败」（此前恒显「恭喜获胜」）
 * C. PvP 将杀 -> 结算页应显示「白方获胜」
 * 前置：本地已启动 http://127.0.0.1:8766，本机装有 Google Chrome。
 */
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var PORT = 9226;
var BASE = process.env.CC_BASE || 'http://127.0.0.1:8766';

var logs = [];
var msgId = 0, pending = {}, ws = null;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function send(m, p) {
    return new Promise(function (res, rej) {
        msgId++; pending[msgId] = { res: res, rej: rej };
        ws.send(JSON.stringify({ id: msgId, method: m, params: p || {} }));
    });
}

function ev(e) {
    return send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
        .then(function (r) {
            if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.text);
            return r && r.result ? r.result.value : null;
        });
}

function txt(id) {
    return ev('(document.getElementById("' + id + '").textContent||"").replace(/\\s+/g," ").trim()');
}

function cls(id) { return ev('document.getElementById("' + id + '").className'); }

function setSel(id, v) {
    return ev('(function(){var s=document.getElementById("' + id + '");s.value=' +
        JSON.stringify(v) + ';s.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()');
}

// 在棋盘上完成一次点击走子
function clickMove(from, to) {
    return ev('(function(){var b=document.getElementById("board-inner");' +
        'var r=b.getBoundingClientRect();var F="abcdefgh",R="87654321";' +
        'function pt(s){return {x:r.left+(F.indexOf(s[0])+0.5)*r.width/8,' +
        'y:r.top+(R.indexOf(s[1])+0.5)*r.height/8};}' +
        'function f(t,x,y){(t==="pointerdown"?b:window).dispatchEvent(new PointerEvent(t,' +
        '{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:"mouse",isPrimary:true}));}' +
        'var a=pt("' + from + '"),c=pt("' + to + '");' +
        'f("pointerdown",a.x,a.y);f("pointerup",a.x,a.y);' +
        'f("pointerdown",c.x,c.y);f("pointerup",c.x,c.y);return true;})()');
}

function seq(moves) {
    return moves.reduce(function (chain, p) {
        return chain.then(function () { return clickMove(p[0], p[1]).then(function () { return sleep(850); }); });
    }, Promise.resolve());
}

function url(path) { return BASE + '/code/html/' + path; }

// 截图到本地，便于人工核对视觉
function shot(file) {
    return send('Page.captureScreenshot', { format: 'png' }).then(function (r) {
        require('fs').writeFileSync(file, Buffer.from(r.data, 'base64'));
        console.log('   📷 ' + file);
    });
}

function main() {
    var http = require('http');
    require('child_process').spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
        '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
        '--window-size=1200,900', '--user-data-dir=/tmp/cc-res', 'about:blank'],
        { stdio: 'ignore', detached: true }).unref();

    console.log('启动 Chrome（端口 ' + PORT + '）...');

    return waitTarget(http).then(function (t) {
        return new Promise(function (res, rej) {
            ws = new WebSocket(t.webSocketDebuggerUrl);
            ws.onopen = res; ws.onerror = function () { rej(new Error('WS 失败')); };
            ws.onmessage = onMessage;
        });
    }).then(function () { return send('Runtime.enable'); })
      .then(function () { return send('Log.enable'); })
      .then(function () { return send('Page.enable'); })

      // ---- A. 首页：pvp 隐藏难度 ----
      .then(function () { console.log('\n--- A. 首页 人 vs 人 隐藏难度 ---'); })
      .then(function () { return send('Page.navigate', { url: url('index.html') }); })
      .then(function () { return sleep(2500); })
      .then(function () { return cls('elo-config-item'); })
      .then(function (c) {
          console.log('   默认(pve): ' + c + (/hidden/.test(c) ? ' ❌ 不该隐藏' : ' ✅ 显示'));
      })
      .then(function () { return setSel('game-mode', 'pvp'); })
      .then(function () { return sleep(300); })
      .then(function () { return cls('elo-config-item'); })
      .then(function (c) {
          console.log('   切到 pvp: ' + c + (/hidden/.test(c) ? ' ✅ 已隐藏' : ' ❌ 未隐藏'));
          return shot('/tmp/cc-index-pvp.png');
      })
      .then(function () { return setSel('game-mode', 'pve'); })

      // ---- B. PvE 执白认输 -> 遗憾失败 ----
      .then(function () { console.log('\n--- B. PvE 执白认输（此前恒显「恭喜获胜」）---'); })
      .then(function () {
          return send('Page.navigate', {
              url: url('game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
                  '&bf=' + encodeURIComponent('阿贝母鸡卡') +
                  '&board=' + encodeURIComponent('标准') + '&mode=pve&elo=600&side=white')
          });
      })
      .then(function () { return sleep(3500); })
      .then(function () { return ev('document.getElementById("resign-btn").click()'); })
      .then(function () { return sleep(2600); })
      .then(function () { return ev('location.pathname'); })
      .then(function (p) {
          console.log('   已跳转: ' + p);
          return Promise.all([txt('result-title'), txt('result-subtitle'), cls('result-content')]);
      })
      .then(function (r) {
          console.log('   标题: ' + r[0]);
          console.log('   小标题: ' + r[1]);
          console.log('   布局类: ' + r[2]);
          var ok = /遗憾失败/.test(r[0]);
          console.log(ok ? '   ✅ 认输正确显示失败' : '   ❌ 胜负判定仍错误');
          return shot('/tmp/cc-result-lose.png');
      })

      // ---- C. PvP 傻瓜将杀 -> 白方获胜 ----
      .then(function () { console.log('\n--- C. PvP 学者将杀（1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7#）---'); })
      .then(function () {
          return send('Page.navigate', {
              url: url('game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
                  '&bf=' + encodeURIComponent('阿贝母鸡卡') +
                  '&board=' + encodeURIComponent('标准') + '&mode=pvp')
          });
      })
      .then(function () { return sleep(3500); })
      .then(function () {
          return seq([['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'],
              ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']]);
      })
      .then(function () { return sleep(6000); })   // 将杀需先播国王被吃动画再跳转
      .then(function () { return ev('location.pathname'); })
      .then(function (p) {
          console.log('   已跳转: ' + p);
          return Promise.all([txt('result-title'), txt('result-subtitle')]);
      })
      .then(function (r) {
          console.log('   标题: ' + r[0]);
          console.log('   小标题: ' + r[1]);
          var ok = /白方获胜/.test(r[0]);
          console.log(ok ? '   ✅ 将杀正确判定白方获胜' : '   ❌ 将杀判定错误');
      })

      // ---- D. 结算页按钮与再来一盘 ----
      .then(function () { console.log('\n--- D. 结算页交互 ---'); })
      .then(function () {
          return ev('(function(){return {' +
              'replay:!!document.getElementById("replay-btn"),' +
              'print:!!document.getElementById("print-btn"),' +
              'confirm:(document.getElementById("confirm-btn")||{}).href||""};})()');
      })
      .then(function (r) {
          console.log('   再来一盘=' + r.replay + ' 打印=' + r.print +
              ' 确认指向=' + r.confirm.replace(/^.*\//, ''));
          console.log(r.replay && r.print && /index/.test(r.confirm)
              ? '   ✅ 三个按钮齐全' : '   ❌ 按钮缺失');
          // 触发打印，检查导出逻辑是否抛异常
          return ev('document.getElementById("print-btn").click()');
      })
      .then(function () { return sleep(800); })
      .then(function () {
          var errs = logs.filter(function (l) { return /exception|TypeError/.test(l); });
          console.log(errs.length ? '   ❌ 打印触发异常' : '   ✅ 打印未报错');
          return ev('document.getElementById("replay-btn").click()');
      })
      .then(function () { return sleep(3000); })
      .then(function () { return ev('(function(){return {path:location.pathname,' +
          'pieces:document.querySelectorAll("#piece-layer .piece").length};})()'); })
      .then(function (r) {
          console.log('   再来一盘后: ' + r.path.replace(/^.*\//, '') + ' 棋子=' + r.pieces);
          console.log(r.pieces === 32 ? '   ✅ 沿用配置重开成功' : '   ❌ 重开异常');
      })
      .then(function () {
          console.log('\n--- 控制台异常 ---');
          var errs = logs.filter(function (l) { return /exception|SyntaxError|TypeError/.test(l); });
          if (!errs.length) console.log('   （无异常）');
          errs.slice(0, 10).forEach(function (l) { console.log('   ' + l); });
          process.exit(0);
      })
      .catch(function (e) {
          console.error('❌ 失败:', e.message);
          logs.slice(-12).forEach(function (l) { console.log('   ' + l); });
          process.exit(1);
      });
}

function waitTarget(http) {
    var t0 = Date.now();
    return (function loop() {
        return new Promise(function (resolve) {
            http.get('http://127.0.0.1:' + PORT + '/json/list', function (res) {
                var b = ''; res.on('data', function (d) { b += d; });
                res.on('end', function () {
                    try { resolve(JSON.parse(b).filter(function (t) { return t.type === 'page'; })[0] || null); }
                    catch (e) { resolve(null); }
                });
            }).on('error', function () { resolve(null); });
        }).then(function (p) {
            if (p) return p;
            if (Date.now() - t0 > 20000) throw new Error('调试端口未就绪');
            return sleep(500).then(loop);
        });
    })();
}

function onMessage(e) {
    var m = JSON.parse(e.data);
    if (m.id && pending[m.id]) {
        var p = pending[m.id]; delete pending[m.id];
        if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
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
