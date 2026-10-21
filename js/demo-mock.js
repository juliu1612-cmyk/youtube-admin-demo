/* ============================================================
 * 演示版数据拦截层（仅用于 GitHub Pages 静态演示）
 * 原理：在 app.js 之前加载，拦截 window.fetch 与上传类 XMLHttpRequest，
 * 把所有 /api/* 请求替换为演示数据。真实后端不存在，功能为界面演示。
 * ============================================================ */
(function () {
  'use strict';

  var DEMO_CHANNELS = [
    {
      id: 'UCdemo00000000000000000A1',
      title: '演示频道 · 都市剧场',
      thumbnail: '',
      createdAt: '2026-08-01T09:00:00.000Z',
      meta: { owner: '演示归属人A', channelName: '演示频道·都市剧场', language: '中文（简体）', company: '演示文化传媒', gender: '男频', channelType: '一轮大号', operationMode: '自运营', supplier: '演示供应商A', copyrightType: '独家买断', dramaType: '真人剧', monetized: 'YPP', ranking: 'YB', status: '运营中', remark: '演示数据，未绑定真实授权', descTemplate: '【{channelTitle}】{title}\\n\\n合集组：{collectionGroup} · 语言：{language}\\n\\n{channelTitle} 每日更新，感谢订阅支持！\\n频道主页：{channelUrl}\\n\\n#短剧 #{channelTitle} #追剧', group: '一组', updatedAt: '2026-10-20T05:00:00.000Z' }
    },
    {
      id: 'UCdemo00000000000000000B2',
      title: '演示频道 · 海外短剧',
      thumbnail: '',
      createdAt: '2026-08-12T09:00:00.000Z',
      meta: { owner: '演示归属人B', channelName: '演示频道·海外短剧', language: '英文', company: '演示文化传媒', gender: '女频', channelType: '垂直号（大女主）', operationMode: '代运营（演示B）', supplier: '演示供应商B', copyrightType: '分账授权', dramaType: '漫剧', monetized: '孵化', ranking: '演示 PRETTY', status: '暂停', remark: '', descTemplate: '{title}\\n\\nWatch the full series on {channelTitle}.\\nCollection: {collectionGroup} · Language: {language}\\nChannel: {channelUrl}\\n\\n#shorts #drama #{collectionGroup}', group: '二组', updatedAt: '2026-10-18T05:00:00.000Z' }
    },
    {
      id: 'UCdemo00000000000000000C3',
      title: 'Demo English Channel',
      thumbnail: '',
      createdAt: '2026-09-01T09:00:00.000Z',
      meta: { owner: '演示归属人A', channelName: 'Demo English Channel', language: '英文', company: '演示海外事业部', gender: '无性别', channelType: '测试号', operationMode: '代运营（演示C）', supplier: '演示供应商A', copyrightType: '独家买断', dramaType: '真人剧/漫剧', monetized: 'YPP', ranking: '演示 MZ', status: '养号', remark: 'Demo data, not linked to any real authorization', descTemplate: '', group: '一组', updatedAt: '2026-10-15T05:00:00.000Z' }
    }
  ];

  var DEMO_DICTIONARIES = {
    owners: ['演示归属人A', '演示归属人B'],
    companies: ['演示文化传媒', '演示海外事业部'],
    groups: ['一组', '二组'],
    languages: ['英文', '中文（简体）', '中文（繁体）', '日文', '韩文', '泰文', '越南文', '西班牙文', '葡萄牙文', '印尼语'],
    genders: ['男频', '女频', '无性别'],
    channelTypes: ['一轮大号', '一轮小号', '垂直号（古装）', '垂直号（大女主）', '垂直号'],
    operationModes: ['自运营', '自运营 代运营（演示A）', '代运营（演示B）', '代运营（演示C）'],
    dramaTypes: ['真人剧', '漫剧', '真人剧/漫剧'],
    monetized: ['孵化', 'YPP'],
    rankings: ['YB', '演示 PRETTY', '演示 MZ'],
    statuses: ['运营中', '注销', '暂停', '养号'],
    suppliers: ['演示供应商A', '演示供应商B'],
    copyrightTypes: ['独家买断', '分账授权']
  };

  /* ---------- 指令库：宏参 / 模型 / 示例指令（与真实后端同结构） ---------- */
  var DEMO_MACROS = [
    { key: '合集组名称', desc: '当前视频所属合集组的名称' },
    { key: '合集简介', desc: '当前视频所属合集组的简介' },
    { key: '内容语言', desc: '本次产出的目标语言，如「英语」' },
    { key: '频道名称', desc: '发布目标频道的名称' },
    { key: '译文标题', desc: '已翻译/生成的视频标题' },
    { key: '译文简介', desc: '已翻译/生成的视频简介' }
  ];

  var DEMO_MODELS = [
    { value: 'deepseek-chat', label: 'DeepSeek · deepseek-chat' },
    { value: 'deepseek-reasoner', label: 'DeepSeek · deepseek-reasoner' },
    { value: 'gpt-4o', label: 'OpenAI · gpt-4o' },
    { value: 'gpt-4o-mini', label: 'OpenAI · gpt-4o-mini' },
    { value: 'gpt-3.5-turbo', label: 'OpenAI · gpt-3.5-turbo' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Anthropic · claude-3-5-sonnet' },
    { value: 'qwen-plus', label: '通义千问 · qwen-plus' }
  ];

  var DEMO_INSTRUCTIONS = {
    title: [
      {
        id: 'insDemoTitle01',
        name: '英语标题生成指令（演示）',
        model: 'deepseek-chat',
        channels: [],
        content: '你是短剧频道「{{频道名称}}」的运营专家。\n' +
          '请根据下面的中文原标题与合集信息，生成 1 条 {{内容语言}} 视频标题。\n\n' +
          '合集组：{{合集组名称}}\n合集简介：{{合集简介}}\n原中文标题：{{译文标题}}\n\n' +
          '要求：\n1. 长度控制在 60 字符以内；\n2. 保留原剧的爽点与悬念；\n3. 只输出标题本身，不要解释。',
        updatedAt: '2026-10-18T05:00:00.000Z'
      },
      {
        id: 'insDemoTitle02',
        name: '西语标题改写指令（演示）',
        model: 'gpt-4o-mini',
        channels: ['UCdemo00000000000000000B2'],
        content: 'Eres el responsable del canal「{{频道名称}}」.\n' +
          'Reescribe el título「{{译文标题}}」en {{内容语言}} para el grupo「{{合集组名称}}」.\n' +
          'Máximo 70 caracteres, mantén el gancho emocional. Devuelve solo el título.',
        updatedAt: '2026-10-17T05:00:00.000Z'
      }
    ],
    description: [
      {
        id: 'insDemoDesc01',
        name: '简介生成指令（演示）',
        model: 'deepseek-chat',
        channels: [],
        content: '为频道「{{频道名称}}」的视频写一段 {{内容语言}} 简介。\n\n' +
          '标题：{{译文标题}}\n现有简介：{{译文简介}}\n所属合集：{{合集组名称}}（{{合集简介}}）\n\n' +
          '要求：前两行是钩子，中间 3-5 行剧情简介，结尾 5 个话题标签。总长不超过 800 字符。',
        updatedAt: '2026-10-18T05:00:00.000Z'
      }
    ],
    thumbnail: [
      {
        id: 'insDemoThumb01',
        name: '封面生成指令（演示）',
        model: 'gpt-4o',
        channels: [],
        content: '生成一张 16:9 的短剧封面图。\n' +
          '频道：{{频道名称}}｜合集：{{合集组名称}}｜标题：{{译文标题}}\n' +
          '风格：高对比度、强情绪、居中人物特写，右下角留出标题区域。',
        updatedAt: '2026-10-16T05:00:00.000Z'
      }
    ]
  };

  /* 演示封面：用 canvas 现画一张 1280x720，返回 dataURL（无需外部图片资源） */
  function demoThumbDataUrl(ctx) {
    try {
      var c = document.createElement('canvas');
      c.width = 1280; c.height = 720;
      var g = c.getContext('2d');
      var grd = g.createLinearGradient(0, 0, 1280, 720);
      grd.addColorStop(0, '#0f172a');
      grd.addColorStop(0.55, '#4c1d95');
      grd.addColorStop(1, '#be185d');
      g.fillStyle = grd;
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = 'rgba(255,255,255,.10)';
      g.beginPath(); g.arc(1050, 150, 260, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 58px "PingFang SC", "Microsoft YaHei", sans-serif';
      g.fillText('AI 生成封面 · 演示', 90, 300);
      g.font = '400 40px "PingFang SC", "Microsoft YaHei", sans-serif';
      var line = (ctx && (ctx['合集组名称'] || ctx['频道名称'])) || '演示频道';
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillText(String(line).slice(0, 16), 90, 380);
      g.font = '400 28px "PingFang SC", "Microsoft YaHei", sans-serif';
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillText((ctx && ctx['译文标题'] || '').slice(0, 30), 90, 600);
      return c.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  function jsonRes(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function pathOf(url) {
    var i = url.indexOf('?');
    return i >= 0 ? url.slice(0, i) : url;
  }

  /* ---------- fetch 拦截 ---------- */
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!realFetch || url.indexOf('/api/') !== 0) return realFetch(input, init);
    var path = pathOf(url);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (path === '/api/admin/status') {
      return Promise.resolve(jsonRes({ loggedIn: true, username: 'demo' }));
    }
    if (path === '/api/admin/login') {
      return Promise.resolve(jsonRes({ success: true, redirect: './index.html' }));
    }
    if (path === '/api/auth/status') {
      return Promise.resolve(jsonRes({
        authenticated: true,
        channel: { id: DEMO_CHANNELS[0].id, title: DEMO_CHANNELS[0].title, thumbnail: '', meta: DEMO_CHANNELS[0].meta },
        channels: DEMO_CHANNELS,
        activeChannelId: DEMO_CHANNELS[0].id
      }));
    }
    if (path === '/api/channels') {
      return Promise.resolve(jsonRes({ channels: DEMO_CHANNELS, activeChannelId: DEMO_CHANNELS[0].id }));
    }
    if (path === '/api/channels/switch') {
      return Promise.resolve(jsonRes({ success: true }));
    }
    if (path.indexOf('/api/channels/') === 0) {
      var id = path.slice('/api/channels/'.length);
      var ch = DEMO_CHANNELS.find(function (c) { return c.id === id; });
      if (method === 'PUT' && ch) {
        var body = {};
        try { body = JSON.parse((init && init.body) || '{}'); } catch (e) { /* noop */ }
        Object.keys(body).forEach(function (k) { if (k !== 'channelId') ch.meta[k] = body[k]; });
        return Promise.resolve(jsonRes({ success: true, channel: ch }));
      }
      return Promise.resolve(jsonRes({ error: '演示环境未包含该频道' }, 404));
    }
    if (path === '/api/admin/login') {
      return Promise.resolve(jsonRes({ success: true }));
    }
    if (path === '/api/yt-videos/by-ids') {
      var ids = [];
      try { ids = (JSON.parse((init && init.body) || '{}').ids) || []; } catch (e) { /* noop */ }
      return Promise.resolve(jsonRes({
        items: ids.map(function (vid, i) {
          var ch = DEMO_CHANNELS[i % DEMO_CHANNELS.length];
          return {
            videoId: vid,
            channelTitle: ch.title,
            channelId: ch.id,
            title: 'Demo Video ' + String(vid).slice(-6).toUpperCase() + ' - Episode',
            description: '演示版自动生成的视频简介，仅用于界面展示。',
            thumbnailUrl: ''
          };
        })
      }));
    }
    if (path === '/api/dictionaries') return Promise.resolve(jsonRes(DEMO_DICTIONARIES));
    if (path === '/api/description-templates') {
      return Promise.resolve(jsonRes({ default: '', byChannel: {}, updatedAt: '2026-10-15T09:09:59.774Z' }));
    }
    if (path === '/api/instructions') {
      return Promise.resolve(jsonRes({
        instructions: DEMO_INSTRUCTIONS,
        macros: DEMO_MACROS,
        models: DEMO_MODELS,
        globalModel: DEMO_MODELS[0].value
      }));
    }
    if (path === '/api/instructions/preview' || path === '/api/instructions/run') {
      var reqBody = {};
      try { reqBody = JSON.parse((init && init.body) || '{}'); } catch (e) { /* noop */ }
      var ctx = reqBody.ctx || {};
      var tab = reqBody.tab || 'title';
      // 演示：不做真实 LLM 调用，用宏参拼出「像模像样」的生成结果，方便体验 AI生成 按钮
      if (tab === 'thumbnail') {
        return Promise.resolve(jsonRes({
          success: true,
          imageUrl: demoThumbDataUrl(ctx),
          model: 'demo-image',
          templateName: '封面生成指令（演示）'
        }));
      }
      var generated;
      if (tab === 'title') {
        generated = (ctx['合集组名称'] ? '【' + ctx['合集组名称'] + '】' : '') +
          '第 01 集｜' + ((ctx['译文标题'] || '精彩短剧').slice(0, 22)) +
          '，反转来得太突然';
      } else {
        generated = '【' + (ctx['频道名称'] || '演示频道') + '】' +
          ((ctx['合集组名称'] || '演示合集')) + '\n\n' +
          (ctx['合集简介'] || '本合集为演示数据。') + '\n\n' +
          '本集看点：' + ((ctx['译文标题'] || '剧情高能反转').slice(0, 40)) + '。\n' +
          '语言：' + (ctx['内容语言'] || '中文（简体）') + '\n\n' +
          '#短剧 #反转 #高能 #追剧 #演示数据';
      }
      return Promise.resolve(jsonRes({
        success: true,
        generated: generated,
        rendered: String(generated),
        model: 'demo-model',
        templateName: (tab === 'title' ? '英语标题生成指令（演示）' : '简介生成指令（演示）'),
        missing: []
      }));
    }
    if (path === '/api/config') {
      return Promise.resolve(jsonRes({ configured: false, clientId: '', clientSecret: '', hasOAuth: false }));
    }
    if (path === '/api/ai/config') {
      return Promise.resolve(jsonRes({ configured: false, hasKey: false, apiKey: null }));
    }
    if (path === '/api/ai/test') {
      return Promise.resolve(jsonRes({ success: false, error: '演示环境未配置 AI Key' }));
    }
    if (path === '/api/network-test') {
      return Promise.resolve(jsonRes({ success: true, proxy: 'demo', latency: 42 }));
    }
    if (path === '/api/auth/url') {
      return Promise.resolve(jsonRes({ success: false, error: '演示环境未配置 Google OAuth，无法添加真实频道' }));
    }
    if (path === '/api/auth/logout' || path === '/api/admin/logout') {
      return Promise.resolve(jsonRes({ success: true }));
    }
    if (path === '/api/channel/description') {
      return Promise.resolve(jsonRes({ success: false, error: '演示环境未配置' }));
    }
    if (path === '/api/yt-videos' || path.indexOf('/api/video/status/') === 0) {
      return Promise.resolve(jsonRes({ status: 'completed', progress: 100, items: [] }));
    }
    if (path.indexOf('/api/video/') === 0) {
      return Promise.resolve(jsonRes({ status: 'completed', progress: 100 }));
    }
    if (path === '/api/self-media/init') {
      return Promise.resolve(jsonRes({
        success: true,
        target: 'demo-' + Date.now() + '-self-upload.mp4',
        file: 'self/demo-' + Date.now() + '-self-upload.mp4'
      }));
    }
    if (path.indexOf('/api/self-media/video') === 0) {
      return Promise.resolve(jsonRes({ success: true }));
    }
    /* 其余接口（上传 from-url、captions 等）统一返回成功 */
    return Promise.resolve(jsonRes({ success: true, demo: true, videoId: 'demo' + Date.now().toString(36) }));
  };

  /* ---------- XMLHttpRequest 拦截（仅上传类接口，模拟后台进度） ---------- */
  var RealXHR = window.XMLHttpRequest;
  var UPLOAD_PATTERNS = ['/api/self-media/video', '/api/upload', '/api/thumbnails', '/api/captions'];

  function DemoXHR() {
    this.upload = {};
    this._listeners = {};
    this.status = 0;
    this.responseText = '';
  }
  DemoXHR.prototype.open = function (method, url) {
    this._method = method;
    this._url = String(url || '');
  };
  DemoXHR.prototype.setRequestHeader = function () { /* 演示环境忽略 */ };
  DemoXHR.prototype.getAllResponseHeaders = function () { return 'content-type: application/json'; };
  DemoXHR.prototype.addEventListener = function (type, fn) {
    if (type === 'load') this.onload = fn;
    else if (type === 'abort') this.onabort = fn;
    else if (type === 'error') this.onerror = fn;
    else this._listeners[type] = fn;
  };
  DemoXHR.prototype.abort = function () {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this.onabort) this.onabort({ type: 'abort' });
  };
  DemoXHR.prototype.send = function () {
    var self = this;
    var total = 180 * 1024 * 1024; // 模拟 180MB
    var pct = 0;
    this._timer = setInterval(function () {
      pct += 4 + Math.random() * 9;
      if (pct >= 100) {
        pct = 100;
        clearInterval(self._timer);
        self._timer = null;
      }
      if (self.upload && self.upload.onprogress) {
        self.upload.onprogress({ lengthComputable: true, loaded: total * pct / 100, total: total });
      }
      if (pct >= 100 && !self._done) {
        self._done = true;
        self.status = 200;
        if (self._url.indexOf('/api/self-media/video') === 0) {
          self.responseText = JSON.stringify({
            success: true,
            file: 'self/demo-finished.mp4',
            url: '/uploads/self/demo-finished.mp4',
            fileName: 'demo-finished.mp4',
            size: total
          });
        } else {
          self.responseText = JSON.stringify({ success: true, demo: true });
        }
        if (self.onload) setTimeout(self.onload, 400);
      }
    }, 300);
  };
  DemoXHR.prototype.realSend = RealXHR.prototype.send;

  window.XMLHttpRequest = function () {
    var real = new RealXHR();
    var wrapper = this;
    this._real = real;
    this.upload = real.upload;
    this._listeners = {};
    // 上传类接口走模拟；其余走真实 XHR（静态页上一般也不会发出去）
    return wrapper;
  };
  /* 简化：直接整体替换为 DemoXHR（演示页不会发出非上传 XHR） */
  window.XMLHttpRequest = DemoXHR;

  /* ---------- 演示标识角标 ---------- */
  function seedSelfCollections() {
    try {
      if (localStorage.getItem('yt_self_collections')) return;
      var now = '2026-10-18 10:00:00';
      localStorage.setItem('yt_self_collections', JSON.stringify([
        { id: 'SCdemo01', name: '演示 · 都市甜宠合集', linkedCollection: '产品评测', intro: '演示用自建合集：现代都市甜宠短剧。', operator: 'demo', createdAt: now, episodes: [
          { language: '中文', fileName: '甜宠来袭 EP01.mp4', localFile: 'self/demo-ep01.mp4', type: '自建内容', outputType: '视频', template: '—', progress: '成功', createdAt: now },
          { language: '英语', fileName: 'Sweet Love EP01 EN.mp4', localFile: 'self/demo-ep01-en.mp4', type: '自建内容', outputType: '视频', template: '—', progress: '成功', createdAt: now },
          { language: '西班牙语', fileName: 'Amor Dulce EP01 ES.mp4', localFile: 'self/demo-ep01-es.mp4', type: '自建内容', outputType: '视频', template: '—', progress: '成功', createdAt: now }
        ]},
        { id: 'SCdemo02', name: '演示 · 玄幻逆袭合集', linkedCollection: '教程系列', intro: '演示用自建合集：玄幻逆袭题材。', operator: 'demo', createdAt: now, episodes: [
          { language: '中文', fileName: '战神归来 EP01.mp4', localFile: 'self/demo-ep02.mp4', type: '自建内容', outputType: '视频', template: '—', progress: '成功', createdAt: now },
          { language: '印尼语', fileName: 'Kembali EP01 ID.mp4', localFile: 'self/demo-ep02-id.mp4', type: '自建内容', outputType: '视频', template: '—', progress: '成功', createdAt: now }
        ]},
        { id: 'SCdemo03', name: '演示 · 空合集（试试新增）', linkedCollection: '开箱体验', intro: '这是一个空的演示合集，可以点「上传视频」体验后台上传进度。', operator: 'demo', createdAt: now, episodes: [] }
      ]));
    } catch (e) { /* localStorage 不可用时忽略 */ }
  }

  function addRibbon() {
    if (document.getElementById('demoRibbon')) return;
    var el = document.createElement('div');
    el.id = 'demoRibbon';
    el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;background:#7c3aed;color:#fff;' +
      'padding:7px 14px;border-radius:999px;font-size:12px;letter-spacing:1px;box-shadow:0 4px 14px rgba(0,0,0,.25);' +
      'opacity:.92;pointer-events:none';
    el.textContent = '演示版 · 数据为模拟数据';
    (document.body || document.documentElement).appendChild(el);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { seedSelfCollections(); addRibbon(); });
  } else {
    seedSelfCollections();
    addRibbon();
  }
})();
