// dsh-reload-button — web client half.
// 左侧栏"设置"按钮旁注入一个重载按钮；点击后发起后端重启（host 半路由），
// 全程保持窗口打开：立即弹出高斯模糊遮罩（中央 DeepSeek 鲸鱼），轮询
// /api/dsh-reload-button/ping 直到后端恢复，然后收尾（旧页面自动 reload 拿
// 新 bundle；已 reload 的新页面直接结束遮罩）。
//
// 跨 reload 状态放在 localStorage：点击时写 pending{fresh:false}；页面每次
// 加载若读到 pending 则把 fresh 置 true 并恢复遮罩 —— 保证"由谁收尾"只有
// 一份职责，不会双方同时 reload。
//
// Module format: window.__ModuleLoader__ 工厂 bundle，纯 JS + 原生 DOM，
// 不依赖 React（client 半无 slots/connection 需要）。

window.__ModuleLoader__.load({
  id: 'dsh-reload-button',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var RELOAD_API = '/api/dsh-reload-button/reload';
    var PING_API = '/api/dsh-reload-button/ping';
    var WHALE_URL = '/api/dsh-reload-button/whale.svg';
    var PENDING_KEY = 'dsh-reload-button:pending';
    /** 与 dsh-auto-resume 的联动标记：点击重载＝显式请求"重启后自动续接"。 */
    var RESUME_REQUEST_KEY = 'dsh-auto-resume:resume-request';
    /** 等待后端恢复的总超时（毫秒）：60 秒封顶，超时退出遮罩并提示，
     * 避免"黑屏"感（服务启动通常 5~20 秒）。 */
    var WAIT_TIMEOUT_MS = 60000;
    /** ping 连续成功两次的间隔（给会话/WebSocket 挂载留时间）。 */
    var SETTLE_MS = 1200;

    var CSS =
      '.dshrb-trigger{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b2);cursor:pointer;transition:background-color 120ms ease,color 120ms ease}' +
      '.dshrb-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#e8eaed)}' +
      '.dshrb-trigger:active{background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.22))}' +
      '.dshrb-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#161b22),0 0 0 4px var(--dsw-alias-brand-primary,#4d6bfe)}' +
      '.dshrb-trigger[data-busy="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}' +
      '.dshrb-trigger[data-busy="true"] svg{animation:dshrb-spin 1.1s linear infinite}' +
      '.dshrb-mask{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#0d1117) 52%,transparent);backdrop-filter:blur(14px) saturate(1.1);-webkit-backdrop-filter:blur(14px) saturate(1.1)}' +
      '.dshrb-mask[hidden]{display:none}' +
      '.dshrb-whale{width:88px;height:88px;opacity:.95;filter:drop-shadow(0 8px 26px rgba(0,0,0,.38));animation:dshrb-breathe 2.6s ease-in-out infinite}' +
      '.dshrb-mask p{margin:0;color:var(--dsw-alias-label-secondary,#9aa4b2);font-size:13px;letter-spacing:.02em}' +
      '.dshrb-mask p.dshrb-title{color:var(--dsw-alias-label-primary,#e8eaed);font-size:15px;font-weight:600}' +
      '.dshrb-timeout{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483001;box-sizing:border-box;max-width:min(560px,calc(100vw - 32px));padding:10px 16px;border:1px solid var(--dsw-alias-state-error-primary,#e5484d);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#161b22);color:var(--dsw-alias-label-primary,#e8eaed);font-size:13px;line-height:20px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.3));animation:dshrb-fadein 180ms ease}' +
      '@keyframes dshrb-fadein{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}' +
      '@keyframes dshrb-spin{to{transform:rotate(360deg)}}' +
      '@keyframes dshrb-breathe{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){.dshrb-whale{animation:none}.dshrb-trigger[data-busy="true"] svg{animation:none}}';

    function ensureStyle() {
      if (document.querySelector('style[data-plugin-css="dsh-reload-button"]') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-reload-button';
      tag.dataset.pluginCss = 'dsh-reload-button';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ---- 设置按钮定位 ----
    // 稳定锚点 = ui-settings 注册的 settings.trigger 插槽（语义化、无版本
    // 依赖）；部分环境该按钮无文本/aria（仅图标+slot），因此文本匹配只作兜底。
    function findSettingsButton() {
      var slot = document.querySelector('div[data-slot="settings.trigger"]');
      if (slot !== null) {
        var fromSlot = slot.closest('button');
        if (fromSlot !== null) return fromSlot;
      }
      var roots = document.querySelectorAll('[data-pane="sidebar"], [data-slot="sidebar"]');
      for (var i = 0; i < roots.length; i += 1) {
        var buttons = roots[i].querySelectorAll('button');
        for (var j = 0; j < buttons.length; j += 1) {
          var label = ((buttons[j].getAttribute('aria-label') || '') + ' ' + (buttons[j].textContent || '')).trim();
          if (/设置|settings/i.test(label)) return buttons[j];
        }
      }
      return null;
    }

    /**
     * 设置按钮之前的最后一个按钮（DOM 顺序）——即"设置上方那一行"的行尾
     * 按钮（实测布局：检查更新 → 远程访问 → 设置，锚点 = 远程访问），
     * 重载按钮插到锚点之后 = 落在上方两个按钮那一行的右侧。
     */
    function previousButtonBefore(settings) {
      var roots = document.querySelectorAll('[data-pane="sidebar"] button, [data-slot="sidebar"] button');
      var previous = null;
      for (var i = 0; i < roots.length; i += 1) {
        if (roots[i] === settings) return previous;
        previous = roots[i];
      }
      return null;
    }

    // ---- 遮罩 ----
    function showMask() {
      var mask = document.querySelector('.dshrb-mask');
      if (mask === null) {
        mask = document.createElement('div');
        mask.className = 'dshrb-mask';
        mask.dataset.dshReloadMask = 'true';
        var img = document.createElement('img');
        img.className = 'dshrb-whale';
        img.src = WHALE_URL;
        img.alt = '';
        var title = document.createElement('p');
        title.className = 'dshrb-title';
        title.textContent = '正在重载 DeepSeek Harness';
        var hint = document.createElement('p');
        hint.textContent = '后端服务重启中，通常需要 5~20 秒，完成后将自动恢复';
        mask.appendChild(img);
        mask.appendChild(title);
        mask.appendChild(hint);
        document.body.appendChild(mask);
      }
      mask.hidden = false;
    }

    function hideMask() {
      var mask = document.querySelector('.dshrb-mask');
      if (mask !== null) mask.remove();
    }

    function maskActive() {
      var mask = document.querySelector('.dshrb-mask');
      return mask !== null && mask.hidden !== true;
    }

    // ---- localStorage 状态 ----
    function readPending() {
      try {
        var raw = window.localStorage.getItem(PENDING_KEY);
        if (raw === null) return null;
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed.ts === 'number' ? parsed : null;
      } catch (error) {
        return null;
      }
    }

    function writePending(value) {
      try {
        window.localStorage.setItem(PENDING_KEY, JSON.stringify(value));
      } catch (error) {
        /* localStorage 不可用（隐私模式等）：遮罩仍在本页工作 */
      }
    }

    function clearPending() {
      try {
        window.localStorage.removeItem(PENDING_KEY);
      } catch (error) {
        /* ignore */
      }
    }

    function delay(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function pingAlive() {
      try {
        var response = await fetch(PING_API, { cache: 'no-store' });
        return response.ok;
      } catch (error) {
        return false;
      }
    }

    // ---- 等待恢复的主循环 ----
    var waiting = false;

    /** 超时提示条：遮罩退出后告知用户下一步（5 秒自动消失）。 */
    function showTimeoutNotice() {
      try {
        var old = document.querySelector('.dshrb-timeout');
        if (old !== null) old.remove();
        var notice = document.createElement('div');
        notice.className = 'dshrb-timeout';
        notice.textContent = '重载未完成：后端未在 60 秒内恢复，请检查服务状态或刷新页面';
        document.body.appendChild(notice);
        setTimeout(function () {
          var node = document.querySelector('.dshrb-timeout');
          if (node !== null) node.remove();
        }, 5000);
      } catch (error) {
        /* ignore */
      }
    }

    async function waitForAlive() {
      if (waiting) return;
      waiting = true;
      try {
        var startedAt = Date.now();
        while (true) {
          if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
            hideMask();
            clearPending();
            showTimeoutNotice();
            window.console.warn('[dsh-reload-button] 等待后端恢复超时，已退出遮罩');
            return;
          }
          var alive = await pingAlive();
          if (!alive) {
            await delay(700);
            continue;
          }
          // 连续两次成功才算稳定（服务刚起来时可能 200 但还没挂好会话）。
          await delay(SETTLE_MS);
          if (!(await pingAlive())) continue;
          break;
        }
        finishAfterRecovery();
      } finally {
        waiting = false;
      }
    }

    function finishAfterRecovery() {
      var pending = readPending();
      if (pending === null || pending.fresh !== true) {
        // 旧页面（点击后从未 reload）：刷新页面拿最新 bundle 与会话状态；
        // 新页面加载时读到 pending 会置 fresh 并接管收尾。
        window.location.reload();
        return;
      }
      // 已 reload 过的新页面：直接收尾。
      delay(500).then(function () {
        hideMask();
        clearPending();
      });
    }

    // ---- 触发 ----
    function onTriggerClick() {
      // 联动：显式请求 auto-resume 在恢复后自动续接（与断连猜测解耦）。
      try {
        window.localStorage.setItem(RESUME_REQUEST_KEY, JSON.stringify({ ts: Date.now() }));
      } catch (error) {
        /* localStorage 不可用：auto-resume 仍可退到断连检测路径 */
      }
      writePending({ ts: Date.now(), fresh: false });
      showMask();
      // fire-and-forget：host 先回 200 再延迟调度重启。
      fetch(RELOAD_API, { method: 'POST', cache: 'no-store' }).catch(function () {});
      void waitForAlive();
    }

    /** 注入锁：React 重渲染瞬间的并发回调只放行一个插入者。 */
    var injecting = false;

    function ensureTriggerButton() {
      if (injecting) return;
      // 已存在（含 isConnected 校验——React 可能已把旧的移走但 query 还能命中？不会，移走即不在 DOM）
      if (document.querySelector('button[data-dsh-reload-trigger]') !== null) return;
      var settings = findSettingsButton();
      if (settings === null || !settings.isConnected) return;
      injecting = true;
      try {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.dshReloadTrigger = 'true';
        btn.className = 'dshrb-trigger';
        btn.setAttribute('aria-label', '重载后端');
        btn.title = '重载后端（重启 dsh web 服务，窗口保持打开）';
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">' +
          '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4.5v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19.5v-5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
        btn.addEventListener('click', onTriggerClick);
        // 插入到"设置上方那一行"的右侧（锚点 = 设置之前最后一个按钮）；
        // 无锚点（设置是该区域第一个按钮）时退到设置之后。
        var anchor = previousButtonBefore(settings);
        var host = anchor !== null && anchor.isConnected ? anchor : settings;
        var side = anchor !== null && anchor.isConnected ? anchor.nextSibling : settings.nextSibling;
        host.parentElement.insertBefore(btn, side);
      } finally {
        injecting = false;
      }
    }

    /**
     * 按钮持久维护：侧边栏 footer 是 React 渲染的，重渲染（折叠/切换/会话
     * 恢复）会清掉原生插入的按钮 —— 所以观察器不设次数上限、注入成功也不
     * 断开，持续"有缺即补"；另加 3s 轮询兜底（防 React 批量重排淹没事件）。
     */
    function installTriggerButton() {
      ensureTriggerButton();
      var observer = new MutationObserver(function () {
        ensureTriggerButton();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      var timer = setInterval(ensureTriggerButton, 3000);
      return function () {
        observer.disconnect();
        clearInterval(timer);
      };
    }

    // ---- 入口 ----
    function apply() {
      ensureStyle();
      // 页面（重新）加载：若存在 pending（本次点击的重载还没收尾）→ 置 fresh 并恢复遮罩。
      var pending = readPending();
      if (pending !== null && pending.fresh !== true) {
        writePending({ ...pending, fresh: true });
      }
      if (readPending() !== null) {
        showMask();
        void waitForAlive();
      }
      installTriggerButton();
    }

    exports.apply = apply;
    return module.exports;
  },
});