#!/usr/bin/env node
/**
 * ChessCheers — 对弈页端到端检查
 *
 * 通过 CDP 在真实时间下驱动对弈页：模拟走子并等待 Stockfish 应手，
 * 覆盖吃子 / 易位 / 吃过路兵 / 升变 / 非法走法 / 拖拽 / 视角翻转 / 终局判定。
 * 前置：本地已启动 http://127.0.0.1:8766，且本机装有 Google Chrome。
 */
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var PORT = 9222;
var BASE = process.env.CC_BASE || 'http://127.0.0.1:8766';
var URL = BASE + '/code/html/game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
    '&bf=' + encodeURIComponent('阿贝母鸡卡') +
    '&board=' + encodeURIComponent('标准') + '&mode=pve&elo=600&side=white';

var logs = [];
var msgId = 0;
var pending = {};
var ws = null;
var sessionId = null;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function send(method, params) {
    return new Promise(function (resolve, reject) {
        msgId++;
        pending[msgId] = { resolve: resolve, reject: reject };
        var payload = { id: msgId, method: method, params: params || {} };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
    });
}

function evaluate(expression) {
    return send('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: true
    }).then(function (r) {
        if (r && r.exceptionDetails) {
            throw new Error(r.exceptionDetails.text + ' ' +
                (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : ''));
        }
        return r && r.result ? r.result.value : null;
    });
}

// 在页面内派发指针事件完成一次点击走子
function clickMove(from, to) {
    var expr = '(function(){' +
        'var board=document.getElementById("board-inner");' +
        'var r=board.getBoundingClientRect();' +
        'var F="abcdefgh",R="87654321";' +
        'function pt(s){return {x:r.left+(F.indexOf(s[0])+0.5)*r.width/8,' +
        'y:r.top+(R.indexOf(s[1])+0.5)*r.height/8};}' +
        'function fire(t,x,y){var e=new PointerEvent(t,{bubbles:true,cancelable:true,' +
        'clientX:x,clientY:y,pointerId:1,pointerType:"mouse",isPrimary:true});' +
        '(t==="pointerdown"?board:window).dispatchEvent(e);}' +
        'var a=pt("' + from + '"),b=pt("' + to + '");' +
        'fire("pointerdown",a.x,a.y);fire("pointerup",a.x,a.y);' +
        'fire("pointerdown",b.x,b.y);fire("pointerup",b.x,b.y);' +
        'return true;})()';
    return evaluate(expr);
}

function moveCount() {
    return evaluate('(function(){var c=document.querySelectorAll("#move-list .move-cell");' +
        'var n=0;for(var i=0;i<c.length;i++){if(c[i].textContent.replace(/\\s/g,""))n++;}' +
        'return n;})()');
}

function moveText() {
    return evaluate('document.getElementById("move-list").textContent.replace(/\\s+/g," ").trim()');
}

function waitFor(fn, timeout, label) {
    var t0 = Date.now();
    return (function loop() {
        return fn().then(function (ok) {
            if (ok) return true;
            if (Date.now() - t0 > timeout) {
                console.log('⏱  等待超时: ' + label);
                return false;
            }
            return sleep(300).then(loop);
        });
    })();
}

function main() {
    var http = require('http');

    // 打开浏览器调试端口
    require('child_process').spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        '--remote-debugging-port=' + PORT, '--remote-allow-origins=*',
        '--window-size=1280,900', '--user-data-dir=/tmp/cc-cdp-profile', 'about:blank'
    ], { stdio: 'ignore', detached: true }).unref();

    console.log('启动 Chrome（调试端口 ' + PORT + '）...');

    return waitForTarget(http).then(function (target) {
        return new Promise(function (resolve, reject) {
            ws = new WebSocket(target.webSocketDebuggerUrl);
            ws.onopen = function () { resolve(); };
            ws.onerror = function (e) { reject(new Error('WebSocket 连接失败')); };
            ws.onmessage = onMessage;
        });
    }).then(function () {
        return send('Target.attachToTarget', { targetId: null, flatten: true }).catch(function () { return null; });
    }).then(function () {
        return send('Runtime.enable');
    }).then(function () {
        return send('Log.enable');
    }).then(function () {
        console.log('打开对弈页...');
        return send('Page.navigate', { url: URL });
    }).then(function () {
        return sleep(4000);
    }).then(function () {
        return evaluate('(function(){return {' +
            'pieces:document.querySelectorAll("#piece-layer .piece").length,' +
            'videos:document.querySelectorAll("#piece-layer video").length,' +
            'bg:document.getElementById("board-bg").style.backgroundImage.slice(0,60),' +
            'engine:(window.StockfishEngine?window.StockfishEngine.isReady():false)' +
            '};})()');
    }).then(function (info) {
        console.log('渲染检查:', JSON.stringify(info));
        console.log('模拟玩家走子 e2 -> e4 ...');
        return clickMove('e2', 'e4');
    }).then(function () {
        return waitFor(function () { return moveCount().then(function (n) { return n >= 1; }); }, 8000, '玩家走子');
    }).then(function (ok) {
        console.log(ok ? '✅ 玩家走子已记录' : '❌ 玩家走子未生效');
        return moveText();
    }).then(function (t) {
        console.log('   棋谱:', t);
        console.log('等待 AI 应手...');
        return waitFor(function () { return moveCount().then(function (n) { return n >= 2; }); }, 30000, 'AI 应手');
    }).then(function (ok) {
        return moveText().then(function (t) {
            console.log(ok ? '✅ AI 已应手' : '❌ AI 未应手');
            console.log('   棋谱:', t);
        });
    }).then(function () {
        return evaluate('(function(){return {' +
            'ready:window.StockfishEngine.isReady(),' +
            'failed:window.StockfishEngine.hasFailed(),' +
            'thinking:document.getElementById("thinking").className,' +
            'toast:document.getElementById("toast").textContent' +
            '};})()');
    }).then(function (d) {
        console.log('引擎诊断:', JSON.stringify(d));
        return runCaptureTest()
            .then(runCastlingTest)
            .then(runEnPassantTest)
            .then(runPromotionTest)
            .then(runIllegalTest)
            .then(runDragTest)
            .then(runFlipTest)
            .then(runOutcomeTest);
    }).then(function () {
        console.log('');
        console.log('--- 浏览器控制台（引擎相关）---');
        var shown = logs.filter(function (l) {
            return /Stockfish|引擎|UCI|bestmove|Worker|wasm/i.test(l);
        });
        if (!shown.length) shown = logs.slice(-25);
        shown.slice(0, 30).forEach(function (l) { console.log('  ' + l); });
        console.log('');
        console.log('--- 最近 15 条全部日志 ---');
        logs.slice(-15).forEach(function (l) { console.log('  ' + l); });
        process.exit(0);
    }).catch(function (e) {
        console.error('❌ 检查失败:', e.message);
        logs.slice(-20).forEach(function (l) { console.log('  ' + l); });
        process.exit(1);
    });
}

// 第二段：PvP 模式下验证吃子与棋子移除（不依赖 AI，序列可控）
function runCaptureTest() {
    var PVP = BASE + '/code/html/game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
        '&bf=' + encodeURIComponent('阿贝母鸡卡') +
        '&board=' + encodeURIComponent('标准') + '&mode=pvp';
    console.log('');
    console.log('--- 吃子测试（PvP：1.e4 d5 2.exd5）---');
    return send('Page.navigate', { url: PVP })
        .then(function () { return sleep(3500); })
        .then(function () { return clickMove('e2', 'e4'); })
        .then(function () { return sleep(1200); })
        .then(function () { return clickMove('d7', 'd5'); })
        .then(function () { return sleep(1200); })
        .then(function () { return clickMove('e4', 'd5'); })
        .then(function () { return sleep(1800); })
        .then(function () { return moveText(); })
        .then(function (t) {
            var ok = t.indexOf('exd5') >= 0;
            console.log(ok ? '✅ 吃子走法已记录: ' + t : '❌ 吃子未生效: ' + t);
            return evaluate('(function(){' +
                'var all=document.querySelectorAll("#piece-layer .piece");' +
                'var n=0;for(var i=0;i<all.length;i++){if(all[i].style.opacity!=="0")n++;}' +
                'return {total:all.length,visible:n,' +
                'd5:!!document.querySelector(\'#piece-layer .piece[data-square="d5"]\'),' +
                'toast:document.getElementById("toast").textContent};})()');
        })
        .then(function (r) {
            var ok = r.total === 31 && !/黑/.test(r.d5 + '');
            console.log('   棋盘剩余棋子: ' + r.total + '（应为 31）');
            console.log('   d5 格为白方棋子: ' + r.d5);
            console.log('   提示: ' + (r.toast || '(无)'));
        })
        .catch(function (e) { console.log('❌ 吃子测试异常: ' + e.message); });
}

// 用固定序列走完一组走法，返回最终棋谱
function playSequence(moves) {
    return moves.reduce(function (chain, pair) {
        return chain.then(function () {
            return clickMove(pair[0], pair[1]).then(function () { return sleep(900); });
        });
    }, Promise.resolve()).then(function () { return sleep(900); }).then(moveText);
}

// 查询某格上的棋子（颜色/类型）
function pieceAtSquare(sq) {
    return evaluate('(function(){var e=document.querySelector(' +
        '\'#piece-layer .piece[data-square="' + sq + '"]\');' +
        'if(!e)return null;' +
        'var m=e.querySelector("img.piece-video,video.piece-video");' +
        'return {c:e.getAttribute("data-color"),t:e.getAttribute("data-type"),' +
        's:decodeURIComponent(m?(m.getAttribute("src")||""):"")};})()');
}

function PVP_URL() {
    return BASE + '/code/html/game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
        '&bf=' + encodeURIComponent('阿贝母鸡卡') +
        '&board=' + encodeURIComponent('标准') + '&mode=pvp';
}

// 拖拽走子：pointerdown → pointermove → pointerup（PRD 二.3「支持拖拽落子」）
function dragMove(from, to) {
    var expr = '(function(){' +
        'var board=document.getElementById("board-inner");' +
        'var r=board.getBoundingClientRect();' +
        'var F="abcdefgh",R="87654321";' +
        'function pt(s){return {x:r.left+(F.indexOf(s[0])+0.5)*r.width/8,' +
        'y:r.top+(R.indexOf(s[1])+0.5)*r.height/8};}' +
        'function fire(t,x,y){var e=new PointerEvent(t,{bubbles:true,cancelable:true,' +
        'clientX:x,clientY:y,pointerId:7,pointerType:"mouse",isPrimary:true,' +
        'buttons:t==="pointerup"?0:1});(t==="pointerdown"?board:document).dispatchEvent(e);}' +
        'var a=pt("' + from + '"),b=pt("' + to + '");' +
        'fire("pointerdown",a.x,a.y);' +
        'fire("pointermove",(a.x+b.x)/2,(a.y+b.y)/2);' +
        'fire("pointermove",b.x,b.y);' +
        'setTimeout(function(){fire("pointerup",b.x,b.y);},50);' +
        'return true;})()';
    return evaluate(expr);
}

// 第四段附录：拖拽通道（走子 / 吃子）
function runDragTest() {
    console.log('');
    console.log('--- 拖拽走子测试（1.e4 d5 2.exd5，全程拖拽）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () { return dragMove('e2', 'e4'); })
        .then(function () { return sleep(1400); })
        .then(function () {
            return evaluate('(function(){return {' +
                'moves:document.getElementById("move-list").textContent.replace(/\\s+/g," ").trim(),' +
                'e2:!!document.querySelector(\'#piece-layer .piece[data-square="e2"]\'),' +
                'e4:!!document.querySelector(\'#piece-layer .piece[data-square="e4"]\')};})()');
        })
        .then(function (r) {
            var ok = /e4/.test(r.moves) && !r.e2 && r.e4;
            console.log((ok ? '✅' : '❌') + ' 拖拽走子生效: ' + r.moves);
            return dragMove('d7', 'd5');
        })
        .then(function () { return sleep(1400); })
        .then(function () { return dragMove('e4', 'd5'); })
        .then(function () { return sleep(2200); })
        .then(function () {
            return evaluate('(function(){var d=document.querySelector(\'#piece-layer .piece[data-square="d5"]\');' +
                'return {moves:document.getElementById("move-list").textContent.replace(/\\s+/g," ").trim(),' +
                'total:document.querySelectorAll("#piece-layer .piece").length,' +
                'd5:d?d.getAttribute("data-color"):null};})()');
        })
        .then(function (r) {
            var ok = r.total === 31 && r.d5 === 'w' && /exd5/.test(r.moves);
            console.log((ok ? '✅' : '❌') + ' 拖拽吃子生效: ' + r.moves +
                '（剩余 ' + r.total + ' 子，d5=' + r.d5 + '）');
        })
        .catch(function (e) { console.log('❌ 拖拽测试异常: ' + e.message); });
}

// 第五段：人机执黑时棋盘翻转（玩家视角始终在下方）
function runFlipTest() {
    console.log('');
    console.log('--- 执黑视角翻转（应把黑方放在屏幕下方）---');
    var url = BASE + '/code/html/game.html?wf=' + encodeURIComponent('明日方舟_喀兰') +
        '&bf=' + encodeURIComponent('阿贝母鸡卡') + '&board=' + encodeURIComponent('标准') +
        '&mode=pve&elo=600&side=black';
    return send('Page.navigate', { url: url })
        .then(function () { return sleep(3500); })
        .then(function () {
            return evaluate('(function(){' +
                'function pos(sq){var e=document.querySelector(\'#piece-layer .piece[data-square="\'+sq+\'"]\');' +
                'return e?{l:parseFloat(e.style.left),t:parseFloat(e.style.top)}:null;}' +
                'return {a1:pos("a1"),h8:pos("h8"),' +
                'files:Array.prototype.map.call(document.querySelectorAll("#coord-row span"),' +
                'function(s){return s.textContent;}).join(""),' +
                'ranks:Array.prototype.map.call(document.querySelectorAll("#coord-col span"),' +
                'function(s){return s.textContent;}).join("")};})()');
        })
        .then(function (r) {
            // 翻转后：a1 在右上、h8 在左下；底行列号 h..a、左侧 1..8
            var ok = r.a1 && r.a1.l === 87.5 && r.a1.t === 0 &&
                r.h8 && r.h8.l === 0 && r.h8.t === 87.5 &&
                r.files === 'hgfedcba' && r.ranks === '12345678';
            console.log((ok ? '✅' : '❌') + ' 棋盘已翻转：底行 ' + r.files + '，左侧 ' + r.ranks);
            if (r.a1) console.log('   a1 位置 left=' + r.a1.l + '% top=' + r.a1.t + '%（应为 87.5/0）');
            if (r.h8) console.log('   h8 位置 left=' + r.h8.l + '% top=' + r.h8.t + '%（应为 0/87.5）');
        })
        .then(function () {
            // 点视口左下角，应选中逻辑 h8（黑车）
            return evaluate('(function(){var b=document.getElementById("board-inner").getBoundingClientRect();' +
                'var c=b.width/8;var t=document.getElementById("board-inner");' +
                'var p=[b.left+0.5*c,b.top+7.5*c];' +
                '["pointerdown","pointerup"].forEach(function(k){t.dispatchEvent(new PointerEvent(k,' +
                '{bubbles:true,cancelable:true,clientX:p[0],clientY:p[1],pointerId:1,pointerType:"mouse",' +
                'isPrimary:true,buttons:k==="pointerup"?0:1}));});' +
                'var s=document.querySelector(".piece.selected");' +
                'return s?s.getAttribute("data-square"):null;})()');
        })
        .then(function (sq) {
            console.log((sq === 'h8' ? '✅' : '❌') + ' 点击左下角选中的是 ' + sq + '（应为 h8）');
        })
        .catch(function (e) { console.log('❌ 翻转测试异常: ' + e.message); });
}

// 第六段：将杀结局判定（PvP 傻瓜将杀，黑方获胜）
function runOutcomeTest() {
    console.log('');
    console.log('--- 将杀结局判定（1.f3 e5 2.g4 Qh4#，应判黑方获胜）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () {
            return playSequence([['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]);
        })
        .then(function () { return sleep(4000); })
        .then(function () {
            return evaluate('(function(){var t=document.getElementById("result-title");' +
                'return {path:location.pathname,title:t?t.textContent:""};})()');
        })
        .then(function (r) {
            // PvP 用客观语气：「恭喜，黑方获胜」
            var ok = /result/.test(r.path) && /黑方获胜/.test(r.title);
            console.log((ok ? '✅' : '❌') + ' 将杀后跳转结算页，标题「' + r.title + '」');
        })
        .catch(function (e) { console.log('❌ 结局判定测试异常: ' + e.message); });
}

// 第三段：王车易位（PvP 序列可控）
function runCastlingTest() {
    console.log('');
    console.log('--- 王车易位测试（1.e4 e5 2.Nf3 Nf6 3.Bc4 Bc5 4.O-O）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () {
            return playSequence([['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['g8', 'f6'],
                ['f1', 'c4'], ['f8', 'c5'], ['e1', 'g1']]);
        })
        .then(function (t) {
            console.log(/O-O/.test(t) ? '✅ 易位已记录: ' + t : '❌ 易位未生效: ' + t);
            return Promise.all([pieceAtSquare('g1'), pieceAtSquare('f1'), pieceAtSquare('h1')]);
        })
        .then(function (r) {
            console.log('   g1=' + JSON.stringify(r[0]) + '（应为白王）');
            console.log('   f1=' + JSON.stringify(r[1]) + '（应为白车）');
            console.log('   h1=' + JSON.stringify(r[2]) + '（应为空）');
            var ok = r[0] && r[0].t === 'k' && r[1] && r[1].t === 'r' && !r[2];
            console.log(ok ? '✅ 王车同步到位' : '❌ 王车位置错误');
        })
        .catch(function (e) { console.log('❌ 易位测试异常: ' + e.message); });
}

// 第四段：吃过路兵
function runEnPassantTest() {
    console.log('');
    console.log('--- 吃过路兵测试（1.e4 a6 2.e5 d5 3.exd6）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () {
            return playSequence([['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5'], ['e5', 'd6']]);
        })
        .then(function (t) {
            console.log(/exd6/.test(t) ? '✅ 吃过路兵已记录: ' + t : '❌ 吃过路兵未生效: ' + t);
            return Promise.all([pieceAtSquare('d6'), pieceAtSquare('d5')]);
        })
        .then(function (r) {
            console.log('   d6=' + JSON.stringify(r[0]) + '（应为白兵）');
            console.log('   d5=' + JSON.stringify(r[1]) + '（应为空）');
            var ok = r[0] && r[0].c === 'w' && r[0].t === 'p' && !r[1];
            console.log(ok ? '✅ 过路兵已移除、白兵占位正确' : '❌ 过路兵处理错误');
        })
        .catch(function (e) { console.log('❌ 吃过路兵测试异常: ' + e.message); });
}

// 第五段：兵升变（含弹窗选择）
function runPromotionTest() {
    console.log('');
    console.log('--- 兵升变测试（1.h4 g5 2.hxg5 Nf6 3.g6 a6 4.g7 a5 5.g8=Q）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () {
            return playSequence([['h2', 'h4'], ['g7', 'g5'], ['h4', 'g5'], ['g8', 'f6'],
                ['g5', 'g6'], ['a7', 'a6'], ['g6', 'g7'], ['a6', 'a5']]);
        })
        .then(function () { return clickMove('g7', 'g8'); })
        .then(function () { return sleep(800); })
        .then(function () { return evaluate('document.getElementById("promotion-modal").className'); })
        .then(function (c) {
            console.log(/show/.test(c) ? '✅ 升变弹窗已弹出' : '❌ 升变弹窗未弹出: ' + c);
            return evaluate('(function(){var b=document.querySelector(' +
                '\'.promo-btn[data-piece="q"]\');if(b){b.click();return true;}return false;})()');
        })
        .then(function () { return sleep(2200); })
        .then(function () { return pieceAtSquare('g8'); })
        .then(function (p) {
            console.log('   g8=' + JSON.stringify(p) + '（应为白后，且用白方阵营素材）');
            var ok = !!p && p.t === 'q' && p.c === 'w' &&
                /明日方舟_喀兰\/Queen/.test(p.s || '');
            console.log(ok ? '✅ 升变为皇后成功（颜色与阵营均属本方）' : '❌ 升变结果错误');
            return moveText();
        })
        .then(function (t) { console.log('   棋谱: ' + t); })
        .catch(function (e) { console.log('❌ 升变测试异常: ' + e.message); });
}

// 第六段：选中高亮与非法移动退回
function runIllegalTest() {
    console.log('');
    console.log('--- 选中高亮与非法移动测试（选中 e2，点击非法格 e5）---');
    return send('Page.navigate', { url: PVP_URL() })
        .then(function () { return sleep(3500); })
        .then(function () {
            // 仅按下 e2 完成选中，不落子
            return evaluate('(function(){var b=document.getElementById("board-inner");' +
                'var r=b.getBoundingClientRect();var F="abcdefgh",R="87654321";' +
                'function pt(s){return {x:r.left+(F.indexOf(s[0])+0.5)*r.width/8,' +
                'y:r.top+(R.indexOf(s[1])+0.5)*r.height/8};}' +
                'var a=pt("e2");' +
                'b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:a.x,' +
                'clientY:a.y,pointerId:1,pointerType:"mouse",isPrimary:true}));' +
                'window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:a.x,' +
                'clientY:a.y,pointerId:1,pointerType:"mouse",isPrimary:true}));return true;})()');
        })
        .then(function () { return sleep(400); })
        .then(function () {
            return evaluate('(function(){return {' +
                'selected:document.querySelectorAll("#piece-layer .piece.selected").length,' +
                'from:document.querySelectorAll("#mark-layer .mark-from").length,' +
                'moves:document.querySelectorAll("#mark-layer .mark-move").length};})()');
        })
        .then(function (r) {
            console.log('   选中态=' + r.selected + ' 起点标记=' + r.from + ' 可走点=' + r.moves);
            console.log(r.selected === 1 && r.from === 1 && r.moves >= 1
                ? '✅ 选中高亮与合法落点提示正常' : '❌ 选中高亮异常');
            return clickMove('e2', 'e5');   // e5 对 e2 兵非法
        })
        .then(function () { return sleep(700); })
        .then(function () {
            return evaluate('(function(){return {' +
                'toast:document.getElementById("toast").textContent,' +
                'shown:document.getElementById("toast").className.indexOf("show")>=0,' +
                'e2:(function(){var e=document.querySelector(' +
                '\'#piece-layer .piece[data-square="e2"]\');return e?e.getAttribute("data-type"):null;})(),' +
                'e5:(function(){var e=document.querySelector(' +
                '\'#piece-layer .piece[data-square="e5"]\');return e?e.getAttribute("data-type"):null;})()' +
                '};})()');
        })
        .then(function (r) {
            console.log('   提示="' + r.toast + '"（显示中=' + r.shown + '）');
            console.log('   e2 仍为兵=' + (r.e2 === 'p') + ' | e5 为空=' + (r.e5 === null));
            var ok = /不能移动到那里/.test(r.toast) && r.e2 === 'p' && r.e5 === null;
            console.log(ok ? '✅ 非法移动已提示并正确退回' : '❌ 非法移动处理错误');
        })
        .catch(function (e) { console.log('❌ 非法移动测试异常: ' + e.message); });
}

// 等待调试端口就绪并取到页面 target
function waitForTarget(http) {
    var t0 = Date.now();
    return (function loop() {
        return new Promise(function (resolve) {
            http.get('http://127.0.0.1:' + PORT + '/json/list', function (res) {
                var body = '';
                res.on('data', function (d) { body += d; });
                res.on('end', function () {
                    try {
                        var list = JSON.parse(body);
                        var page = list.filter(function (t) { return t.type === 'page'; })[0];
                        resolve(page || null);
                    } catch (e) { resolve(null); }
                });
            }).on('error', function () { resolve(null); });
        }).then(function (page) {
            if (page) return page;
            if (Date.now() - t0 > 20000) throw new Error('Chrome 调试端口未就绪');
            return sleep(500).then(loop);
        });
    })();
}

function onMessage(ev) {
    var msg = JSON.parse(ev.data);
    if (msg.id && pending[msg.id]) {
        var p = pending[msg.id];
        delete pending[msg.id];
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
        return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
        var args = (msg.params.args || []).map(function (a) {
            return a.value !== undefined ? String(a.value) : (a.description || a.type);
        });
        logs.push('[' + msg.params.type + '] ' + args.join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        var d = msg.params.exceptionDetails;
        logs.push('[exception] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    if (msg.method === 'Log.entryAdded') {
        logs.push('[log] ' + msg.params.entry.text);
    }
}

main();
