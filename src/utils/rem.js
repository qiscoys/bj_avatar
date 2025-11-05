(function(win, doc) {
    'use strict';
    var options = { width: 960, dpr: 1 };
    var html = doc.documentElement,
        width = html.getAttribute('data-width') || options.width,
        dpr = html.getAttribute('data-dpr') || options.dpr,
        viewPort = doc.querySelector('meta[name="viewport"]'),
        rotate = win.onorientationchange ? 'orientationchange' : 'resize';

    // 检测是否为PC端
    function isPC() {
        return win.innerWidth > 2768;
    }

    // 设置 initial-scale
    function setScale() {
        var viewContent = viewPort.getAttribute('content');
        var reg = /initial-scale=(\d(.\d+)?)/i;
        var matchRes = viewContent.match(reg);
        var scale = isPC() ? 1 : (1 / dpr); // PC端使用1，移动端使用1/dpr
        if (matchRes && matchRes[1] == scale) {
            return;
        }
        var newContent = viewContent.replace(reg, function(a, b) {
            return a.replace(/\d(.\d+)?/i, scale);
        });
        viewPort.setAttribute('content', newContent);
    };

    // 设置html fontSize
    function setSize() {
        var winWidth = win.innerWidth || html.clientWidth;
        if (isPC()) {
            // PC端使用固定fontSize，模拟375px宽度的手机显示
            html.style.fontSize = '50px'; // 375px / 7.5 = 50px
            html.classList.add('pc-mode');
        } else {
            // 移动端保持原有逻辑
            html.style.fontSize = 100 * winWidth / width + 'px';
            html.classList.remove('pc-mode');
        }
    };
    
    win.addEventListener(rotate, setSize);
    window.requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
    setScale();
    setSize();
    requestAnimationFrame(function() {
        setScale();
        setSize();
    });
})(window, document);
