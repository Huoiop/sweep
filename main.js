/* =========================================================================
   刷了吗 · 大扫除分工抽取
   流程：首页 → 选择抽取范围 → 配置分配条目 → 过场 → 逐项抽取 → 总结
   ========================================================================= */
(function () {
  'use strict';

  var STAGE_W = 2000, STAGE_H = 1125;

  /* ---------- 分工项定义（图标名与 svg/ 下的文件名一致） ---------- */
  var ITEMS = [
    { key: '擦拭', icon: '擦拭', count: 1 },
    { key: '讲台', icon: '讲台', count: 1 },
    { key: '刷地', icon: '刷地', count: 4 },
    { key: '走廊', icon: '走廊', count: 1 }
  ];
  /* 「自定义」项：项名可改、人数可填；一旦改了名或填了人，就作为普通分工项
     进入后续抽取流程（默认 0 人不参与）。图标用擦拭的。 */
  var CUSTOM = { key: '自定义', icon: '擦拭', count: 0 };

  /* 每次进入配置屏都从 ITEMS 重新生成，def 记住该项的默认人数，
     输入了非法内容时要回到这个默认值。 */
  function makeItems() {
    var list = ITEMS.map(function (it) {
      return { key: it.key, icon: it.icon, count: it.count, def: it.count };
    });
    list.push({
      key: CUSTOM.key, icon: CUSTOM.icon,
      count: CUSTOM.count, def: CUSTOM.count, custom: true
    });
    return list;
  }

  /* ---------- 运行时状态 ---------- */
  var state = {
    groupIndex: 0,
    selected: [],        // 选中的成员姓名
    touched: false,      // 用户是否手动改动过「默认全选」
    items: [],           // [{key, icon, count}]
    results: [],         // [{key, icon, members: []}]
    cursor: 0
  };

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- 舞台缩放 ---------- */
  function fitStage() {
    var k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    $('#stage').style.transform = 'translate(-50%, -50%) scale(' + k + ')';
  }
  window.addEventListener('resize', fitStage);

  /* ---------- 图标注入 ---------- */
  function mountIcons(root) {
    $$('.icon[data-icon]', root || document).forEach(function (el) {
      var def = window.ICONS && window.ICONS[el.dataset.icon];
      if (def && !el.firstChild) {
        el.innerHTML = '<svg viewBox="' + def.viewBox + '">' + def.inner + '</svg>';
      }
    });
  }

  /* ---------- 屏幕切换 ---------- */
  function show(name, opts) {
    $$('.screen').forEach(function (s) {
      s.classList.toggle('is-active', s.dataset.screen === name);
    });
    if (opts) Object.keys(opts).forEach(function (k) { $('.screen[data-screen="' + name + '"]').dataset[k] = opts[k]; });
    // 屏幕可见之后布局尺寸才有效，否则 offsetLeft / clientWidth 一律是 0
    updateTabsFade();
    placeIndicator(false);
    syncScrollbars();
  }

  /* ---------- 分组 / 成员 ---------- */
  function groups() { return window.ROSTER || []; }
  function currentGroup() { return groups()[state.groupIndex] || { name: '', members: [] }; }

  var INDICATOR_W = 34;      // 与原稿一致：短横条宽 34px

  function renderTabs(animateIndicator) {
    var box = $('[data-role="group-tabs"]');
    // 只清标签按钮，指示条要留着，否则每次都要重新建、没法连起来做位移动画
    $$('.tabs__item', box).forEach(function (b) { b.remove(); });
    groups().forEach(function (g, i) {
      var b = document.createElement('button');
      b.className = 'tabs__item' + (i === state.groupIndex ? ' is-active' : '');
      b.type = 'button';
      b.textContent = g.name;
      b.addEventListener('click', function () {
        switchGroup(i);
      });
      box.appendChild(b);
    });
    placeIndicator(animateIndicator);
    updateTabsFade();
  }

  /* 把指示条摆到当前分组下方；animate 为真时做「先收窄再展开」的位移动画 */
  function placeIndicator(animate) {
    var ind = $('[data-role="tabs-indicator"]');
    var act = $('.tabs__item.is-active');
    if (!ind || !act) return;
    var x = act.offsetLeft + (act.offsetWidth - INDICATOR_W) / 2;

    if (!animate) {
      // 关掉动画再设位置。否则「本屏从 display:none 变可见」会触发动画开始，
      // 之后改 CSS 变量又让动画中途跳一下——就是入场时那下多余的动作。
      ind.style.animation = 'none';
      ind.style.setProperty('--ind-x0', x + 'px');
      ind.style.setProperty('--ind-x1', x + 'px');
      return;
    }
    // 从「当前实际位置」起步，连点两次也能接得上，不会跳回起点
    var cur = new DOMMatrix(getComputedStyle(ind).transform).e;
    ind.style.setProperty('--ind-x0', cur + 'px');
    ind.style.setProperty('--ind-x1', x + 'px');
    ind.style.animation = 'none';
    void ind.offsetWidth;                   // 强制重排，让动画能重播
    ind.style.animation = '';
  }

  /* 切换分组：
     - 还没动过任何勾选 → 默认全选随分组走（旧的整组取消，新组整组选中）
     - 已经动过勾选     → 已有选择原样保留，新组不默认全选，用户勾谁加谁 */
  function switchGroup(i) {
    if (i === state.groupIndex) return;
    state.groupIndex = i;
    if (!state.touched) {
      state.selected = currentGroup().members.slice();
    }
    renderTabs(true);                              // 指示条做滑动动画
    renderChips();
    scrollTabIntoView($('.tabs__item.is-active'));
    updateTabsFade();
  }

  /* 把某个标签滚到可视区正中间，往前/往后切换都留有余地。
     不用 scrollIntoView —— 它会连带滚动祖先容器；这里直接算该滚多少。
     首尾两项会被夹在两端，没法真正居中，属正常。 */
  function scrollTabIntoView(el) {
    var wrap = $('[data-role="tabs-wrap"]');
    if (!el || !wrap) return;
    var max = wrap.scrollWidth - wrap.clientWidth;
    var target = el.offsetLeft + el.offsetWidth / 2 - wrap.clientWidth / 2;
    target = Math.max(0, Math.min(target, max));
    if (Math.abs(target - wrap.scrollLeft) < 1) return;
    wrap.scrollTo({ left: target, behavior: 'smooth' });
  }

  /* 鼠标按住拖动标签栏。触摸交给原生横向滚动，避免和页面手势打架。 */
  function enableDragScroll() {
    var wrap = $('[data-role="tabs-wrap"]');
    if (!wrap) return;
    var dragging = false, moved = 0, startX = 0, startLeft = 0, suppressClick = false;

    wrap.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true; moved = 0; startX = e.clientX; startLeft = wrap.scrollLeft;
    });

    wrap.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved <= 4) return;                       // 小位移仍算点击
      if (!wrap.classList.contains('is-dragging')) {
        wrap.classList.add('is-dragging');
        try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      }
      wrap.scrollLeft = startLeft - dx;
      e.preventDefault();
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      if (moved > 4) {
        suppressClick = true;                       // 拖过之后这一次点击不算数
        setTimeout(function () { suppressClick = false; }, 0);
      }
      wrap.classList.remove('is-dragging');
      if (wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId);
      }
    }
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('click', function (e) {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  /* 左/右端是否还有内容可以滑动，决定要不要打渐隐。
     必须等屏幕可见后再调用，否则 clientWidth 是 0，判断会失真。 */
  function updateTabsFade() {
    var frame = $('[data-role="tabs-frame"]');
    var wrap = $('[data-role="tabs-wrap"]');
    if (!frame || !wrap) return;
    // scrollLeft 是小数而 scrollWidth/clientWidth 被取整，留 2px 容差，
    // 否则滚到最右时右侧渐隐会残留 1px 宽的一条。
    var max = wrap.scrollWidth - wrap.clientWidth;
    frame.classList.toggle('can-right', max - wrap.scrollLeft > 2);
    frame.classList.toggle('can-left', wrap.scrollLeft > 2);
  }

  /* ---------- 首页徽标轮播 ---------- */

  /* 各图标在 200px 见方里的最大墨迹边长（标定实测值）。
     各图标在各自 viewBox 里留白不同，直接同框渲染会忽大忽小，
     这里按墨迹反推框大小，让轮播时视觉尺寸一致。 */
  var ICON_INK = { 擦拭: 161, 讲台: 193, 刷地: 186, 走廊: 187, 小组: 175, 配置: 200, 统计: 176, 分享: 172 };
  var BADGE_INK = 46.3;            // 原稿徽标图标的墨迹宽度

  function badgeIconSize(name) {
    var m = ICON_INK[name] || 200;
    return Math.round(200 * BADGE_INK / m * 10) / 10;
  }

  function renderBadgeRoll() {
    var iconBox = $('[data-role="badge-icon"]');
    var textBox = $('[data-role="badge-text"]');
    if (!iconBox || !textBox) return;
    var names = ITEMS.map(function (it) { return it.key; });
    var loop = names.concat([names[0]]);          // 末位补首位，循环回起点才接得上

    iconBox.innerHTML = '<span class="badge-roll__track">' + loop.map(function (n) {
      return '<span class="badge-roll__slot"><span class="icon" data-icon="' + n +
             '" style="--icon-size:' + badgeIconSize(n) + 'px"></span></span>';
    }).join('') + '</span>';

    textBox.innerHTML = '<span class="badge-roll__track">' + loop.map(function (n) {
      return '<span class="badge-roll__slot">' + n + '</span>';
    }).join('') + '</span>';
  }

  function renderChips() {
    var box = $('[data-role="member-chips"]');
    box.innerHTML = '';
    currentGroup().members.forEach(function (name) {
      var b = document.createElement('button');
      b.className = 'chip' + (state.selected.indexOf(name) >= 0 ? '' : ' is-off');
      b.type = 'button';
      // 两层同名文字：底层黑字（白底），上层白字（深底），靠上层的 opacity 交叉淡入淡出
      b.innerHTML = '<span class="chip__label"></span>' +
                    '<span class="chip__ink"><span></span></span>';
      b.dataset.name = name;                 // 名字在两层里各有一份，取名字要用 dataset
      $('.chip__label', b).textContent = name;
      $('.chip__ink span', b).textContent = name;
      b.addEventListener('click', function () {
        var i = state.selected.indexOf(name);
        if (i >= 0) state.selected.splice(i, 1);
        else state.selected.push(name);
        // 只要用户动过一次，默认全选就不再跟随分组切换
        state.touched = true;
        b.classList.toggle('is-off', i >= 0);
        updateRangeFooter();
      });
      box.appendChild(b);
    });
    updateRangeFooter();
  }

  function updateRangeFooter() {
    $('[data-role="selected-count"]').textContent = state.selected.length;
  }

  /* ---------- 配置分配条目 ---------- */

  /* 依次尽量满足各条目的人数，超出选中总人数的部分裁掉，
     这样即便在上一屏改了选人范围，本屏也不会出现「配比总数 > 总人数」的死局。 */
  function clampCounts() {
    var total = state.selected.length, used = 0;
    state.items.forEach(function (it) {
      it.count = Math.max(0, Math.min(it.count, total - used));
      used += it.count;
    });
  }

  /* 把 amount 个名额按各条目现有占比分摊，用「最大余数法」补足整数，
     保证分摊后总和精确等于 amount。全为 0 时退化成平均分。 */
  function redistribute(list, amount) {
    if (!list.length) return;
    amount = Math.max(0, amount);
    var sum = list.reduce(function (a, b) { return a + b.count; }, 0);
    if (sum <= 0) {
      var base = Math.floor(amount / list.length), rem = amount % list.length;
      list.forEach(function (it, i) { it.count = base + (i < rem ? 1 : 0); });
      return;
    }
    var exact = list.map(function (it) { return it.count * amount / sum; });
    var vals = exact.map(Math.floor);
    var used = vals.reduce(function (a, b) { return a + b; }, 0);
    var order = exact.map(function (v, i) { return { frac: v - Math.floor(v), i: i }; })
                     .sort(function (a, b) { return b.frac - a.frac; });
    for (var k = amount - used, i = 0; i < k; i++) vals[order[i % order.length].i] += 1;
    list.forEach(function (it, i) { it.count = vals[i]; });
  }

  /* 改某一项的人数：其余项按现有占比自动重分摊，总和恒等于已选人数 */
  function applyCount(item, value) {
    var total = state.selected.length;
    item.count = Math.max(0, Math.min(value, total));
    redistribute(state.items.filter(function (x) { return x !== item; }), total - item.count);
    syncCounts();
    updateConfigStat();
  }

  /* 只改输入框的值，不重建 DOM —— 否则正在编辑的输入框会失焦 */
  function syncCounts() {
    $$('.screen[data-screen="config"] .pill').forEach(function (pill, i) {
      var input = $('.pill__input', pill);
      if (!input || input.tagName !== 'INPUT') return;
      input.value = state.items[i].count;
    });
  }

  function renderConfig() {
    clampCounts();
    var box = $('[data-role="item-pills"]');
    box.innerHTML = '';
    state.items.forEach(function (it) {
      var el = document.createElement('div');
      el.className = 'pill';
      // 数字胶囊里统一用「小组」图标——它是人数指示，不随分工项变化
      el.innerHTML =
        '<span class="pill__label"></span>' +
        '<span class="pill__count">' +
          '<span class="icon" data-icon="小组" style="--icon-size:19.4px"></span>' +
          '<input class="pill__input" type="text" inputmode="numeric" maxlength="2" autocomplete="off">' +
        '</span>';

      var label = $('.pill__label', el);
      if (it.custom) {
        var nameInput = document.createElement('input');
        nameInput.className = 'pill__label pill__label--input';
        nameInput.type = 'text';
        nameInput.maxLength = 4;
        nameInput.autocomplete = 'off';
        nameInput.placeholder = CUSTOM.key;
        nameInput.value = it.key;
        label.replaceWith(nameInput);
        bindNameInput(nameInput, it);
      } else {
        label.textContent = it.key;
      }

      var input = $('.pill__input', el);
      input.value = it.count;
      bindCountInput(el, it);
      box.appendChild(el);
    });
    mountIcons(box);
    updateConfigStat();
  }

  /* 「自定义」项名的输入交互：清空就回到默认项名 */
  function bindNameInput(input, item) {
    function commit() {
      var v = String(input.value).trim();
      if (!v) v = CUSTOM.key;
      item.key = v;
      input.value = v;
    }
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  }

  /* 数字胶囊的输入交互 */
  function bindCountInput(pillEl, item) {
    var input = $('.pill__input', pillEl);

    function commit() {
      var raw = String(input.value).trim();
      var n;
      if (raw === '' || !/^\d+$/.test(raw)) {
        n = item.def;                                     // 不是数字 → 回到该项默认值
      } else {
        n = Math.min(parseInt(raw, 10), state.selected.length);   // 超出上限 → 取此项能支持的最大值
      }
      applyCount(item, n);
    }

    // 点胶囊任意位置都能输入
    $('.pill__count', pillEl).addEventListener('click', function () {
      input.focus();
      input.select();
    });
    // 只允许数字进来
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '');
      if (v !== input.value) input.value = v;
    });
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  }

  function updateConfigStat() {
    var total = state.selected.length;
    var used = state.items.reduce(function (a, b) { return a + b.count; }, 0);
    $('[data-role="total"]').textContent = total;
    $('[data-role="left"]').textContent = Math.max(0, total - used);
    // 没分完就不让走下一步
    var btn = $('.screen[data-screen="config"] [data-action="to-transition"]');
    var done = used === total && total > 0;
    btn.classList.toggle('is-disabled', !done);
    btn.disabled = !done;
  }

  /* ---------- 抽取 ---------- */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function runDraw() {
    var pool = shuffle(state.selected.slice());
    state.results = state.items
      .filter(function (it) { return it.count > 0; })
      .map(function (it) {
        return { key: it.key, icon: it.icon, members: pool.splice(0, it.count) };
      });
  }

  var countdownHandle = null, rollTimer = null;

  /* 这几项必须与 styles.css 里 .draw-slot__name / .draw-slot 的基准值一致 */
  var REEL_FONT = 183.26;    // 字宽 = 一个汉字的推进宽度
  var REEL_H = 300;          // 滚轮单格高度
  var WIN_H = 200;           // 槽位窗口高度
  var REEL_K = 11;           // 每个滚轮先滚过多少格
  var REEL_DUR = 2100;       // 滚动时长
  var REEL_STAGGER = 110;    // 同一个名字里，相邻两个字起步的时间差 —— 就是斜线错位的来源
  var MAX_ROWS = 2;          // 人名最多排两行 —— 每行 238.2px，从 top:485.22 起三行就出屏了

  var drawScale = 1;

  /* 整体缩放：字号、格高、行距、槽位宽一起乘同一个系数 */
  function setDrawScale(s) {
    drawScale = s;
    var box = $('[data-role="draw-names"]');
    if (box) box.style.setProperty('--dfs', s);
  }

  /* 终点：让最后一格的墨迹正好落在窗口正中。
     单格比窗口高 (REEL_H - WIN_H)，墨迹在格内居中，所以还要再上移一半的差值。 */
  function reelEndY(k) {
    var cell = REEL_H * drawScale, win = WIN_H * drawScale;
    return -(k * cell) - (cell - win) / 2;
  }

  /* 当前排了几行（按各槽位的纵向位置分组） */
  function nameRows() {
    var seen = {};
    $$('.draw-slot').forEach(function (s) { seen[Math.round(s.offsetTop)] = 1; });
    return Object.keys(seen).length;
  }

  /* 布局基线：以设计稿里最左边那个人名框的左缘为准。
     做法是用「结果人名」的宽度先模拟一遍设计稿的换行，得到最宽一行的宽度，
     它在 1300 的容器里居中时的左缘，就是基准线。之后所有名字框都从这个左缘
     往右排 —— 谁需要预留更宽，就往后挤别人，绝不会把左边的名字顶得偏左。 */
  function designLeft(members) {
    var font = REEL_FONT * drawScale, gap = 108.5 * drawScale;
    if (!members.length) return (2000 - 1300) / 2;
    var widest = 0, cur = 0, n = 0;
    members.forEach(function (m) {
      var w = m.length * font;
      if (n && cur + gap + w > 1300) { widest = Math.max(widest, cur); cur = w; n = 1; }
      else { cur += (n ? gap : 0) + w; n++; }
    });
    widest = Math.max(widest, cur);
    return (2000 - 1300) / 2 + Math.max(0, (1300 - widest) / 2);
  }

  /* 滚动池：就是本组已选范围本身。
     前面抽过的名字**仍然允许**在后续项里滚出来 —— 不做任何排除。
     这样池子永远够大，也不会出现「最后一项只剩一个人、每个名字位都在重复滚同一个字」。 */
  function rollPool() {
    return state.selected.slice();
  }

  /* 左对齐：名字一律从第 0 位起摆，多余的字符位留在右边并且是空的。
     于是「结果的第一个字」永远在最左边那个固定位置上，长短名字的左缘都对齐，
     更长的候选只是往右多占几格，不会挤动别人。 */
  function padOf(cols, len) { return 0; }

  function randomSeq(pool, k) {
    var out = [];
    for (var i = 0; i < k; i++) {
      var pick = pool[Math.floor(Math.random() * pool.length)];
      out.push(pick);
    }
    return out;
  }

  /* 一个名字一个槽位，槽内每个字各是一个纵向滚轮。
     同一名字的各列滚的是**同一个名字序列**，只是起步时间依次延后——
     于是滚动过程中各列错开、连成一条斜线，落定时对齐成正字。
     每列的末位就是最终结果，停下来的那一刻无需再换内容。
     返回 [{el, endY, delay}]，由调用方决定是直接落位还是播动画。 */
  function buildReels(members, atEnd) {
    var box = $('[data-role="draw-names"]');
    box.innerHTML = '';
    var jobs = [];
    var font = REEL_FONT * drawScale;
    var pool = atEnd ? null : rollPool();
    box.style.left = designLeft(members) + 'px';   // 左缘基线按「结果人名」算，滚动与落定同一条

    members.forEach(function (name) {
      var seq = atEnd ? [name] : randomSeq(pool, REEL_K).concat([name]);   // 末位永远是结果
      // 进该项时就把「结果长度」和「候选里最长的名字」一起考虑进来，
      // 槽宽一次按较大者定死、全程不动 —— 滚动时才不会出现名字位互相重叠。
      var cols = Math.max(name.length,
                          seq.reduce(function (a, n) { return Math.max(a, n.length); }, 0));
      var slot = document.createElement('span');
      slot.className = 'draw-slot';
      slot.style.width = (cols * font) + 'px';
      slot.dataset.w = (name.length * font);

      for (var i = 0; i < cols; i++) {
        var col = document.createElement('span');
        col.className = 'draw-col';
        var track = document.createElement('span');
        track.className = 'draw-col__track';
        track.innerHTML = seq.map(function (n) {
          var idx = i - padOf(cols, n.length);          // 居中后这一列对应的字，没有就是空
          var s = document.createElement('span');
          s.className = 'draw-ch';
          s.textContent = (idx >= 0 && idx < n.length) ? n.charAt(idx) : '';
          return s.outerHTML;
        }).join('');
        col.appendChild(track);
        slot.appendChild(col);
        jobs.push({
          el: track,
          endY: reelEndY(atEnd ? 0 : REEL_K),
          delay: i * REEL_STAGGER
        });
      }
      box.appendChild(slot);
    });
    alignRows(box, font);
    return jobs;
  }

  /* 逐行校正横向位置。
     预留更宽的名字框会把整行往右推，但**每行最左边那个人名框**仍应待在
     设计稿的位置上（= 该行按「结果人名」宽度居中时的左缘）。
     这里按行分组算出偏差，用 position:relative 平移回来 —— 纯视觉位移，不触发重排，
     行内其余名字框保持「向右让位」的关系不变。 */
  function alignRows(box, font) {
    var slots = $$('.draw-slot', box);
    if (!slots.length) return;
    var rows = {};
    slots.forEach(function (sl) {
      var t = Math.round(sl.offsetTop);
      (rows[t] = rows[t] || []).push(sl);
    });
    var gap = 108.5 * drawScale;
    // 各行的「按结果宽度算」的设计行宽
    var keys = Object.keys(rows);
    var widths = {};
    keys.forEach(function (t) {
      var w = 0;
      rows[t].forEach(function (sl, i) { w += parseFloat(sl.dataset.w || 0) + (i ? gap : 0); });
      widths[t] = w;
    });
    // 容器左缘已经对齐到「最宽那行」的设计左缘，所以行内偏移要相对最宽行来算
    var widest = Math.max.apply(null, keys.map(function (t) { return widths[t]; }));
    keys.forEach(function (t) {
      var row = rows[t];
      var want = Math.max(0, (widest - widths[t]) / 2);
      var dx = want - row[0].offsetLeft;
      if (Math.abs(dx) < 0.5) return;
      row.forEach(function (sl) {
        sl.style.position = 'relative';
        sl.style.left = dx + 'px';
      });
    });
  }

  /* 排好人名：超过两行就整体缩小再重排，直到装得下或到下限。
     字变小 → 每行能站下更多人 → 行数回落，所以这个循环很快收敛（最多 5 次左右）。 */
  function layoutReels(members, atEnd) {
    var s = 1, jobs;
    for (var i = 0; i < 8; i++) {
      setDrawScale(s);
      jobs = buildReels(members, atEnd);
      if (nameRows() <= MAX_ROWS) break;
      s *= 0.88;
      if (s < 0.42) break;
    }
    return jobs;
  }

  /* 抽取动画：每个字一路快速上滚、再逐渐减速停在结果上，
     同一个名字里第一个字先起步，后面的字依次延后，做出错位的动态感。 */
  function rollNames(members, done) {
    clearTimeout(rollTimer);
    var box = $('[data-role="draw-names"]');
    var jobs = layoutReels(members, false);

    jobs.forEach(function (j) { j.el.style.transition = 'none'; j.el.style.transform = 'translateY(0)'; });
    void box.offsetWidth;                      // 强制重排，过渡才会从头播
    jobs.forEach(function (j) {
      j.el.style.transition = 'transform ' + REEL_DUR + 'ms cubic-bezier(.3, .75, .25, 1) ' + j.delay + 'ms';
      j.el.style.transform = 'translateY(' + j.endY + 'px)';
    });

    var maxLen = members.reduce(function (a, n) { return Math.max(a, n.length); }, 1);
    rollTimer = setTimeout(done, REEL_DUR + (maxLen - 1) * REEL_STAGGER + 40);
  }

  function renderDrawItem(i, still) {
    var r = state.results[i];
    if (!r) return;
    var screenEl = $('.screen[data-screen="draw"]');

    $('[data-role="draw-icon"]').dataset.icon = r.icon;
    $('[data-role="draw-icon"]').innerHTML = '';
    mountIcons(screenEl);

    $('[data-role="draw-name"]').textContent = r.key;
    $('[data-role="draw-index"]').textContent = i + 1;
    $('[data-role="draw-total"]').textContent = state.results.length;

    clearInterval(countdownHandle);
    clearTimeout(rollTimer);
    var btn = $('[data-role="draw-timer"]');
    btn.classList.add('is-hidden');            // 抽取结束前不显示「3 秒后继续」

    function settle() {
      // 字符位数从进该项起就定死了，这里不再改动布局 —— 落定只换内容，不搬位置
      btn.classList.remove('is-hidden');
      if (still) return;                       // 预览模式：停在结果上，不计时
      var left = 3;
      $('[data-role="timer-text"]').textContent = left + ' 秒后继续';
      countdownHandle = setInterval(function () {
        left -= 1;
        if (left <= 0) { clearInterval(countdownHandle); nextItem(); return; }
        $('[data-role="timer-text"]').textContent = left + ' 秒后继续';
      }, 1000);
    }

    if (still) {
      var jobs = layoutReels(r.members, true);
      void $('[data-role="draw-names"]').offsetWidth;   // 先让新建的滚轮布局落地，
      // 再写 transform，否则两者挤在同一帧里，有些情况下会按未位移的状态绘制
      jobs.forEach(function (j) { j.el.style.transform = 'translateY(' + j.endY + 'px)'; });
      settle();
      return;
    }
    rollNames(r.members, settle);
  }

  function nextItem() {
    clearInterval(countdownHandle);
    state.cursor += 1;
    if (state.cursor >= state.results.length) { renderSummary(); show('summary'); return; }
    renderDrawItem(state.cursor);
  }

  /* ---------- 过场 ---------- */
  function playTransition() {
    var el = $('.screen[data-screen="transition"]');
    var step = 1;
    el.dataset.step = 1;
    show('transition');
    var h = setInterval(function () {
      step += 1;
      el.dataset.step = step;
      if (step >= 4) {
        clearInterval(h);
        setTimeout(function () {
          runDraw();
          state.cursor = 0;
          show('draw');            // 必须先显示：display:none 时过渡不会跑，滚轮会直接跳到终点
          renderDrawItem(0);
        }, 700);
      }
    }, 480);
  }

  /* ---------- 总结 ---------- */
  function summaryItemHTML(r) {
    return '<div class="summary-item">' +
             '<span class="icon" data-icon="' + r.icon + '" style="--icon-size:49.2px"></span>' +
             '<span class="summary-item__label"></span>' +
           '</div>';
  }

  function namesHTML(members, cls) {
    var inner = members.map(function (n) { return '<span>' + n + '</span>'; }).join('');
    // 外层负责定位定宽，滚动条叠在它右侧、不跟着内容滚
    return '<div class="' + cls + '-wrap"><div class="' + cls + '">' + inner + '</div></div>';
  }

  /* ---------- 自定义滚动条 ----------
     原生滚动条在 Win11「自动隐藏滚动条」下会变成悬浮式：不占位、默认不可见、拖不动，
     且此时 ::-webkit-scrollbar 被忽略。所以自己画一条，各环境表现一致，样式也能贴合整体。 */

  function makeScrollbar(box, hugContent) {
    var wrap = box.parentElement;
    if (!wrap || wrap.querySelector(':scope > .scrollbar')) return;

    var bar = document.createElement('span');
    bar.className = 'scrollbar';
    var thumb = document.createElement('span');
    thumb.className = 'scrollbar__thumb';
    bar.appendChild(thumb);
    wrap.appendChild(bar);

    // 舞台带 scale，视口像素换算回设计像素才能与 scrollTop 对齐
    function scale() {
      var r = box.getBoundingClientRect();
      return box.clientWidth ? r.width / box.clientWidth : 1;
    }

    function sync() {
      var over = box.scrollHeight - box.clientHeight;
      if (over <= 1) { bar.classList.remove('is-on'); return; }
      bar.classList.add('is-on');
      var track = box.clientHeight;
      var h = Math.max(28, track * track / box.scrollHeight);
      bar.style.height = track + 'px';
      thumb.style.height = h + 'px';
      thumb.style.transform = 'translateY(' + ((track - h) * (box.scrollTop / over)) + 'px)';

      if (hugContent) {
        // 右栏容器固定 1160 宽，但内容只到 850 上下；贴容器右缘会跑到舞台外看不见，
        // 所以改贴内容的实际右缘。
        var right = 0;
        Array.prototype.forEach.call(box.children, function (c) {
          right = Math.max(right, c.offsetLeft + c.offsetWidth);
        });
        bar.style.left = (box.offsetLeft + right + 8) + 'px';
      } else {
        // 左栏各行固定在列边缘：名字字数不同，贴内容右缘会让滚动条左右乱跳。
        bar.style.left = (box.offsetLeft + box.clientWidth - 6) + 'px';
      }
    }
    box.__syncScrollbar = sync;
    box.addEventListener('scroll', sync, { passive: true });

    // 拖滑块
    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var travel = box.clientHeight - thumb.offsetHeight;
      var over = box.scrollHeight - box.clientHeight;
      if (travel <= 0 || over <= 0) return;
      var ratio = over / travel, y0 = e.clientY, top0 = box.scrollTop;
      function move(ev) { box.scrollTop = top0 + (ev.clientY - y0) / scale() * ratio; }
      function up(ev) {
        bar.classList.remove('is-dragging');
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        if (thumb.hasPointerCapture && thumb.hasPointerCapture(ev.pointerId)) thumb.releasePointerCapture(ev.pointerId);
      }
      // 先绑监听再捕获：万一捕获失败（例如合成事件没有真实指针），拖动仍然可用
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
      try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
      bar.classList.add('is-dragging');
    });

    // 点空白轨道翻页
    bar.addEventListener('pointerdown', function (e) {
      if (e.target !== bar) return;
      var tr = thumb.getBoundingClientRect();
      var dir = e.clientY < tr.top ? -1 : 1;
      box.scrollBy({ top: dir * box.clientHeight * 0.9, behavior: 'smooth' });
    });

    // 内容区也支持鼠标拖动（触摸走原生滚动，见 touch-action: pan-y）
    var drag = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { y: e.clientY, top: box.scrollTop, moved: 0 };
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.abs(dy));
      if (drag.moved <= 4) return;
      box.classList.add('is-dragging');
      box.scrollTop = drag.top - dy / scale();
      e.preventDefault();
    });
    function endDrag() { drag = null; box.classList.remove('is-dragging'); }
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    box.addEventListener('pointerleave', endDrag);

    sync();
  }

  function syncScrollbars() {
    $$('.summary-names, .summary-right-names').forEach(function (box) {
      if (box.__syncScrollbar) box.__syncScrollbar();
    });
  }

  function renderSummary() {
    var res = state.results.filter(function (r) { return r.members.length; });
    if (!res.length) return;

    // 人数最多的那项独占右栏、人名排成网格（对应原稿里「刷地 4 人」的位置）；
    // 其余项在左栏各占一行。人数相同时取靠后的一项。
    var wide = 0;
    res.forEach(function (r, i) { if (r.members.length >= res[wide].members.length) wide = i; });
    var leftRows  = res.filter(function (_, i) { return i !== wide; });
    var rightItem = res[wide];

    var host = $('[data-role="summary"]');
    host.innerHTML = '';

    var left = document.createElement('div');
    left.className = 'summary-left';
    leftRows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = summaryItemHTML(r) + namesHTML(r.members, 'summary-names');
      $('.summary-item__label', row).textContent = r.key;
      left.appendChild(row);
    });
    host.appendChild(left);

    var right = document.createElement('div');
    right.innerHTML =
      '<div class="summary-right-item">' + summaryItemHTML(rightItem) + '</div>' +
      namesHTML(rightItem.members, 'summary-right-names');
    $('.summary-item__label', right).textContent = rightItem.key;
    host.appendChild(right);

    mountIcons(host);
    $$('.summary-names', host).forEach(function (b) { makeScrollbar(b, false); });
    $$('.summary-right-names', host).forEach(function (b) { makeScrollbar(b, true); });
  }

  /* ---------- 分享：把总结页画成图片存到本地 ---------- */

  var iconCache = {};

  function loadIcon(name, color) {
    var key = name + '|' + color;
    if (iconCache[key]) return iconCache[key];
    var def = window.ICONS[name];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + def.viewBox +
              '" fill="' + color + '">' + def.inner + '</svg>';
    iconCache[key] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    return iconCache[key];
  }

  /* 舞台带 scale，getBoundingClientRect 拿到的是缩放后的值，
     除以缩放系数即回到设计坐标 —— 这样画布上的位置与页面所见完全一致。 */
  function stageMapper() {
    var sr = $('#stage').getBoundingClientRect();
    var k = sr.width / STAGE_W;
    return function (el) {
      var r = el.getBoundingClientRect();
      return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k,
               w: r.width / k, h: r.height / k };
    };
  }

  function drawIconContain(ctx, img, name, box) {
    var vb = window.ICONS[name].viewBox.split(/\s+/).map(Number);
    var vw = vb[2], vh = vb[3];
    var s = Math.min(box.w / vw, box.h / vh);          // 与 svg 的 preserveAspectRatio=meet 一致
    var dw = vw * s, dh = vh * s;
    ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  }

  /* 按 s 比例缩小绘制单行文字：用于导出时把「屏幕上装不下、得滚动才能看全」的人名区
     整体缩到装得下。位置与行高同步乘以 s，等价于把整块等比缩放，换行关系不变。 */
  function drawTextScaled(ctx, el, boxRect, s) {
    var cs = getComputedStyle(el);
    var fs = parseFloat(cs.fontSize) * s;
    var lh = (cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight)) * s;
    ctx.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
    ctx.fillStyle = cs.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var m = ctx.measureText('永');
    var A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
    ctx.fillText(el.textContent,
                 boxRect.x + el.offsetLeft * s,
                 boxRect.y + el.offsetTop * s + (lh - (A + D)) / 2 + A);
  }

  /* 单行文本：按 CSS 的「半行距」规则算出基线，行内墨迹位置才和页面一致 */
  function drawText(ctx, el, box) {
    var cs = getComputedStyle(el);
    var fs = parseFloat(cs.fontSize);
    var lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight);
    ctx.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
    ctx.fillStyle = cs.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var m = ctx.measureText('永');
    var A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
    ctx.fillText(el.textContent, box.x, box.y + (lh - (A + D)) / 2 + A);
  }

  function shareSummary() {
    var screenEl = $('.screen[data-screen="summary"]');
    if (!screenEl || !$$('.summary-item__label').length) return;
    var btn = $('[data-action="share"]');
    btn.disabled = true;

    var at = stageMapper();
    var canvas = document.createElement('canvas');
    canvas.width = STAGE_W; canvas.height = STAGE_H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = getComputedStyle($('#stage')).backgroundColor;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    // 图标要等 SVG 解码，先全部发起。只取结果区里的图标，页脚的分享图标不进图。
    var iconJobs = [];
    $$('.summary .icon[data-icon]', screenEl).forEach(function (el) {
      var box = at(el);
      iconJobs.push(loadIcon(el.dataset.icon, getComputedStyle(el).color).then(function (img) {
        drawIconContain(ctx, img, el.dataset.icon, box);
      }));
    });

    // 只画分工结果本身：底部的「再来一次」按钮和分享图标不进图
    Promise.all(iconJobs).then(function () {
      $$('.summary-item__label', screenEl).forEach(function (el) { drawText(ctx, el, at(el)); });

      // 人名区：屏幕上需要滚动才能看全的，导出时整块按比例缩小，保证名字一个不少
      $$('.summary-names, .summary-right-names', screenEl).forEach(function (box) {
        var s = box.scrollHeight > box.clientHeight ? box.clientHeight / box.scrollHeight : 1;
        var b = at(box);
        Array.prototype.forEach.call(box.children, function (sp) {
          drawTextScaled(ctx, sp, b, s);
        });
      });

      canvas.toBlob(function (blob) {
        btn.disabled = false;
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '刷了吗-分工结果.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }, 'image/png');
    }).catch(function () { btn.disabled = false; });
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
      case 'start':
        state.groupIndex = 0;
        state.touched = false;                       // 默认全选第一组
        state.selected = currentGroup().members.slice();
        renderTabs(); renderChips();
        show('range');
        // 必须放在 show 之后：本屏还是 display:none 时设置 scrollLeft 不生效，
        // 上一次滚过的位置会被带进来。
        $('[data-role="tabs-wrap"]').scrollLeft = 0;
        updateTabsFade();
        break;
      case 'to-config':
        if (!state.selected.length) return;
        state.items = makeItems();
        renderConfig();
        show('config');
        break;
      case 'to-transition':
        if (el.disabled) return;
        if (state.items.reduce(function (a, b) { return a + b.count; }, 0) !== state.selected.length) return;
        playTransition();
        break;
      case 'next-item':
        nextItem();
        break;
      case 'share':
        shareSummary();
        break;
      case 'restart':
        state.selected = []; state.results = []; state.cursor = 0;
        renderTabs(); renderChips();
        show('home');
        break;
    }
  });

  /* ---------- 开发预览：?screen=range / config / transition / draw / summary ----------
     便于逐屏与设计原稿比对，正式使用时不带参数即从首页开始。 */
  function devPreview() {
    var q = new URLSearchParams(location.search);
    var name = q.get('screen');
    if (!name) return false;
    var seed = {
      draw1: { key: '擦拭', members: ['陈子轩'] },
      draw2: { key: '讲台', members: ['许晨曦', '曹文杰'] },
      draw3: { key: '刷地', members: ['程子豪', '蔡文博', '肖雅琳'] },
      draw4: { key: '走廊', members: ['吕佳明', '丁雨欣', '任浩宇', '沈雅涵'] }
    };
    state.selected = currentGroup().members.slice();
    renderTabs(); renderChips();
    if (name === 'range') {
      // 对齐设计稿：第一组中「赵思远」未选中，计数为 6
      state.selected = state.selected.filter(function (n) { return n !== '赵思远'; });
      $$('.chip').forEach(function (c) { c.classList.toggle('is-off', c.dataset.name === '赵思远'); });
      updateRangeFooter();
      show('range'); return true;
    }
    if (name === 'config') { renderConfig(); show('config'); return true; }
    if (name === 'transition') { $('.screen[data-screen="transition"]').dataset.step = q.get('step') || 4; show('transition'); return true; }
    if (name === 'draw') {
      var n = q.get('n') || '1';
      var s = seed['draw' + n];
      state.results = s ? [{ key: s.key, icon: s.key, members: s.members }] : [];
      state.cursor = 0;
      show('draw');
      renderDrawItem(0, true);   // 预览模式：直接给抽取结束后的静止状态
      return true;
    }
    if (name === 'summary') {
      state.results = [
        { key: '擦拭', icon: '擦拭', members: ['陈子轩'] },
        { key: '讲台', icon: '讲台', members: ['许晨曦'] },
        { key: '走廊', icon: '走廊', members: ['吕佳明'] },
        { key: '刷地', icon: '刷地', members: ['丁雨欣', '苏梦琪', '曹文杰', '任浩宇'] }
      ];
      renderSummary();
      show('summary');
      return true;
    }
    return false;
  }

  /* ---------- 启动 ---------- */
  (function () {
    var wrap = $('[data-role="tabs-wrap"]');
    if (wrap) wrap.addEventListener('scroll', updateTabsFade, { passive: true });
    enableDragScroll();
  })();
  /* @font-face 用的是 font-display: block：字体就绪前文字完全不可见。
     三个 TTF 各有 8MB，本地直接打开 html 时要解析几百毫秒——
     期间页面「只有一个圆和按钮，没有字」，然后文字突然蹦出来。
     所以先等字体就绪再渲染首屏，让所有元素一起出现。 */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    fitStage();
    renderBadgeRoll();
    mountIcons(document);
    state.items = makeItems();
    renderTabs();
    renderChips();
    if (!devPreview()) show('home');
  }
  (function () {
    if (!document.fonts || !document.fonts.load) { boot(); return; }
    Promise.all(['400', '500', '900'].map(function (w) {
      return document.fonts.load(w + ' 24px "HarmonyOS Sans SC"');
    })).then(boot, boot);
    setTimeout(boot, 3000);   // 字体加载失败/卡住时兜底，别一直白屏
  })();
})();
