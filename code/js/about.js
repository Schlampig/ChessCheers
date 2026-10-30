/**
 * ChessCheers 「了解更多」页面逻辑
 * 负责 Markdown 渲染、目录生成、中英切换、侧栏折叠。
 * 解析器改为逐行状态机，避免多组列表被合并成一个 <ul>。
 */
(function () {
    'use strict';

    // 页面位于 code/html/，需向上两级回到仓库根再进 doc/
    var DOC_PATH = '../../doc/intro/';

    // 各语言的候选文件名：不同作者可能用 en / eng 等写法，逐个尝试直到命中
    var DOC_CANDIDATES = {
        zh: ['intro_zh.md', 'intro_zh_CN.md', 'intro_cn.md', 'intro.md'],
        en: ['intro_en.md', 'intro_eng.md', 'intro_en_US.md', 'intro_en-US.md']
    };

    var currentLang = 'zh';
    var elements = {};
    var scrollBound = false;

    function $(id) { return document.getElementById(id); }

    function initElements() {
        elements.tocToggle = $('toc-toggle');
        elements.langSwitch = $('lang-switch');
        elements.tocSidebar = $('toc-sidebar');
        elements.tocList = $('toc-list');
        elements.docContent = $('doc-content');
        elements.backToTop = $('back-to-top');
    }

    // ==================== Markdown ====================
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 行内标记：先转义再还原，避免文档内容被当作 HTML 执行
    function inline(text) {
        var s = escapeHtml(text);
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        s = s.replace(/(https?:\/\/[^\s<）)"]+)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>');
        return s;
    }

    // 逐行状态机：正确处理多组列表、代码块与段落
    function parseMarkdown(text) {
        var st = { out: [], para: [], list: [], code: [], inCode: false };
        var lines = String(text).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) parseLine(lines[i], st);
        flushAll(st);
        if (st.inCode && st.code.length) st.out.push(preCode(st.code));
        return st.out.join('\n');
    }

    // 单行归类：代码块 > 空行 > 标题 > 列表 > 引用 > 段落
    function parseLine(line, st) {
        if (/^\s*```/.test(line)) { toggleCode(st); return; }
        if (st.inCode) { st.code.push(line); return; }
        if (/^\s*$/.test(line)) { flushAll(st); return; }

        var h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            flushAll(st);
            var tag = 'h' + h[1].length;
            st.out.push('<' + tag + '>' + inline(h[2]) + '</' + tag + '>');
            return;
        }
        var li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) { flushPara(st); st.list.push(li[1]); return; }

        var bq = line.match(/^>\s+(.*)$/);
        if (bq) { flushAll(st); st.out.push('<blockquote>' + inline(bq[1]) + '</blockquote>'); return; }

        flushList(st);
        st.para.push(line);
    }

    function toggleCode(st) {
        if (st.inCode) {
            st.out.push(preCode(st.code));
            st.code = [];
            st.inCode = false;
        } else {
            flushAll(st);
            st.inCode = true;
        }
    }

    function preCode(code) {
        return '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
    }

    function flushPara(st) {
        if (!st.para.length) return;
        st.out.push('<p>' + inline(st.para.join(' ')) + '</p>');
        st.para = [];
    }

    function flushList(st) {
        if (!st.list.length) return;
        var items = [];
        for (var k = 0; k < st.list.length; k++) items.push('<li>' + inline(st.list[k]) + '</li>');
        st.out.push('<ul>' + items.join('') + '</ul>');
        st.list = [];
    }

    function flushAll(st) { flushPara(st); flushList(st); }

    // ==================== 文档加载 ====================
    // 依次尝试候选文件名，任一命中即渲染；全部失败才报错
    function loadDocument() {
        var list = DOC_CANDIDATES[currentLang] || DOC_CANDIDATES.zh;
        tryNext(0, list, []);
    }

    function tryNext(index, list, tried) {
        if (index >= list.length) {
            renderFailure(tried);
            return;
        }
        var url = DOC_PATH + list[index];
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 400) {
                renderDocument(xhr.responseText);
            } else {
                tried.push(url);
                tryNext(index + 1, list, tried);
            }
        };
        xhr.onerror = function () {
            tried.push(url + '（网络错误）');
            tryNext(index + 1, list, tried);
        };
        xhr.send(null);
    }

    function renderFailure(tried) {
        var tips = '';
        for (var i = 0; i < tried.length; i++) {
            tips += '<li>' + escapeHtml(tried[i]) + '</li>';
        }
        elements.docContent.innerHTML =
            '<h2 class="load-error">文档加载失败</h2>' +
            '<p>以下路径均无法访问，请确认 doc/intro/ 下存在对应语言的 Markdown 文件：</p>' +
            '<ul>' + tips + '</ul>';
    }

    function renderDocument(text) {
        elements.docContent.innerHTML = parseMarkdown(text);
        generateToc();
    }

    // ==================== 目录 ====================
    function generateToc() {
        elements.tocList.innerHTML = '';
        var headings = elements.docContent.querySelectorAll('h1, h2, h3');

        for (var i = 0; i < headings.length; i++) {
            var heading = headings[i];
            var level = parseInt(heading.tagName.charAt(1), 10);
            var id = 'sec-' + i;
            heading.id = id;

            var li = document.createElement('li');
            li.className = 'toc-item level-' + level;
            li.appendChild(makeTocLink(id, heading.textContent));
            elements.tocList.appendChild(li);
        }
    }

    function makeTocLink(id, text) {
        var a = document.createElement('a');
        a.href = '#' + id;
        a.className = 'toc-link';
        a.textContent = text;
        a.addEventListener('click', function (e) {
            e.preventDefault();
            var target = document.getElementById(id);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return a;
    }

    // ==================== 交互 ====================
    function toggleLanguage() {
        currentLang = currentLang === 'zh' ? 'en' : 'zh';
        elements.langSwitch.textContent = currentLang === 'zh' ? 'CN | EN' : 'EN | CN';
        elements.langSwitch.className = 'lang-switch' + (currentLang === 'en' ? ' en' : '');
        loadDocument();
    }

    function toggleSidebar() {
        var collapsed = elements.tocSidebar.classList.toggle('collapsed');
        syncToggleLabel(collapsed);
    }

    // 箭头方向随状态同步：展开时「←」收起，折叠时「→」展开
    function syncToggleLabel(collapsed) {
        elements.tocToggle.textContent = collapsed ? '→' : '←';
        elements.tocToggle.title = collapsed ? '展开目录' : '折叠目录';
    }

    // 窄屏默认折叠，避免目录遮挡正文
    function applyDefaultSidebar() {
        var collapsed = window.innerWidth <= 760;
        if (collapsed) elements.tocSidebar.classList.add('collapsed');
        syncToggleLabel(collapsed);
    }

    function onScroll() {
        if (window.pageYOffset > 200) elements.backToTop.classList.add('visible');
        else elements.backToTop.classList.remove('visible');
    }

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function bindEvents() {
        elements.langSwitch.addEventListener('click', toggleLanguage);
        elements.tocToggle.addEventListener('click', toggleSidebar);
        elements.backToTop.addEventListener('click', scrollToTop);
        // 只绑定一次，避免切换语言时监听器累积
        if (!scrollBound) {
            window.addEventListener('scroll', onScroll);
            scrollBound = true;
        }
    }

    function init() {
        initElements();
        bindEvents();
        applyDefaultSidebar();
        loadDocument();
        onScroll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
