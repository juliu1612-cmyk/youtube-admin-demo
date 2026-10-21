/* ─── YouTube Creator Studio ────────────────── */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

// 应用状态
const state = {
  authenticated: false,
  channel: null,
  channels: [],
  activeChannelId: null,
  adminUsername: null,    // 当前后台登录账号
  sourceFilterCollection: '',  // 视频来源筛选:关联合集组(合集 name)
  sourceFilterLanguage: '',    // 视频来源筛选:语言
  sourceFilterType: '',        // 视频来源筛选:类型
  sourceEpisodeSearch: '',     // 视频来源 combobox 搜索关键字
  videoUrl: '',
  tags: [],
  localizations: [],
  uploading: false,
  currentStep: 1,
  captions: [], // { id, file, language, name }
  captionIdCounter: 0,
  thumbnailFile: null,
  collections: [], // 合集组列表
  // 步骤 2 上传结果
  step2Uploaded: false,   // 第 2 步是否已上传
  step2VideoId: null,     // 第 2 步上传返回的 videoId
  step2VideoUrl: null,    // 第 2 步上传返回的 YouTube URL
  step2UploadPromise: null // 上传 Promise，供 handleSubmit 等待
};

// 右下角上传进度 toast 状态
let uploadToastItems = [];          // { id, name, status, percent, finished }
let uploadToastProgressTimer = null;  // 模拟进度定时器
let uploadAbortController = null;     // 当前上传的 AbortController
// 自建内容「后台上传」在跑的任务：toastId -> { xhr }，用于逐条取消
const _selfUploads = new Map();

// ─── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 先检查后台登录状态
  await checkAdminAuth();

  bindNavigation();
  populateSourceFilterOptions();
  populateSourceEpisodeOptions();
  bindSourceCombobox();
  bindStepNavigation();
  bindPrivacySelect();
  bindSchedulePrivacy();
  bindChannelDesc();
  bindAiTitle();
  bindToggles();
  bindFormValidation();
  bindSubmit();
  bindCaptions();
  bindThumbnail();
  bindProcessingClose();
  bindUploadToast();
  bindSettings();
  bindChannelsPage();
  bindLogout();
  initTranslationPage();
  initPublishTasksPage();
  loadSettings();
  await checkAuth();
  populateCollectionOptions();

  // 处理 OAuth 回调参数
  handleOAuthCallback();

  // 进场兜底：清掉任何意外残留的全屏遮罩（历史状态/上次会话遗留），避免"页面被盖住"。
  forceCloseStuckMasks();
}

// ─── OAuth 回调处理 ──────────────────────────
function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const msg = params.get('msg');

  if (auth === 'success') {
    showToast('Google 账号授权成功！', 'success');
    // 清除 URL 参数
    window.history.replaceState({}, '', '/');
  } else if (auth === 'error') {
    const errMsg = msg ? decodeURIComponent(msg) : '授权失败，请重试';
    showToast('授权失败: ' + errMsg, 'error');
    window.history.replaceState({}, '', '/');
  }
}

// ─── Admin Auth Check ────────────────────────
async function checkAdminAuth() {
  try {
    const res = await fetch('/api/admin/status');
    const data = await res.json();
    if (!data.loggedIn) {
      window.location.href = './login.html';
      return;
    }
    // 后台已登录，左下角显示管理员账号信息（与 YouTube 频道授权无关）
    state.adminUsername = data.username || '管理员';
    $('#adminName').textContent = state.adminUsername;
    $('#adminStatus').textContent = '后台账号 · 已登录';
  } catch {
    window.location.href = './login.html';
  }
}

// ─── Navigation ──────────────────────────────
function bindNavigation() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      $$('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      $$('.page').forEach(p => p.classList.remove('active'));
      $(`#page-${page}`).classList.add('active');
    });
  });
}

// ─── Auth ────────────────────────────────────
function bindLogout() {
  const btn = $('#btnLogout');
  if (btn) btn.addEventListener('click', logout);
}

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    updateAuthState(data);
  } catch {
    updateAuthState({ authenticated: false });
  }
}

function updateAuthState(data) {
  state.authenticated = data.authenticated;
  state.channel = data.channel;
  state.channels = data.channels || [];
  state.activeChannelId = data.activeChannelId || null;

  populateChannelSelect();
  renderChannelsPage();
}

function populateChannelSelect() {
  const sel = $('#targetChannel');
  if (!sel) return;
  const channels = state.channels || [];
  if (channels.length === 0) {
    sel.innerHTML = '<option value="">暂无已授权频道，请前往「社媒账号采集表」授权</option>';
    return;
  }
  sel.innerHTML = '<option value="">选择频道</option>';
  channels.forEach(c => {
    sel.innerHTML += `<option value="${c.id}" ${c.id === state.activeChannelId ? 'selected' : ''}>${c.title}</option>`;
  });
  if (channels.length === 1 && state.activeChannelId) {
    sel.value = state.activeChannelId;
  }
  // Update step 1 next button state (enable when channel is pre-selected)
  updateStep1NextButton();
}

function updateStep1NextButton() {
  const btn = $('#btnNextStep1');
  if (!btn) return;
  const hasSource = !!$('#sourceEpisode').value;
  const hasChannel = !!$('#targetChannel').value;
  btn.disabled = !(hasSource && hasChannel);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = './login.html';
}

// ─── 右下角上传进度悬浮面板 ──────────────────────
const UPLOAD_TOAST_STATUS = {
  uploading:  { text: '上传中', cls: 'uploading' },
  processing: { text: '处理中', cls: 'completed' },
  completed:  { text: '已完成', cls: 'completed' },
  failed:     { text: '上传失败', cls: 'failed' },
  cancelled:  { text: '已取消上传', cls: 'cancelled' }
};

// 用户是否主动关掉了「上传进度」面板（后台上传还在跑时避免被进度事件反复弹回）
let _uploadToastDismissed = false;

function bindUploadToast() {
  const toast = $('#uploadToast');
  const toggle = $('#uploadToastToggle');
  const close = $('#uploadToastClose');
  if (!toast || !toggle || !close) return;
  toggle.addEventListener('click', () => {
    toast.classList.toggle('collapsed');
    toggle.textContent = toast.classList.contains('collapsed') ? '▼' : '▲';
  });
  close.addEventListener('click', () => {
    toast.style.display = 'none';
    // 标记「用户主动收起」：后台上传还在跑时进度事件会不断触发重渲染，
    // 不记住这个状态的话面板会被反复弹回来，等于关不掉。
    _uploadToastDismissed = true;
    // 还有任务在后台跑 → 留一个重新打开的入口，否则进度就再也看不到了
    updateUploadReopenBtn();
  });
  const reopen = $('#uploadToastReopen');
  if (reopen) reopen.addEventListener('click', showUploadToast);
}

// 面板关闭后，用右下角的小胶囊把它叫回来；只统计「还没结束」的任务
function updateUploadReopenBtn() {
  const btn = $('#uploadToastReopen');
  const countEl = $('#uploadToastReopenCount');
  if (!btn) return;
  const running = uploadToastItems.filter(i => !i.finished).length;
  const toast = $('#uploadToast');
  const panelVisible = toast && getComputedStyle(toast).display !== 'none';
  const show = !panelVisible && running > 0;
  btn.style.display = show ? 'inline-flex' : 'none';
  if (countEl) countEl.textContent = String(running);
}

function showUploadToast() {
  const toast = $('#uploadToast');
  _uploadToastDismissed = false;
  if (toast) toast.style.display = 'flex';
  updateUploadReopenBtn();
}

function getUploadFileName() {
  // 优先使用当前选中的剧集名
  const sel = $('#sourceEpisode');
  if (sel && sel.value) {
    const opt = sel.querySelector(`option[value="${sel.value}"]`);
    if (opt) return opt.textContent.trim();
  }
  // 否则从 URL 取 basename
  if (state.videoUrl) {
    const url = state.videoUrl.split('?')[0];
    const name = url.substring(url.lastIndexOf('/') + 1);
    if (name) return decodeURIComponent(name);
  }
  return '未命名视频';
}

function renderUploadToastItems() {
  const list = $('#uploadToastList');
  const toast = $('#uploadToast');
  if (!list) return;
  if (uploadToastItems.length === 0) {
    list.innerHTML = '<li class="upload-toast-empty">暂无上传任务</li>';
    updateUploadReopenBtn();
    return;
  }
  list.innerHTML = uploadToastItems.map(item => {
    const st = UPLOAD_TOAST_STATUS[item.status] || UPLOAD_TOAST_STATUS.uploading;
    const progressBar = item.percent === null
      ? '<div class="upload-toast-progress"><div class="upload-toast-progress-fill indeterminate"></div></div>'
      : `<div class="upload-toast-progress"><div class="upload-toast-progress-fill" style="width:${item.percent}%"></div></div>`;
    const cancelBtn = !item.finished
      ? `<button class="upload-toast-cancel" data-cancel-id="${item.id}" type="button">取消</button>`
      : '';
    return `
      <li class="upload-toast-item" data-toast-id="${item.id}">
        <div class="upload-toast-icon">🎬</div>
        <div class="upload-toast-info">
          <div class="upload-toast-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="upload-toast-status">
            <span class="upload-toast-status-text ${st.cls}">${st.text}${item.percent !== null ? ` ${item.percent}%` : ''}</span>
            ${cancelBtn}
          </div>
          ${progressBar}
        </div>
      </li>
    `;
  }).join('');

  // 绑定取消按钮
  $$('.upload-toast-cancel', list).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cancelId;
      cancelUploadTask(id);
    });
  });

  if (toast && !_uploadToastDismissed) toast.style.display = 'flex';
  updateUploadReopenBtn();
}

function createUploadToastItem(name) {
  const id = 'upl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  uploadToastItems.push({ id, name, status: 'uploading', percent: 0, finished: false });
  // 新任务来了就取消「已关闭」标记，重新把面板弹出来（用户刚点的上传，理应看到进度）
  _uploadToastDismissed = false;
  renderUploadToastItems();
  return id;
}

function updateUploadToastItem(id, status, percent) {
  const item = uploadToastItems.find(i => i.id === id);
  if (!item) return;
  const before = `${item.status}|${item.percent}|${item.finished}`;
  item.status = status;
  if (percent !== undefined) item.percent = percent;
  if (['completed', 'failed', 'cancelled'].includes(status)) item.finished = true;
  // 大文件上传的 progress 事件很密集（每秒好几次），状态没变就不要整个重渲染
  if (`${item.status}|${item.percent}|${item.finished}` === before) return;
  renderUploadToastItems();
}

function removeUploadToastItem(id) {
  uploadToastItems = uploadToastItems.filter(i => i.id !== id);
  renderUploadToastItems();
}

function startUploadToastProgress(id) {
  // 模拟进度：0% → 90%，每 200ms +3%，完成/失败后停止
  if (uploadToastProgressTimer) clearInterval(uploadToastProgressTimer);
  uploadToastProgressTimer = setInterval(() => {
    const item = uploadToastItems.find(i => i.id === id);
    if (!item || item.finished) {
      clearInterval(uploadToastProgressTimer);
      uploadToastProgressTimer = null;
      return;
    }
    if (item.percent < 90) {
      item.percent = Math.min(90, item.percent + 3);
      renderUploadToastItems();
    }
  }, 200);
}

function stopUploadToastProgress() {
  if (uploadToastProgressTimer) {
    clearInterval(uploadToastProgressTimer);
    uploadToastProgressTimer = null;
  }
}

function cancelUploadTask(id) {
  const item = uploadToastItems.find(i => i.id === id);
  if (!item || item.finished) return;
  // 自建内容的后台上传：每个任务自己持有一个 XHR，按 id 精确中止
  const selfUp = _selfUploads.get(id);
  if (selfUp) {
    _selfUploads.delete(id);
    try { selfUp.xhr.abort(); } catch (e) { /* noop */ }
    // 服务端那半截文件由 submitSelfVideo 的 catch 统一清理（那里才知道有没有传完）
    item.status = 'cancelled';
    item.percent = null;
    item.finished = true;
    renderUploadToastItems();
    showToast('上传已取消', 'info');
    return;
  }
  if (uploadAbortController) {
    uploadAbortController.abort();
    uploadAbortController = null;
  }
  stopUploadToastProgress();
  item.status = 'cancelled';
  item.percent = null;
  item.finished = true;
  state.uploading = false;
  state.step2Uploaded = false;
  renderUploadToastItems();
  showToast('上传已取消', 'info');
}

// ─── 步骤 2→3：自动上传到 YouTube ──────────
let step2UploadXhr = null; // 用于追踪当前上传的 XHR 对象(保留兼容)

async function startStep2Upload() {
  if (state.uploading) return;
  state.uploading = true;
  state.step2Uploaded = false;

  const fileName = getUploadFileName();
  const toastId = createUploadToastItem(fileName);
  showUploadToast();
  startUploadToastProgress(toastId);
  showBottomUploadPanel('正在上传视频到 YouTube...');

  // 存储上传 Promise，供 handleSubmit 在未完成时等待
  state.step2UploadPromise = (async () => {
    try {
      uploadAbortController = new AbortController();
      const res = await fetch('/api/upload/quick-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.videoUrl }),
        signal: uploadAbortController.signal
      });
      uploadAbortController = null;
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData.error || `上传失败 (${res.status})`) + (errData.detail ? `（${errData.detail}）` : ''));
      }
      const data = await res.json();
      if (data.success) {
        stopUploadToastProgress();
        updateUploadToastItem(toastId, 'completed', 100);
        showBottomUploadDone(data.videoId, data.url);
      } else {
        throw new Error(data.error || '上传失败');
      }
    } catch (err) {
      uploadAbortController = null;
      stopUploadToastProgress();
      state.uploading = false;
      state.step2Uploaded = false;
      if (err.name === 'AbortError' || (err.message && err.message.includes('已取消'))) {
        updateUploadToastItem(toastId, 'cancelled', null);
      } else {
        updateUploadToastItem(toastId, 'failed', null);
      }
      // 底部面板显示错误（仅在未取消时）
      if (err.name !== 'AbortError') {
        $('#processingStatusIcon').textContent = '❌';
        $('#processingStatusTitle').textContent = '上传失败';
        $('#processingPercentBadge').textContent = '';
        $('#progressBarFill').style.width = '100%';
        $('#progressBarFill').className = 'progress-bar-fill error';
        showToast('上传失败: ' + err.message, 'error');
      }
      throw err; // re-throw 让 handleSubmit 感知上传失败
    }
  })(); // end of step2UploadPromise IIFE
}

function showBottomUploadPanel(msg) {
  const panel = $('#processingPanel');
  panel.style.display = 'block';
  document.body.classList.add('has-processing-panel');
  $('#processingStatusIcon').textContent = '📤';
  $('#processingStatusTitle').textContent = msg;
  $('#processingPercentBadge').textContent = '0%';
  $('#progressBarFill').style.width = '0%';
  $('#progressBarFill').className = 'progress-bar-fill';
  $('#processingIssues').innerHTML = '';
  $('#processingPanelDetail').style.display = 'none';
  $('#processingVideoLink').style.display = 'none';
  $('#processingCopyBtn').style.display = 'none';
}

function updateBottomUploadProgress(pct, label) {
  const badge = label || (pct + '%');
  $('#processingPercentBadge').textContent = badge;
  $('#progressBarFill').style.width = pct + '%';
  if (pct >= 100) {
    $('#processingStatusTitle').textContent = '上传完成，等待 YouTube 处理...';
    $('#progressBarFill').className = 'progress-bar-fill success';
  }
}

function showBottomUploadDone(videoId, url) {
  state.step2Uploaded = true;
  state.step2VideoId = videoId;
  state.step2VideoUrl = url;
  state.uploading = false;
  $('#processingStatusIcon').textContent = '⏳';
  $('#processingStatusTitle').textContent = '视频处理检查中...';
  $('#processingPercentBadge').textContent = '0%';
  $('#progressBarFill').style.width = '0%';
  $('#progressBarFill').className = 'progress-bar-fill';
  $('#processingVideoLink').href = url;
  $('#processingVideoLink').style.display = 'inline-flex';
  $('#processingCopyBtn').style.display = 'flex';
  // 开始轮询 YouTube 处理状态
  pollProcessingStatus(videoId, url);
  // 刷新预览页（如果当前在步骤 4）
  if (state.currentStep === 4) buildReview();
}

function closeBottomPanel() {
  $('#processingPanel').style.display = 'none';
  document.body.classList.remove('has-processing-panel');
  if (processingPollTimer) {
    clearTimeout(processingPollTimer);
    processingPollTimer = null;
  }
}

function formatSize(bytes) {
  if (!bytes) return '—';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes)/Math.log(1024));
  return (bytes/Math.pow(1024,i)).toFixed(i===0?0:1)+' '+u[i];
}

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '—';
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ─── Step Navigation ─────────────────────────
function bindStepNavigation() {
  // Step 1 → 2: 选好视频 + 频道后点下一步触发上传，并跳到填写信息（上传在后台进行）
  $('#btnNextStep1').addEventListener('click', async () => {
    // 校验视频来源(必须是已选剧集)
    const sel = $('#sourceEpisode');
    if (!sel || !sel.value) {
      showToast('请先选择要发布的剧集', 'error');
      return;
    }
    // 从 value ("<collectionId>-<episodeIdx>") 反查剧集对象,设置 videoUrl
    const [colId, epIdxStr] = sel.value.split('-');
    const idx = parseInt(epIdxStr, 10);
    const collections = getTranslationCollections();
    const col = collections.find(c => c.id === colId);
    const ep = col && col.episodes ? col.episodes[idx] : null;
    if (!ep) {
      showToast('所选剧集数据已失效，请重新选择', 'error');
      return;
    }
    state.videoUrl = getEpisodeVideoUrl(ep, idx);
    state.step2Uploaded = false;
    state.step2UploadPromise = null;
    state.step2VideoId = null;
    state.step2VideoUrl = null;

    // 校验频道
    const channel = $('#targetChannel').value;
    if (!channel) {
      showToast('请先选择发布频道', 'error');
      return;
    }
    // 同步频道选择到服务端
    try {
      const swRes = await fetch('/api/channels/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel })
      });
      if (swRes.ok) state.activeChannelId = channel;
    } catch (e) {
      console.warn('频道同步失败:', e);
    }
    // 开始上传到 YouTube（后台进行）
    startStep2Upload();
    // 立即跳转到步骤 2，用户可同时填写视频信息
    goToStep(2);
  });
  // Step 2 → 3: metadata → preview
  $('#btnNextStep2').addEventListener('click', () => {
    if (validateMetadata()) {
      goToStep(3);
    }
  });
  // Back buttons
  $('#btnPrevStep2').addEventListener('click', () => goToStep(1));
  $('#btnPrevStep3').addEventListener('click', () => goToStep(2));

  // Enable/disable btnNextStep1 based on source / channel selection
  $('#sourceEpisode').addEventListener('change', () => {
    updateStep1NextButton();
  });
  $('#targetChannel').addEventListener('change', () => {
    updateStep1NextButton();
  });

  // 视频来源 3 个筛选下拉联动
  $('#filterSourceCollection').addEventListener('change', (e) => {
    state.sourceFilterCollection = e.target.value;
    // 清掉已选剧集(避免选中项在新筛选下不存在)
    $('#sourceEpisode').value = '';
    populateSourceEpisodeOptions();
    updateStep1NextButton();
  });
  $('#filterSourceLanguage').addEventListener('change', (e) => {
    state.sourceFilterLanguage = e.target.value;
    $('#sourceEpisode').value = '';
    populateSourceEpisodeOptions();
    updateStep1NextButton();
  });
  $('#filterSourceType').addEventListener('change', (e) => {
    state.sourceFilterType = e.target.value;
    $('#sourceEpisode').value = '';
    populateSourceEpisodeOptions();
    updateStep1NextButton();
  });
}

function goToStep(n) {
  state.currentStep = n;

  // Update panels
  [1,2,3].forEach(i => {
    const panel = $(`#stepPanel${i}`);
    if (panel) panel.classList.toggle('active', i === n);
  });

  // Update step indicators
  $$('.step').forEach((step, i) => {
    step.classList.remove('active','completed');
    if (i+1 < n) step.classList.add('completed');
    if (i+1 === n) step.classList.add('active');
  });
  $$('.step-line').forEach((line, i) => {
    line.classList.toggle('completed', i+1 < n);
  });

  // Build review if step 3
  if (n === 3) {
    buildReview();
  }

  // 进入第 2 步：优先用该频道设置的「视频简介模版」填充视频描述，没设置才退回频道「关于」简介
  if (n === 2) {
    autoFillStep2Description();
  }

  // Scroll top
  $('#stepPanel1').closest('.step-panel')?.scrollIntoView({ behavior:'smooth' });

  // Update step dots with check marks for completed
  $$('.step.completed .step-dot').forEach(dot => {
    dot.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  });
  // Reset active step dot
  const activeDot = $('.step.active .step-dot');
  if (activeDot) activeDot.textContent = n;
}

function validateMetadata() {
  const title = $('#title').value.trim();
  if (!title) {
    showToast('请输入视频标题', 'error');
    $('#title').focus();
    return false;
  }
  if (title.length > 100) {
    showToast('标题不能超过100字符', 'error');
    return false;
  }
  return true;
}

// ─── Privacy Radio ───────────────────────────
function getActivePrivacy() {
  return $('#privacyGroup .radio-card.active')?.dataset?.value || 'private';
}

function setPrivacyCard(value) {
  const cards = [...$$('#privacyGroup .radio-card')];
  const target = cards.find(c => c.dataset.value === value);
  if (!target) return false;
  cards.forEach(c => c.classList.remove('active'));
  target.classList.add('active');
  return true;
}

function bindPrivacySelect() {
  $$('#privacyGroup .radio-card').forEach(card => {
    card.addEventListener('click', () => {
      setPrivacyCard(card.dataset.value);
      // 定时发布只在私享下有效：切到公开/不公开时清空已填的定时时间，避免提交被 YouTube 拒绝
      const pubAtEl = $('#publishAt');
      if (card.dataset.value !== 'private' && pubAtEl && pubAtEl.value) {
        pubAtEl.value = '';
        showToast('「公开 / 不公开」不支持定时发布，已清空定时时间；如需定时请保持「私享」', 'warning');
      }
    });
  });
}

// 定时发布 ↔ 私享 联动：填了发布时间就自动锁定为私享（与 YouTube Studio 行为一致）
function bindSchedulePrivacy() {
  const pubAtEl = $('#publishAt');
  if (!pubAtEl) return;

  // 日期选择器不允许选过去的时间
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  pubAtEl.min = now.toISOString().slice(0, 16);

  const sync = () => {
    if (!pubAtEl.value) return;
    if (getActivePrivacy() !== 'private') {
      setPrivacyCard('private');
      showToast('定时发布仅支持「私享」视频，已自动切换为「私享」', 'info');
    }
  };
  pubAtEl.addEventListener('change', sync);
  pubAtEl.addEventListener('input', sync);
}

// ─── Collapsible Sections ────────────────────
function bindToggles() {
  $$('.toggle-section').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.collapsible').classList.toggle('collapsed');
    });
  });
}

// ─── Form Validation ─────────────────────────
function bindFormValidation() {
  $('#title').addEventListener('input', () => {
    $('#titleCount').textContent = `${$('#title').value.length}/100`;
  });
  $('#description').addEventListener('input', () => {
    $('#descCount').textContent = `${$('#description').value.length}/5000`;
  });
}

// ─── 频道「关于」简介自动填充视频描述 ────────────
// 记录上次自动填充的来源，用于判断用户是否改动过、是否需要随频道切换重新填充
let channelDescState = { channelId: null, text: '' };
// 上次由「视频简介模版」自动填入的内容（用于判断用户是否手改过）
let _mainAutoDesc = '';
// 请求序号：接口约 1.8s 才返回，用它丢弃过期响应，防止慢响应覆盖用户新输入
let channelDescToken = 0;
const DESC_HINT_DEFAULT = '进入第 2 步时会自动填入当前发布频道的「关于」简介，可随意修改';
const DESC_HINT_TPL = '已套用该频道在「社媒账号采集表」里设置的「视频简介模版」，可随意修改';

function setDescriptionValue(text) {
  const el = $('#description');
  if (!el) return '';
  el.value = String(text || '').slice(0, 5000);
  const counter = $('#descCount');
  if (counter) counter.textContent = `${el.value.length}/5000`;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
}

function setDescHint(text) {
  const hint = $('#descAutoHint');
  if (hint) hint.textContent = text || DESC_HINT_DEFAULT;
}

async function fillChannelDescription({ silent = false, force = false } = {}) {
  const el = $('#description');
  if (!el) return false;
  // 非强制且用户已手动填写 → 不覆盖
  if (!force && el.value.trim()) return false;

  const token = ++channelDescToken;
  const btn = $('#btnUseChannelDesc');
  try {
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    setDescHint('正在获取频道简介…');
    const res = await fetch('/api/channel/description' + (force ? '?refresh=1' : ''));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // 已有更新的请求发出 → 本次结果作废
    if (token !== channelDescToken) return false;
    // 等待期间用户已自己输入 → 不覆盖
    if (!force && el.value.trim()) return false;

    const text = (data.description || '').slice(0, 5000);
    if (!text) {
      setDescHint(DESC_HINT_DEFAULT);
      if (!silent) showToast('该频道的「关于」简介为空，未填充', 'warning');
      return false;
    }
    const filled = setDescriptionValue(text);
    channelDescState = {
      channelId: data.channelId || state.activeChannelId || null,
      text: filled
    };
    setDescHint(DESC_HINT_DEFAULT);
    if (!silent) {
      const name = data.channelTitle || '当前频道';
      showToast(`已填入「${name}」的频道简介（${filled.length} 字）`, 'success');
    }
    return true;
  } catch (e) {
    if (token === channelDescToken) setDescHint(DESC_HINT_DEFAULT);
    if (!silent) showToast('获取频道简介失败：' + e.message, 'error');
    return false;
  } finally {
    if (btn && token === channelDescToken) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

// 进入第 2 步时调用：仅在「描述为空」或「内容仍是上次自动填充的简介但频道已切换」时填充
function autoFillChannelDescription() {
  const el = $('#description');
  if (!el) return;
  const activeId = state.activeChannelId || $('#targetChannel')?.value || null;
  const isUntouched = !el.value.trim() || el.value === channelDescState.text;
  if (!isUntouched) return;
  if (el.value.trim() && channelDescState.channelId && activeId && channelDescState.channelId === activeId) return;
  fillChannelDescription({ silent: true });
}

// 主上传弹窗的模版变量上下文（与快传弹窗 uytBuildDescCtx 口径一致）
function buildMainDescCtx(channelId) {
  const src = getSelectedSourceContext();
  const ch = (state.channels || []).find(c => c.id === channelId);
  const titleEl = $('#title');
  return {
    channelId: channelId || '',
    title: titleEl ? String(titleEl.value || '').trim() : '',
    channelTitle: ch ? (ch.title || (ch.meta && ch.meta.channelName) || '') : '',
    collectionGroup: (src && (src.linkedCollection || src.collectionName)) || '',
    language: (src && src.language) || '',
    type: (src && src.type) || ''
  };
}

// 进入第 2 步：优先套用频道上设置的「视频简介模版」；频道没设置才退回「频道关于简介」
function autoFillStep2Description() {
  const el = $('#description');
  if (!el) return;
  const activeId = state.activeChannelId || ($('#targetChannel') && $('#targetChannel').value) || '';
  // 用户已手改过 → 不动
  const untouched = !el.value.trim()
    || el.value === channelDescState.text
    || el.value === _mainAutoDesc;
  if (!untouched) return;

  const tpl = resolveDescTemplateFor(activeId);
  const rendered = renderDescTemplateClient(tpl, buildMainDescCtx(activeId));
  if (rendered && rendered.trim()) {
    _mainAutoDesc = setDescriptionValue(rendered);
    // 已用模版填充，清掉「频道简介」的来源标记，避免之后被它覆盖
    channelDescState = { channelId: null, text: '' };
    setDescHint(DESC_HINT_TPL);
    return;
  }
  setDescHint(DESC_HINT_DEFAULT);
  autoFillChannelDescription();
}

function bindChannelDesc() {
  const btn = $('#btnUseChannelDesc');
  if (btn) {
    btn.addEventListener('click', () => fillChannelDescription({ force: true }));
  }
  // 视频描述：按「指令库 → 简介指令」生成（原「模版说明」按钮已替换为 AI 生成）
  const genDescBtn = $('#btnAiGenDesc');
  if (genDescBtn) {
    genDescBtn.addEventListener('click', () => insGenAndFill({
      tab: 'description', scope: 'main', btnId: 'btnAiGenDesc', fill: insFillMainDesc
    }));
  }
}

// ─── 发布弹窗「AI生成」：统一按指令库模板生成标题/简介/封面 ──────────
const INS_TAB_CN = { title: '标题', description: '简介', thumbnail: '封面' };
const _insGenBusy = {}; // key = `${scope}:${tab}`

// 取当前弹窗的宏参上下文 + 目标频道 ID
// scope: 'main'（上传主表单） | 'uyt'（快传弹窗） | 'ytv'（YT视频列表编辑弹窗）
function insCollectCtx(scope) {
  const isUyt = scope === 'uyt';
  const isYtv = scope === 'ytv';
  // YT视频列表：行数据里已有频道名 / 频道ID / 关联合集组，标题简介取弹窗当前值
  if (isYtv) {
    const r = _ytvView[_ytvEditIdx] || {};
    const titleEl = $('#ytvEditTitleInput');
    const descEl = $('#ytvEditDescInput');
    return {
      ctx: {
        '合集组名称': r.linkedCollection || '',
        '合集简介': ytvCollectionIntro(r.linkedCollection),
        '内容语言': r.language || '',
        '频道名称': r.channelTitle || '',
        '译文标题': titleEl ? String(titleEl.value || '').trim() : '',
        '译文简介': descEl ? String(descEl.value || '').trim() : ''
      },
      channelId: r.channelId || ''
    };
  }
  const src = isUyt ? getUytSourceContext() : getSelectedSourceContext();
  let channelId = '';
  let channelTitle = '';
  if (isUyt) {
    const sel = $('#uytChannel');
    channelId = sel ? (sel.value || '') : '';
    const ch = (state.channels || []).find(c => c.id === channelId);
    channelTitle = ch ? (ch.title || '')
      : (sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.trim() : '');
  } else {
    channelId = state.activeChannelId || ($('#targetChannel') && $('#targetChannel').value) || '';
    const ch = (state.channels || []).find(c => c.id === channelId);
    channelTitle = ch ? (ch.title || '') : '';
  }
  const titleEl = isUyt ? $('#uytTitle') : $('#title');
  const descEl = isUyt ? $('#uytDesc') : $('#description');
  return {
    ctx: {
      '合集组名称': (src && src.collectionName) || '',
      '合集简介': (src && src.intro) || '',
      '内容语言': (src && src.language) || '',
      '频道名称': channelTitle || '',
      '译文标题': titleEl ? String(titleEl.value || '').trim() : '',
      '译文简介': descEl ? String(descEl.value || '').trim() : ''
    },
    channelId
  };
}

// 调后端按模板生成
async function insRunInstruction(tab, collected) {
  const res = await fetch('/api/instructions/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab, ctx: collected.ctx, channelId: collected.channelId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 通用「AI生成」按钮：cfg = { tab, scope, btnId, fill(data) }
async function insGenAndFill(cfg) {
  const key = `${cfg.scope}:${cfg.tab}`;
  if (_insGenBusy[key]) return;
  const btn = $('#' + cfg.btnId);
  const originText = btn ? btn.textContent : '';
  _insGenBusy[key] = true;
  if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = '生成中…'; }
  try {
    const data = await insRunInstruction(cfg.tab, insCollectCtx(cfg.scope));
    cfg.fill(data);
    const modelTip = data.model ? ` · ${data.model}` : '';
    const tplTip = data.templateName ? ` · 模板「${data.templateName}」` : '';
    showToast(`已生成${INS_TAB_CN[cfg.tab] || ''}${modelTip}${tplTip}`, 'success');
    if (Array.isArray(data.missing) && data.missing.length) {
      showToast(`宏参未取到值：${data.missing.join('、')}（已原样保留，请检查视频来源与频道）`, 'warning', 6000);
    }
  } catch (e) {
    showToast(e.message || '生成失败', 'error', 6000);
  } finally {
    _insGenBusy[key] = false;
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = originText || 'AI生成'; }
  }
}

// ─── 各字段的回填实现 ────────────────────────────
function insFillMainTitle(data) {
  const v = String(data.generated || '').slice(0, 100);
  const el = $('#title');
  if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  const c = $('#titleCount');
  if (c) c.textContent = `${v.length}/100`;
}

function insFillMainDesc(data) {
  if (typeof setDescriptionValue === 'function') setDescriptionValue(String(data.generated || ''));
  else {
    const el = $('#description');
    if (el) { el.value = String(data.generated || ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
}

function insFillMainThumb(data) {
  const url = String(data.imageUrl || '');
  if (!url) throw new Error('未返回图片数据');
  const blob = dataUrlToBlob(url);
  state.thumbnailFile = new File([blob], 'ai-thumbnail.png', { type: blob.type || 'image/png' });
  const uz = $('#thumbnailUploadZone');
  const pa = $('#thumbnailPreviewArea');
  const pi = $('#thumbnailPreview');
  const fn = $('#thumbnailFileName');
  if (uz) uz.style.display = 'none';
  if (pa) pa.style.display = 'flex';
  if (pi) pi.src = url;
  if (fn) fn.textContent = 'ai-thumbnail.png';
}

function insFillUytTitle(data) {
  const v = String(data.generated || '').slice(0, 100);
  const el = $('#uytTitle');
  if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  const c = $('#uytTitleCount');
  if (c) c.textContent = `${v.length}/100`;
}

function insFillUytDesc(data) {
  const v = String(data.generated || '');
  const el = $('#uytDesc');
  if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  const c = $('#uytDescCount');
  if (c) c.textContent = `${v.length}/5000`;
}

function insFillUytThumb(data) {
  const url = String(data.imageUrl || '');
  if (!url) throw new Error('未返回图片数据');
  _uytThumbDataUrl = url;
  _uytThumbUploadName = 'ai-thumbnail.png';
  const pi = $('#uytThumbPreviewImg');
  const nameEl = $('#uytThumbFileName');
  if (pi) pi.src = url;
  if (nameEl) nameEl.textContent = 'AI 生成封面';
  uytUpdateThumbUI();
}

// ─── YT视频列表编辑弹窗：AI 生成回填 ──────────────────
// 关联合集组名 → 本地合集（翻译系统 / 自建内容）的简介，供「合集简介」宏参
function ytvCollectionIntro(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  let list = [];
  try { list = list.concat(typeof getTranslationCollections === 'function' ? getTranslationCollections() : []); } catch (e) { /* 本地数据异常时跳过 */ }
  try { list = list.concat(typeof getSelfCollections === 'function' ? getSelfCollections() : []); } catch (e) { /* 本地数据异常时跳过 */ }
  const hit = list.find(c => c && ((c.name || '') === key || (c.linkedCollection || '') === key));
  return hit ? String(hit.intro || '') : '';
}

function insFillYtvTitle(data) {
  const v = String(data.generated || '').slice(0, 100);
  const el = $('#ytvEditTitleInput');
  if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  if (typeof ytvUpdateCounters === 'function') ytvUpdateCounters();
}

function insFillYtvDesc(data) {
  const v = String(data.generated || '');
  const el = $('#ytvEditDescInput');
  if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  if (typeof ytvUpdateCounters === 'function') ytvUpdateCounters();
}

function insFillYtvThumb(data) {
  const url = String(data.imageUrl || '');
  if (!url) throw new Error('未返回图片数据');
  const fileEl = $('#ytvEditThumbFile');
  if (!fileEl) throw new Error('封面控件未就绪，请重新打开编辑弹窗');
  const blob = dataUrlToBlob(url);
  const file = new File([blob], 'ai-thumbnail.png', { type: blob.type || 'image/png' });
  // 写回 input.files，保存时才会真正把新封面同步到 YouTube
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileEl.files = dt.files;
  } catch (e) {
    throw new Error('当前浏览器不支持自动写入封面文件，请下载后手动选择');
  }
  const img = $('#ytvEditThumbImg');
  const prev = $('#ytvEditThumbPreview');
  const upBtn = $('#ytvThumbUploadBtn');
  const upText = $('#ytvThumbUploadText');
  const hint = $('#ytvThumbHint');
  if (img && prev) { img.src = url; prev.classList.add('ytv-has-img'); }
  if (upBtn) upBtn.classList.add('ytv-picked');
  if (upText) upText.textContent = '已生成新封面';
  if (hint) hint.textContent = 'AI 已生成封面，保存时同步到 YouTube';
}

// 取当前视频来源上下文：优先当前选中剧集，退回筛选器中选中的合集组
function getSelectedSourceContext() {
  const collections = getTranslationCollections();

  // 1. 已选剧集：value = `${collectionId}-${episodeIndex}`
  const raw = $('#sourceEpisode')?.value || '';
  if (raw) {
    const dash = raw.lastIndexOf('-');
    const cid = raw.slice(0, dash);
    const idx = Number(raw.slice(dash + 1));
    const col = collections.find(c => String(c.id) === cid);
    if (col) {
      const ep = (col.episodes || [])[idx] || {};
      return {
        collectionName: col.name || '',
        linkedCollection: col.linkedCollection || '',
        intro: col.intro || '',
        language: ep.language || '',
        type: ep.type || '',
        from: 'episode'
      };
    }
  }

  // 2. 退回筛选器里选中的合集组
  const fCol = state.sourceFilterCollection || '';
  if (fCol) {
    const col = collections.find(c => (c.name || '') === fCol);
    return {
      collectionName: fCol,
      linkedCollection: col?.linkedCollection || '',
      intro: col?.intro || '',
      language: state.sourceFilterLanguage || '',
      type: state.sourceFilterType || '',
      from: 'filter'
    };
  }
  return null;
}

function bindAiTitle() {
  const btn = $('#btnAiGenTitle');
  if (btn) {
    btn.addEventListener('click', () => insGenAndFill({
      tab: 'title', scope: 'main', btnId: 'btnAiGenTitle', fill: insFillMainTitle
    }));
  }
}

// ─── Review Builder ──────────────────────────
function buildReview() {
  // 视频来源为已选剧集，预览通过 reviewYoutubeLink 展示 YouTube 链接（无文件预览分支）

  // Metadata
  const privacyMap = { public:'公开', unlisted:'不公开', private:'私享' };
  const activePrivacy = $('#privacyGroup .radio-card.active')?.dataset?.value || 'private';

  const rows = [
    ['标题', $('#title').value || '—'],
    ['描述', ($('#description').value || '—').substring(0, 100) + ($('#description').value.length>100?'...':'')],
  ];
  // 如果步骤 2 已上传，在视频预览下方展示 YouTube 播放地址
  if (state.step2VideoUrl) {
    $('#reviewYoutubeLink').href = state.step2VideoUrl;
    $('#reviewYoutubeLink').textContent = state.step2VideoUrl;
    $('#btnCopyYoutubeUrl').onclick = () => copyYoutubeUrl(state.step2VideoUrl);
    $('#reviewYoutubeUrl').style.display = 'block';
  } else {
    $('#reviewYoutubeUrl').style.display = 'none';
  }
  rows.push(
    ['定时发布', $('#publishAt').value || '立即发布'],
    ['嵌入', $('#embeddable').checked ? '是' : '否'],
    ['通知订阅者', $('#notifySubscribers').checked ? '是' : '否'],
    ['面向儿童', $('#selfDeclaredMadeForKids').checked ? '是' : '否'],
    ['含 AI 内容', $('#containsSyntheticMedia').checked ? '是' : '否'],
    ['18+ 限制', $('#ageRestricted').checked ? '是' : '否']
  );

  $('#reviewMetaList').innerHTML = rows.map(([k, v]) => `
    <div class="review-row">
      <span class="review-key">${k}</span>
      <span class="review-val">${v}</span>
    </div>
  `).join('');
}

// ─── Submit ──────────────────────────────────
function bindSubmit() {
  $('#btnSubmit').addEventListener('click', handleSubmit);
}

// ─── 频道管理页面 ──────────────────────────
function bindChannelsPage() {
  const addBtn = $('#btnAddChannel');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/auth/url');
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || '获取认证链接失败', 'error');
          return;
        }
        window.location.href = data.url;
      } catch (err) {
        showToast('获取认证链接失败', 'error');
      }
    });
  }

  // 字典管理
  const dictBtn = $('#btnManageDictionaries');
  if (dictBtn) {
    dictBtn.addEventListener('click', () => openDictionaryModal());
  }

  // 频道编辑弹窗事件绑定
  bindChannelEditModalEvents();

  // 字典管理弹窗事件绑定
  bindDictionaryModalEvents();

  // 频道筛选栏事件绑定
  const applyFilterBtn = $('#btnApplyChannelFilter');
  const resetFilterBtn = $('#btnResetChannelFilter');
  if (applyFilterBtn) applyFilterBtn.addEventListener('click', renderChannelsPage);
  if (resetFilterBtn) {
    resetFilterBtn.addEventListener('click', () => {
      $('#filterChannelId').value = '';
      $('#filterChannelName').value = '';
      $('#filterChannelType').value = '';
      $('#filterLanguage').value = '';
      $('#filterOperationMode').value = '';
      $('#filterDramaType').value = '';
      $('#filterRanking').value = '';
      $('#filterGender').value = '';
      $('#filterGroup').value = '';
      $('#filterOwner').value = '';
      $('#filterStatus').value = '';
      $('#filterMonetized').value = '';
      renderChannelsPage();
    });
  }
}

function getChannelFilterValues() {
  return {
    channelId: ($('#filterChannelId')?.value || '').trim().toLowerCase(),
    channelName: ($('#filterChannelName')?.value || '').trim().toLowerCase(),
    channelType: ($('#filterChannelType')?.value || '').trim(),
    language: ($('#filterLanguage')?.value || '').trim(),
    operationMode: ($('#filterOperationMode')?.value || '').trim(),
    dramaType: ($('#filterDramaType')?.value || '').trim(),
    ranking: ($('#filterRanking')?.value || '').trim(),
    supplier: ($('#filterSupplier')?.value || '').trim(),
    copyrightType: ($('#filterCopyrightType')?.value || '').trim(),
    gender: ($('#filterGender')?.value || '').trim(),
    group: ($('#filterGroup')?.value || '').trim(),
    owner: ($('#filterOwner')?.value || '').trim(),
    status: ($('#filterStatus')?.value || '').trim(),
    monetized: ($('#filterMonetized')?.value || '').trim(),
  };
}

function filterChannels(channels) {
  const f = getChannelFilterValues();
  return channels.filter(c => {
    const m = c.meta || {};
    const name = (m.channelName || c.title || '').toLowerCase();
    if (f.channelId && !(c.id || '').toLowerCase().includes(f.channelId)) return false;
    if (f.channelName && !name.includes(f.channelName)) return false;
    if (f.channelType && (m.channelType || '') !== f.channelType) return false;
    if (f.language && (m.language || '') !== f.language) return false;
    if (f.operationMode && (m.operationMode || '') !== f.operationMode) return false;
    if (f.dramaType && (m.dramaType || '') !== f.dramaType) return false;
    if (f.ranking && (m.ranking || '') !== f.ranking) return false;
    if (f.supplier && (m.supplier || '') !== f.supplier) return false;
    if (f.copyrightType && (m.copyrightType || '') !== f.copyrightType) return false;
    if (f.gender && (m.gender || '') !== f.gender) return false;
    if (f.group && (m.group || '') !== f.group) return false;
    if (f.owner && (m.owner || '') !== f.owner) return false;
    if (f.status && (m.status || '') !== f.status) return false;
    if (f.monetized && (m.monetized || '') !== f.monetized) return false;
    return true;
  });
}

function populateChannelFilterOptions() {
  const channels = state.channels || [];
  const unique = (key) => [...new Set(channels.map(c => (c.meta || {})[key]).filter(Boolean))].sort();
  const pairs = [
    ['filterChannelType', 'channelType'],
    ['filterLanguage', 'language'],
    ['filterOperationMode', 'operationMode'],
    ['filterDramaType', 'dramaType'],
    ['filterRanking', 'ranking'],
    ['filterSupplier', 'supplier'],
    ['filterCopyrightType', 'copyrightType'],
    ['filterGender', 'gender'],
    ['filterGroup', 'group'],
    ['filterOwner', 'owner'],
    ['filterStatus', 'status'],
    ['filterMonetized', 'monetized']
  ];
  for (const [id, key] of pairs) {
    const sel = $('#' + id);
    if (!sel) continue;
    const val = sel.value;
    sel.innerHTML = '<option value="">请选择</option>' +
      unique(key).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    sel.value = val;
  }
}

function renderChannelsPage() {
  const tbody = $('#channelsTableBody');
  const wrap = $('#channelsTableWrap');
  const empty = $('#channelsEmpty');
  if (!tbody || !wrap || !empty) return;

  const channels = state.channels || [];
  populateChannelFilterOptions();
  const filtered = filterChannels(channels);

  if (channels.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    $('#channelsFilter').style.display = 'none';
    return;
  }
  $('#channelsFilter').style.display = 'block';
  if (filtered.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = 'block';

  // 字段着色辅助函数
  function tdVal(text, cssClass) {
    if (!text) return '<span class="td-empty">—</span>';
    if (cssClass) return `<span class="${cssClass}">${escapeHtml(text)}</span>`;
    return escapeHtml(text);
  }
  function rankTag(val) {
    if (!val) return '<span class="td-empty">—</span>';
    const cls = ['S+','S','A+','A'].includes(val) ? 'success' : (val === 'YB' ? 'danger' : 'warn');
    return `<span class="table-tag ${cls}">${escapeHtml(val)}</span>`;
  }
  function statusTag(val) {
    if (!val) return '<span class="td-empty">—</span>';
    const cls = val === '运营中' ? 'success' : (val === '已下线' || val === '封号' ? 'danger' : 'warn');
    return `<span class="table-tag ${cls}">${escapeHtml(val)}</span>`;
  }
  function monetizedTag(val) {
    if (!val) return '<span class="td-empty">—</span>';
    const cls = val === '已获利' || val === '是' ? 'success' : 'gray';
    return `<span class="table-tag ${cls}">${escapeHtml(val)}</span>`;
  }
  function tdText(val) {
    if (!val) return '<span class="td-empty">—</span>';
    return escapeHtml(val);
  }
  // 视频简介模版：表格里不铺全文，只标「已设置 N 字」，鼠标悬停看全文
  function descTplTag(val) {
    const s = String(val || '').trim();
    if (!s) return '<span class="td-empty">—</span>';
    return `<span class="table-tag success">已设置 · ${s.length} 字</span>`;
  }

  tbody.innerHTML = filtered.map(c => {
    const m = c.meta || {};
    const displayName = m.channelName || c.title;
    const isActive = c.id === state.activeChannelId;
    const activeBadge = isActive ? '<span class="badge-active">当前</span>' : '';

    return `
    <tr class="${isActive ? 'active-row' : ''}" data-cid="${c.id}">
      <td><span class="td-channel-name">${escapeHtml(displayName)}${activeBadge}</span></td>
      <td><span class="td-channel-cid" title="${c.id}">${c.id}</span></td>
      <td>${tdText(m.owner)}</td>
      <td>${tdText(m.language)}</td>
      <td>${tdText(m.company)}</td>
      <td>${tdText(m.group)}</td>
      <td>${tdText(m.gender)}</td>
      <td>${tdText(m.channelType)}</td>
      <td>${tdText(m.operationMode)}</td>
      <td>${tdText(m.supplier)}</td>
      <td>${tdText(m.copyrightType)}</td>
      <td>${tdText(m.dramaType)}</td>
      <td>${monetizedTag(m.monetized)}</td>
      <td>${rankTag(m.ranking)}</td>
      <td>${statusTag(m.status)}</td>
      <td><span class="td-channel-remark">${tdText(m.remark)}</span></td>
      <td><span class="td-desctpl" title="${escapeHtml(m.descTemplate || '')}">${descTplTag(m.descTemplate)}</span></td>
      <td>
        <button class="table-action-btn" data-edit-cid="${c.id}">编辑</button>
        <button class="table-action-btn danger" data-remove-cid="${c.id}">移除</button>
      </td>
    </tr>`;
  }).join('');

  // 绑定编辑按钮
  $$('.table-action-btn[data-edit-cid]', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      openChannelEditModal(btn.dataset.editCid);
    });
  });

  // 绑定移除按钮
  $$('.table-action-btn[data-remove-cid]', tbody).forEach(btn => {
    btn.addEventListener('click', async () => {
      const channelId = btn.dataset.removeCid;
      if (!confirm('确定要移除此频道的授权吗？\n（仅清除授权，业务元数据保留在 channels.json）')) return;

      try {
        const res = await fetch(`/api/channels/${channelId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          await checkAuth();
          showToast('频道已移除', 'success');
        }
      } catch (err) {
        showToast('移除失败: ' + err.message, 'error');
      }
    });
  });
}

// ─── 频道编辑弹窗 ─────────────────────────
let _editChannelId = null;     // 当前正在编辑的频道 ID
let _editDictionaries = null;  // 字典缓存

async function loadDictionaries(force = false) {
  if (_editDictionaries && !force) return _editDictionaries;
  const res = await fetch('/api/dictionaries');
  const data = await res.json();
  _editDictionaries = data.dictionaries || {};
  return _editDictionaries;
}

function fillSelectOptions(selectEl, options, currentValue) {
  selectEl.innerHTML = '<option value="">请选择</option>' +
    options.map(o => `<option value="${escapeHtml(o)}" ${o === currentValue ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
}

async function openChannelEditModal(channelId, options = {}) {
  _editChannelId = channelId;
  const channel = state.channels.find(c => c.id === channelId);
  if (!channel) {
    showToast('频道未找到', 'error');
    return;
  }
  const dict = await loadDictionaries();
  const meta = channel.meta || {};

  // 填充摘要
  $('#channelEditSummaryTitle').textContent = meta.channelName || channel.title;
  $('#channelEditSummarySub').textContent = channel.id;
  const avatarEl = $('#channelEditAvatar');
  if (channel.thumbnail) {
    avatarEl.innerHTML = `<img src="${channel.thumbnail}" alt="">`;
  } else {
    avatarEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>`;
  }

  // ChannelID 字段（不在字典里，直接展示，不在 meta 字段时默认用 YouTube 频道 ID）
  $('#editChannelId').value = channel.id;

  // 填充下拉框
  fillSelectOptions($('#editOwner'), dict.owners || [], meta.owner);
  fillSelectOptions($('#editLanguage'), dict.languages || [], meta.language);
  fillSelectOptions($('#editCompany'), dict.companies || [], meta.company);
  fillSelectOptions($('#editGroup'), dict.groups || [], meta.group);
  fillSelectOptions($('#editGender'), dict.genders || [], meta.gender);
  fillSelectOptions($('#editChannelType'), dict.channelTypes || [], meta.channelType);
  fillSelectOptions($('#editOperationMode'), dict.operationModes || [], meta.operationMode);
  fillSelectOptions($('#editSupplier'), dict.suppliers || [], meta.supplier);
  fillSelectOptions($('#editCopyrightType'), dict.copyrightTypes || [], meta.copyrightType);
  fillSelectOptions($('#editDramaType'), dict.dramaTypes || [], meta.dramaType);
  fillSelectOptions($('#editMonetized'), dict.monetized || [], meta.monetized);
  fillSelectOptions($('#editRanking'), dict.rankings || [], meta.ranking);
  fillSelectOptions($('#editStatus'), dict.statuses || [], meta.status);

  // 文本字段
  $('#editChannelName').value = meta.channelName || '';
  $('#editRemark').value = meta.remark || '';
  $('#editDescTemplate').value = meta.descTemplate || '';

  $('#channelEditModal').style.display = 'flex';

  // 字典管理入口：聚焦到归属人 +
  if (options.focusInlineAdd) {
    setTimeout(() => $('#editOwner').focus(), 100);
  }
}

function closeChannelEditModal() {
  $('#channelEditModal').style.display = 'none';
  _editChannelId = null;
}

// ─── 字典管理弹窗 ─────────────────────────
const DICT_FIELDS = [
  { key: 'languages',     label: '语言',       hint: '可选择以下语言' },
  { key: 'genders',       label: '男女频',     hint: '可选择以下性别频道' },
  { key: 'channelTypes',  label: '频道类型',   hint: '可选择以下频道类型' },
  { key: 'operationModes',label: '运营模式',   hint: '可选择以下运营模式' },
  { key: 'suppliers',     label: '供应商',     hint: '可选择以下供应商' },
  { key: 'copyrightTypes',label: '版权类型',   hint: '可选择以下版权类型' },
  { key: 'dramaTypes',    label: '真人剧/漫剧',hint: '可选择以下类型' },
  { key: 'monetized',     label: '是否过获利',   hint: '可选择以下获利状态' },
  { key: 'rankings',      label: '挂靠方',     hint: '可选择以下等级' },
  { key: 'statuses',      label: '运营频道状态',   hint: '可选择以下状态' },
  { key: 'owners',        label: '归属人',     hint: '频道归属人列表' },
  { key: 'companies',     label: '所属公司',   hint: '所属公司列表' },
  { key: 'groups',        label: '小组',       hint: '小组列表' },
];

let _dictEditCache = null; // 当前编辑中的字典副本

async function openDictionaryModal() {
  const dict = await loadDictionaries(true);
  // 深拷贝用于编辑
  _dictEditCache = {};
  for (const f of DICT_FIELDS) {
    _dictEditCache[f.key] = [...(dict[f.key] || [])];
  }
  renderDictionaryBody();
  $('#dictModal').style.display = 'flex';
}

function closeDictionaryModal() {
  $('#dictModal').style.display = 'none';
  _dictEditCache = null;
}

function renderDictionaryBody() {
  const body = $('#dictBody');
  if (!_dictEditCache) return;

  const dictLabelColors = {
    'S+': '#22c55e', 'S': '#22c55e', 'A+': '#22c55e', 'A': '#22c55e',
    'B+': '#60a5fa', 'B': '#60a5fa', 'C': '#94a3b8', 'YB': '#ef4444',
    '运营中': '#22c55e', '已下线': '#ef4444', '封号': '#ef4444',
    '已获利': '#22c55e', '未获利': '#f59e0b',
  };

  body.innerHTML = DICT_FIELDS.map(f => {
    const items = _dictEditCache[f.key] || [];
    const tags = items.map(v => {
      const color = dictLabelColors[v] || '';
      const style = color ? `style="color:${color};border-color:${color}33"` : '';
      return `<span class="dict-tag" ${style}>
        ${escapeHtml(v)}
        <button class="dict-tag-del" data-dict-key="${f.key}" data-dict-val="${escapeHtml(v)}" title="删除">&times;</button>
      </span>`;
    }).join('');

    return `
    <div class="dict-section" data-dict-section="${f.key}">
      <div class="dict-section-header">
        <span class="dict-section-title">${f.label}<span class="dict-section-hint">${f.hint}</span></span>
      </div>
      <div class="dict-tag-list" id="dictTags_${f.key}">${tags || '<span class="td-empty" style="font-size:11px">暂无选项</span>'}</div>
      <div class="dict-add-row">
        <input class="dict-add-input" id="dictAddInput_${f.key}" placeholder="新增${f.label}选项..." maxlength="30">
        <button class="dict-add-btn" data-dict-add="${f.key}">+ 添加</button>
      </div>
    </div>`;
  }).join('');

  // 绑定删除事件
  $$('.dict-tag-del', body).forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.dictKey;
      const val = btn.dataset.dictVal;
      removeDictItem(key, val);
    });
  });

  // 绑定新增事件
  $$('.dict-add-btn', body).forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.dictAdd;
      const input = $(`#dictAddInput_${key}`);
      addDictItem(key, input);
    });
  });

  // 输入框回车新增
  $$('.dict-add-input', body).forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const key = input.id.replace('dictAddInput_', '');
        addDictItem(key, input);
      }
    });
  });
}

function removeDictItem(key, value) {
  if (!_dictEditCache) return;
  _dictEditCache[key] = (_dictEditCache[key] || []).filter(v => v !== value);
  // 仅更新当前 section 的标签列表
  const tagList = $(`#dictTags_${key}`);
  if (tagList) {
    const items = _dictEditCache[key];
    tagList.innerHTML = items.length === 0
      ? '<span class="td-empty" style="font-size:11px">暂无选项</span>'
      : items.map(v => `<span class="dict-tag">${escapeHtml(v)}<button class="dict-tag-del" data-dict-key="${key}" data-dict-val="${escapeHtml(v)}" title="删除">&times;</button></span>`).join('');
    // 重新绑定新标签的删除事件
    $$('.dict-tag-del', tagList).forEach(btn => {
      btn.addEventListener('click', () => {
        removeDictItem(btn.dataset.dictKey, btn.dataset.dictVal);
      });
    });
  }
}

function addDictItem(key, inputEl) {
  if (!_dictEditCache) return;
  const val = (inputEl.value || '').trim();
  if (!val) { showToast('请输入内容', 'info'); return; }
  if ((_dictEditCache[key] || []).includes(val)) {
    showToast('该选项已存在', 'info');
    return;
  }
  _dictEditCache[key].push(val);
  inputEl.value = '';
  // 刷新当前 section
  const tagList = $(`#dictTags_${key}`);
  if (tagList) {
    tagList.innerHTML = _dictEditCache[key].map(v => `<span class="dict-tag">${escapeHtml(v)}<button class="dict-tag-del" data-dict-key="${key}" data-dict-val="${escapeHtml(v)}" title="删除">&times;</button></span>`).join('');
    $$('.dict-tag-del', tagList).forEach(btn => {
      btn.addEventListener('click', () => {
        removeDictItem(btn.dataset.dictKey, btn.dataset.dictVal);
      });
    });
  }
}

async function saveDictionary() {
  if (!_dictEditCache) return;
  try {
    const res = await fetch('/api/dictionaries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_dictEditCache)
    });
    const data = await res.json();
    if (data.success) {
      _editDictionaries = data.dictionaries; // 更新缓存
      showToast('字典已保存', 'success');
      closeDictionaryModal();
    } else {
      showToast('保存失败: ' + (data.error || '未知错误'), 'error');
    }
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

// 绑定字典管理弹窗按钮事件（仅需绑定一次）
let _dictModalBound = false;
function bindDictionaryModalEvents() {
  if (_dictModalBound) return;
  _dictModalBound = true;

  const close = $('#dictClose');
  const cancel = $('#dictCancel');
  const save = $('#dictSave');
  const mask = $('#dictModal');

  if (close) close.addEventListener('click', closeDictionaryModal);
  if (cancel) cancel.addEventListener('click', closeDictionaryModal);
  if (save) save.addEventListener('click', saveDictionary);
  if (mask) mask.addEventListener('click', (e) => {
    if (e.target === mask) closeDictionaryModal();
  });
}

async function saveChannelEdit() {
  if (!_editChannelId) return;

  // 必填校验
  const required = [
    { id: 'editOwner', label: '归属人' },
    { id: 'editChannelId', label: 'ChannelID' },
    { id: 'editLanguage', label: '语言' },
    { id: 'editCompany', label: '所属公司' },
    { id: 'editGroup', label: '小组' },
    { id: 'editGender', label: '男女频' },
    { id: 'editChannelType', label: '频道类型' },
    { id: 'editOperationMode', label: '运营模式' },
    { id: 'editDramaType', label: '真人剧/漫剧' },
    { id: 'editMonetized', label: '是否过获利' },
    { id: 'editRanking', label: '挂靠方' },
    { id: 'editStatus', label: '运营频道状态' }
  ];
  for (const f of required) {
    const v = $('#' + f.id).value.trim();
    if (!v) {
      showToast(`请填写「${f.label}」`, 'error');
      $('#' + f.id).focus();
      return;
    }
  }
  // ChannelID 简单格式校验
  const cid = $('#editChannelId').value.trim();
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(cid)) {
    showToast('ChannelID 格式不正确（应为 UC 开头的 YouTube 频道 ID）', 'error');
    $('#editChannelId').focus();
    return;
  }

  const body = {
    owner: $('#editOwner').value,
    language: $('#editLanguage').value,
    channelName: $('#editChannelName').value.trim(),
    company: $('#editCompany').value,
    group: $('#editGroup').value,
    gender: $('#editGender').value,
    channelType: $('#editChannelType').value,
    operationMode: $('#editOperationMode').value,
    supplier: $('#editSupplier').value,
    copyrightType: $('#editCopyrightType').value,
    dramaType: $('#editDramaType').value,
    monetized: $('#editMonetized').value,
    ranking: $('#editRanking').value,
    status: $('#editStatus').value,
    remark: $('#editRemark').value.trim(),
    descTemplate: $('#editDescTemplate').value
  };

  try {
    const res = await fetch(`/api/channels/${_editChannelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      // 更新本地 state 中的频道
      const idx = state.channels.findIndex(c => c.id === _editChannelId);
      if (idx >= 0) state.channels[idx].meta = data.channel.meta;
      renderChannelsPage();
      closeChannelEditModal();
      showToast('频道信息已保存', 'success');
    } else {
      showToast(data.error || '保存失败', 'error');
    }
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

function bindChannelEditModalEvents() {
  const modal = $('#channelEditModal');
  if (!modal) return;

  $('#channelEditClose').addEventListener('click', closeChannelEditModal);
  $('#channelEditCancel').addEventListener('click', closeChannelEditModal);
  $('#channelEditSave').addEventListener('click', saveChannelEdit);

  // 点击遮罩关闭
  modal.addEventListener('click', e => {
    if (e.target === modal) closeChannelEditModal();
  });

  // 内联 + 按钮：归属人 / 公司
  $$('.inline-add-btn', modal).forEach(btn => {
    btn.addEventListener('click', () => {
      openInlineAddModal(btn.dataset.target);
    });
  });

  // 内联新增弹窗
  const inlineAddModal = $('#inlineAddModal');
  if (inlineAddModal) {
    $('#inlineAddClose').addEventListener('click', closeInlineAddModal);
    $('#inlineAddCancel').addEventListener('click', closeInlineAddModal);
    inlineAddModal.addEventListener('click', e => {
      if (e.target === inlineAddModal) closeInlineAddModal();
    });
    $('#inlineAddSave').addEventListener('click', saveInlineAdd);
    $('#inlineAddInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveInlineAdd(); }
    });
  }
}

let _inlineAddType = null;  // 'owner' | 'company' | 'group'

function openInlineAddModal(type) {
  _inlineAddType = type;
  const titles = { owner: '新增归属人', company: '新增公司', group: '新增小组' };
  const labels = { owner: '归属人姓名', company: '公司名称', group: '小组名称' };
  const placeholders = { owner: '请输入归属人姓名', company: '请输入公司名称', group: '请输入小组名称' };
  $('#inlineAddTitle').textContent = titles[type] || '新增';
  $('#inlineAddLabel').textContent = labels[type] || '名称';
  $('#inlineAddInput').value = '';
  $('#inlineAddInput').placeholder = placeholders[type] || '请输入名称';
  $('#inlineAddModal').style.display = 'flex';
  setTimeout(() => $('#inlineAddInput').focus(), 50);
}

function closeInlineAddModal() {
  $('#inlineAddModal').style.display = 'none';
  _inlineAddType = null;
}

async function saveInlineAdd() {
  const name = $('#inlineAddInput').value.trim();
  if (!name) {
    showToast('名称不能为空', 'error');
    return;
  }
  const endpointMap = { owner: '/api/owners', company: '/api/companies', group: '/api/groups' };
  const endpoint = endpointMap[_inlineAddType] || '/api/companies';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.success) {
      // 重新拉字典
      _editDictionaries = null;
      const dict = await loadDictionaries(true);
      // 更新对应下拉框 + 选中新值
      const selIdMap = { owner: 'editOwner', company: 'editCompany', group: 'editGroup' };
      const selId = selIdMap[_inlineAddType] || 'editCompany';
      const sel = $('#' + selId);
      if (!sel.querySelector(`option[value="${data.name}"]`)) {
        const opt = document.createElement('option');
        opt.value = data.name;
        opt.textContent = data.name;
        opt.selected = true;
        // 插在 "请选择" 后面
        if (sel.children.length > 0) sel.insertBefore(opt, sel.children[1]);
        else sel.appendChild(opt);
      } else {
        sel.value = data.name;
      }
      closeInlineAddModal();
      showToast('已添加', 'success');
    } else {
      showToast(data.error || '添加失败', 'error');
    }
  } catch (err) {
    showToast('添加失败: ' + err.message, 'error');
  }
}

// ─── 合集组（硬编码枚举值）─────────────────
const COLLECTION_GROUP_NAMES = ['产品评测', '教程系列', 'Vlog 日常', '开箱体验', '游戏实况', '技术分享'];
const COLLECTION_GROUP_IDS = ['demo-product-review', 'demo-tutorial', 'demo-vlog', 'demo-unboxing', 'demo-gameplay', 'demo-tech-talk'];

function populateCollectionOptions() {
  const sel = $('#collectionId');
  if (!sel) return;
  sel.innerHTML = '<option value="">不关联合集</option>';
  COLLECTION_GROUP_NAMES.forEach((name, i) => {
    sel.innerHTML += `<option value="${COLLECTION_GROUP_IDS[i]}">${name}</option>`;
  });
}

// ─── 视频来源筛选(填充 3 个筛选下拉)──────────────────
function populateSourceFilterOptions() {
  const collections = getTranslationCollections();
  const colSel = $('#filterSourceCollection');
  const langSel = $('#filterSourceLanguage');
  const typeSel = $('#filterSourceType');
  if (!colSel || !langSel || !typeSel) return;

  // 收集去重的合集名 / 语言 / 类型
  const collectionNames = [];
  const languages = [];
  const types = [];
  const seenCol = new Set(), seenLang = new Set(), seenType = new Set();
  collections.forEach(c => {
    const cname = c.name || '';
    if (cname && !seenCol.has(cname)) { seenCol.add(cname); collectionNames.push(cname); }
    (c.episodes || []).forEach(ep => {
      const lang = ep.language || '';
      if (lang && !seenLang.has(lang)) { seenLang.add(lang); languages.push(lang); }
      const t = ep.type || '';
      if (t && !seenType.has(t)) { seenType.add(t); types.push(t); }
    });
  });

  const colVal = state.sourceFilterCollection;
  const langVal = state.sourceFilterLanguage;
  const typeVal = state.sourceFilterType;
  colSel.innerHTML = '<option value="">关联合集组(全部)</option>' +
    collectionNames.map(n => `<option value="${n}" ${n === colVal ? 'selected' : ''}>${n}</option>`).join('');
  langSel.innerHTML = '<option value="">语言(全部)</option>' +
    languages.map(n => `<option value="${n}" ${n === langVal ? 'selected' : ''}>${n}</option>`).join('');
  typeSel.innerHTML = '<option value="">类型(全部)</option>' +
    types.map(n => `<option value="${n}" ${n === typeVal ? 'selected' : ''}>${n}</option>`).join('');
}

// ─── 视频来源(渲染到 combobox:ul + 隐藏 select,按筛选/搜索过滤,展示合集·语言·类型)──────────────
function populateSourceEpisodeOptions() {
  const sel = $('#sourceEpisode');
  const ul = $('#sourceOptions');
  const hint = $('#sourceCountHint');
  if (!sel || !ul) return;
  const collections = getTranslationCollections();
  const fCol = state.sourceFilterCollection;
  const fLang = state.sourceFilterLanguage;
  const fType = state.sourceFilterType;
  const kw = (state.sourceEpisodeSearch || '').trim().toLowerCase();

  let totalCount = 0;
  let showCount = 0;
  let selHtml = '<option value="">选择剧集</option>';
  let ulHtml = '';
  collections.forEach(c => {
    const cname = c.name || '';
    if (fCol && cname !== fCol) return;
    (c.episodes || []).forEach((ep, idx) => {
      totalCount++;
      const lang = ep.language || '';
      const t = ep.type || '';
      if (fLang && lang !== fLang) return;
      if (fType && t !== fType) return;
      // 搜索关键字过滤(合集名/语言/类型)
      if (kw) {
        const haystack = `${cname} ${lang} ${t}`.toLowerCase();
        if (haystack.indexOf(kw) === -1) return;
      }
      showCount++;
      const value = `${c.id}-${idx}`;
      // 枚举展示:合集名 · 语言 · 类型(去掉第几集)
      const label = `${cname} · ${lang || '—'} · ${t || '—'}`;
      selHtml += `<option value="${value}">${label}</option>`;
      ulHtml += `<li data-value="${value}">${label}</li>`;
    });
  });
  sel.innerHTML = selHtml;
  ul.innerHTML = ulHtml || '<li class="empty">无匹配剧集</li>';

  // 标记当前选中项
  const currentVal = sel.value;
  if (currentVal) {
    const matched = ul.querySelector(`li[data-value="${currentVal}"]`);
    if (matched) matched.classList.add('selected');
  }

  // 统计提示
  if (hint) {
    if (totalCount === 0) {
      hint.textContent = '暂无翻译合成视频';
    } else if (showCount === totalCount && !kw) {
      hint.textContent = `共 ${totalCount} 个剧集`;
    } else {
      hint.textContent = `已筛选: 显示 ${showCount} / 共 ${totalCount} 个剧集`;
    }
  }
}

// ─── 视频来源 combobox 交互:打开/关闭、搜索、选项点击、外部点击关闭 ──────────────
function bindSourceCombobox() {
  const combo = $('#sourceCombo');
  const display = $('#sourceEpisodeDisplay');
  const search = $('#sourceSearchInput');
  const ul = $('#sourceOptions');
  const sel = $('#sourceEpisode');
  if (!combo || !display || !search || !ul || !sel) return;

  // 显示框点击 → 打开/关闭
  display.addEventListener('click', () => {
    const isOpen = combo.classList.contains('open');
    if (isOpen) {
      closeCombo();
    } else {
      openCombo();
    }
  });

  // 搜索输入 → 实时过滤
  search.addEventListener('input', (e) => {
    state.sourceEpisodeSearch = e.target.value;
    populateSourceEpisodeOptions();
  });

  // 选项点击 → 选中并关闭
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;
    const value = li.dataset.value;
    const label = li.textContent;
    sel.value = value;
    display.value = label;
    // 同步当前选中高亮
    ul.querySelectorAll('li').forEach(item => item.classList.remove('selected'));
    li.classList.add('selected');
    // 触发 change(保持原 change 监听逻辑生效:updateStep1NextButton)
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    closeCombo();
  });

  // 搜索框按键:Enter 不提交表单
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
    if (e.key === 'Escape') closeCombo();
  });

  // 显示框按键:Enter / 空格 打开面板
  display.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCombo();
    }
  });

  // 外部点击关闭
  document.addEventListener('click', (e) => {
    if (!combo.contains(e.target)) closeCombo();
  });

  function openCombo() {
    combo.classList.add('open');
    // 同步搜索框值为 state 中保存的关键字(避免打开后看到陈旧内容)
    search.value = state.sourceEpisodeSearch || '';
    setTimeout(() => search.focus(), 0);
  }
  function closeCombo() {
    combo.classList.remove('open');
  }
}

// ─── Captions / Subtitle ──────────────────────

function bindCaptions() {
  const btnAdd = $('#btnAddCaption');
  const container = $('#captionEntries');

  btnAdd.addEventListener('click', () => addCaptionEntry());

  function addCaptionEntry() {
    const id = ++state.captionIdCounter;
    state.captions.push({ id, file: null, language: '', name: '' });
    renderCaptionEntry(id);
  }

  function renderCaptionEntry(id) {
    const entry = document.createElement('div');
    entry.className = 'caption-entry';
    entry.dataset.captionId = id;
    entry.innerHTML = `
      <div class="caption-entry-row">
        <div class="caption-entry-field">
          <label class="caption-label">字幕语言</label>
          <select class="form-select caption-lang-sel" data-cid="${id}">
            <option value="">选择语言</option>
            <option value="zh-CN">中文（简体）</option>
            <option value="zh-TW">中文（繁体）</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="pt">Português</option>
            <option value="ru">Русский</option>
            <option value="ar">العربية</option>
            <option value="hi">हिन्दी</option>
            <option value="th">ไทย</option>
            <option value="vi">Tiếng Việt</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </div>
        <div class="caption-entry-field">
          <label class="caption-label">字幕名称（可选）</label>
          <input type="text" class="form-input caption-name-input" placeholder="例如：中文字幕" data-cid="${id}">
        </div>
      </div>
      <div class="caption-entry-file">
        <div class="caption-file-upload-zone" data-cid="${id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>点击选择字幕文件</span>
        </div>
        <input type="file" class="caption-file-input" accept=".srt" hidden data-cid="${id}">
        <div class="caption-entry-file-info" style="display:none" data-cid="${id}">
          <span class="caption-entry-file-name" data-cid="${id}">—</span>
          <button class="caption-entry-remove-file" data-cid="${id}">移除</button>
        </div>
      </div>
      <button class="caption-entry-delete" data-cid="${id}" title="删除此字幕">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    `;

    container.appendChild(entry);

    // Bind events for this entry
    const langSel = entry.querySelector('.caption-lang-sel');
    const nameInput = entry.querySelector('.caption-name-input');
    const fileInput = entry.querySelector('.caption-file-input');
    const uploadZone = entry.querySelector('.caption-file-upload-zone');
    const fileInfo = entry.querySelector('.caption-entry-file-info');
    const fileName = entry.querySelector('.caption-entry-file-name');
    const removeFileBtn = entry.querySelector('.caption-entry-remove-file');
    const deleteBtn = entry.querySelector('.caption-entry-delete');

    langSel.addEventListener('change', () => {
      const caption = state.captions.find(c => c.id === id);
      if (caption) caption.language = langSel.value;
    });

    nameInput.addEventListener('input', () => {
      const caption = state.captions.find(c => c.id === id);
      if (caption) caption.name = nameInput.value.trim();
    });

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('dragover'); });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) setFile(file);
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) setFile(file);
    });

    removeFileBtn.addEventListener('click', () => setFile(null));
    deleteBtn.addEventListener('click', () => removeCaptionEntry(id));

    function setFile(file) {
      const caption = state.captions.find(c => c.id === id);
      if (!caption) return;
      if (file) {
        const validExts = ['.srt'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!validExts.includes(ext)) {
          showToast('不支持的字幕格式，请使用 .srt 格式', 'error');
          fileInput.value = '';
          return;
        }
        caption.file = file;
        if (!nameInput.value) nameInput.value = file.name.replace(/\.[^.]+$/, '');
      } else {
        caption.file = null;
        fileInput.value = '';
      }
      updateFileUI();
    }

    function updateFileUI() {
      const caption = state.captions.find(c => c.id === id);
      if (caption && caption.file) {
        uploadZone.style.display = 'none';
        fileInfo.style.display = 'flex';
        fileName.textContent = caption.file.name;
      } else {
        uploadZone.style.display = 'flex';
        fileInfo.style.display = 'none';
        fileName.textContent = '—';
      }
    }
  }

  function removeCaptionEntry(id) {
    state.captions = state.captions.filter(c => c.id !== id);
    const el = container.querySelector(`.caption-entry[data-caption-id="${id}"]`);
    if (el) el.remove();
  }
}

function resetCaptions() {
  state.captions = [];
  state.captionIdCounter = 0;
  const container = $('#captionEntries');
  if (container) container.innerHTML = '';
}

async function uploadCaptions(videoId) {
  if (!state.captions.length) return true;
  const validCaptions = state.captions.filter(c => c.file && c.language);
  if (!validCaptions.length) return true;

  let allOk = true;
  const okLangs = [];   // 上传成功的语言 → 合并进记录的 subtitleLangs(列表「字幕语言」列)
  for (const caption of validCaptions) {
    showLoading(`正在上传字幕 (${caption.language})...`);
    const fd = new FormData();
    fd.append('videoId', videoId);
    fd.append('language', caption.language);
    fd.append('caption', caption.file);
    if (caption.name) fd.append('name', caption.name);

    try {
      const res = await fetch('/api/captions/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        okLangs.push(caption.language);
        showToast(`字幕上传成功 (${caption.language})`, 'success');
      } else {
        showToast(`字幕上传失败 (${caption.language}): ${data.error || data.detail}`, 'error');
        allOk = false;
      }
    } catch (err) {
      showToast(`字幕上传网络错误 (${caption.language}): ${err.message}`, 'error');
      allOk = false;
    }
  }
  hideLoading();
  // 发布链路回写字幕语言(saveRecord 先行,这里按上传成功状态合并)
  updateRecordSubtitleLangs(videoId, okLangs);
  return allOk;
}

function bindThumbnail() {
  const fileInput = $('#thumbnailFileInput');
  const uploadZone = $('#thumbnailUploadZone');
  const previewArea = $('#thumbnailPreviewArea');
  const previewImg = $('#thumbnailPreview');
  const fileName = $('#thumbnailFileName');
  const removeBtn = $('#thumbnailRemoveBtn');

  if (!uploadZone) return;

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)'; });
  uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) setThumbnailFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) setThumbnailFile(file);
  });

  removeBtn.addEventListener('click', () => {
    state.thumbnailFile = null;
    fileInput.value = '';
    showThumbnailUI(null);
  });

  // 自定义缩略图：按「指令库 → 封面指令」生成
  const genThumbBtn = $('#btnAiGenThumb');
  if (genThumbBtn) {
    genThumbBtn.addEventListener('click', () => insGenAndFill({
      tab: 'thumbnail', scope: 'main', btnId: 'btnAiGenThumb', fill: insFillMainThumb
    }));
  }

  function setThumbnailFile(file) {
    const validExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) {
      showToast('不支持的图片格式，请使用 .jpg / .png / .gif / .webp', 'error');
      fileInput.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('缩略图文件不能超过 10MB', 'error');
      fileInput.value = '';
      return;
    }
    state.thumbnailFile = file;
    showThumbnailUI(file);
  }

  function showThumbnailUI(file) {
    if (file) {
      uploadZone.style.display = 'none';
      previewArea.style.display = 'flex';
      fileName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (e) => { previewImg.src = e.target.result; };
      reader.readAsDataURL(file);
    } else {
      uploadZone.style.display = 'flex';
      previewArea.style.display = 'none';
      previewImg.src = '';
      fileName.textContent = '—';
    }
  }
}

function resetThumbnail() {
  state.thumbnailFile = null;
  const fileInput = $('#thumbnailFileInput');
  if (fileInput) fileInput.value = '';
  const uploadZone = $('#thumbnailUploadZone');
  const previewArea = $('#thumbnailPreviewArea');
  const previewImg = $('#thumbnailPreview');
  const fileName = $('#thumbnailFileName');
  if (uploadZone) uploadZone.style.display = 'flex';
  if (previewArea) previewArea.style.display = 'none';
  if (previewImg) previewImg.src = '';
  if (fileName) fileName.textContent = '—';
}

async function uploadThumbnail(videoId) {
  if (!state.thumbnailFile) return true;

  showLoading('正在上传缩略图...');
  const fd = new FormData();
  fd.append('videoId', videoId);
  fd.append('thumbnail', state.thumbnailFile);

  try {
    const res = await fetch('/api/thumbnails/set', { method: 'POST', body: fd });
    const data = await res.json();
    hideLoading();
    if (data.success) {
      showToast('缩略图上传成功！', 'success');
      return true;
    } else {
      showToast('缩略图上传失败: ' + (data.error || data.detail), 'error');
      return false;
    }
  } catch (err) {
    hideLoading();
    showToast('缩略图上传网络错误: ' + err.message, 'error');
    return false;
  }
}

// ─── 处理结果轮询 ──────────────────────────
let processingPollTimer = null;

const ICONS = {
  error: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
  warning: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
  info: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  tag: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
  edit: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>'
};

function bindProcessingClose() {
  const closeBtn = $('#processingCloseBtn');
  const expandBtn = $('#processingExpandBtn');
  const copyBtn = $('#processingCopyBtn');
  const detailEl = $('#processingPanelDetail');
  let detailOpen = false;

  if (closeBtn) closeBtn.addEventListener('click', () => {
    $('#processingPanel').style.display = 'none';
    document.body.classList.remove('has-processing-panel');
    if (processingPollTimer) {
      clearTimeout(processingPollTimer);
      processingPollTimer = null;
    }
  });

  if (expandBtn) expandBtn.addEventListener('click', () => {
    detailOpen = !detailOpen;
    detailEl.style.display = detailOpen ? 'block' : 'none';
    expandBtn.style.transform = detailOpen ? 'rotate(180deg)' : '';
  });

  if (copyBtn) copyBtn.addEventListener('click', () => {
    const link = $('#processingVideoLink').href;
    if (link && link !== '#') {
      navigator.clipboard.writeText(link).then(() => {
        showToast('链接已复制到剪贴板', 'success');
      }).catch(() => {
        showToast('复制失败，请手动复制', 'error');
      });
    }
  });
}

// 全局复制 YouTube 链接函数（供 buildReview 中的 inline button 调用）
function copyYoutubeUrl(url) {
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast('链接已复制到剪贴板', 'success');
  }).catch(() => {
    showToast('复制失败，请手动复制', 'error');
  });
}

function showProcessingPanel(videoUrl) {
  const panel = $('#processingPanel');
  panel.style.display = 'block';
  document.body.classList.add('has-processing-panel');

  $('#processingStatusIcon').textContent = '⏳';
  $('#processingStatusTitle').textContent = '处理检查中...';
  $('#processingPercentBadge').textContent = '0%';
  $('#progressBarFill').style.width = '0%';
  $('#progressBarFill').className = 'progress-bar-fill';
  $('#processingIssues').innerHTML = '';
  $('#processingPanelDetail').style.display = 'none';
  $('#processingExpandBtn').style.transform = '';

  // 展示 YouTube 播放地址
  const watchBtn = $('#processingVideoLink');
  const copyBtn = $('#processingCopyBtn');
  if (videoUrl) {
    watchBtn.href = videoUrl;
    watchBtn.style.display = 'inline-flex';
    copyBtn.style.display = 'flex';
  } else {
    watchBtn.style.display = 'none';
    copyBtn.style.display = 'none';
  }
}

async function pollProcessingStatus(videoId, videoUrl) {
  showProcessingPanel(videoUrl);
  let attempts = 0;
  const maxAttempts = 60; // 最多轮询 3 分钟

  const poll = async () => {
    attempts++;
    try {
      const res = await fetch(`/api/video/status/${videoId}`);
      if (!res.ok) {
        if (attempts < maxAttempts) processingPollTimer = setTimeout(poll, 3000);
        return;
      }
      const data = await res.json();
      // 同步发布状态到关联表:succeeded→已完成 / failed→上传失败 / terminated→拒绝
      if (data.processingStatus === 'succeeded') updateRecordStatusByVideoId(videoId, 'completed');
      else if (data.processingStatus === 'failed') updateRecordStatusByVideoId(videoId, 'failed');
      else if (data.processingStatus === 'terminated') updateRecordStatusByVideoId(videoId, 'rejected');
      renderProcessingResult(data);

      const ps = data.processingStatus;
      // 处理完成或失败时停止轮询
      if (ps === 'succeeded' || ps === 'failed' || ps === 'terminated' || attempts >= maxAttempts) {
        processingPollTimer = null;
        return;
      }
      processingPollTimer = setTimeout(poll, 3000);
    } catch (err) {
      if (attempts < maxAttempts) processingPollTimer = setTimeout(poll, 3000);
    }
  };

  poll();
}

function renderProcessingResult(data) {
  const ps = data.processingStatus;
  const pp = data.processingProgress;

  // 更新百分比徽章
  let pct = 0;
  if (pp && pp.partsTotal > 0) {
    pct = Math.round((pp.partsProcessed / pp.partsTotal) * 100);
  } else if (ps === 'succeeded') {
    pct = 100;
  }
  $('#processingPercentBadge').textContent = pct + '%';
  $('#progressBarFill').style.width = pct + '%';

  // 进度条颜色
  if (ps === 'failed' || ps === 'terminated') {
    $('#progressBarFill').classList.add('error');
  } else if (ps === 'succeeded') {
    $('#progressBarFill').classList.add('success');
  }

  // 更新状态图标和文字
  const label = data.processingStatusLabel || { text: ps || '未知', color: 'info' };
  if (ps === 'succeeded') {
    $('#processingStatusIcon').textContent = '✅';
    $('#processingStatusTitle').textContent = '视频处理完成';
  } else if (ps === 'failed') {
    $('#processingStatusIcon').textContent = '❌';
    $('#processingStatusTitle').textContent = '视频处理失败';
  } else if (ps === 'terminated') {
    $('#processingStatusIcon').textContent = '⏹';
    $('#processingStatusTitle').textContent = '处理已终止';
  } else {
    $('#processingStatusIcon').textContent = '⏳';
    $('#processingStatusTitle').textContent = label.text || '处理检查中...';
  }

  // 构建问题列表
  const issues = $('#processingIssues');
  let html = '';

  // 处理错误
  if (data.processingErrors?.length) {
    html += '<div class="issue-group-title" style="color:#f87171">处理错误</div>';
    html += '<div class="issue-list">';
    data.processingErrors.forEach(e => {
      html += `<div class="issue-item error">${ICONS.error}<span class="issue-content">${e.label}</span></div>`;
    });
    html += '</div>';
  }

  // 处理警告
  if (data.processingWarnings?.length) {
    html += '<div class="issue-group-title" style="color:#fbbf24">处理警告</div>';
    html += '<div class="issue-list">';
    data.processingWarnings.forEach(w => {
      html += `<div class="issue-item warning">${ICONS.warning}<span class="issue-content">${w.label}</span></div>`;
    });
    html += '</div>';
  }

  // 处理提示
  if (data.processingHints?.length) {
    html += '<div class="issue-group-title" style="color:#60a5fa">优化建议</div>';
    html += '<div class="issue-list">';
    data.processingHints.forEach(h => {
      html += `<div class="issue-item hint">${ICONS.info}<span class="issue-content">${h.label}</span></div>`;
    });
    html += '</div>';
  }

  // 编辑建议
  if (data.editorSuggestions?.length) {
    html += '<div class="issue-group-title" style="color:#a78bfa">编辑建议</div>';
    html += '<div class="issue-list">';
    data.editorSuggestions.forEach(e => {
      html += `<div class="issue-item suggestion">${ICONS.edit}<span class="issue-content">${e.label}</span></div>`;
    });
    html += '</div>';
  }

  // 全部正常
  if (!data.processingErrors?.length && !data.processingWarnings?.length &&
      !data.processingHints?.length && !data.editorSuggestions?.length && ps === 'succeeded') {
    html += `<div class="issue-item hint">${ICONS.check}<span class="issue-content">未发现任何问题，视频处理一切正常。</span></div>`;
  }

  issues.innerHTML = html;
}

async function handleSubmit() {
  // 如果上传尚未完成，等待上传
  if (!state.step2Uploaded && state.step2UploadPromise) {
    showLoading('等待视频上传完成...');
    try {
      await state.step2UploadPromise;
    } catch (e) {
      hideLoading();
      showToast('视频上传失败，无法更新信息', 'error');
      return;
    }
    hideLoading();
  }

  // 上传完成后仍未拿到 videoId
  if (!state.step2VideoId) {
    showToast('请先在步骤 1 上传视频到 YouTube', 'error');
    goToStep(1);
    return;
  }
  if (!state.authenticated) { showToast('请先登录', 'error'); return; }

  const title = $('#title').value.trim();
  if (!title || title.length > 100) {
    showToast('请填写有效的视频标题', 'error');
    goToStep(2);
    return;
  }

  // 定时发布：必须晚于当前时间，且 YouTube 只接受「私享」视频 —— 这里做最终兜底
  const pubAtRaw = $('#publishAt').value;
  let publishAtIso = '';
  if (pubAtRaw) {
    const when = new Date(pubAtRaw);
    if (isNaN(when.getTime())) {
      showToast('定时发布时间格式不正确，请重新选择', 'error');
      return;
    }
    if (when.getTime() <= Date.now()) {
      showToast('定时发布时间必须晚于当前时间，请重新选择', 'error');
      return;
    }
    publishAtIso = when.toISOString();
    // 兜底：无论界面上当前选中什么，定时发布一律以私享提交
    if (getActivePrivacy() !== 'private') setPrivacyCard('private');
  }

  const activePrivacy = pubAtRaw ? 'private' : getActivePrivacy();
  state.uploading = true;
  showLoading('正在更新视频信息...');
  $('#btnSubmit').disabled = true;

  // Build request body for metadata update
  const body = {
    title,
    privacyStatus: activePrivacy,
    embeddable: $('#embeddable').checked,
    notifySubscribers: $('#notifySubscribers').checked,
    selfDeclaredMadeForKids: $('#selfDeclaredMadeForKids').checked,
    containsSyntheticMedia: $('#containsSyntheticMedia').checked,
    ageRestricted: $('#ageRestricted').checked
  };

  // 说明：手填优先；留空则套用该频道的「视频简介模版」（保证重试时结果一致）
  let desc = $('#description').value.trim();
  if (!desc) {
    const cid = state.activeChannelId || ($('#targetChannel') && $('#targetChannel').value) || '';
    desc = renderDescTemplateClient(resolveDescTemplateFor(cid), buildMainDescCtx(cid));
  }
  if (desc) body.description = desc;
  if (publishAtIso) body.publishAt = publishAtIso;

  // 合集组
  const collectionId = $('#collectionId')?.value;
  if (collectionId) body.collectionId = collectionId;

  try {
    // 更新视频元数据
    const res = await fetch(`/api/video/${state.step2VideoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    hideLoading();

    if (data.success) {
      const videoUrl = data.url || state.step2VideoUrl;
      showToast(publishAtIso ? '视频信息已更新，已设为定时发布（私享）' : '视频信息已更新！', 'success');

      const channelMeta = state.channel?.meta || {};
      saveRecord({
        contentId: generateContentId(),
        videoId: data.videoId,
        // 频道信息随记录落库：批量字幕翻译时据此自动切换归属账号
        channelId: state.channel?.id || '',
        channelTitle: state.channel?.title || '',
        title,
        url: videoUrl,
        time: new Date().toISOString(),
        collectionName: getCollectionNameById(collectionId),
        owner: state.adminUsername || '—',
        language: channelMeta.language || '—',
        gender: channelMeta.gender || '—',
        // 以下字段当前暂无数据来源，保留为空以便后续扩展
        supplier: '',
        purchaseVersion: '',
        producePlatform: '',
        baseFee: '',
        checkFee: '',
        dubFee: '',
        aiDubUnit: '',
        aiDubFee: '',
        authTime: '',
        remark: ''
      });

      // 开始轮询处理状态
      pollProcessingStatus(data.videoId, videoUrl);

      // 如果有字幕文件，上传字幕
      const captionOk = await uploadCaptions(data.videoId);

      let thumbnailOk = true;
      if (state.thumbnailFile && captionOk) {
        thumbnailOk = await uploadThumbnail(data.videoId);
      }

      if (captionOk && thumbnailOk) {
        showToast('全部完成！', 'success');
      }

      // 重置表单但保留处理面板
      resetAllExceptProcessing();

      // 自动跳转到视频列表页面
      setTimeout(() => {
        document.querySelector('[data-page=history]').click();
      }, 1500);
    } else {
      const extraMsg = data.attemptedCategoryId ? ` (尝试的categoryId: ${data.attemptedCategoryId})` : '';
      showToast(data.error + (data.detail ? `：${JSON.stringify(data.detail)}${extraMsg}` : ''), 'error');
    }
  } catch (err) {
    hideLoading();
    showToast('网络错误: ' + err.message, 'error');
  }

  state.uploading = false;
  $('#btnSubmit').disabled = false;
}

function resetAll() {
  // 视频来源为"翻译合成视频"剧集选择，重置时清掉选择与上传产物
  const srcSel = $('#sourceEpisode');
  if (srcSel) srcSel.value = '';
  const srcDisp = $('#sourceEpisodeDisplay');
  if (srcDisp) srcDisp.value = '';
  state.sourceFilterCollection = '';
  state.sourceFilterLanguage = '';
  state.sourceFilterType = '';
  state.sourceEpisodeSearch = '';
  populateSourceFilterOptions();
  populateSourceEpisodeOptions();
  state.videoUrl = '';
  state.step2Uploaded = false;
  state.step2UploadPromise = null;
  state.step2VideoId = null;
  state.step2VideoUrl = null;

  $('#title').value = '';
  $('#titleCount').textContent = '0/100';
  $('#description').value = '';
  $('#descCount').textContent = '0/5000';
  channelDescState = { channelId: null, text: '' };
  _mainAutoDesc = '';
  setDescHint(DESC_HINT_DEFAULT);
  $('#publishAt').value = '';
  $('#embeddable').checked = true;
  $('#notifySubscribers').checked = true;
  $('#selfDeclaredMadeForKids').checked = false;
  $('#containsSyntheticMedia').checked = false;
  $('#ageRestricted').checked = false;
  $$('#privacyGroup .radio-card').forEach(c => c.classList.remove('active'));
  const privateCard = $('#privacyGroup [data-value="private"]');
  if (privateCard) privateCard.classList.add('active');
  // 重置字幕状态
  resetCaptions();
  // 重置缩略图状态
  resetThumbnail();
  // 关闭处理面板
  $('#processingPanel').style.display = 'none';
  document.body.classList.remove('has-processing-panel');
  if (processingPollTimer) { clearTimeout(processingPollTimer); processingPollTimer = null; }
  // 重置步骤1按钮（视频已清空，需重新选择视频与频道）
  updateStep1NextButton();
}

// 重置表单但保留处理结果面板
function resetAllExceptProcessing() {
  // 保留处理结果面板，只清掉视频来源与表单内容
  const srcSel = $('#sourceEpisode');
  if (srcSel) srcSel.value = '';
  const srcDisp = $('#sourceEpisodeDisplay');
  if (srcDisp) srcDisp.value = '';
  state.sourceFilterCollection = '';
  state.sourceFilterLanguage = '';
  state.sourceFilterType = '';
  state.sourceEpisodeSearch = '';
  populateSourceFilterOptions();
  populateSourceEpisodeOptions();
  state.videoUrl = '';
  state.step2Uploaded = false;
  state.step2UploadPromise = null;
  state.step2VideoId = null;
  state.step2VideoUrl = null;

  $('#title').value = '';
  $('#titleCount').textContent = '0/100';
  $('#description').value = '';
  $('#descCount').textContent = '0/5000';
  channelDescState = { channelId: null, text: '' };
  _mainAutoDesc = '';
  setDescHint(DESC_HINT_DEFAULT);
  $('#publishAt').value = '';
  $('#embeddable').checked = true;
  $('#notifySubscribers').checked = true;
  $('#selfDeclaredMadeForKids').checked = false;
  $('#containsSyntheticMedia').checked = false;
  $('#ageRestricted').checked = false;
  $$('#privacyGroup .radio-card').forEach(c => c.classList.remove('active'));
  const privateCard = $('#privacyGroup [data-value="private"]');
  if (privateCard) privateCard.classList.add('active');
  resetCaptions();
  resetThumbnail();
  updateStep1NextButton();
}

// ─── Settings ────────────────────────────────
function loadSettings() {
  // 从服务器读取当前配置状态
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => {
      // 总是回显服务器端配置
      if (cfg.hasClientId && cfg.clientId) {
        $('#settingClientId').value = cfg.clientId;
      }
      if (cfg.hasClientSecret && cfg.clientSecret) {
        $('#settingClientSecret').value = cfg.clientSecret;
      }
      // 重定向 URI 始终以服务端为准回显：此前漏了这一步，界面会一直显示写死的 3000，
      // 且点「保存到服务器」时又把这个写死值写回 .env，导致 .env 的修改被静默覆盖
      const redirectEl = $('#redirectUri');
      if (redirectEl && cfg.redirectUri) {
        redirectEl.value = cfg.redirectUri;
      }

      if (cfg.hasClientId && cfg.hasClientSecret) {
        $('#configStatus').textContent = '服务器已配置（凭据完整）';
        $('#configStatus').style.color = 'var(--success)';
      } else if (cfg.hasClientId || cfg.hasClientSecret) {
        $('#configStatus').textContent = '凭据不完整，请重新填写完整';
        $('#configStatus').style.color = 'var(--warning)';
      } else {
        $('#configStatus').textContent = '未配置';
        $('#configStatus').style.color = 'var(--muted)';
      }
    })
    .catch(() => {
      // 服务器不可用时回退到本地存储
      const s = JSON.parse(localStorage.getItem('yt_settings') || '{}');
      if (s.clientId) $('#settingClientId').value = s.clientId;
      if (s.clientSecret) $('#settingClientSecret').value = s.clientSecret;
      $('#configStatus').textContent = '无法连接服务器';
      $('#configStatus').style.color = 'var(--danger)';
    });

  // 加载代理配置
  fetch('/api/network-test')
    .then(r => r.json())
    .then(data => {
      if (data.proxyUrl) {
        $('#settingProxyUrl').value = data.proxyUrl;
      }
    })
    .catch(() => {});

  // 加载 AI 配置
  loadAiConfig();
  // 加载默认视频说明模板
  loadDescTemplates();
}

// ─── AI 标题生成 · 设置页 ────────────────────────
async function loadAiConfig() {
  const statusEl = $('#aiConfigStatus');
  try {
    const res = await fetch('/api/ai/config');
    const cfg = await res.json();
    if (!res.ok) throw new Error(cfg.error || `HTTP ${res.status}`);

    if ($('#settingAiBaseUrl')) $('#settingAiBaseUrl').value = cfg.baseUrl || '';
    if ($('#settingAiModel')) $('#settingAiModel').value = cfg.model || '';
    if ($('#settingAiImageModel')) $('#settingAiImageModel').value = cfg.imageModel || '';
    // 密钥不回显明文，留空即不修改
    if ($('#settingAiApiKey')) {
      $('#settingAiApiKey').value = '';
      $('#settingAiApiKey').placeholder = cfg.hasKey
        ? `已保存：${cfg.keyMasked}（留空表示不修改）`
        : 'sk-... 请填写 DeepSeek API Key';
    }
    if (statusEl) {
      statusEl.textContent = cfg.hasKey ? `已配置（${cfg.keyMasked}）` : '未配置 API Key';
      statusEl.style.color = cfg.hasKey ? 'var(--success)' : 'var(--warning)';
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '读取失败：' + err.message;
      statusEl.style.color = 'var(--danger)';
    }
  }
}

async function saveAiConfig() {
  const statusEl = $('#aiConfigStatus');
  const payload = {
    baseUrl: $('#settingAiBaseUrl')?.value.trim() || '',
    model: $('#settingAiModel')?.value.trim() || '',
    imageModel: $('#settingAiImageModel')?.value.trim() || '',
    apiKey: $('#settingAiApiKey')?.value.trim() || ''
  };
  try {
    const res = await fetch('/api/ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showToast('AI 配置已保存到服务器', 'success');
    await loadAiConfig();
  } catch (err) {
    showToast('保存 AI 配置失败：' + err.message, 'error');
    if (statusEl) {
      statusEl.textContent = '保存失败';
      statusEl.style.color = 'var(--danger)';
    }
  }
}

// ─── 默认视频说明模板 ────────────────────────
// YouTube 的「上传默认设置 → 说明」没有读写接口（拉不到也改不了），
// 所以默认说明由本系统在上传时直接写入 snippet.description。
let _descTemplates = { default: '', byChannel: {} };

function resolveDescTemplateFor(channelId) {
  // 1) 频道列表里维护的「视频简介模版」优先（用户在社媒账号采集表里直接填）
  const ch = (state.channels || []).find(c => c.id === channelId);
  const fromChannel = ch && ch.meta ? String(ch.meta.descTemplate || '').trim() : '';
  if (fromChannel) return fromChannel;
  // 2) 退回「系统设置 → 默认视频说明模板」（按频道 / 全局默认）
  const per = channelId ? _descTemplates.byChannel[channelId] : '';
  return (per && String(per).trim()) ? String(per) : (_descTemplates.default || '');
}

function renderDescTemplateClient(tpl, ctx = {}) {
  if (!tpl) return '';
  const map = {
    title: ctx.title || '',
    channelTitle: ctx.channelTitle || '',
    channelUrl: ctx.channelId ? `https://www.youtube.com/channel/${ctx.channelId}` : (ctx.channelUrl || ''),
    collectionGroup: ctx.collectionGroup || '',
    language: ctx.language || '',
    type: ctx.type || '',
    date: ctx.date || new Date().toISOString().slice(0, 10)
  };
  return String(tpl).replace(/\{\s*(\w+)\s*\}/g, (m, k) => (k in map ? map[k] : m)).slice(0, 5000);
}

async function loadDescTemplates() {
  const statusEl = $('#descTplStatus');
  try {
    const res = await fetch('/api/description-templates');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    _descTemplates = { default: data.default || '', byChannel: data.byChannel || {} };
    const sel = $('#descTplChannel');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">全局默认（未单独设置的频道都用这份）</option>' +
        (state.channels || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join('');
      sel.value = cur;
    }
    fillDescTplText();
    if (statusEl) {
      statusEl.textContent = _descTemplates.default ? '已配置全局默认' : '未配置（留空=不自动填写）';
      statusEl.style.color = _descTemplates.default ? 'var(--success)' : 'var(--warning)';
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '读取失败：' + err.message;
      statusEl.style.color = 'var(--danger)';
    }
  }
}

function fillDescTplText() {
  const sel = $('#descTplChannel');
  const id = sel ? sel.value : '';
  const el = $('#descTplText');
  if (!el) return;
  el.value = id ? (_descTemplates.byChannel[id] || '') : (_descTemplates.default || '');
}

async function saveDescTemplates() {
  const statusEl = $('#descTplStatus');
  const sel = $('#descTplChannel');
  const id = sel ? sel.value : '';
  const text = ($('#descTplText') && $('#descTplText').value || '').slice(0, 5000);
  const payload = id
    ? { byChannel: Object.assign({}, _descTemplates.byChannel, { [id]: text }) }
    : { default: text };
  try {
    const res = await fetch('/api/description-templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    _descTemplates = { default: data.default || '', byChannel: data.byChannel || {} };
    showToast(id ? '该频道的说明模板已保存' : '全局默认说明模板已保存', 'success');
    if (statusEl) {
      statusEl.textContent = '已保存';
      statusEl.style.color = 'var(--success)';
    }
  } catch (err) {
    showToast('保存说明模板失败：' + err.message, 'error');
  }
}

async function previewDescTemplates() {
  const sel = $('#descTplChannel');
  const id = sel ? sel.value : '';
  const text = ($('#descTplText') && $('#descTplText').value) || '';
  const ch = (state.channels || []).find(c => c.id === id);
  const rendered = renderDescTemplateClient(text, {
    channelId: id,
    channelTitle: ch ? ch.title : '示例频道',
    title: '示例影片名称',
    collectionGroup: '示例合集组',
    language: '英文',
    type: 'AI配音视频'
  });
  let box = $('#descTplPreviewBox');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'descTplPreviewBox';
    box.style.cssText = 'margin:10px 0 0;padding:12px;border:1px dashed var(--border);border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.7;color:var(--text-secondary);background:var(--bg-input)';
    const host = $('#descTplText') && $('#descTplText').parentNode;
    if (host) host.appendChild(box);
  }
  box.textContent = rendered || '（模板为空，上传时不会自动填写说明）';
}

async function testAi() {
  const statusEl = $('#aiConfigStatus');
  if (statusEl) {
    statusEl.textContent = '测试中...';
    statusEl.style.color = 'var(--text-muted)';
  }
  try {
    const res = await fetch('/api/ai/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (statusEl) {
      statusEl.textContent = `连接正常 · ${data.model} · ${data.latencyMs}ms`;
      statusEl.style.color = 'var(--success)';
    }
    showToast(`AI 连接正常（${data.model} · ${data.latencyMs}ms）`, 'success');
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '连接失败：' + err.message;
      statusEl.style.color = 'var(--danger)';
    }
    showToast('AI 连接失败：' + err.message, 'error');
  }
}

function toggleAiKeyVisibility() {
  const input = $('#settingAiApiKey');
  const btn = $('#btnToggleAiKey');
  if (!input || !btn) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '隐';
  } else {
    input.type = 'password';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

async function saveProxy() {
  const proxyUrl = $('#settingProxyUrl').value.trim();
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxyUrl })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    showToast(proxyUrl ? '代理已保存' : '代理已清除', 'success');
  } catch (err) {
    showToast('保存代理失败: ' + err.message, 'error');
  }
}

async function testNetwork() {
  const resultEl = $('#networkTestResult');
  if (!resultEl) return;
  resultEl.textContent = '测试中...';
  resultEl.style.color = 'var(--muted)';
  try {
    const res = await fetch('/api/network-test');
    const data = await res.json();
    if (data.direct.ok) {
      resultEl.textContent = `直连可用 (${data.direct.time}ms)`;
      resultEl.style.color = 'var(--success)';
    } else if (data.viaProxy && data.viaProxy.ok) {
      resultEl.textContent = `代理可用 (${data.viaProxy.time}ms)`;
      resultEl.style.color = 'var(--success)';
    } else {
      const directErr = data.direct.error || '未知';
      const proxyErr = data.viaProxy ? data.viaProxy.error : '未配置代理';
      resultEl.textContent = `直连: ${directErr} | 代理: ${proxyErr}`;
      resultEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    resultEl.textContent = '测试失败: ' + err.message;
    resultEl.style.color = 'var(--danger)';
  }
}

function bindSettings() {
  $('#settingClientId').addEventListener('change', saveLocalSettings);
  $('#settingClientSecret').addEventListener('change', saveLocalSettings);
  $('#btnSaveConfig').addEventListener('click', saveConfigToServer);
  $('#btnSaveProxy')?.addEventListener('click', saveProxy);
  $('#btnTestNetwork')?.addEventListener('click', testNetwork);
  $('#btnSaveAiConfig')?.addEventListener('click', saveAiConfig);
  $('#btnSaveDescTpl')?.addEventListener('click', saveDescTemplates);
  $('#btnPreviewDescTpl')?.addEventListener('click', previewDescTemplates);
  $('#descTplChannel')?.addEventListener('change', fillDescTplText);
  $('#btnTestAi')?.addEventListener('click', testAi);
}

function toggleSecretVisibility() {
  const input = $('#settingClientSecret');
  if (input.type === 'password') {
    input.type = 'text';
    $('#btnToggleSecret').textContent = '隐';
  } else {
    input.type = 'password';
    $('#btnToggleSecret').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
}

function saveLocalSettings() {
  localStorage.setItem('yt_settings', JSON.stringify({
    clientId: $('#settingClientId').value.trim(),
    clientSecret: $('#settingClientSecret').value.trim()
  }));
}

async function saveConfigToServer() {
  const clientId = $('#settingClientId').value.trim();
  const clientSecret = $('#settingClientSecret').value.trim();
  const redirectUri = $('#redirectUri').value.trim();

  // 重定向 URI 也允许单独保存（服务端对空值会沿用旧值）
  if (!clientId && !clientSecret && !redirectUri) {
    showToast('请至少填写一项要修改的配置', 'error');
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        clientSecret,
        redirectUri
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');

    // 用服务端返回值回显，避免界面与实际配置不一致
    if (data.config && data.config.redirectUri) {
      $('#redirectUri').value = data.config.redirectUri;
    }

    $('#configStatus').textContent = '服务器已保存（凭据完整）';
    $('#configStatus').style.color = 'var(--success)';
    showToast('配置已保存到服务器，可以开始授权', 'success');
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

// ─── History ─────────────────────────────────
// 发布状态(发布内容关联表):处理中/已完成/上传失败/拒绝/删除
const PUBLISH_STATUS = {
  processing: { text: '处理中', cls: 'st-processing' },
  completed:  { text: '已完成', cls: 'st-completed' },
  failed:     { text: '上传失败', cls: 'st-failed' },
  rejected:   { text: '拒绝', cls: 'st-rejected' },
  deleted:    { text: '删除', cls: 'st-deleted' }
};
// 兼容旧记录(无 publishStatus 字段):有 videoId 视为已完成,否则视为处理中
function getPublishStatus(r) {
  if (r.publishStatus && PUBLISH_STATUS[r.publishStatus]) return r.publishStatus;
  return r.videoId ? 'completed' : 'processing';
}
// 按视频ID同步发布状态到关联表(删除状态不覆盖)
function updateRecordStatusByVideoId(videoId, status) {
  if (!videoId || !PUBLISH_STATUS[status]) return;
  const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
  let changed = false;
  records.forEach(r => {
    if (r.videoId === videoId && r.publishStatus !== 'deleted') {
      if (r.publishStatus !== status) { r.publishStatus = status; changed = true; }
    }
  });
  if (changed) {
    localStorage.setItem('yt_upload_records', JSON.stringify(records));
    renderHistory();
  }
}

function generateContentId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rnd = '';
  for (let i = 0; i < 6; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
  return `media_${rnd}`;
}

// 发布内容关联表 mock 种子数据(覆盖全部 5 种发布状态,字段尽量填满)
const HISTORY_SEED = [
  { contentId: 'media_a1b2c3', videoId: 'v1_Kx8mPz2q', subtitleLangs: ['en', 'es', 'pt'], collectionName: '逆袭之巅', owner: '刘桐金', language: '英语', gender: '男', supplier: '杭州容量互娱', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥12,000', checkFee: '¥800', dubFee: '¥3,500', aiDubUnit: '¥120/集', aiDubFee: '¥1,200', authTime: '2026-09-08', remark: '首批出海内容', publishStatus: 'processing', url: 'https://youtu.be/v1_Kx8mPz2q', time: '2026-09-08 10:12:30' },
  { contentId: 'media_d4e5f6', videoId: 'v2_Mn9qR3s', subtitleLangs: ['ko'], collectionName: '重生医妃', owner: '刘桐金', language: '韩语', gender: '女', supplier: '星辰文化', purchaseVersion: '分账授权', producePlatform: '外部采购', baseFee: '¥9,500', checkFee: '¥600', dubFee: '¥4,200', aiDubUnit: '¥120/集', aiDubFee: '¥960', authTime: '2026-09-06', remark: '', publishStatus: 'processing', url: 'https://youtu.be/v2_Mn9qR3s', time: '2026-09-06 15:40:11' },
  { contentId: 'media_g7h8i9', videoId: 'v3_Tu4wX5y', subtitleLangs: ['en', 'es', 'pt', 'id', 'th', 'vi'], collectionName: '隐婚总裁', owner: '张梦圆', language: '英语', gender: '女', supplier: '星辰文化', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥15,000', checkFee: '¥800', dubFee: '¥5,000', aiDubUnit: '¥150/集', aiDubFee: '¥1,800', authTime: '2026-08-30', remark: '甜宠赛道主力', publishStatus: 'completed', url: 'https://youtu.be/v3_Tu4wX5y', time: '2026-08-30 09:22:45' },
  { contentId: 'media_j0k1l2', videoId: 'v4_Za6bC7d', subtitleLangs: [], collectionName: '战神归来', owner: '张梦圆', language: '中文', gender: '男', supplier: '蓝鲸传媒', purchaseVersion: '分账授权', producePlatform: '外部采购', baseFee: '¥8,800', checkFee: '¥500', dubFee: '¥2,600', aiDubUnit: '¥100/集', aiDubFee: '¥800', authTime: '2026-08-25', remark: '', publishStatus: 'completed', url: 'https://youtu.be/v4_Za6bC7d', time: '2026-08-25 14:05:38' },
  { contentId: 'media_m3n4o5', videoId: 'v5_Ef8gH9i', subtitleLangs: ['en', 'es'], collectionName: '千年狐妖', owner: '王思远', language: '韩语', gender: '女', supplier: '星辰文化', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥13,200', checkFee: '¥800', dubFee: '¥4,800', aiDubUnit: '¥150/集', aiDubFee: '¥1,500', authTime: '2026-08-18', remark: '玄幻仙侠重点档', publishStatus: 'completed', url: 'https://youtu.be/v5_Ef8gH9i', time: '2026-08-18 11:30:00' },
  { contentId: 'media_p6q7r8', videoId: 'v6_Jk0lM1n', subtitleLangs: [], collectionName: '邪王追妻', owner: '王思远', language: '英语', gender: '女', supplier: '蓝鲸传媒', purchaseVersion: '分账授权', producePlatform: '外部采购', baseFee: '¥7,600', checkFee: '¥500', dubFee: '¥3,200', aiDubUnit: '¥120/集', aiDubFee: '¥1,080', authTime: '2026-09-02', remark: '上传中断待重试', publishStatus: 'failed', url: 'https://youtu.be/v6_Jk0lM1n', time: '2026-09-02 16:48:22' },
  { contentId: 'media_s9t0u1', videoId: 'v7_Op2qR3s', subtitleLangs: ['en'], collectionName: '都市高手', owner: '刘桐金', language: '英语', gender: '男', supplier: '杭州容量互娱', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥11,000', checkFee: '¥600', dubFee: '¥3,800', aiDubUnit: '¥120/集', aiDubFee: '¥1,320', authTime: '2026-09-04', remark: '网络超时失败', publishStatus: 'failed', url: 'https://youtu.be/v7_Op2qR3s', time: '2026-09-04 10:15:44' },
  { contentId: 'media_v2w3x4', videoId: 'v8_Tu4vW5x', subtitleLangs: ['en', 'es'], collectionName: '豪门千金', owner: '张梦圆', language: '韩语', gender: '女', supplier: '九州文创', purchaseVersion: '分账授权', producePlatform: '外部采购', baseFee: '¥6,800', checkFee: '¥500', dubFee: '¥2,400', aiDubUnit: '¥100/集', aiDubFee: '¥600', authTime: '2026-07-12', remark: '因版权争议被平台拒绝', publishStatus: 'rejected', url: 'https://youtu.be/v8_Tu4vW5x', time: '2026-07-12 13:26:09' },
  { contentId: 'media_y5z6a7', videoId: 'v9_Yz6aB7c', subtitleLangs: [], collectionName: '星际战士', owner: '王思远', language: '中文', gender: '男', supplier: '蓝鲸传媒', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥14,500', checkFee: '¥800', dubFee: '¥5,200', aiDubUnit: '¥150/集', aiDubFee: '¥2,100', authTime: '2026-06-28', remark: '内容审核未通过', publishStatus: 'rejected', url: 'https://youtu.be/v9_Yz6aB7c', time: '2026-06-28 17:52:31' },
  { contentId: 'media_b8c9d0', videoId: 'v10_Cd8eF9g', subtitleLangs: ['en'], collectionName: '甜宠来袭', owner: '刘桐金', language: '英语', gender: '女', supplier: '星辰文化', purchaseVersion: '分账授权', producePlatform: '外部采购', baseFee: '¥9,200', checkFee: '¥600', dubFee: '¥3,000', aiDubUnit: '¥120/集', aiDubFee: '¥960', authTime: '2026-08-05', remark: '已下架处理', publishStatus: 'deleted', url: 'https://youtu.be/v10_Cd8eF9g', time: '2026-08-05 09:44:17' },
  { contentId: 'media_e1f2g3', videoId: 'v11_Gh0iJ1k', subtitleLangs: [], collectionName: '逆袭之巅', owner: '张梦圆', language: '韩语', gender: '男', supplier: '九州文创', purchaseVersion: '独家买断', producePlatform: '容量自研', baseFee: '¥12,800', checkFee: '¥800', dubFee: '¥4,500', aiDubUnit: '¥150/集', aiDubFee: '¥1,650', authTime: '2026-08-12', remark: '渠道调整主动删除', publishStatus: 'deleted', url: 'https://youtu.be/v11_Gh0iJ1k', time: '2026-08-12 16:08:53' }
];

function getCollectionNameById(id) {
  if (!id) return '';
  const sel = $('#collectionId');
  if (!sel) return id;
  const opt = sel.querySelector(`option[value="${id}"]`);
  return opt ? opt.textContent : id;
}

function saveRecord(record) {
  const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
  // 新记录默认发布状态:处理中(等待 YouTube 处理,由 pollProcessingStatus 后续流转)
  if (!record.publishStatus || !PUBLISH_STATUS[record.publishStatus]) record.publishStatus = 'processing';
  records.unshift(record);
  if (records.length > 50) records.length = 50;
  localStorage.setItem('yt_upload_records', JSON.stringify(records));
  renderHistory();
}

// ─── 字幕语言统计(记录字段 subtitleLangs) ───────────────────
// 来源 1:发布视频时上传字幕成功(uploadCaptions)
// 来源 2:字幕操作台自动翻译成功(日志解析,见 subtitleParseOkLangs)
// 两路合并去重,列表「字幕语言」列展示数量,hover 展示语言名称

// 语言代码 → 展示名映射。注意:本表会被 renderHistory 顶层首次渲染时用到,
// 而 subtitleState/SUBTITLE_LANGS_FALLBACK 定义在文件后面(顶层调用时处于
// 暂时性死区),所以这里只依赖本表 + try/catch 惰性访问操作台语言表
const CAPTION_LANG_NAMES = {
  'zh-CN': '中文（简体）', 'zh-TW': '中文（繁体）',
  'zh-Hans': '中文简体', 'zh-Hant': '中文繁體',
  en: '英语', ja: '日语', ko: '韩语', es: '西班牙语', fr: '法语', de: '德语',
  pt: '葡萄牙语', ru: '俄语', ar: '阿拉伯语', hi: '印地语', th: '泰语',
  vi: '越南语', id: '印尼语', ms: '马来语', fil: '菲律宾语', tr: '土耳其语'
};

// 语言代码 → 展示名(优先操作台语言表,其次本地映射,兜底显示代码本身)
function subtitleLangName(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  let label = '';
  try {
    const hit = (subtitleState.langs || []).find(l => l.code === c);
    if (hit) label = String(hit.label || '').split(' ')[0];
  } catch (e) { /* subtitleState 未初始化(顶层 seed 渲染)时走本地映射 */ }
  return label || CAPTION_LANG_NAMES[c] || c;
}

// 多语言代码 → tooltip 文本(如「英语、西班牙语、葡萄牙语」)
function subtitleLangNamesText(codes) {
  return (codes || []).map(subtitleLangName).filter(Boolean).join('、');
}

// 把成功新增的字幕语言合并进记录(按 videoId 定位;不在列表的视频静默跳过;幂等)
function updateRecordSubtitleLangs(videoId, langs) {
  const vid = String(videoId || '').trim();
  const add = (Array.isArray(langs) ? langs : []).map(l => String(l).trim()).filter(Boolean);
  if (!vid || !add.length) return false;
  const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
  const rec = records.find(r => r.videoId === vid);
  if (!rec) return false;
  const before = Array.isArray(rec.subtitleLangs) ? rec.subtitleLangs : [];
  const merged = [...new Set(before.concat(add))];
  if (merged.length === before.length) return false;   // 无新增,不写不重渲
  rec.subtitleLangs = merged;
  localStorage.setItem('yt_upload_records', JSON.stringify(records));
  renderHistory();
  return true;
}

function getHistoryRecords() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem('yt_upload_records'));
  } catch (e) { data = null; }

  // 版本化 seed 合并:seed 版本升级时,先清理旧结构的 seed 记录
  // (contentId 命中 seed 且缺 supplier 字段 = 旧版本种子),再把新 seed 合并进来,
  // 用户真实上传记录(contentId 随机生成,带 title/videoId 等字段)不受影响。
  // 删除 seed 记录后因版本标记已写入,不会被反复回填。
  const SEED_VERSION = 'v3-subtitle-langs';
  if (localStorage.getItem('yt_upload_records_seed_v') !== SEED_VERSION) {
    const seedIds = new Set(HISTORY_SEED.map(s => s.contentId));
    const seedById = Object.fromEntries(HISTORY_SEED.map(s => [s.contentId, s]));
    const existing = (Array.isArray(data) ? data : [])
      .filter(r => !(seedIds.has(r.contentId) && r.supplier === undefined));
    // 字幕语言字段回填:老 seed 记录没有 subtitleLangs,补上 seed 里的演示值
    // (用户真实记录/手动删除的 seed 不受影响,只补 undefined 的情况)
    existing.forEach(r => {
      const seed = seedById[r.contentId];
      if (seed && r.subtitleLangs === undefined) r.subtitleLangs = seed.subtitleLangs || [];
    });
    const existingIds = new Set(existing.map(r => r.contentId));
    const merged = existing.concat(HISTORY_SEED.filter(s => !existingIds.has(s.contentId)));
    localStorage.setItem('yt_upload_records', JSON.stringify(merged));
    localStorage.setItem('yt_upload_records_seed_v', SEED_VERSION);
    data = merged;
  }

  if (!Array.isArray(data)) data = [];
  return data;
}

function populateHistoryFilterOptions() {
  const records = getHistoryRecords();
  const unique = (key) => [...new Set(records.map(r => r[key]).filter(Boolean))].sort();

  // 注意:频道管理页也有同名 ID(#filterOwner/#filterLanguage/#filterGender),
  // 必须限定在 #historyFilter 容器内查询,避免命中频道页的同名元素
  const root = $('#historyFilter');
  if (!root) return;
  const ownerSel = $('#filterOwner', root);
  const langSel = $('#filterLanguage', root);
  const genderSel = $('#filterGender', root);
  const supplierSel = $('#filterHistorySupplier', root);
  if (ownerSel) {
    const val = ownerSel.value;
    ownerSel.innerHTML = '<option value="">请选择</option>' +
      unique('owner').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    ownerSel.value = val;
  }
  if (langSel) {
    const val = langSel.value;
    langSel.innerHTML = '<option value="">请选择</option>' +
      unique('language').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    langSel.value = val;
  }
  if (genderSel) {
    const val = genderSel.value;
    genderSel.innerHTML = '<option value="">请选择</option>' +
      unique('gender').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    genderSel.value = val;
  }
  if (supplierSel) {
    const val = supplierSel.value;
    supplierSel.innerHTML = '<option value="">请选择</option>' +
      unique('supplier').map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    supplierSel.value = val;
  }
}

function getHistoryFilters() {
  // 限定在 #historyFilter 容器内查询(避免命中频道页的同名 ID 元素)
  const root = $('#historyFilter');
  const q = (sel) => $(sel, root);
  return {
    contentId: (q('#filterContentId')?.value || '').trim().toLowerCase(),
    collectionName: (q('#filterCollectionName')?.value || '').trim().toLowerCase(),
    owner: (q('#filterOwner')?.value || '').trim(),
    language: (q('#filterLanguage')?.value || '').trim(),
    gender: (q('#filterGender')?.value || '').trim(),
    supplier: (q('#filterHistorySupplier')?.value || '').trim(),
    videoId: (q('#filterVideoId')?.value || '').trim().toLowerCase(),
    authTimeStart: (q('#filterAuthTimeStart')?.value || '').trim(),
    authTimeEnd: (q('#filterAuthTimeEnd')?.value || '').trim()
  };
}

function filterHistoryRecords(records) {
  const f = getHistoryFilters();
  return records.filter(r => {
    if (f.contentId && !(r.contentId || '').toLowerCase().includes(f.contentId)) return false;
    if (f.collectionName && !(r.collectionName || '').toLowerCase().includes(f.collectionName)) return false;
    if (f.owner && (r.owner || '') !== f.owner) return false;
    if (f.language && (r.language || '') !== f.language) return false;
    if (f.gender && (r.gender || '') !== f.gender) return false;
    if (f.supplier && (r.supplier || '') !== f.supplier) return false;
    if (f.videoId && !(r.videoId || '').toLowerCase().includes(f.videoId)) return false;
    if (f.authTimeStart && (r.authTime || '') < f.authTimeStart) return false;
    if (f.authTimeEnd && (r.authTime || '') > f.authTimeEnd) return false;
    return true;
  });
}

// 批量字幕翻译的勾选状态：按 videoId 记忆（跨筛选/重渲染保留）
const historySelection = new Set();

function updateHistoryBatchBar(filtered) {
  const bar = $('#historyBatchBar');
  if (!bar) return;
  // 剔除已从列表消失/被删除的勾选项
  const validIds = new Set(filtered.filter(r => r.videoId && getPublishStatus(r) !== 'deleted').map(r => r.videoId));
  for (const id of Array.from(historySelection)) {
    if (!validIds.has(id)) historySelection.delete(id);
  }
  const n = historySelection.size;
  const cnt = $('#historyBatchCount');
  if (cnt) cnt.textContent = `已选 ${n} 个视频`;
  const btn = $('#btnBatchSubtitle');
  if (btn) btn.disabled = n === 0;
  const all = $('#historyCheckAll');
  if (all) {
    const eligible = filtered.filter(r => r.videoId && getPublishStatus(r) !== 'deleted');
    all.checked = eligible.length > 0 && eligible.every(r => historySelection.has(r.videoId));
    all.indeterminate = n > 0 && !(all.checked);
  }
}

function renderHistory() {
  const records = getHistoryRecords();
  const grid = $('#historyGrid');
  const wrap = $('#historyTableWrap');
  const tbody = $('#historyTableBody');
  if (!grid || !wrap || !tbody) return;

  populateHistoryFilterOptions();
  const filtered = filterHistoryRecords(records);
  updateHistoryBatchBar(filtered);

  if (filtered.length === 0) {
    grid.style.display = 'block';
    wrap.style.display = 'none';
    // 如果原本有记录但筛选为空，保留筛选栏可见
    return;
  }

  grid.style.display = 'none';
  wrap.style.display = 'block';

  const empty = (v) => v ? escapeHtml(String(v)) : '<span class="cell-empty">—</span>';

  tbody.innerHTML = filtered.map(r => {
    const originalIdx = records.indexOf(r);
    const st = getPublishStatus(r);
    return `
    <tr>
      <td class="col-check" data-page-node-id="tdCheck001">${(() => {
        const no = !r.videoId || st === 'deleted';
        const tip = !r.videoId ? '该行没有关联视频ID，无法批量翻译' : '勾选后可批量翻译字幕';
        return `<input type="checkbox" class="row-check" data-video-id="${escapeHtml(r.videoId || '')}"${no ? ' disabled' : ''}${historySelection.has(r.videoId) ? ' checked' : ''} title="${tip}">`;
      })()}</td>
      <td class="cell-content-id">${empty(r.contentId)}</td>
      <td>${empty(r.collectionName)}</td>
      <td>${empty(r.owner)}</td>
      <td>${empty(r.language)}</td>
      <td>${empty(r.gender)}</td>
      <td>${empty(r.supplier)}</td>
      <td>${empty(r.purchaseVersion)}</td>
      <td>${empty(r.producePlatform)}</td>
      <td>${empty(r.baseFee)}</td>
      <td>${empty(r.checkFee)}</td>
      <td>${empty(r.dubFee)}</td>
      <td>${empty(r.aiDubUnit)}</td>
      <td>${empty(r.aiDubFee)}</td>
      <td class="cell-video-id">${empty(r.videoId)}</td>
      <td>${empty(r.authTime)}</td>
      <td>${empty(r.remark)}</td>
      <td class="col-action">
        <div class="action-btns">
          ${(() => {
            // 字幕翻译需要真实视频：没有关联视频ID 或已删除的记录置灰
            const no = !r.videoId || st === 'deleted';
            const tip = !r.videoId ? '该行没有关联视频ID，无法翻译字幕' : (st === 'deleted' ? '该记录已删除，无法翻译字幕' : '打开字幕操作台');
            return `<button class="btn-subtitle" data-subtitle-idx="${originalIdx}"${no ? ' disabled' : ''} title="${tip}">字幕翻译</button>`;
          })()}
          <button class="btn-edit" data-edit-idx="${originalIdx}">编辑</button>
          <button class="btn-delete" data-delete-idx="${originalIdx}">删除</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  // 行勾选（批量字幕翻译）：按 videoId 记忆，重渲染后状态不丢
  $$('.row-check', tbody).forEach(chk => {
    chk.addEventListener('change', () => {
      const vid = chk.dataset.videoId;
      if (!vid) return;
      if (chk.checked) historySelection.add(vid);
      else historySelection.delete(vid);
      updateHistoryBatchBar(filtered);
    });
  });

  // 表头全选（只勾有视频ID且未删除的行）
  const checkAll = $('#historyCheckAll');
  if (checkAll) {
    checkAll.onchange = null;
    checkAll.addEventListener('change', () => {
      filtered.forEach(r => {
        if (!r.videoId || getPublishStatus(r) === 'deleted') return;
        if (checkAll.checked) historySelection.add(r.videoId);
        else historySelection.delete(r.videoId);
      });
      renderHistory();
    });
  }

  // 批量字幕翻译：把勾选记录（视频ID + 频道ID）带进抽屉批量执行
  const batchBtn = $('#btnBatchSubtitle');
  if (batchBtn) {
    batchBtn.onclick = null;
    batchBtn.addEventListener('click', () => {
      const items = filtered
        .filter(r => r.videoId && historySelection.has(r.videoId) && getPublishStatus(r) !== 'deleted')
        .map(r => ({
          videoId: r.videoId,
          channelId: r.channelId || '',
          channelTitle: r.channelTitle || '',
          contentId: r.contentId || '',
          collectionName: r.collectionName || '',
          language: r.language || ''
        }));
      if (!items.length) {
        showToast('请先勾选含有视频ID的记录', 'error');
        return;
      }
      openSubtitleBatchDrawer(items);
    });
  }

  // 字幕翻译(打开右侧全屏抽屉,需要该行有真实视频)
  $$('.btn-subtitle', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      openSubtitleDrawer(parseInt(btn.dataset.subtitleIdx, 10));
    });
  });

  // 删除(软删除:状态标记为「删除」;已删除的再删则彻底移除)
  $$('.btn-delete', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.deleteIdx, 10);
      const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
      const r = records[idx];
      if (!r) return;
      if (getPublishStatus(r) === 'deleted') {
        if (!confirm('该记录已标记为「删除」，确定彻底删除吗？')) return;
        records.splice(idx, 1);
      } else {
        if (!confirm('确定删除这条记录吗？删除后状态将标记为「删除」。')) return;
        r.publishStatus = 'deleted';
      }
      localStorage.setItem('yt_upload_records', JSON.stringify(records));
      renderHistory();
    });
  });

  // 编辑
  $$('.btn-edit', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      openHistoryEditModal(parseInt(btn.dataset.editIdx, 10));
    });
  });
}

renderHistory();

// 绑定视频库筛选按钮
(function bindHistoryFilter() {
  const applyBtn = $('#btnApplyHistoryFilter');
  const resetBtn = $('#btnResetHistoryFilter');
  if (applyBtn) applyBtn.addEventListener('click', renderHistory);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // 限定在 #historyFilter 容器内(避免命中频道页的同名 ID 元素)
      const root = $('#historyFilter');
      ['#filterContentId', '#filterCollectionName', '#filterOwner', '#filterLanguage',
       '#filterGender', '#filterHistorySupplier', '#filterVideoId',
       '#filterAuthTimeStart', '#filterAuthTimeEnd'].forEach(sel => {
        const el = $(sel, root);
        if (el) el.value = '';
      });
      renderHistory();
    });
  }
})();

// ─── 视频编辑弹窗 ───────────────────────────
let _historyEditIndex = -1;

// ─── 发布内容关联表:导入/导出 ───────────────────────────
let _importBuffer = null; // { fileName, records }

function exportHistory() {
  const records = getHistoryRecords();
  if (!records || records.length === 0) {
    showToast('当前没有可导出的数据', 'warn');
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 'yt_history_export_v1',
    recordCount: records.length,
    records
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `发布内容关联表_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已导出 ${records.length} 条记录`, 'success');
}

// 触发文件选择(每次动态创建 file input,允许多次选择同一文件)
function pickHistoryImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    document.body.removeChild(input);
    if (!file) return;
    handleHistoryImportFile(file);
  });
  input.click();
}

function handleHistoryImportFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    showToast('文件超过 20MB，请检查文件是否正确', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    let parsed;
    try {
      parsed = JSON.parse(e.target.result);
    } catch (err) {
      showToast('JSON 解析失败：' + err.message, 'error');
      return;
    }
    // 兼容两种格式: { records: [...] } 或 直接数组
    let records;
    if (Array.isArray(parsed)) {
      records = parsed;
    } else if (parsed && Array.isArray(parsed.records)) {
      records = parsed.records;
    } else {
      showToast('文件格式无效：未找到记录数组', 'error');
      return;
    }
    // 过滤掉明显无效的记录
    const valid = records.filter(r => r && typeof r === 'object');
    if (valid.length === 0) {
      showToast('文件中没有有效的记录', 'warn');
      return;
    }
    _importBuffer = { fileName: file.name, records: valid };
    openHistoryImportModal();
  };
  reader.onerror = () => showToast('读取文件失败', 'error');
  reader.readAsText(file);
}

function openHistoryImportModal() {
  if (!_importBuffer) return;
  const { fileName, records } = _importBuffer;
  const nameEl = $('#importFileName');
  const countEl = $('#importFileCount');
  const listEl = $('#importPreviewList');
  if (nameEl) nameEl.textContent = fileName;
  if (countEl) countEl.textContent = `${records.length} 条`;
  // 预览前 3 条
  if (listEl) {
    if (records.length === 0) {
      listEl.innerHTML = '<li class="preview-empty">没有可预览的记录</li>';
    } else {
      listEl.innerHTML = records.slice(0, 3).map(r => {
        const cid = escapeHtml(r.contentId || '—');
        const name = escapeHtml(r.collectionName || r.title || r.videoId || '—');
        const supplier = r.supplier ? `供应商: ${escapeHtml(r.supplier)}` : '';
        const status = r.publishStatus ? `状态: ${escapeHtml(getPublishStatus(r))}` : '';
        const extra = [supplier, status].filter(Boolean).join(' · ');
        return `<li>
          <span class="preview-cid">${cid}</span>
          <span class="preview-name">${name}</span>
          ${extra ? `<span class="preview-extra">${extra}</span>` : ''}
        </li>`;
      }).join('');
    }
  }
  // 默认选中合并
  const mergeRadio = document.querySelector('input[name="importStrategy"][value="merge"]');
  if (mergeRadio) mergeRadio.checked = true;
  const mask = $('#historyImportMask');
  if (mask) mask.style.display = 'flex';
}

function closeHistoryImportModal() {
  const mask = $('#historyImportMask');
  if (mask) mask.style.display = 'none';
  _importBuffer = null;
}

function confirmImport() {
  if (!_importBuffer) return;
  const { records: incoming } = _importBuffer;
  const strategy = (document.querySelector('input[name="importStrategy"]:checked') || {}).value || 'merge';
  const existing = getHistoryRecords();
  const existingMap = new Map(existing.map(r => [r.contentId, r]));
  let added = 0, updated = 0, skipped = 0;
  let merged;
  if (strategy === 'append') {
    merged = existing.slice();
    incoming.forEach(r => {
      if (existingMap.has(r.contentId)) {
        skipped++;
      } else {
        merged.push(r);
        added++;
      }
    });
  } else {
    // merge: 导入数据优先,按 contentId 去重
    const incomingMap = new Map(incoming.map(r => [r.contentId, r]));
    merged = existing.map(r => incomingMap.has(r.contentId) ? incomingMap.get(r.contentId) : r);
    incoming.forEach(r => {
      if (!existingMap.has(r.contentId)) {
        merged.push(r);
        added++;
      } else {
        updated++;
      }
    });
  }
  // 上限保护:最多 200 条
  if (merged.length > 200) merged = merged.slice(0, 200);
  localStorage.setItem('yt_upload_records', JSON.stringify(merged));
  // 不更新 seed 版本标记,避免下次启动重新合并
  closeHistoryImportModal();
  renderHistory();
  const tip = strategy === 'append'
    ? `已新增 ${added} 条,跳过 ${skipped} 条重复`
    : `已合并: 新增 ${added} 条,覆盖 ${updated} 条`;
  showToast(tip, 'success');
}

// 绑定导入/导出按钮
(function bindHistoryImportExport() {
  const exportBtn = $('#btnExportHistory');
  if (exportBtn) exportBtn.addEventListener('click', exportHistory);
  const importBtn = $('#btnImportHistory');
  if (importBtn) importBtn.addEventListener('click', pickHistoryImportFile);
  const confirmBtn = $('#btnConfirmImport');
  if (confirmBtn) confirmBtn.addEventListener('click', confirmImport);
})();

function openHistoryEditModal(idx) {
  const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
  if (idx < 0 || idx >= records.length) return;
  _historyEditIndex = idx;
  const r = records[idx];

  $('#heContentId').value = r.contentId || '';
  $('#heVideoId').value = r.videoId || '';
  $('#heCollectionName').value = r.collectionName || '';
  $('#heOwner').value = r.owner || '';
  $('#heLanguage').value = r.language || '';
  $('#heGender').value = r.gender || '';
  // 供应商下拉:选项来自现有记录去重,并确保当前值可选
  const heSupplierSel = $('#heSupplier');
  if (heSupplierSel) {
    const supplierOptions = [...new Set(records.map(x => x.supplier).filter(Boolean))].sort();
    if (r.supplier && !supplierOptions.includes(r.supplier)) supplierOptions.push(r.supplier);
    heSupplierSel.innerHTML = '<option value="">请选择</option>' +
      supplierOptions.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    heSupplierSel.value = r.supplier || '';
  }
  $('#hePurchaseVersion').value = r.purchaseVersion || '';
  $('#heProducePlatform').value = r.producePlatform || '';
  $('#heBaseFee').value = r.baseFee || '';
  $('#heCheckFee').value = r.checkFee || '';
  $('#heDubFee').value = r.dubFee || '';
  $('#heAiDubUnit').value = r.aiDubUnit || '';
  $('#heAiDubFee').value = r.aiDubFee || '';
  $('#heAuthTime').value = r.authTime || '';
  $('#heRemark').value = r.remark || '';

  $('#historyEditMask').style.display = 'flex';
  setTimeout(() => $('#heCollectionName').focus(), 150);
}

function closeHistoryEditModal() {
  $('#historyEditMask').style.display = 'none';
  _historyEditIndex = -1;
}

function saveHistoryEdit() {
  if (_historyEditIndex < 0) return;
  const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
  if (_historyEditIndex >= records.length) return;

  const r = records[_historyEditIndex];
  r.collectionName = $('#heCollectionName').value.trim();
  r.owner = $('#heOwner').value.trim();
  r.language = $('#heLanguage').value.trim();
  r.gender = $('#heGender').value.trim();
  r.supplier = $('#heSupplier').value.trim();
  r.purchaseVersion = $('#hePurchaseVersion').value.trim();
  r.producePlatform = $('#heProducePlatform').value.trim();
  r.baseFee = $('#heBaseFee').value.trim();
  r.checkFee = $('#heCheckFee').value.trim();
  r.dubFee = $('#heDubFee').value.trim();
  r.aiDubUnit = $('#heAiDubUnit').value.trim();
  r.aiDubFee = $('#heAiDubFee').value.trim();
  r.authTime = $('#heAuthTime').value.trim();
  r.remark = $('#heRemark').value.trim();

  localStorage.setItem('yt_upload_records', JSON.stringify(records));
  closeHistoryEditModal();
  renderHistory();
  showToast('视频信息已更新', 'success');
}

// 绑定保存按钮
(function bindHistoryEditSave() {
  const btn = $('#btnSaveHistoryEdit');
  if (btn) btn.addEventListener('click', saveHistoryEdit);
})();

// ─── Toast ───────────────────────────────────
function showToast(msg, type = 'info', duration = 4000) {
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-msg">${msg}</span>
  `;
  $('#toastContainer').appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ─── Loading ─────────────────────────────────
// 全部做空值保护：任何 DOM 缺失/异常都不能让蒙层卡死或抛出新的异常
function showLoading(text) {
  const overlay = $('#loadingOverlay');
  if (!overlay) return;
  const t = $('#loadingText');
  if (t) t.textContent = text;
  const ring = $('#loadingRing');
  if (ring) ring.style.display = 'block';
  const bar = $('#loadingProgressBar');
  if (bar) bar.style.display = 'none';
  overlay.classList.add('active');
}
function showUploadProgress(percent) {
  const ring = $('#loadingRing');
  if (ring) ring.style.display = 'none';
  const bar = $('#loadingProgressBar');
  if (bar) bar.style.display = 'flex';
  const t = $('#loadingText');
  if (t) t.textContent = '正在上传视频到 YouTube...';
  const fill = $('#loadingProgressFill');
  if (fill) fill.style.width = percent + '%';
  const pt = $('#loadingProgressText');
  if (pt) pt.textContent = percent + '%';
}
function hideLoading() {
  const overlay = $('#loadingOverlay');
  if (overlay) overlay.classList.remove('active');
  // 兜底：收掉任何仍处于显示状态却无可见卡片的弹窗遮罩（避免整页被锁死）
  forceCloseStuckMasks();
}

// ─── 蒙层自愈 ─────────────────────────────────
// 症状：某弹窗遮罩（.modal-mask / .sub-drawer-mask）显示出来了，但里面卡片/抽屉
// 没渲染或不可见 → 整页被均匀压暗且无法操作。这里做两件事：
//   1) Esc / 全局异常时强制收掉这类“显示中但无可见卡片”的遮罩
//   2) 周期巡检：遮罩显示超过 2.5s 仍无可见卡片，自动关闭
function _isMaskVisible(el) {
  if (!el) return false;
  try {
    const s = getComputedStyle(el);
    if (s.display === 'none' || parseFloat(s.opacity) <= 0.01) return false;
    const r = el.getBoundingClientRect();
    return r.width > 50 && r.height > 50;
  } catch (e) { return false; }
}
function _hasVisibleCard(mask) {
  // 卡片：modal-card 或 sub-drawer（必须真实可见：存在、显示、不透明、在视口内）
  const card = mask.querySelector('.modal-card, .sub-drawer');
  if (!card) return false;
  const cs = getComputedStyle(card);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const op = parseFloat(cs.opacity);
  if (isNaN(op) || op < 0.05) return false;
  const r = card.getBoundingClientRect();
  if (r.width < 50 || r.height < 20) return false;
  const vw = innerWidth, vh = innerHeight;
  if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return false;
  return true;
}
// 指令库「适用频道」抽屉是挂在指令编辑弹窗里的二级层：父弹窗关掉后它必须一起消失，
// 否则 .ins-drawer-mask（inset:0 + z-index:1000）会变成孤立全屏遮罩，整页无法点击。
function _closeOrphanInsDrawer() {
  const drawer = document.getElementById('insChDrawerMask');
  if (!drawer) return;
  if (!_isMaskVisible(drawer)) return;
  const edit = document.getElementById('insEditMask');
  if (!edit || !_isMaskVisible(edit)) drawer.style.display = 'none';
}

function forceCloseStuckMasks() {
  try {
    document.querySelectorAll('.modal-mask, .sub-drawer-mask').forEach(m => {
      if (_isMaskVisible(m) && !_hasVisibleCard(m)) m.style.display = 'none';
    });
    _closeOrphanInsDrawer();
  } catch (e) { /* noop */ }
}
// BFCache 恢复（浏览器前进/后退、或从登录页返回）不会重新触发 DOMContentLoaded，
// 页面会带着上一次的 DOM 与 JS 状态回来，可能残留全屏遮罩 → 这里补一次清理。
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  try { forceCloseStuckMasks(); } catch (err) { /* noop */ }
});

const _stuckMaskSeenAt = new WeakMap();
setInterval(() => {
  try {
    document.querySelectorAll('.modal-mask, .sub-drawer-mask').forEach(m => {
      if (_isMaskVisible(m)) {
        if (!_hasVisibleCard(m)) {
          const t = _stuckMaskSeenAt.get(m) || Date.now();
          _stuckMaskSeenAt.set(m, t);
          if (Date.now() - t > 1500) {
            console.warn('[self-heal] 关闭无卡片的残留遮罩:', m.id || m.className);
            m.style.display = 'none';
          }
        } else {
          _stuckMaskSeenAt.delete(m);
        }
      } else {
        _stuckMaskSeenAt.delete(m);
      }
    });
    _closeOrphanInsDrawer();
  } catch (e) { /* noop */ }
}, 500);

// 全局兜底：脚本异常 / 未捕获的 Promise 拒绝时，避免 loading 蒙层卡住整页无法操作
window.addEventListener('error', () => { try { hideLoading(); } catch (e) { /* noop */ } });
window.addEventListener('unhandledrejection', () => { try { hideLoading(); } catch (e) { /* noop */ } });
// 按 Esc 强制清掉加载蒙层 / 无卡片的残留弹窗遮罩（自救快捷键）
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = $('#loadingOverlay');
  if (overlay && overlay.classList.contains('active')) hideLoading();
  forceCloseStuckMasks();
});

// ─── loading 蒙层自检 ───────────────────────────
// 仅在「处理中」小圈在转（ring 可见）、超过 12s 仍不结束才自动关闭。
// 真实上传会切换到进度条（隐藏 ring），不会被误关。
const _loadingStuckSeenAt = new WeakMap();
setInterval(() => {
  try {
    const ov = $('#loadingOverlay');
    if (ov && ov.classList.contains('active')) {
      const ring = $('#loadingRing');
      const ringVisible = !ring || ring.style.display !== 'none';
      if (ringVisible) {
        const t = _loadingStuckSeenAt.get(ov) || Date.now();
        _loadingStuckSeenAt.set(ov, t);
        if (Date.now() - t > 12000) {
          console.warn('[self-heal] 关闭卡死的 loading 蒙层');
          ov.classList.remove('active');
        }
      } else {
        _loadingStuckSeenAt.delete(ov);
      }
    } else {
      _loadingStuckSeenAt.delete(ov);
    }
  } catch (e) { /* noop */ }
}, 1000);

// ─── XMLHttpRequest 上传（带进度）─────────────
function uploadFileWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    // 监听上传进度
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        showUploadProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      hideLoading();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('响应解析失败'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `上传失败 (${xhr.status})`));
        } catch {
          reject(new Error(`上传失败 (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      hideLoading();
      reject(new Error('网络错误，上传中断'));
    });

    xhr.addEventListener('abort', () => {
      hideLoading();
      reject(new Error('上传已取消'));
    });

    xhr.send(formData);
  });
}

// ─── Util ────────────────────────────────────
function escapeHtml(s) {
  // 兜底转字符串：localStorage 里若有数字/布尔字段，直接 .replace 会抛错并导致整表渲染失败
  if (s === null || s === undefined || s === '') return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ─── 翻译合成视频 ─────────────────────────────
const TRANSLATION_STORAGE_KEY = 'yt_translation_collections';

// 首次使用的示例数据（含 10 个合集）
const TRANSLATION_SEED = [
  { id: 'TS001', name: '逆袭之巅', linkedCollection: '产品评测', operator: '王雪', intro: '都市逆袭题材，男主从底层一路逆袭成为商业巨擘，剧情紧凑、反转密集，适配海外观众口味。', createdAt: '2026-08-07 11:37:45', episodes: [
      { language: '英语', template: '模板三', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-08-07 11:37:45' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-07-23 20:14:15' },
      { language: '英语', template: '模板一', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-07-23 16:01:32' },
      { language: '英语', template: '模板二', type: 'AI配音音频', outputType: '音频', progress: '成功', createdAt: '2026-07-21 14:49:09' }
  ]},
  { id: 'TS002', name: '重生医妃', linkedCollection: '教程系列', operator: '李强', intro: '古装重生题材，女主重生后逆天改命，医毒双绝，情感线虐中带甜。', createdAt: '2026-07-23 20:10:47', episodes: [
      { language: '英语', template: '模板一', type: 'AI配音音频', outputType: '音频', progress: '成功', createdAt: '2026-07-23 20:10:47' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-07-21 15:47:44' },
      { language: '韩语', template: '模板二', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-06-25 20:41:55' }
  ]},
  { id: 'TS003', name: '隐婚总裁', linkedCollection: 'Vlog 日常', operator: '王雪', intro: '现代言情，总裁与隐婚妻子的甜宠日常，高甜高能。', createdAt: '2026-06-25 20:42:16', episodes: [
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-06-25 20:42:10' },
      { language: '韩语', template: '—', type: '字幕压制', outputType: '视频', progress: '成功', createdAt: '2026-06-25 20:41:26' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-06-25 20:42:16' }
  ]},
  { id: 'TS004', name: '战神归来', linkedCollection: '产品评测', operator: '赵敏', intro: '兵王回归都市，扮猪吃虎，护妻狂魔，爽点密集。', createdAt: '2026-06-20 09:15:22', episodes: [
      { language: '英语', template: '模板三', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-06-20 09:15:22' },
      { language: '韩语', template: '模板一', type: 'AI配音视频', outputType: '视频', progress: '合成中', createdAt: '2026-06-20 10:02:11' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '失败', createdAt: '2026-06-20 11:40:08' }
  ]},
  { id: 'TS005', name: '千年狐妖', linkedCollection: '开箱体验', operator: '李强', intro: '玄幻仙侠，千年狐妖化形入世，与捉妖师相爱相杀。', createdAt: '2026-06-15 14:33:50', episodes: [
      { language: '英语', template: '模板二', type: 'AI配音音频', outputType: '音频', progress: '成功', createdAt: '2026-06-15 14:33:50' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-06-15 15:01:29' }
  ]},
  { id: 'TS006', name: '邪王追妻', linkedCollection: '教程系列', operator: '陈晨', intro: '古言虐恋，邪王与小娇妻的相爱相杀与追妻火葬场。', createdAt: '2026-06-10 08:20:00', episodes: [
      { language: '韩语', template: '模板三', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-06-10 08:20:00' },
      { language: '英语', template: '模板一', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-06-10 09:05:41' }
  ]},
  { id: 'TS007', name: '都市高手', linkedCollection: '游戏实况', operator: '赵敏', intro: '都市异能，普通青年觉醒异能逆天崛起，横扫都市。', createdAt: '2026-06-05 18:45:30', episodes: [
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-06-05 18:45:30' },
      { language: '英语', template: '模板二', type: 'AI配音音频', outputType: '音频', progress: '成功', createdAt: '2026-06-05 19:10:05' },
      { language: '韩语', template: '模板一', type: '字幕压制', outputType: '视频', progress: '成功', createdAt: '2026-06-05 19:45:12' }
  ]},
  { id: 'TS008', name: '豪门千金', linkedCollection: 'Vlog 日常', operator: '陈晨', intro: '豪门恩怨，落魄千金强势回归，打脸白莲，夺回家产。', createdAt: '2026-06-01 12:00:00', episodes: [
      { language: '英语', template: '模板三', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-06-01 12:00:00' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-06-01 12:30:18' }
  ]},
  { id: 'TS009', name: '星际战士', linkedCollection: '技术分享', operator: '王雪', intro: '科幻战争，星际战士穿越异界，拯救人类文明。', createdAt: '2026-05-28 20:10:00', episodes: [
      { language: '英语', template: '模板一', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-05-28 20:10:00' },
      { language: '韩语', template: '模板二', type: 'AI配音视频', outputType: '视频', progress: '成功', createdAt: '2026-05-28 20:55:44' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-05-28 21:20:33' }
  ]},
  { id: 'TS010', name: '甜宠来袭', linkedCollection: '开箱体验', operator: '李强', intro: '现代甜宠，奶凶男友的追妻日常，甜度爆表。', createdAt: '2026-05-20 16:00:00', episodes: [
      { language: '英语', template: '模板二', type: 'AI配音音频', outputType: '音频', progress: '成功', createdAt: '2026-05-20 16:00:00' },
      { language: '中文', template: '—', type: '音频分离', outputType: '视频', progress: '成功', createdAt: '2026-05-20 16:45:27' }
  ]}
];

let _translationDetailId = null;

function getTranslationCollections() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(TRANSLATION_STORAGE_KEY));
  } catch (e) { data = null; }
  if (!Array.isArray(data)) {
    data = TRANSLATION_SEED;
    localStorage.setItem(TRANSLATION_STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  // 迁移：旧数据没有 operator 字段时，按 id 从种子数据回填
  let migrated = false;
  data.forEach(c => {
    if (c && !c.operator) {
      const seed = TRANSLATION_SEED.find(s => s.id === c.id);
      c.operator = (seed && seed.operator) || '';
      migrated = true;
    }
  });
  if (migrated) localStorage.setItem(TRANSLATION_STORAGE_KEY, JSON.stringify(data));
  return data;
}

function saveTranslationCollections(collections) {
  localStorage.setItem(TRANSLATION_STORAGE_KEY, JSON.stringify(collections));
}

// ─── 翻译合成一级列表筛选（合集名称 / 合集组名称）─────────
const _tsFilterState = { name: '', group: '' };

// 填充合集组筛选下拉：取数据中实际出现过的合集组（去重），保持当前选中
function populateTsGroupFilter() {
  const sel = $('#tsFilterGroup');
  if (!sel) return;
  const groups = [];
  const seen = new Set();
  // 两个 Tab 共用同一个筛选栏 → 合集组下拉要把两份数据的合集组都列出来
  const collect = list => (list || []).forEach(c => {
    const g = c.linkedCollection || '';
    if (g && !seen.has(g)) { seen.add(g); groups.push(g); }
  });
  collect(getTranslationCollections());
  collect(getSelfCollections());
  // 数据中没有的枚举值也列出（避免新数据尚未出现时选不到）
  COLLECTION_GROUP_NAMES.forEach(g => { if (!seen.has(g)) { seen.add(g); groups.push(g); } });
  const cur = _tsFilterState.group || '';
  sel.innerHTML = '<option value="">全部</option>' +
    groups.map(g => `<option value="${escapeHtml(g)}" ${g === cur ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('');
}

function resetTranslationFilter() {
  _tsFilterState.name = '';
  _tsFilterState.group = '';
  const nameInput = $('#tsFilterName');
  if (nameInput) nameInput.value = '';
  populateTsGroupFilter();
  renderTsActiveTab();
}

// 进度标签着色
function progressTag(val) {
  if (!val) return '<span class="td-empty">—</span>';
  if (val === '成功') return '<span class="table-tag success">成功</span>';
  if (val === '合成中') return '<span class="table-tag warn">合成中</span>';
  if (val === '失败') return '<span class="table-tag danger">失败</span>';
  return `<span class="table-tag gray">${escapeHtml(val)}</span>`;
}

// 输出类型标签着色
function outputTypeTag(val) {
  if (!val) return '<span class="td-empty">—</span>';
  if (val === '视频') return '<span class="table-tag info">视频</span>';
  if (val === '音频') return '<span class="table-tag warn">音频</span>';
  return `<span class="table-tag gray">${escapeHtml(val)}</span>`;
}

// 渲染合集列表页（支持筛选：合集名称 / 合集组名称）
function renderTranslationPage() {
  const collections = getTranslationCollections();
  const tbody = $('#translationTableBody');
  const wrap = $('#translationTableWrap');
  const empty = $('#translationEmpty');
  const hint = $('#translationCountHint');
  if (!tbody || !wrap || !empty) return;

  // 同步刷新合集组筛选下拉（编辑/新增合集组后保持一致，保留当前选中）
  populateTsGroupFilter();

  // 应用筛选
  const kw = (_tsFilterState.name || '').trim().toLowerCase();
  const group = _tsFilterState.group || '';
  const filtered = collections.filter(c => {
    if (kw && !((c.name || '').toLowerCase().includes(kw))) return false;
    if (group && (c.linkedCollection || '') !== group) return false;
    return true;
  });

  if (hint) hint.textContent = collections.length === filtered.length
    ? `共 ${collections.length} 个合集`
    : `共 ${collections.length} 个合集 · 筛选出 ${filtered.length} 个`;

  // 数据为空（从未创建过）→ 显示空态卡片
  if (collections.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = 'block';

  // 筛选后为空 → 表格内显示「无匹配」行
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="ts-no-match">未找到匹配「${escapeHtml(_tsFilterState.name || '')}${group ? ' / ' + escapeHtml(group) : ''}」的合集，可调整筛选条件或<span class="ts-no-match-reset" id="tsNoMatchReset">清空筛选</span></td></tr>`;
    const resetLink = $('#tsNoMatchReset');
    if (resetLink) resetLink.addEventListener('click', resetTranslationFilter);
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td>${escapeHtml(c.id)}</td>
      <td><span class="td-name-link" data-collection-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</span></td>
      <td>${c.linkedCollection ? `<span class="linked-collection-tag">${escapeHtml(c.linkedCollection)}</span>` : '<span class="cell-empty">—</span>'}</td>
      <td><div class="col-intro">${escapeHtml(c.intro)}</div></td>
      <td class="col-operator">${c.operator
        ? `<span class="operator-cell"><span class="operator-avatar">${escapeHtml(c.operator.slice(-1))}</span>${escapeHtml(c.operator)}</span>`
        : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(c.createdAt)}</td>
      <td class="col-actions">
        <div class="action-btns">
          <button class="btn-edit" data-edit-id="${escapeHtml(c.id)}" title="编辑关联合集">编辑</button>
        </div>
      </td>
    </tr>
  `).join('');

  // 绑定合集名称点击 → 进入详情
  $$('.td-name-link[data-collection-id]', tbody).forEach(el => {
    el.addEventListener('click', () => openTranslationDetail(el.dataset.collectionId));
  });

  // 绑定编辑按钮 → 打开编辑关联合集弹窗
  $$('.btn-edit[data-edit-id]', tbody).forEach(btn => {
    btn.addEventListener('click', () => openTranslationEdit(btn.dataset.editId));
  });
}

// ─── 翻译合成合集 · 编辑关联合集 ───────────────
let _translationEditId = null;

function openTranslationEdit(id) {
  const collections = getTranslationCollections();
  const col = collections.find(c => c.id === id);
  if (!col) return;
  _translationEditId = id;

  $('#translationEditName').textContent = col.name || col.id;
  $('#translationEditSub').textContent = `ID：${col.id} · 创建于 ${col.createdAt || '—'}`;

  const sel = $('#translationEditLinked');
  const current = col.linkedCollection || '';
  let options = '<option value="">不关联</option>';
  COLLECTION_GROUP_NAMES.forEach(name => {
    options += `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  });
  // 当前值不在枚举里时兜底展示，避免下拉显示空白
  if (current && !COLLECTION_GROUP_NAMES.includes(current)) {
    options += `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`;
  }
  sel.innerHTML = options;

  $('#translationEditMask').style.display = 'flex';
}

function closeTranslationEdit() {
  $('#translationEditMask').style.display = 'none';
  _translationEditId = null;
}

function saveTranslationEdit() {
  if (!_translationEditId) return;
  const collections = getTranslationCollections();
  const col = collections.find(c => c.id === _translationEditId);
  if (!col) { closeTranslationEdit(); return; }

  const newVal = $('#translationEditLinked').value;
  const oldVal = col.linkedCollection || '';
  col.linkedCollection = newVal;
  saveTranslationCollections(collections);
  closeTranslationEdit();
  renderTranslationPage();

  if (newVal !== oldVal) {
    showToast(`已更新「${col.name}」的关联合集：${oldVal || '不关联'} → ${newVal || '不关联'}`, 'success');
  }
}

// 进入详情页
function openTranslationDetail(id) {
  const collections = getTranslationCollections();
  const col = collections.find(c => c.id === id);
  if (!col) return;
  _translationDetailId = id;
  _tsDetailSource = 'system';

  $('#translationDetailTitle').textContent = col.name;
  $('#translationDetailSub').textContent = `ID：${col.id} · 共 ${(col.episodes || []).length} 集`;

  renderTranslationDetail(col.episodes || [], col.linkedCollection);

  // 切换导航高亮到翻译合成
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-page="translation"]`);
  if (navItem) navItem.classList.add('active');

  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-translation-detail').classList.add('active');
}

// 渲染详情页表格
function renderTranslationDetail(episodes, linkedCollection) {
  const tbody = $('#translationDetailTableBody');
  if (!tbody) return;

  tbody.innerHTML = episodes.map((ep, idx) => {
    const downloadLabel = ep.outputType === '音频' ? '下载音频' : '下载视频';
    const canPreview = ep.progress === '成功';
    return `
    <tr>
      <td>${linkedCollection ? `<span class="linked-collection-tag">${escapeHtml(linkedCollection)}</span>` : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(ep.language)}</td>
      <td><span class="td-template">${escapeHtml(ep.template)}</span></td>
      <td>${escapeHtml(ep.type)}</td>
      <td>${progressTag(ep.progress)}</td>
      <td>${escapeHtml(ep.createdAt)}</td>
      <td class="col-actions">
        <div class="action-btns">
          <button class="btn-preview" data-ep-idx="${idx}" title="预览" ${canPreview ? '' : 'disabled'}>预览</button>
          <button class="btn-download" data-ep-idx="${idx}" title="下载">${downloadLabel}</button>
          <button class="btn-upload-yt" data-ep-idx="${idx}" ${linkedCollection ? '' : 'disabled title="所属合集未关联合集组，无法上传"'}>上传YT</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // 绑定操作
  $$('.btn-preview', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.epIdx, 10);
      const ep = episodes[idx];
      if (!ep) return;
      if (ep.progress !== '成功') {
        showToast(`当前状态为「${ep.progress}」，无法预览`, 'error');
        return;
      }
      openVideoPreview(ep, idx);
    });
  });
  $$('.btn-download', tbody).forEach(btn => {
    btn.addEventListener('click', () => { showToast('下载功能即将开放', 'info'); });
  });
  $$('.btn-upload-yt', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      openUploadYtModal(parseInt(btn.dataset.epIdx, 10), 'system');
    });
  });
}

// ─── 自建内容（翻译合成视频 · 第二个 Tab）──────────────
// 与「翻译系统」数据完全分开存储：翻译系统的合集是外部合成系统推过来的（只读 + 改关联合集组），
// 自建内容是用户在后台手动创建的（可增删改 + 自行上传视频），两者生命周期不同，
// 所以独立用 yt_self_collections 一个 key，互不迁移、互不干扰。
const SELF_STORAGE_KEY = 'yt_self_collections';
const SELF_LANGUAGES = ['中文', '英语', '日语', '韩语', '西班牙语', '法语', '德语', '葡萄牙语', '俄语', '阿拉伯语', '泰语', '越南语', '印尼语'];
const SELF_VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.mpg', '.mpeg', '.ts'];

let _tsTab = 'system';          // 'system' | 'self'
let _tsDetailSource = 'system'; // 当前详情页属于哪个来源（决定上传YT时去哪份数据里找合集）
let _selfDetailId = null;
let _selfEditId = null;
let _selfVideoColId = null;
let _selfVideoFile = null;
let _selfBound = false;

// 历史数据修复：早期版本把服务端返回的 latin1 乱码名存了下来（「测试视频」→「æµè¯è§é¢」），
// 这里按 UTF-8 重新解码还原；解码不合法（本来就是正常的中文/ASCII 名）时保持原样。
function decodeMojibakeName(s) {
  const str = String(s || '');
  if (!str) return str;
  if (!/[\u00C0-\u00FF]/.test(str)) return str; // 没有 latin1 高位字符 → 不是乱码
  const bytes = [];
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code > 0xff) return str; // 已含正常中文 → 说明没被乱码化
    bytes.push(code);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) || str;
  } catch (e) {
    return str; // 不是合法 UTF-8 字节序列 → 原名本来就这样，不动
  }
}

// 读列表时顺手修一遍已存的乱码文件名（修好即落盘，之后不再重复写）
function repairSelfFileNames(list) {
  let changed = false;
  (Array.isArray(list) ? list : []).forEach(col => {
    (col && Array.isArray(col.episodes) ? col.episodes : []).forEach(ep => {
      if (!ep || !ep.fileName) return;
      const fixed = decodeMojibakeName(ep.fileName);
      if (fixed !== ep.fileName) { ep.fileName = fixed; changed = true; }
    });
  });
  if (changed) { try { localStorage.setItem(SELF_STORAGE_KEY, JSON.stringify(list)); } catch (e) {} }
  return list;
}

function getSelfCollections() {
  try {
    const data = JSON.parse(localStorage.getItem(SELF_STORAGE_KEY));
    return Array.isArray(data) ? repairSelfFileNames(data) : [];
  } catch (e) { return []; }
}

function saveSelfCollections(list) {
  localStorage.setItem(SELF_STORAGE_KEY, JSON.stringify(list));
}

function selfNowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function nextSelfId() {
  let max = 0;
  getSelfCollections().forEach(c => {
    const m = /^SC(\d+)$/.exec(String(c.id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'SC' + String(max + 1).padStart(3, '0');
}

// ─── Tab 切换 ────────────────────────────────
function switchTsTab(tab) {
  _tsTab = (tab === 'self') ? 'self' : 'system';
  $$('#tsTabs .ins-tab').forEach(t => t.classList.toggle('active', t.dataset.tsTab === _tsTab));
  // 先全部隐藏，再由各自的 render 决定显示空态还是表格
  $$('[data-ts-block]').forEach(el => { el.style.display = 'none'; });
  const addBtn = $('#selfAddBtn');
  if (addBtn) addBtn.style.display = (_tsTab === 'self') ? 'inline-flex' : 'none';
  // 两个 Tab 共用筛选栏，切换时清空，避免带着上一个 Tab 的条件进来看到空列表
  _tsFilterState.name = '';
  _tsFilterState.group = '';
  const nameInput = $('#tsFilterName');
  if (nameInput) nameInput.value = '';
  renderTsActiveTab();
}

function renderTsActiveTab() {
  if (_tsTab === 'self') renderSelfPage();
  else renderTranslationPage();
}

// ─── 自建内容 · 列表 ──────────────────────────
function renderSelfPage() {
  const list = getSelfCollections();
  const tbody = $('#selfTableBody');
  const wrap = $('#selfTableWrap');
  const empty = $('#selfEmpty');
  const hint = $('#translationCountHint');
  if (!tbody || !wrap || !empty) return;

  populateTsGroupFilter();

  const kw = (_tsFilterState.name || '').trim().toLowerCase();
  const group = _tsFilterState.group || '';
  const filtered = list.filter(c => {
    if (kw && !String(c.name || '').toLowerCase().includes(kw)) return false;
    if (group && (c.linkedCollection || '') !== group) return false;
    return true;
  });

  if (hint) hint.textContent = list.length === filtered.length
    ? `共 ${list.length} 个自建内容`
    : `共 ${list.length} 个自建内容 · 筛选出 ${filtered.length} 个`;

  if (list.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = 'block';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="ts-no-match">未找到匹配「${escapeHtml(_tsFilterState.name || '')}${group ? ' / ' + escapeHtml(group) : ''}」的自建内容，可调整筛选条件或<span class="ts-no-match-reset" id="selfNoMatchReset">清空筛选</span></td></tr>`;
    const resetLink = $('#selfNoMatchReset');
    if (resetLink) resetLink.addEventListener('click', resetTranslationFilter);
    return;
  }

  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td>${escapeHtml(c.id)}</td>
      <td><span class="td-name-link" data-self-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</span></td>
      <td>${c.linkedCollection ? `<span class="linked-collection-tag">${escapeHtml(c.linkedCollection)}</span>` : '<span class="cell-empty">—</span>'}</td>
      <td><div class="col-intro">${escapeHtml(c.intro || '')}</div></td>
      <td class="col-operator">${c.operator
        ? `<span class="operator-cell"><span class="operator-avatar">${escapeHtml(c.operator.slice(-1))}</span>${escapeHtml(c.operator)}</span>`
        : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(c.createdAt)}</td>
      <td class="col-actions">
        <div class="action-btns">
          <button class="btn-upload-yt" data-self-upload="${escapeHtml(c.id)}" title="上传视频">上传视频</button>
          <button class="btn-edit" data-self-edit="${escapeHtml(c.id)}" title="编辑">编辑</button>
          <button class="btn-delete" data-self-del="${escapeHtml(c.id)}" title="删除">删除</button>
        </div>
      </td>
    </tr>`).join('');

  $$('.td-name-link[data-self-id]', tbody).forEach(el => {
    el.addEventListener('click', () => openSelfDetail(el.dataset.selfId));
  });
  $$('.btn-upload-yt[data-self-upload]', tbody).forEach(btn => {
    btn.addEventListener('click', () => openSelfVideoModal(btn.dataset.selfUpload));
  });
  $$('.btn-edit[data-self-edit]', tbody).forEach(btn => {
    btn.addEventListener('click', () => openSelfEdit(btn.dataset.selfEdit));
  });
  $$('.btn-delete[data-self-del]', tbody).forEach(btn => {
    btn.addEventListener('click', () => deleteSelfCollection(btn.dataset.selfDel));
  });
}

// ─── 自建内容 · 新增 / 编辑 ────────────────────
function selfFillGroupSelect(sel, current) {
  if (!sel) return;
  let options = '<option value="">请选择关联合集组</option>';
  COLLECTION_GROUP_NAMES.forEach(name => {
    options += `<option value="${escapeHtml(name)}" ${name === current ? 'selected' : ''}>${escapeHtml(name)}</option>`;
  });
  if (current && !COLLECTION_GROUP_NAMES.includes(current)) {
    options += `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`;
  }
  sel.innerHTML = options;
}

function openSelfAdd() {
  _selfEditId = null;
  const t = $('#selfEditTitle');
  if (t) t.textContent = '新增自建内容';
  selfFillGroupSelect($('#selfEditGroup'), '');
  const nameEl = $('#selfEditName');
  if (nameEl) nameEl.value = '';
  const introEl = $('#selfEditIntro');
  if (introEl) introEl.value = '';
  const idEl = $('#selfEditId');
  if (idEl) idEl.value = '';
  $('#selfEditMask').style.display = 'flex';
}

function openSelfEdit(id) {
  const col = getSelfCollections().find(c => c.id === id);
  if (!col) return;
  _selfEditId = id;
  const t = $('#selfEditTitle');
  if (t) t.textContent = '编辑自建内容';
  selfFillGroupSelect($('#selfEditGroup'), col.linkedCollection || '');
  const nameEl = $('#selfEditName');
  if (nameEl) nameEl.value = col.name || '';
  const introEl = $('#selfEditIntro');
  if (introEl) introEl.value = col.intro || '';
  const idEl = $('#selfEditId');
  if (idEl) idEl.value = id;
  $('#selfEditMask').style.display = 'flex';
}

function closeSelfEdit() {
  $('#selfEditMask').style.display = 'none';
  _selfEditId = null;
}

function saveSelfEdit() {
  const group = ($('#selfEditGroup') && $('#selfEditGroup').value) || '';
  const name = ($('#selfEditName') && $('#selfEditName').value.trim()) || '';
  const intro = ($('#selfEditIntro') && $('#selfEditIntro').value.trim()) || '';

  if (!group) { showToast('请选择关联合集组', 'error'); return; }
  if (!name) { showToast('请填写合集名称', 'error'); return; }

  const list = getSelfCollections();
  if (_selfEditId) {
    const col = list.find(c => c.id === _selfEditId);
    if (!col) { closeSelfEdit(); return; }
    col.linkedCollection = group;
    col.name = name;
    col.intro = intro;
    saveSelfCollections(list);
    closeSelfEdit();
    renderSelfPage();
    if (_selfDetailId === col.id) renderSelfDetail();
    showToast(`已更新「${name}」`, 'success');
    return;
  }

  if (list.some(c => c.name === name)) {
    showToast('已存在同名合集，请换一个名称', 'error');
    return;
  }
  const col = {
    id: nextSelfId(),
    name,
    linkedCollection: group,
    intro,
    operator: state.adminUsername || '管理员',
    createdAt: selfNowStamp(),
    episodes: []
  };
  list.push(col);
  saveSelfCollections(list);
  closeSelfEdit();
  renderSelfPage();
  showToast(`已创建自建内容「${name}」`, 'success');
}

function deleteSelfCollection(id) {
  const list = getSelfCollections();
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return;
  const col = list[idx];
  if (!confirm(`确定删除自建内容「${col.name}」吗？其下 ${(col.episodes || []).length} 个已上传视频也会一并删除。`)) return;
  // 清理服务器上的视频文件（失败不影响本地记录删除）
  (col.episodes || []).forEach(ep => {
    if (ep.localFile) {
      fetch(`/api/self-media/video?file=${encodeURIComponent(ep.localFile)}`, { method: 'DELETE' }).catch(() => {});
    }
  });
  list.splice(idx, 1);
  saveSelfCollections(list);
  renderSelfPage();
  showToast(`已删除「${col.name}」`, 'success');
}

// ─── 自建内容 · 详情页 ─────────────────────────
function openSelfDetail(id) {
  const col = getSelfCollections().find(c => c.id === id);
  if (!col) return;
  _selfDetailId = id;
  _tsDetailSource = 'self';
  // 上传YT 弹窗按 _translationDetailId 定位当前合集，两个来源复用同一个变量
  _translationDetailId = id;

  const titleEl = $('#selfDetailTitle');
  if (titleEl) titleEl.textContent = col.name || '自建内容详情';
  const subEl = $('#selfDetailSub');
  if (subEl) subEl.textContent = `ID：${col.id} · 共 ${(col.episodes || []).length} 个视频`;

  renderSelfDetail();

  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = $('.nav-item[data-page="translation"]');
  if (navItem) navItem.classList.add('active');
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-self-detail').classList.add('active');
}

function renderSelfDetail() {
  const col = getSelfCollections().find(c => c.id === _selfDetailId);
  const tbody = $('#selfDetailTableBody');
  if (!tbody || !col) return;
  const episodes = col.episodes || [];
  const wrap = $('#selfDetailTableWrap');
  const empty = $('#selfDetailEmpty');
  const subEl = $('#selfDetailSub');
  if (subEl) subEl.textContent = `ID：${col.id} · 共 ${episodes.length} 个视频`;

  if (episodes.length === 0) {
    if (wrap) wrap.style.display = 'none';
    if (empty) empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap) wrap.style.display = 'block';

  // 关联合集组是合集级属性，每一行都显示（顶部信息块已去掉，改由列表承载）
  const linkedCell = col.linkedCollection
    ? `<span class="linked-collection-tag">${escapeHtml(col.linkedCollection)}</span>`
    : '<span class="cell-empty">—</span>';

  tbody.innerHTML = episodes.map((ep, idx) => `
    <tr>
      <td>${linkedCell}</td>
      <td>${escapeHtml(ep.language || '')}</td>
      <td><span class="self-video-cell" title="${escapeHtml(ep.fileName || '')}">${escapeHtml(ep.fileName || '—')}</span></td>
      <td>${escapeHtml(ep.createdAt || '')}</td>
      <td class="col-actions">
        <div class="action-btns">
          <button class="btn-preview" data-self-ep="${idx}" title="预览">预览</button>
          <button class="btn-upload-yt" data-self-ep="${idx}" ${col.linkedCollection ? '' : 'disabled title="未关联合集组，无法上传"'}>上传YT</button>
          <button class="btn-delete" data-self-ep="${idx}" title="删除">删除</button>
        </div>
      </td>
    </tr>`).join('');

  $$('.btn-preview[data-self-ep]', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      const ep = episodes[parseInt(btn.dataset.selfEp, 10)];
      if (ep) openVideoPreview(ep, parseInt(btn.dataset.selfEp, 10));
    });
  });
  $$('.btn-upload-yt[data-self-ep]', tbody).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      openUploadYtModal(parseInt(btn.dataset.selfEp, 10), 'self');
    });
  });
  $$('.btn-delete[data-self-ep]', tbody).forEach(btn => {
    btn.addEventListener('click', () => deleteSelfEpisode(parseInt(btn.dataset.selfEp, 10)));
  });
}

function deleteSelfEpisode(idx) {
  const list = getSelfCollections();
  const col = list.find(c => c.id === _selfDetailId);
  if (!col) return;
  const ep = (col.episodes || [])[idx];
  if (!ep) return;
  if (!confirm(`确定删除视频「${ep.fileName || ep.language}」吗？`)) return;
  if (ep.localFile) {
    fetch(`/api/self-media/video?file=${encodeURIComponent(ep.localFile)}`, { method: 'DELETE' }).catch(() => {});
  }
  col.episodes.splice(idx, 1);
  saveSelfCollections(list);
  renderSelfDetail();
  renderSelfPage();
  showToast('已删除该视频', 'success');
}

function goBackSelfList() {
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = $('.nav-item[data-page="translation"]');
  if (navItem) navItem.classList.add('active');
  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-translation').classList.add('active');
  switchTsTab('self'); // 回到列表并停留在「自建内容」Tab
}

// ─── 自建内容 · 上传视频弹窗 ────────────────────
function selfVideoReset() {
  _selfVideoFile = null;
  const input = $('#selfVideoFileInput');
  if (input) input.value = '';
  const emptyEl = $('#selfVideoEmpty');
  const selEl = $('#selfVideoSelected');
  if (emptyEl) emptyEl.style.display = 'flex';
  if (selEl) selEl.style.display = 'none';
  const nameEl = $('#selfVideoName');
  if (nameEl) nameEl.textContent = '—';
  const sizeEl = $('#selfVideoSize');
  if (sizeEl) sizeEl.textContent = '';
}

function selfVideoUpdateFileUI() {
  const has = !!_selfVideoFile;
  const emptyEl = $('#selfVideoEmpty');
  const selEl = $('#selfVideoSelected');
  if (emptyEl) emptyEl.style.display = has ? 'none' : 'flex';
  if (selEl) selEl.style.display = has ? 'flex' : 'none';
  if (has) {
    const nameEl = $('#selfVideoName');
    if (nameEl) nameEl.textContent = _selfVideoFile.name;
    const sizeEl = $('#selfVideoSize');
    if (sizeEl) sizeEl.textContent = formatFileSize(_selfVideoFile.size);
  }
}

function selfVideoSetFile(file) {
  if (!file) return;
  const name = String(file.name || '');
  const ext = '.' + name.split('.').pop().toLowerCase();
  if (!SELF_VIDEO_EXTS.includes(ext)) {
    showToast(`不支持的视频格式，请上传 ${SELF_VIDEO_EXTS.join(' / ')}`, 'error');
    return;
  }
  _selfVideoFile = file;
  selfVideoUpdateFileUI();
}

function openSelfVideoModal(colId) {
  if (!colId) return;
  const col = getSelfCollections().find(c => c.id === colId);
  if (!col) return;
  _selfVideoColId = colId;

  const titleEl = $('#selfVideoTitle');
  if (titleEl) titleEl.textContent = `上传视频 · ${col.name}`;

  const langSel = $('#selfVideoLang');
  if (langSel) {
    langSel.innerHTML = '<option value="">请选择语言</option>' +
      SELF_LANGUAGES.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  }
  selfVideoReset();

  if (!_selfBound) {
    _selfBound = true;
    const close = $('#selfVideoCloseBtn');
    if (close) close.addEventListener('click', closeSelfVideoModal);
    const cancel = $('#selfVideoCancelBtn');
    if (cancel) cancel.addEventListener('click', closeSelfVideoModal);
    const submit = $('#selfVideoSubmitBtn');
    if (submit) submit.addEventListener('click', submitSelfVideo);
    const remove = $('#selfVideoRemoveBtn');
    if (remove) remove.addEventListener('click', () => { selfVideoReset(); });
    const emptyEl = $('#selfVideoEmpty');
    if (emptyEl) emptyEl.addEventListener('click', () => {
      const input = $('#selfVideoFileInput');
      if (input) input.click();
    });
    const input = $('#selfVideoFileInput');
    if (input) input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      if (f) selfVideoSetFile(f);
    });
    const field = $('#selfVideoDropField');
    if (field) {
      field.addEventListener('dragover', e => { e.preventDefault(); field.classList.add('dragging'); });
      field.addEventListener('dragleave', e => {
        if (e.relatedTarget && field.contains(e.relatedTarget)) return;
        field.classList.remove('dragging');
      });
      field.addEventListener('drop', e => {
        e.preventDefault();
        field.classList.remove('dragging');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) selfVideoSetFile(f);
      });
    }
    const mask = $('#selfVideoMask');
    if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeSelfVideoModal(); });
  }

  $('#selfVideoMask').style.display = 'flex';
}

function closeSelfVideoModal() {
  $('#selfVideoMask').style.display = 'none';
  _selfVideoColId = null;
  selfVideoReset();
}

// 上传前先向服务端领一个落盘文件名：取消 / 失败时能精确删掉那半截文件
async function initSelfVideoTarget(fileName) {
  const res = await fetch('/api/self-media/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || '初始化上传失败');
  return data;
}

// 删除服务端上没用上的（半截）文件；失败不影响主流程
function discardSelfVideoFile(rel) {
  if (!rel) return;
  fetch(`/api/self-media/video?file=${encodeURIComponent(rel)}`, { method: 'DELETE' }).catch(() => {});
}

// 上传进度用 XHR（fetch 拿不到上传进度事件）
// registerXhr：把 xhr 暴露出去，让「取消」按钮能精确中止这一条
function uploadSelfVideoFile(file, target, onProgress, registerXhr) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    // target 必须排在 video 之前：multer 按 multipart 流顺序填 req.body，
    // 晚于文件的话 filename 回调里就取不到，服务端会另起一个随机名
    fd.append('target', target);
    fd.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/self-media/video');
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total * 100);
      };
    }
    if (registerXhr) registerXhr(xhr);
    // 大文件上传到 100% 后，服务端还要写盘 / 落 multer，这段前端拿不到进度，
    // 只有 load 事件，所以用 99% 过渡，load 之后再置 100%。
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; }
      if (xhr.status === 200 && data.success) resolve(data);
      else reject(new Error(data.error || `上传失败（HTTP ${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new Error('__CANCELLED__'));
    xhr.send(fd);
  });
}

// 后台上传：点「开始上传」立刻关弹窗，XHR 不受弹窗关闭影响继续跑，
// 进度统一走右下角「上传进度」面板（可收起 / 关闭 / 逐条取消）。
async function submitSelfVideo() {
  const language = ($('#selfVideoLang') && $('#selfVideoLang').value) || '';
  if (!language) { showToast('请先选择语言', 'error'); return; }
  const file = _selfVideoFile;
  if (!file) { showToast('请选择要上传的视频文件', 'error'); return; }

  const list0 = getSelfCollections();
  const col0 = list0.find(c => c.id === _selfVideoColId);
  if (!col0) { closeSelfVideoModal(); return; }
  const colId = col0.id;
  const colName = col0.name || '自建内容';

  // 先关弹窗（此时 file 已被闭包捕获，selfVideoReset 不会影响上传）
  closeSelfVideoModal();

  const toastId = createUploadToastItem(`${colName} · ${file.name}`);
  showUploadToast();
  updateUploadToastItem(toastId, 'uploading', 0);

  let target = '';
  try {
    const init = await initSelfVideoTarget(file.name);
    target = init.file;
    const data = await uploadSelfVideoFile(
      file,
      init.target,
      pct => {
        const p = Math.min(99, Math.round(pct));
        updateUploadToastItem(toastId, 'uploading', p);
      },
      xhr => _selfUploads.set(toastId, { xhr, colId, target })
    );
    _selfUploads.delete(toastId);
    target = ''; // 上传成功，这个文件要留着

    // 写回数据（重新取一次，避免上传期间别的操作改过 localStorage）
    const list = getSelfCollections();
    const col = list.find(c => c.id === colId);
    if (!col) throw new Error('合集已被删除，上传结果未保存');
    if (!col.episodes) col.episodes = [];
    col.episodes.push({
      language,
      // 用浏览器拿到的 file.name：它是真正的 UTF-8 原名；
      // 服务端返回的 fileName 由 multipart 解析而来，中文名有乱码风险（已修，但仍以客户端为准）
      fileName: file.name || data.fileName || '',
      localFile: data.file,          // 服务端相对路径，发布时拼成回环 URL
      type: '自建内容',
      outputType: '视频',
      template: '—',
      progress: '成功',
      createdAt: selfNowStamp()
    });
    saveSelfCollections(list);

    updateUploadToastItem(toastId, 'completed', 100);
    renderSelfPage();
    if (_selfDetailId === colId) renderSelfDetail();
    showToast(`「${colName}」已上传视频（${language}）`, 'success');
  } catch (err) {
    _selfUploads.delete(toastId);
    if (err && err.message === '__CANCELLED__') {
      // 取消：等服务端把半截文件写完再删，否则可能删不掉
      setTimeout(() => discardSelfVideoFile(target), 500);
      return; // 取消状态已由 cancelUploadTask 写好
    }
    discardSelfVideoFile(target);
    updateUploadToastItem(toastId, 'failed', null);
    showToast(err.message || '上传失败', 'error');
  }
}

// ─── 上传YT（单步发布）弹窗 ─────────────────────
let _uytCtx = null; // { colId, epIdx }
let _uytBound = false;
let _uytThumbDataUrl = ''; // 封面（dataUrl）：AI 生成或本地选择，发布成功后上传
let _uytThumbUploadName = ''; // 提交给 YouTube 时使用的文件名

// 按来源取合集：翻译系统 / 自建内容分别存在不同的 localStorage key
function getUytCollection() {
  if (!_uytCtx) return null;
  const list = _uytCtx.source === 'self' ? getSelfCollections() : getTranslationCollections();
  return list.find(c => c.id === _uytCtx.colId) || null;
}

// 弹窗上下文 → AI 生成标题所需的来源信息（比上传页反查筛选器更直接）
function getUytSourceContext() {
  if (!_uytCtx) return null;
  const col = getUytCollection();
  if (!col) return null;
  const ep = (col.episodes || [])[_uytCtx.epIdx] || {};
  return {
    collectionName: col.name || '',
    linkedCollection: col.linkedCollection || '',
    intro: col.intro || '',
    language: ep.language || '',
    type: ep.type || ''
  };
}

// 手动选择/拖入本地图片作为封面：读成 dataUrl 存进 _uytThumbDataUrl，
// 与 AI 生成共用同一条上传链路（发布成功后 /api/thumbnails/set）。
function uytSetThumbFile(file) {
  if (!file) return;
  const validExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const name = String(file.name || '');
  const ext = '.' + name.split('.').pop().toLowerCase();
  if (!validExts.includes(ext)) {
    showToast('不支持的图片格式，请使用 .jpg / .jpeg / .png / .gif / .bmp / .webp', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('缩略图文件不能超过 10MB', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    _uytThumbDataUrl = String((e.target && e.target.result) || '');
    if (!_uytThumbDataUrl) { showToast('读取图片失败，请重试', 'error'); return; }
    const img = $('#uytThumbPreviewImg');
    const area = $('#uytThumbPreviewArea');
    const nameEl = $('#uytThumbFileName');
    _uytThumbUploadName = name || 'thumbnail.png';
    if (img) img.src = _uytThumbDataUrl;
    if (nameEl) nameEl.textContent = name || '本地图片';
    uytUpdateThumbUI();
    showToast(`已选择封面「${name}」，将随发布任务上传`, 'success');
  };
  reader.onerror = () => showToast('读取图片失败，请重试', 'error');
  reader.readAsDataURL(file);
}

// 打开系统文件选择框
function uytPickThumbFile() {
  const input = $('#uytThumbFileInput');
  if (input) input.click();
}

// 缩略图：未上传显示空状态占位，已上传显示预览，两者互斥
function uytUpdateThumbUI() {
  const has = !!_uytThumbDataUrl;
  const empty = $('#uytThumbEmpty');
  const area = $('#uytThumbPreviewArea');
  if (empty) empty.style.display = has ? 'none' : 'flex';
  if (area) area.style.display = has ? 'flex' : 'none';
}

function removeUytThumb() {
  _uytThumbDataUrl = '';
  _uytThumbUploadName = '';
  const input = $('#uytThumbFileInput');
  if (input) input.value = '';   // 允许再次选择同一个文件
  const nameEl = $('#uytThumbFileName');
  if (nameEl) nameEl.textContent = '—';
  const img = $('#uytThumbPreviewImg');
  if (img) img.src = '';
  uytUpdateThumbUI();
}

// 缩略图字段：点击空状态 / 拖拽图片均可上传
function bindUytThumbUpload() {
  const empty = $('#uytThumbEmpty');
  if (empty) empty.addEventListener('click', uytPickThumbFile);
  const zone = $('#uytThumbField');
  const input = $('#uytThumbFileInput');
  if (input) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) uytSetThumbFile(file);
    });
  }
  if (!zone) return;
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', (e) => {
    // 只有真正离开整个字段区域才取消高亮
    if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uytSetThumbFile(file);
  });
}

// dataUrl → Blob（用于把 AI 封面提交给 /api/thumbnails/set）
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 发布成功后上传封面（失败只提示，不影响发布结果）
async function uploadUytThumbnail(videoId, taskTitle) {
  if (!_uytThumbDataUrl) return;
  try {
    const blob = dataUrlToBlob(_uytThumbDataUrl);
    const fd = new FormData();
    fd.append('videoId', videoId);
    fd.append('thumbnail', blob, _uytThumbUploadName || 'thumbnail.png');
    const res = await fetch('/api/thumbnails/set', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      showToast(`「${taskTitle}」封面已上传`, 'success');
    } else {
      showToast(`「${taskTitle}」封面上传失败：${data.error || data.detail || '未知错误'}`, 'error');
    }
  } catch (err) {
    showToast(`「${taskTitle}」封面上传失败：${err.message}`, 'error');
  }
}

function uytGetActivePrivacy() {
  const active = $('#uytPrivacyGroup .radio-card.active');
  return active ? active.dataset.value : 'private';
}

function uytSetPrivacy(val) {
  $$('#uytPrivacyGroup .radio-card').forEach(card => {
    card.classList.toggle('active', card.dataset.value === val);
  });
}

// 上传弹窗：说明为空时自动套用默认模板
let _uytAutoDesc = '';

function uytBuildDescCtx() {
  const col = getUytCollection();
  const ep = col && (col.episodes || [])[(_uytCtx && _uytCtx.epIdx) || 0];
  const channelId = ($('#uytChannel') && $('#uytChannel').value) || '';
  const ch = (state.channels || []).find(c => c.id === channelId);
  return {
    channelId,
    title: (($('#uytTitle') && $('#uytTitle').value.trim()) || (col && col.name) || ''),
    channelTitle: ch ? ch.title : '',
    collectionGroup: (col && col.linkedCollection) || '',
    language: (ep && ep.language) || '',
    type: (ep && ep.type) || ''
  };
}

// force=true 强制覆盖；否则只在「说明为空」或「仍是上次自动填入的内容」时更新，不覆盖手改
function uytApplyDefaultDesc(force) {
  if (!_uytCtx) return;
  const el = $('#uytDesc');
  if (!el) return;
  const untouched = !el.value.trim() || el.value === _uytAutoDesc;
  if (!force && !untouched) return;
  const ctx = uytBuildDescCtx();
  const rendered = renderDescTemplateClient(resolveDescTemplateFor(ctx.channelId), ctx);
  _uytAutoDesc = rendered;
  el.value = rendered;
  const counter = $('#uytDescCount');
  if (counter) counter.textContent = `${rendered.length}/5000`;
}

// 视频描述「模版说明」按钮（上传弹窗）：用当前发布频道的说明模板文案填充
// source: 'system' 翻译系统 | 'self' 自建内容
function openUploadYtModal(epIdx, source) {
  const src = source || _tsDetailSource || 'system';
  const list = src === 'self' ? getSelfCollections() : getTranslationCollections();
  const col = list.find(c => c.id === _translationDetailId);
  if (!col) return;
  const ep = (col.episodes || [])[epIdx];
  if (!ep) return;
  _uytCtx = { colId: col.id, epIdx, source: src };

  // 关联信息（只读）
  $('#uytInfoName').textContent = col.name || '—';
  $('#uytInfoGroup').textContent = col.linkedCollection || '—';
  $('#uytInfoLang').textContent = ep.language || '—';
  $('#uytInfoType').textContent = ep.type || '—';
  $('#uploadYtTitle').textContent = `上传视频至 YouTube · ${col.name}`;

  // 发布频道：复用已授权频道列表
  const chSel = $('#uytChannel');
  const channels = state.channels || [];
  if (channels.length === 0) {
    chSel.innerHTML = '<option value="">暂无已授权频道，请前往「社媒账号采集表」授权</option>';
  } else {
    chSel.innerHTML = '<option value="">选择频道</option>' +
      channels.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === state.activeChannelId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`).join('');
  }

  // 重置表单
  $('#uytTitle').value = '';
  $('#uytTitleCount').textContent = '0/100';
  $('#uytDesc').value = '';
  $('#uytDescCount').textContent = '0/5000';
  _uytAutoDesc = '';
  $('#uytPublishAt').value = '';
  removeUytThumb();
  uytSetPrivacy('private');
  $('#uytEmbeddable').checked = true;
  $('#uytNotifySubscribers').checked = true;
  $('#uytMadeForKids').checked = false;
  $('#uytSynthetic').checked = false;
  $('#uytAgeRestricted').checked = false;

  // 事件绑定（一次性）
  if (!_uytBound) {
    _uytBound = true;
    $('#uploadYtClose').addEventListener('click', closeUploadYtModal);
    $('#uploadYtCancel').addEventListener('click', closeUploadYtModal);
    $('#uploadYtMask').addEventListener('click', e => {
      if (e.target === $('#uploadYtMask')) closeUploadYtModal();
    });
    $('#uploadYtSubmit').addEventListener('click', submitUploadYt);
    // 标题 / 简介 / 封面统一走「指令库」模板
    $('#uytAiGenTitle').addEventListener('click', () => insGenAndFill({
      tab: 'title', scope: 'uyt', btnId: 'uytAiGenTitle', fill: insFillUytTitle
    }));
    $('#uytAiGenThumb').addEventListener('click', () => insGenAndFill({
      tab: 'thumbnail', scope: 'uyt', btnId: 'uytAiGenThumb', fill: insFillUytThumb
    }));
    $('#uytThumbRemove').addEventListener('click', removeUytThumb);
    // 手动上传封面：点击空状态 / 拖拽（不再需要单独的「本地上传」按钮）
    bindUytThumbUpload();
    uytUpdateThumbUI();
    $('#uytTitle').addEventListener('input', () => {
      $('#uytTitleCount').textContent = `${$('#uytTitle').value.length}/100`;
      uytApplyDefaultDesc(false);
    });
    $('#uytChannel').addEventListener('change', () => uytApplyDefaultDesc(false));
    $('#uytDesc').addEventListener('input', () => {
      $('#uytDescCount').textContent = `${$('#uytDesc').value.length}/5000`;
    });
    $('#uytAiGenDesc').addEventListener('click', () => insGenAndFill({
      tab: 'description', scope: 'uyt', btnId: 'uytAiGenDesc', fill: insFillUytDesc
    }));
    $$('#uytPrivacyGroup .radio-card').forEach(card => {
      card.addEventListener('click', () => uytSetPrivacy(card.dataset.value));
    });
  }

  // 说明预填：套用默认模板（用户手改过则不覆盖）
  uytApplyDefaultDesc(true);

  $('#uploadYtMask').style.display = 'flex';
}

function closeUploadYtModal() {
  $('#uploadYtMask').style.display = 'none';
  _uytCtx = null;
}

// 创建发布任务：fire-and-forget 调用 from-url 接口，任务在后台执行
function submitUploadYt() {
  if (!_uytCtx) return;
  const col = getUytCollection();
  const ep = col && (col.episodes || [])[_uytCtx.epIdx];
  if (!col || !ep) { closeUploadYtModal(); return; }

  const channelId = $('#uytChannel').value;
  if (!channelId) { showToast('请选择发布频道', 'error'); return; }
  const title = $('#uytTitle').value.trim();
  if (!title || title.length > 100) { showToast('请填写有效的视频标题（最多 100 字）', 'error'); return; }

  // 定时发布校验：必须晚于当前时间；定时发布一律按私享提交
  const pubAtRaw = $('#uytPublishAt').value;
  let publishAtIso = '';
  let privacy = uytGetActivePrivacy();
  if (pubAtRaw) {
    const when = new Date(pubAtRaw);
    if (isNaN(when.getTime())) { showToast('定时发布时间格式不正确', 'error'); return; }
    if (when.getTime() <= Date.now()) { showToast('定时发布时间必须晚于当前时间', 'error'); return; }
    publishAtIso = when.toISOString();
    privacy = 'private';
  }

  const videoUrl = getEpisodeVideoUrl(ep, _uytCtx.epIdx);
  const body = {
    url: videoUrl,
    title,
    privacyStatus: privacy,
    embeddable: $('#uytEmbeddable').checked,
    notifySubscribers: $('#uytNotifySubscribers').checked,
    selfDeclaredMadeForKids: $('#uytMadeForKids').checked,
    containsSyntheticMedia: $('#uytSynthetic').checked,
    ageRestricted: $('#uytAgeRestricted').checked
  };
  // 说明：手填优先；留空则套用默认模板（保证发布任务重试时结果一致）
  let desc = $('#uytDesc').value.trim();
  if (!desc) desc = renderDescTemplateClient(resolveDescTemplateFor(channelId), uytBuildDescCtx());
  if (desc) body.description = desc;
  if (publishAtIso) body.publishAt = publishAtIso;
  // 合集组名 → demo id（与上传页 populateCollectionOptions 的取值口径一致）
  const groupIdx = COLLECTION_GROUP_NAMES.indexOf(col.linkedCollection);
  if (groupIdx >= 0) body.collectionId = COLLECTION_GROUP_IDS[groupIdx];

  // 原始文件名：合集组名_语言_类型 → 服务端经 Slug 头写入 YouTube「文件名」字段
  const slugFileName = [col.linkedCollection, ep.language, ep.type]
    .map(v => (v || '').trim())
    .filter(Boolean)
    .join('_');
  if (slugFileName) body.sourceFileName = slugFileName;

  const taskTitle = title;
  const thumbDataUrl = _uytThumbDataUrl; // 关弹窗前留存
  // 记录发布任务（发布任务页展示）；保存请求体供失败重试
  const taskRec = createPublishTask({
    title,
    channelId,
    channelTitle: (state.channels || []).find(c => c.id === channelId)?.title || channelId,
    linkedCollection: col.linkedCollection || '',
    language: ep.language || '',
    operator: col.operator || '',
    videoUrl,
    retryBody: body
  });
  closeUploadYtModal();
  showToast('发布任务已创建，正在后台上传发布…', 'success');

  // 后台执行，完成后提示结果（页面不展示上传进度）
  runPublishTask(taskRec.id, body, taskTitle, thumbDataUrl);
}

// 统一的发布执行器（首次创建与失败重试共用）
function runPublishTask(taskId, body, taskTitle, thumbDataUrl) {
  updatePublishTask(taskId, { status: PT_STATUS.PROCESSING });
  fetch('/api/upload/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async res => {
    // 后台会话失效（服务重启/过期）：明确提示重新登录，并刷新侧边栏登录状态
    if (res.status === 401) {
      const msg = '后台登录已失效，请刷新页面重新登录后再重试';
      updatePublishTask(taskId, { status: PT_STATUS.FAILED, error: msg });
      showToast('后台登录已失效，页面即将跳转登录页…', 'error');
      setTimeout(() => { window.location.href = './login.html'; }, 2000);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      updatePublishTask(taskId, { status: PT_STATUS.DONE, videoId: data.videoId, url: data.url || '' });
      // 同步写入「发布内容关联表」(yt_upload_records)，让关联表和 YT 视频列表同时出现该视频
      ytvSyncPublishTaskToHistory(taskId, data.videoId, data.url || '');
      showToast(`「${taskTitle}」发布成功：${data.url || ''}`, 'success');
      // AI 生成的封面随发布自动上传
      if (thumbDataUrl) {
        await uploadUytThumbnail(data.videoId, taskTitle);
      }
    } else {
      updatePublishTask(taskId, { status: PT_STATUS.FAILED, error: data.detail || data.error || '未知错误' });
      showToast(`「${taskTitle}」发布失败：${data.detail || data.error || '未知错误'}`, 'error');
    }
  }).catch(err => {
    updatePublishTask(taskId, { status: PT_STATUS.FAILED, error: err.message });
    showToast(`「${taskTitle}」发布失败：${err.message}`, 'error');
  });
}

// ─── 发布任务列表 ─────────────────────────────
const PUBLISH_TASKS_KEY = 'yt_publish_tasks';
// 状态机：排队中 → 处理中 → 已完成 / 失败（失败可重试 → 处理中）
const PT_STATUS = { QUEUED: '排队中', PROCESSING: '处理中', DONE: '已完成', FAILED: '失败' };

// 首次使用的示例数据（每种状态多条，覆盖不同频道/合集组/语言/操作人）
const PUBLISH_TASKS_SEED = [
  // 已完成 4 条
  { id: 'PTdemo01', title: 'Hidden Marriage CEO Sweet Love EP1', channelTitle: '天骄剧场', linkedCollection: 'Vlog 日常', language: '英语', operator: '王雪', videoUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4', status: '已完成', error: '', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', createdAt: '2026-09-22 09:15:00', finishedAt: '2026-09-22 09:17:20', retryBody: null },
  { id: 'PTdemo05', title: 'Rebirth of the Genius Doctor EP5', channelTitle: 'AI Agent', linkedCollection: '教程系列', language: '韩语', operator: '李强', videoUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4', status: '已完成', error: '', videoId: 'yPYZpwSpKmA', url: 'https://www.youtube.com/watch?v=yPYZpwSpKmA', createdAt: '2026-09-21 15:22:41', finishedAt: '2026-09-21 15:24:18', retryBody: null },
  { id: 'PTdemo06', title: 'The War God Returns EP2 - Back with a Vengeance', channelTitle: 'Rural AIGent', linkedCollection: '产品评测', language: '西班牙语', operator: '赵敏', videoUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', status: '已完成', error: '', videoId: 'aqz-KE-bpKQ', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', createdAt: '2026-09-20 10:08:15', finishedAt: '2026-09-20 10:11:42', retryBody: null },
  { id: 'PTdemo07', title: 'Sweet Trap - My Fierce Boyfriend EP8', channelTitle: '天骄剧场', linkedCollection: '开箱体验', language: '葡萄牙语', operator: '陈晨', videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4', status: '已完成', error: '', videoId: 'kJQP7kiw5Fk', url: 'https://www.youtube.com/watch?v=kJQP7kiw5Fk', createdAt: '2026-09-19 17:45:03', finishedAt: '2026-09-19 17:47:55', retryBody: null },
  // 处理中 3 条
  { id: 'PTdemo02', title: 'Rebirth of the Genius Doctor EP2', channelTitle: 'AI Agent', linkedCollection: '教程系列', language: '韩语', operator: '李强', videoUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', status: '处理中', error: '', videoId: '', url: '', createdAt: '2026-09-23 13:05:12', finishedAt: '', retryBody: null },
  { id: 'PTdemo08', title: 'Millennium Fox Fairy EP4 - Demon Hunter in Love', channelTitle: '天骄剧场', linkedCollection: '游戏实况', language: '泰语', operator: '王雪', videoUrl: 'https://media.w3.org/2010/05/video/movie_300.mp4', status: '处理中', error: '', videoId: '', url: '', createdAt: '2026-09-23 13:52:30', finishedAt: '', retryBody: null },
  { id: 'PTdemo09', title: 'Urban Master EP1 - Awakening Power', channelTitle: 'Rural AIGent', linkedCollection: '技术分享', language: '印尼语', operator: '陈晨', videoUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4', status: '处理中', error: '', videoId: '', url: '', createdAt: '2026-09-23 13:58:06', finishedAt: '', retryBody: null },
  // 失败 3 条
  { id: 'PTdemo03', title: 'Millennium Fox Fairy EP1', channelTitle: 'Rural AIGent', linkedCollection: '开箱体验', language: '西班牙语', operator: '赵敏', videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4', status: '失败', error: '下载视频失败: Client network socket disconnected', videoId: '', url: '', createdAt: '2026-09-23 12:44:30', finishedAt: '2026-09-23 12:45:02', retryBody: null },
  { id: 'PTdemo10', title: 'Hidden Marriage CEO Sweet Love EP3', channelTitle: 'AI Agent', linkedCollection: 'Vlog 日常', language: '英语', operator: '王雪', videoUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', status: '失败', error: '上传视频到 YouTube失败: uploadLimitExceeded 当日上传配额已用尽', videoId: '', url: '', createdAt: '2026-09-23 11:30:18', finishedAt: '2026-09-23 11:32:44', retryBody: null },
  { id: 'PTdemo11', title: 'The Wicked Prince Chases His Wife EP6', channelTitle: '天骄剧场', linkedCollection: '教程系列', language: '越南语', operator: '李强', videoUrl: 'https://media.w3.org/2010/05/video/movie_300.mp4', status: '失败', error: '下载视频失败: HTTP 状态码 404', videoId: '', url: '', createdAt: '2026-09-22 20:15:52', finishedAt: '2026-09-22 20:16:10', retryBody: null },
  // 排队中 2 条
  { id: 'PTdemo04', title: 'Boss Fight Scene - Full Episode 3', channelTitle: '天骄剧场', linkedCollection: '产品评测', language: '英语', operator: '陈晨', videoUrl: 'https://media.w3.org/2010/05/video/movie_300.mp4', status: '排队中', error: '', videoId: '', url: '', createdAt: '2026-09-23 13:40:00', finishedAt: '', retryBody: null },
  { id: 'PTdemo12', title: 'Wealthy Heiress Strikes Back EP2', channelTitle: 'Rural AIGent', linkedCollection: '游戏实况', language: '阿拉伯语', operator: '赵敏', videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4', status: '排队中', error: '', videoId: '', url: '', createdAt: '2026-09-23 14:02:33', finishedAt: '', retryBody: null }
];

// 演示数据（固定展示）：id 以 PTdemo 开头，localStorage 只存用户自建任务
const PT_HIDDEN_DEMO_KEY = 'publish_tasks_hidden_demo';

function isDemoPublishTask(t) {
  return !!(t && (t.isDemo || /^PTdemo/.test(String(t.id || ''))));
}

function getPublishTasks() {
  // 1. 读取用户自建任务（过滤掉旧版本误存进去的演示行）
  let userTasks = [];
  try {
    const d = JSON.parse(localStorage.getItem(PUBLISH_TASKS_KEY));
    if (Array.isArray(d)) userTasks = d.filter(t => !isDemoPublishTask(t));
  } catch (e) { userTasks = []; }
  // 旧状态值迁移（发布中→处理中，成功→已完成）
  let migrated = false;
  userTasks.forEach(t => {
    if (t.status === '发布中') { t.status = PT_STATUS.PROCESSING; migrated = true; }
    if (t.status === '成功') { t.status = PT_STATUS.DONE; migrated = true; }
  });
  if (migrated) localStorage.setItem(PUBLISH_TASKS_KEY, JSON.stringify(userTasks));
  // 2. 固定合并演示数据（可通过删除按钮隐藏，隐藏 id 记在独立 key）
  let hidden = [];
  try {
    const h = JSON.parse(localStorage.getItem(PT_HIDDEN_DEMO_KEY));
    if (Array.isArray(h)) hidden = h;
  } catch (e) { hidden = []; }
  const demo = PUBLISH_TASKS_SEED.filter(t => !hidden.includes(t.id)).map(t => ({ ...t, isDemo: true }));
  return [...userTasks, ...demo];
}

function savePublishTasks(tasks) {
  const userTasks = (Array.isArray(tasks) ? tasks : []).filter(t => !isDemoPublishTask(t));
  localStorage.setItem(PUBLISH_TASKS_KEY, JSON.stringify(userTasks));
}

function createPublishTask(info) {
  const tasks = getPublishTasks();
  const rec = {
    id: 'PT' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: info.title || '',
    channelId: info.channelId || '',
    channelTitle: info.channelTitle || '',
    linkedCollection: info.linkedCollection || '',
    language: info.language || '',
    operator: info.operator || '',
    videoUrl: info.videoUrl || '',
    status: PT_STATUS.QUEUED,
    error: '',
    videoId: '',
    url: '',
    retryBody: info.retryBody || null,
    createdAt: new Date().toLocaleString('sv-CH').replace('T', ' '),
    finishedAt: ''
  };
  tasks.unshift(rec);
  savePublishTasks(tasks);
  renderPublishTasks();
  return rec;
}

function updatePublishTask(id, patch) {
  const tasks = getPublishTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  if (patch.status === PT_STATUS.DONE || patch.status === PT_STATUS.FAILED) {
    t.finishedAt = new Date().toLocaleString('sv-CH').replace('T', ' ');
  }
  savePublishTasks(tasks);
  renderPublishTasks();
}

function deletePublishTask(id) {
  if (/^PTdemo/.test(String(id))) {
    // 演示行：记录隐藏 id，不再展示
    let hidden = [];
    try {
      const h = JSON.parse(localStorage.getItem(PT_HIDDEN_DEMO_KEY));
      if (Array.isArray(h)) hidden = h;
    } catch (e) { hidden = []; }
    if (!hidden.includes(id)) {
      hidden.push(id);
      localStorage.setItem(PT_HIDDEN_DEMO_KEY, JSON.stringify(hidden));
    }
  } else {
    savePublishTasks(getPublishTasks().filter(t => t.id !== id));
  }
  renderPublishTasks();
}

// 失败任务重试：状态 → 处理中，用创建时的请求体重发
function retryPublishTask(id) {
  const tasks = getPublishTasks();
  const t = tasks.find(x => x.id === id);
  if (!t || t.status !== PT_STATUS.FAILED) return;
  if (!t.retryBody) {
    showToast('该任务缺少原始发布参数（示例数据），无法重试。请重新发起发布', 'error');
    return;
  }
  updatePublishTask(id, { status: PT_STATUS.PROCESSING, error: '', videoId: '', url: '' });
  showToast(`「${t.title}」已重新开始发布…`, 'info');
  runPublishTask(t.id, t.retryBody, t.title);
}

// 发布状态标签
function pubTaskStatusTag(t) {
  if (t.status === PT_STATUS.DONE) return `<span class="table-tag success">已完成</span>`;
  if (t.status === PT_STATUS.PROCESSING) return `<span class="table-tag warn">处理中</span>`;
  if (t.status === PT_STATUS.QUEUED) return `<span class="table-tag gray">排队中</span>`;
  if (t.status === PT_STATUS.FAILED) return `<span class="table-tag danger" title="${escapeHtml(t.error || '')}">失败</span>`;
  return `<span class="table-tag gray">${escapeHtml(t.status)}</span>`;
}

// ─── 发布任务筛选（时间/视频ID/操作人/频道/合集组/语言/状态）──
const _ptFilterState = { dateFrom: '', dateTo: '', videoId: '', operator: '', channel: '', group: '', lang: '', status: '' };

function populatePtFilterOptions() {
  const tasks = getPublishTasks();
  const uniq = key => {
    const seen = new Set(); const out = [];
    tasks.forEach(t => { const v = t[key] || ''; if (v && !seen.has(v)) { seen.add(v); out.push(v); } });
    return out;
  };
  const fill = (selId, values, allLabel) => {
    const sel = $(selId);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (values.includes(cur)) sel.value = cur;
  };
  fill('#ptFilterOperator', uniq('operator'), '操作人(全部)');
  fill('#ptFilterChannel', uniq('channelTitle'), '频道(全部)');
  fill('#ptFilterGroup', uniq('linkedCollection'), '合集组(全部)');
  fill('#ptFilterLang', uniq('language'), '语言(全部)');
}

function resetPtFilter() {
  Object.assign(_ptFilterState, { dateFrom: '', dateTo: '', videoId: '', operator: '', channel: '', group: '', lang: '', status: '' });
  ['#ptFilterDateFrom', '#ptFilterDateTo'].forEach(s => { const el = $(s); if (el) el.value = ''; });
  const vidInput = $('#ptFilterVideoId');
  if (vidInput) vidInput.value = '';
  const stSel = $('#ptFilterStatus');
  if (stSel) stSel.value = '';
  populatePtFilterOptions();
  renderPublishTasks();
}

function renderPublishTasks() {
  const all = getPublishTasks();
  const tbody = $('#pubTaskTableBody');
  const wrap = $('#pubTaskTableWrap');
  const empty = $('#pubTaskEmpty');
  const hint = $('#pubTaskCountHint');
  if (!tbody || !wrap || !empty) return;

  // 同步筛选下拉选项（保留当前选中）
  populatePtFilterOptions();

  // 应用筛选：日期范围（含当天）+ 视频ID模糊 + 操作人/频道/合集组/语言/状态精确匹配
  const tasks = all.filter(t => {
    const f = _ptFilterState;
    if (f.dateFrom && (t.createdAt || '') < f.dateFrom + ' 00:00:00') return false;
    if (f.dateTo && (t.createdAt || '') > f.dateTo + ' 23:59:59') return false;
    if (f.videoId && !((t.videoId || '') + (t.url || '')).toLowerCase().includes(f.videoId.toLowerCase())) return false;
    if (f.operator && (t.operator || '') !== f.operator) return false;
    if (f.channel && (t.channelTitle || '') !== f.channel) return false;
    if (f.group && (t.linkedCollection || '') !== f.group) return false;
    if (f.lang && (t.language || '') !== f.lang) return false;
    if (f.status && (t.status || '') !== f.status) return false;
    return true;
  });

  if (hint) {
    const okN = all.filter(t => t.status === PT_STATUS.DONE).length;
    const failN = all.filter(t => t.status === PT_STATUS.FAILED).length;
    const doingN = all.filter(t => t.status === PT_STATUS.PROCESSING).length;
    const queuedN = all.filter(t => t.status === PT_STATUS.QUEUED).length;
    const base = `共 ${all.length} 条 · 已完成 ${okN} · 处理中 ${doingN} · 排队中 ${queuedN} · 失败 ${failN}`;
    hint.textContent = all.length ? (all.length === tasks.length ? base : `${base} · 筛选出 ${tasks.length} 条`) : '';
  }

  if (tasks.length === 0) {
    empty.style.display = 'block';
    wrap.style.display = 'none';
    const emptyDesc = $('#ptEmptyDesc');
    if (emptyDesc && all.length > 0) {
      empty.querySelector('h3').textContent = '没有匹配的任务';
      emptyDesc.textContent = '调整筛选条件或清空筛选后再试';
    } else if (empty.querySelector('h3')) {
      empty.querySelector('h3').textContent = '暂无发布任务';
      if (emptyDesc) emptyDesc.textContent = '在「翻译合成视频」详情页点「上传YT」创建的发布任务会展示在这里';
    }
    return;
  }
  empty.style.display = 'none';
  wrap.style.display = 'block';

  tbody.innerHTML = tasks.map(t => `
    <tr>
      <td class="col-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</td>
      <td class="col-video-id">${t.videoId
        ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(t.videoId)}" target="_blank" rel="noopener" class="pt-video-id-link">${escapeHtml(t.videoId)}</a>`
        : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(t.channelTitle || t.channelId || '—')}</td>
      <td>${t.linkedCollection ? `<span class="linked-collection-tag">${escapeHtml(t.linkedCollection)}</span>` : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(t.language || '—')}</td>
      <td class="col-operator">${t.operator
        ? `<span class="operator-cell"><span class="operator-avatar">${escapeHtml(t.operator.slice(-1))}</span>${escapeHtml(t.operator)}</span>`
        : '<span class="cell-empty">—</span>'}</td>
      <td>${escapeHtml(t.createdAt)}</td>
      <td class="col-status">${pubTaskStatusTag(t)}${t.status === PT_STATUS.FAILED && t.error
        ? `<div class="pt-error-text" title="${escapeHtml(t.error)}">${escapeHtml(t.error)}</div>` : ''}</td>
      <td class="col-actions">
        <div class="action-btns">
          ${t.status === PT_STATUS.FAILED ? `
            <button class="btn-retry" data-task-retry="${escapeHtml(t.id)}" title="重新发布该任务">重试</button>
          ` : ''}
          ${t.status === PT_STATUS.QUEUED ? `
            <button class="btn-delete" data-task-del="${escapeHtml(t.id)}" title="删除该排队任务">删除</button>
          ` : ''}
          ${t.status === PT_STATUS.PROCESSING ? '' : ''}
        </div>
      </td>
    </tr>
  `).join('');

  $$('.btn-delete[data-task-del]', tbody).forEach(btn => {
    btn.addEventListener('click', () => deletePublishTask(btn.dataset.taskDel));
  });
  $$('.btn-retry[data-task-retry]', tbody).forEach(btn => {
    btn.addEventListener('click', () => retryPublishTask(btn.dataset.taskRetry));
  });
}

function initPublishTasksPage() {
  const navItem = $('.nav-item[data-page="pubtasks"]');
  if (navItem) {
    navItem.addEventListener('click', () => renderPublishTasks());
  }
  // 筛选事件
  const bind = (sel, key, isDate) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(isDate ? 'change' : 'change', () => {
      _ptFilterState[key] = el.value;
      renderPublishTasks();
    });
  };
  bind('#ptFilterDateFrom', 'dateFrom', true);
  bind('#ptFilterDateTo', 'dateTo', true);
  bind('#ptFilterOperator', 'operator');
  bind('#ptFilterChannel', 'channel');
  bind('#ptFilterGroup', 'group');
  bind('#ptFilterLang', 'lang');
  bind('#ptFilterStatus', 'status');
  // 视频ID筛选：输入防抖
  const vidInput = $('#ptFilterVideoId');
  if (vidInput) {
    let _ptVidDebounce = null;
    vidInput.addEventListener('input', () => {
      clearTimeout(_ptVidDebounce);
      _ptVidDebounce = setTimeout(() => {
        _ptFilterState.videoId = vidInput.value;
        renderPublishTasks();
      }, 200);
    });
  }
  const resetBtn = $('#ptFilterReset');
  if (resetBtn) resetBtn.addEventListener('click', resetPtFilter);
  renderPublishTasks();
}

// ─── 合成视频预览 ────────────────────────────
const SAMPLE_VIDEO_URLS = [
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://media.w3.org/2010/05/bunny/movie.mp4',
  'https://media.w3.org/2010/05/video/movie_300.mp4'
];

function getEpisodeVideoUrl(ep, idx) {
  // 自建内容：发布时把服务端相对路径拼成当前站点的回环 URL，
  // 由 /api/upload/from-url 下载后再推 YouTube（不写死端口，换端口也不会失效）
  if (ep.localFile) return `${window.location.origin}/uploads/${String(ep.localFile).replace(/^\/+/, '')}`;
  // mock：基于 idx 分配示例视频链接（演示用；实际接入后端时直接读 ep.videoUrl）
  if (ep.videoUrl) return ep.videoUrl;
  return SAMPLE_VIDEO_URLS[idx % SAMPLE_VIDEO_URLS.length];
}

let _videoPreviewBound = false;

function openVideoPreview(ep, idx) {
  const mask = $('#videoPreviewMask');
  const player = $('#videoPreviewPlayer');
  const titleEl = $('#videoPreviewTitle');
  const metaEl = $('#videoPreviewMeta');
  if (!mask || !player) return;

  const url = getEpisodeVideoUrl(ep, idx);
  player.src = url;
  player.load();

  const col = getTranslationCollections().find(c => c.id === _translationDetailId);
  const colName = col ? col.name : '合集';
  titleEl.textContent = `${colName} · ${ep.language} · ${ep.type}`;

  metaEl.innerHTML = `
    <div class="video-preview-meta-row"><span class="meta-k">语言</span><span class="meta-v">${escapeHtml(ep.language)}</span></div>
    <div class="video-preview-meta-row"><span class="meta-k">模版</span><span class="meta-v">${escapeHtml(ep.template || '—')}</span></div>
    <div class="video-preview-meta-row"><span class="meta-k">类型</span><span class="meta-v">${escapeHtml(ep.type)}</span></div>
    <div class="video-preview-meta-row"><span class="meta-k">输出</span><span class="meta-v">${escapeHtml(ep.outputType)}</span></div>
    <div class="video-preview-meta-row"><span class="meta-k">合成时间</span><span class="meta-v">${escapeHtml(ep.createdAt)}</span></div>
    <div class="video-preview-meta-row video-preview-url-row"><span class="meta-k">视频链接</span><span class="meta-v video-preview-url"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></span></div>
  `;

  mask.style.display = 'flex';
  // 自动播放（部分浏览器需要显式调用 play）
  try { player.play().catch(() => {}); } catch {}

  if (!_videoPreviewBound) {
    _videoPreviewBound = true;
    const closeBtn = $('#videoPreviewClose');
    if (closeBtn) closeBtn.addEventListener('click', closeVideoPreview);
    mask.addEventListener('click', e => {
      if (e.target === mask) closeVideoPreview();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mask.style.display !== 'none') closeVideoPreview();
    });
  }
}

function closeVideoPreview() {
  const mask = $('#videoPreviewMask');
  const player = $('#videoPreviewPlayer');
  if (!mask) return;
  mask.style.display = 'none';
  if (player) {
    try { player.pause(); } catch {}
    player.removeAttribute('src');
    player.load();
  }
}

// ─── 跳转至"上传视频"并自动填充视频链接 ─────
function navigateToUploadWithUrl(url, ep) {
  // 1. 切换侧边栏高亮与页面
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const uploadNav = $('.nav-item[data-page="upload"]');
  if (uploadNav) uploadNav.classList.add('active');
  $$('.page').forEach(p => p.classList.remove('active'));
  const uploadPage = $('#page-upload');
  if (uploadPage) uploadPage.classList.add('active');

  // 2. 回到步骤 1（统一入口）
  if (typeof goToStep === 'function') goToStep(1);

  // 3. 根据 url 反查所属合集+剧集，选中 sourceEpisode
  const srcSel = $('#sourceEpisode');
  if (srcSel) {
    const collections = getTranslationCollections();
    let matched = null;
    for (const col of collections) {
      const idx = (col.episodes || []).findIndex((e, i) => getEpisodeVideoUrl(e, i) === url);
      if (idx >= 0) {
        matched = `${col.id}-${idx}`;
        break;
      }
    }
    if (matched) {
      srcSel.value = matched;
      // 同步显示框文字 + ul 中 selected 标记
      const matchedOpt = srcSel.options[srcSel.selectedIndex];
      const srcDisp = $('#sourceEpisodeDisplay');
      if (srcDisp && matchedOpt) srcDisp.value = matchedOpt.textContent;
      const ul = $('#sourceOptions');
      if (ul) {
        $$('#sourceOptions li').forEach(li => li.classList.remove('selected'));
        const li = ul.querySelector(`li[data-value="${matched}"]`);
        if (li) li.classList.add('selected');
      }
      srcSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  showToast(`已跳转到上传页面，并自动选中对应剧集`, 'success');
}

// 返回合集列表
function goBackTranslationList() {
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-page="translation"]`);
  if (navItem) navItem.classList.add('active');

  $$('.page').forEach(p => p.classList.remove('active'));
  $('#page-translation').classList.add('active');
  switchTsTab('system');
}

// 初始化翻译合成页面（导航切换时渲染列表）
function initTranslationPage() {
  const navItem = $(`.nav-item[data-page="translation"]`);
  if (navItem) {
    navItem.addEventListener('click', () => {
      // switchPage 处理高亮与页面切换，这里确保列表被渲染
      renderTsActiveTab();
    });
  }
  const backBtn = $('#translationBtnBack');
  if (backBtn) backBtn.addEventListener('click', goBackTranslationList);

  // 来源 Tab（翻译系统 / 自建内容）
  $$('#tsTabs .ins-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTsTab(tab.dataset.tsTab));
  });
  const selfAddBtn = $('#selfAddBtn');
  if (selfAddBtn) selfAddBtn.addEventListener('click', openSelfAdd);

  // 自建内容：新增/编辑弹窗
  const selfEditClose = $('#selfEditCloseBtn');
  if (selfEditClose) selfEditClose.addEventListener('click', closeSelfEdit);
  const selfEditCancel = $('#selfEditCancelBtn');
  if (selfEditCancel) selfEditCancel.addEventListener('click', closeSelfEdit);
  const selfEditSave = $('#selfEditSaveBtn');
  if (selfEditSave) selfEditSave.addEventListener('click', saveSelfEdit);
  const selfEditMask = $('#selfEditMask');
  if (selfEditMask) selfEditMask.addEventListener('click', e => { if (e.target === selfEditMask) closeSelfEdit(); });
  const selfEditForm = $('#selfEditForm');
  if (selfEditForm) selfEditForm.addEventListener('submit', e => { e.preventDefault(); saveSelfEdit(); });

  // 自建内容：详情页返回 + 上传视频
  const selfBackBtn = $('#selfDetailBtnBack');
  if (selfBackBtn) selfBackBtn.addEventListener('click', goBackSelfList);
  const selfDetailUploadBtn = $('#selfDetailUploadBtn');
  if (selfDetailUploadBtn) selfDetailUploadBtn.addEventListener('click', () => openSelfVideoModal(_selfDetailId));

  // 一级列表筛选事件
  const tsNameInput = $('#tsFilterName');
  if (tsNameInput) {
    let _tsDebounce = null;
    tsNameInput.addEventListener('input', () => {
      clearTimeout(_tsDebounce);
      _tsDebounce = setTimeout(() => {
        _tsFilterState.name = tsNameInput.value;
        renderTsActiveTab();
      }, 200);
    });
  }
  const tsGroupSel = $('#tsFilterGroup');
  if (tsGroupSel) tsGroupSel.addEventListener('change', () => {
    _tsFilterState.group = tsGroupSel.value;
    renderTsActiveTab();
  });
  const tsResetBtn = $('#tsFilterReset');
  if (tsResetBtn) tsResetBtn.addEventListener('click', resetTranslationFilter);

  // 编辑关联合集弹窗事件
  const editClose = $('#translationEditClose');
  if (editClose) editClose.addEventListener('click', closeTranslationEdit);
  const editCancel = $('#translationEditCancel');
  if (editCancel) editCancel.addEventListener('click', closeTranslationEdit);
  const editSave = $('#translationEditSave');
  if (editSave) editSave.addEventListener('click', saveTranslationEdit);
  const editMask = $('#translationEditMask');
  if (editMask) editMask.addEventListener('click', (e) => { if (e.target === editMask) closeTranslationEdit(); });
  const editForm = $('#translationEditForm');
  if (editForm) editForm.addEventListener('submit', (e) => { e.preventDefault(); saveTranslationEdit(); });

  // 初始停在「翻译系统」Tab（也会触发一次列表渲染）
  switchTsTab('system');
}

// ══════════════════════════════════════════════════════════
//  字幕翻译抽屉
// ──────────────────────────────────────────────────────────
//  自动化本身不在这个项目里跑，而是交给同机的「字幕操作台」
//  （youtube-subtitle-tool，Playwright 驱动 YouTube Studio，
//   默认监听 127.0.0.1:8765）。前端只做三件事：
//    1) 把「视频地址 + 目标语言 + 目标账号」交给服务端，由服务端转发给操作台；
//    2) 按 seq 增量拉日志并渲染（服务端会带回 running / exit_code / cmd_short）；
//    3) 操作台没启动时给出可操作的启动指引，而不是静默失败。
//  服务端路由见 server.js 的 /api/subtitle/*。
//  标准流程固定为：先翻译字幕 → 再翻译并填写标题/说明（不暴露其它模式）。
// ══════════════════════════════════════════════════════════

// 关联表「语言」字段（字典值）→ 字幕工具语言代码。
// 字典里叫「英文/日文」，历史种子数据里叫「英语/日语」，两种叫法都要认。
const SUBTITLE_SRC_LANG_MAP = {
  '英文': 'en', '英语': 'en', en: 'en', English: 'en',
  '中文（简体）': 'zh-Hans', '中文(简体)': 'zh-Hans', '简体中文': 'zh-Hans', '中文': 'zh-Hans',
  '中文（繁体）': 'zh-Hant', '中文(繁体)': 'zh-Hant', '繁体中文': 'zh-Hant',
  '日文': 'ja', '日语': 'ja', ja: 'ja',
  '韩文': 'ko', '韩语': 'ko', ko: 'ko',
  '泰文': 'th', '泰语': 'th', th: 'th',
  '越南文': 'vi', '越南语': 'vi', vi: 'vi',
  '西班牙文': 'es', '西班牙语': 'es', es: 'es',
  '葡萄牙文': 'pt', '葡萄牙语': 'pt', pt: 'pt',
  '印尼语': 'id', '印尼文': 'id', id: 'id',
  '阿拉伯语': 'ar', '阿拉伯文': 'ar', ar: 'ar',
  '法文': 'fr', '法语': 'fr', fr: 'fr',
  '德文': 'de', '德语': 'de', de: 'de',
  '俄文': 'ru', '俄语': 'ru', ru: 'ru',
  '土耳其语': 'tr', '土耳其文': 'tr', tr: 'tr',
  '马来语': 'ms', '马来文': 'ms', ms: 'ms',
  '菲律宾语': 'fil', fil: 'fil',
  '印地语': 'hi', hi: 'hi'
};

// 兜底语言清单（正常从 /api/subtitle/langs 取，与 webui.py 的 LANGS 同源）
const SUBTITLE_LANGS_FALLBACK = [
  { code: 'en', label: '英语 English' },
  { code: 'es', label: '西班牙语 Spanish' },
  { code: 'pt', label: '葡萄牙语 Portuguese' },
  { code: 'ar', label: '阿拉伯语 Arabic' },
  { code: 'id', label: '印尼语 Indonesian' },
  { code: 'th', label: '泰语 Thai' },
  { code: 'vi', label: '越南语 Vietnamese' },
  { code: 'ja', label: '日语 Japanese' },
  { code: 'ko', label: '韩语 Korean' },
  { code: 'zh-Hans', label: '中文简体' },
  { code: 'zh-Hant', label: '中文繁體' },
  { code: 'fr', label: '法语 French' },
  { code: 'de', label: '德语 German' },
  { code: 'ru', label: '俄语 Russian' },
  { code: 'tr', label: '土耳其语 Turkish' },
  { code: 'ms', label: '马来语 Malay' },
  { code: 'fil', label: '菲律宾语 Filipino' },
  { code: 'hi', label: '印地语 Hindi' }
];

// 「常用组合」快捷选择 —— 与字幕操作台 webui.py 的 pick-common 完全一致
const SUBTITLE_COMMON_LANGS = ['en', 'es', 'pt', 'id', 'th', 'vi'];

const SUBTITLE_CONSOLE_URL = 'http://127.0.0.1:8765';
// 与操作台 webui.py 的轮询间隔一致（1200ms）
const SUBTITLE_POLL_MS = 1200;

const subtitleState = {
  recordIdx: -1,
  langs: [],
  selected: new Set(),
  srcLang: '',        // 源语言代码：对应项置灰不可选
  seq: 0,             // 日志增量游标
  timer: null,
  running: false,
  reachable: null,    // null=未检测 / true=已连接 / false=连不上
  hadRun: false,      // 是否发起过任务（决定状态显示「空闲」还是「已结束（退出码 N）」）
  exitCode: null,
  cmdShort: '',
  logLines: [],       // 当前任务的原始日志行（解析自动翻译成功的语言用）
  runVideoId: '',     // 当前任务对应的视频ID（结束时回写字幕语言）
  base: SUBTITLE_CONSOLE_URL,
  accountsLoaded: false,
  launching: false,     // 正在一键启动操作台（按钮置灰防重复点）
  batch: null           // 批量模式：{items:[{videoId,channelId,...,status}], active, abort, cur, done, fail}
};

function subtitleIsOpen() {
  const mask = $('#subtitleDrawerMask');
  return !!mask && mask.style.display !== 'none';
}

async function subtitleApi(path, options) {
  const res = await fetch(path, options);
  let data = {};
  try { data = await res.json(); } catch (e) { /* 非 JSON 响应按空对象处理 */ }
  if (!res.ok) {
    const err = new Error(data.error || data.msg || `请求失败（HTTP ${res.status}）`);
    err.data = data;
    throw err;
  }
  return data;
}

// 连不上操作台时，光说"失败"没用——把"下一步点哪儿"一起塞进 toast
function subtitleErrText(prefix, e) {
  const hasHint = !!(e && e.data && e.data.hint);
  return hasHint ? `${prefix}：${e.message}。点右上角「启动字幕操作台」即可` : `${prefix}：${e.message}`;
}

// 状态条只在「连不上 / 正在启动」时出现；连接正常时整个页面就是操作台，不留状态卡
function setSubtitleStatus(kind, title, hintHtml) {
  const box = $('#subtitleStatus');
  if (!box) return;
  box.classList.remove('ok', 'down', 'busy');
  if (kind) box.classList.add(kind);
  box.style.display = (kind === 'down' || kind === 'busy') ? 'flex' : 'none';
  const t = $('#subtitleStatusTitle');
  if (t) t.innerHTML = `<b>${escapeHtml(title)}</b>`;
  const h = $('#subtitleStatusHint');
  if (h) h.innerHTML = hintHtml || '';
}

function updateSubtitleButtons() {
  const startBtn = $('#subtitleStart');
  const stopBtn = $('#subtitleStop');
  const connected = subtitleState.reachable === true;
  const batch = subtitleState.batch;
  const busy = subtitleState.running || (batch && batch.active);
  if (startBtn) {
    startBtn.disabled = !connected || busy || subtitleState.selected.size === 0;
    if (batch) startBtn.textContent = batch.active ? `批量执行中 ${batch.cur}/${batch.items.length}…` : '开始批量执行';
    else startBtn.textContent = '开始执行';
  }
  if (stopBtn) stopBtn.disabled = !connected || !busy;
  // 状态卡上的入口：未连接时是「启动字幕操作台」，已连接变成「打开操作台」
  const consoleBtn = $('#subtitleConsoleAction');
  if (consoleBtn) {
    consoleBtn.textContent = connected ? '打开操作台' : '启动字幕操作台';
    consoleBtn.disabled = !!subtitleState.launching;
  }
  renderSubtitleRunState();
}

// 运行状态机与操作台 webui.py 一致：
//   未跑过 → 空闲；running → 执行中（cmd_short）；跑过且已结束 → 已结束（退出码 N）
// 额外的「未连接 / 检测中」是本项目特有的降级态（操作台是外部服务）
function renderSubtitleRunState() {
  const el = $('#subtitleRunState');
  if (!el) return;
  const batch = subtitleState.batch;
  let cls = '';
  let text = '';
  if (subtitleState.reachable === null) {
    text = '检测中…';
  } else if (subtitleState.reachable !== true) {
    text = '未连接';
  } else if (batch && batch.active) {
    // 批量模式：显示第几个 + 成功/失败统计
    cls = 'run';
    text = `批量执行中 ${batch.cur}/${batch.items.length}（成功 ${batch.done} · 失败 ${batch.fail}）`;
  } else if (subtitleState.running) {
    cls = 'run';
    // 命令全文已经在上面的命令条里展示，这里只放个短摘要，避免把状态栏撑开
    const short = subtitleState.cmdShort.length > 30
      ? subtitleState.cmdShort.slice(0, 30) + '…'
      : subtitleState.cmdShort;
    text = short ? `执行中（${short}）` : '执行中';
  } else if (batch && batch.done + batch.fail > 0) {
    cls = batch.fail ? 'err' : 'done';
    text = `批量已结束（成功 ${batch.done} · 失败 ${batch.fail}）`;
  } else if (subtitleState.hadRun && subtitleState.exitCode !== null) {
    cls = subtitleState.exitCode === 0 ? 'done' : 'err';
    text = `已结束（退出码 ${subtitleState.exitCode}）`;
  } else {
    text = '空闲';
  }
  el.innerHTML = `<span class="sub-dot ${cls}"></span>${escapeHtml(text)}`;
}

// 发起一次新任务前重置：与操作台 webui.py 的 window._had_run / _seq / log 清空等价
function resetSubtitleRun() {
  subtitleState.hadRun = true;
  subtitleState.seq = 0;
  subtitleState.exitCode = null;
  subtitleState.running = false;
  subtitleState.cmdShort = '';
  subtitleState.logLines = [];   // 每个任务的日志独立解析
  subtitleState.runVideoId = ''; // 由任务发起方(subtitleStartRun/批量循环)重新赋值
  const logEl = $('#subtitleLog');
  if (logEl) logEl.innerHTML = '';
  const cmdEl = $('#subtitleCmd');
  if (cmdEl) cmdEl.textContent = '—';
}

// ─── 自动翻译成功语言的解析与回写 ───────────────────────────

// 从视频地址提取 11 位视频 ID（支持 watch / youtu.be / shorts / 纯 ID）
function subtitleExtractVideoId(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return '';
}

// 解析日志中「自动翻译成功生成字幕」的语言代码（依据 main.py / studio_uploader.py 输出格式）：
//   metadata 流程（admin 固定走这条）：'  ✓ [es] 字幕已生成并发布，继续填写标题/说明'
//   auto 流程（CLI 兼容）：'▶ [es] YouTube 自动翻译中...' 后跟 '✓ 自动翻译完成并已发布/保存'
//                          / '→ 该语言轨道已存在，跳过'（已存在也算有字幕）
//                          / '→ [es] 今日已成功处理过，跳过'（此前已成功，字幕已存在）
// 注意：'✓ 已填写并保存'（仅标题/说明成功）不算新字幕语言 —— 那时字幕要么发布时已传、
// 要么此前已生成（对应轮次的日志已回写过），避免重复计数之外的误判。
function subtitleParseOkLangs(lines) {
  const ok = new Set();
  let cur = '';
  for (const raw of lines || []) {
    const line = String(raw);
    const direct = line.match(/✓\s*\[([A-Za-z][A-Za-z0-9_-]*)\]\s*字幕已生成并发布/);
    if (direct) { ok.add(direct[1]); continue; }
    const start = line.match(/[→▶]\s*\[([A-Za-z][A-Za-z0-9_-]*)\]/);
    if (start) cur = start[1];
    if (cur && (
      /今日已成功处理过，跳过/.test(line) ||
      /✓\s*自动翻译完成并已发布/.test(line) ||
      /该语言轨道已存在，跳过/.test(line)
    )) ok.add(cur);
  }
  return [...ok];
}

// 任务结束瞬间可能还有尾巴行没被轮询取到，单独补拉一次增量日志
async function subtitleFetchLogOnce() {
  try {
    const d = await subtitleApi(`/api/subtitle/log?seq=${subtitleState.seq}`);
    if (Array.isArray(d.lines) && d.lines.length) appendSubtitleLog(d.lines);
    if (typeof d.seq === 'number') subtitleState.seq = d.seq;
  } catch (e) { /* 拉不到就按已积累的日志解析，尽力而为 */ }
}

// 任务结束后结算字幕语言：补拉日志 → 解析成功语言 → 合并进记录（幂等，可安全重复调用）
async function subtitleFinalizeLangs(videoId) {
  const vid = String(videoId || subtitleState.runVideoId || '').trim();
  if (!vid) return;
  await subtitleFetchLogOnce();
  const langs = subtitleParseOkLangs(subtitleState.logLines);
  if (langs.length) updateRecordSubtitleLangs(vid, langs);
}

function updateSubtitleLangCount() {
  const el = $('#subtitleLangCount');
  if (el) el.textContent = `已选 ${subtitleState.selected.size} 种`;
}

// ─── 语言模板：保存当前勾选为命名模板 / 选模板快速勾选 ──────────
// localStorage 结构：[{name, langs:[code...]}]，同一名称覆盖保存
const SUBTITLE_TPL_KEY = 'yt_subtitle_lang_templates';

function getSubtitleTemplates() {
  try {
    const arr = JSON.parse(localStorage.getItem(SUBTITLE_TPL_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(t => t && t.name && Array.isArray(t.langs)) : [];
  } catch (e) { return []; }
}

function saveSubtitleTemplates(list) {
  localStorage.setItem(SUBTITLE_TPL_KEY, JSON.stringify(list));
}

// 刷新模板下拉选项（保留当前选择）
function renderSubtitleTemplates() {
  const sel = $('#subtitleTplSelect');
  if (!sel) return;
  const cur = sel.value;
  const list = getSubtitleTemplates();
  sel.innerHTML = '<option value="">选择语言模板…</option>' +
    list.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}（${t.langs.length} 种）</option>`).join('');
  // 之前的索引可能因删除而失效，只在与现有项匹配时恢复
  const opt = sel.querySelector(`option[value="${cur}"]`);
  sel.value = opt ? cur : '';
}

// 应用模板：勾选模板里的全部语言（过滤掉语言表里不存在的代码与源语言）
function applySubtitleTemplate() {
  const sel = $('#subtitleTplSelect');
  if (!sel || !sel.value) {
    showToast('请先在下拉里选择一个模板', 'warning');
    return;
  }
  const tpl = getSubtitleTemplates()[Number(sel.value)];
  if (!tpl) return;
  const known = new Set(subtitleState.langs.map(l => l.code));
  const langs = tpl.langs.filter(c => known.has(c) && c !== subtitleState.srcLang);
  if (!langs.length) {
    showToast('该模板里的语言在当前语言表里都不可用（或都是源语言）', 'warning');
    return;
  }
  subtitleState.selected = new Set(langs);
  renderSubtitleLangs();
  updateSubtitleButtons();
  showToast(`已应用模板「${tpl.name}」：勾选 ${langs.length} 种语言`, 'success');
}

// 保存模板：自定义命名；重名覆盖，保存的是当前勾选的语言
function saveSubtitleTemplate() {
  const nameEl = $('#subtitleTplName');
  const name = (nameEl?.value || '').trim();
  if (!name) {
    showToast('请先填写模板名称', 'warning');
    nameEl?.focus();
    return;
  }
  if (!subtitleState.selected.size) {
    showToast('当前没有勾选任何语言，先勾选再保存模板', 'warning');
    return;
  }
  const list = getSubtitleTemplates();
  const langs = [...subtitleState.selected];
  const exist = list.findIndex(t => t.name === name);
  if (exist >= 0) {
    list[exist].langs = langs;
    showToast(`模板「${name}」已更新（${langs.length} 种语言）`, 'success');
  } else {
    list.push({ name, langs });
    showToast(`模板「${name}」已保存（${langs.length} 种语言）`, 'success');
  }
  saveSubtitleTemplates(list);
  if (nameEl) nameEl.value = '';
  renderSubtitleTemplates();
  const sel = $('#subtitleTplSelect');
  if (sel) sel.value = String(list.findIndex(t => t.name === name));
}

// 删除选中的模板
function deleteSubtitleTemplate() {
  const sel = $('#subtitleTplSelect');
  if (!sel || !sel.value) {
    showToast('请先在下拉里选择要删除的模板', 'warning');
    return;
  }
  const idx = Number(sel.value);
  const list = getSubtitleTemplates();
  const tpl = list[idx];
  if (!tpl) return;
  list.splice(idx, 1);
  saveSubtitleTemplates(list);
  renderSubtitleTemplates();
  showToast(`模板「${tpl.name}」已删除`, 'info');
}

function renderSubtitleLangs() {
  const grid = $('#subtitleLangGrid');
  if (!grid) return;
  grid.innerHTML = subtitleState.langs.map(l => {
    const on = subtitleState.selected.has(l.code);
    const isSrc = l.code === subtitleState.srcLang;
    // 标签形如「西班牙语 Spanish」：中文名正常字号，英文名缩小并淡显，避免换行导致高度参差
    const parts = String(l.label || '').split(' ');
    const zhName = parts.shift() || '';
    const enName = parts.join(' ');
    return `<div class="sub-lang${on ? ' on' : ''}${isSrc ? ' src' : ''}" data-lang="${escapeHtml(l.code)}"${isSrc ? ' title="该视频本身的语言，无需翻译"' : ''}>`
      + '<span class="chk">✓</span>'
      + `<span class="nm">${escapeHtml(zhName)}</span>`
      + (enName ? `<span class="en">${escapeHtml(enName)}</span>` : '')
      + (isSrc ? '<span class="tag-src">源</span>' : '')
      + '</div>';
  }).join('');

  $$('.sub-lang', grid).forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.lang;
      if (code === subtitleState.srcLang) return;
      if (subtitleState.selected.has(code)) subtitleState.selected.delete(code);
      else subtitleState.selected.add(code);
      renderSubtitleLangs();
      updateSubtitleButtons();
    });
  });
  updateSubtitleLangCount();
}

// 服务端健康探测：连不上时给启动指引
async function subtitleCheckHealth(probeOnly) {
  try {
    const d = await subtitleApi('/api/subtitle/health');
    subtitleState.reachable = d.reachable === true;
    // probeOnly（打开抽屉时的轻探测）：只更新连通性，不接管「执行中」状态——
    // 操作台侧可能有残留任务（如登录浏览器还开着），进入抽屉默认不显示为执行中
    if (!probeOnly) subtitleState.running = !!d.running;
    if (d.base) subtitleState.base = d.base;
    if (d.reachable) {
      refreshSubtitleStatus();
    } else {
      const hint = escapeHtml(d.error || '')
        + (d.hint ? `<br><code>${escapeHtml(d.hint)}</code>` : '');
      setSubtitleStatus('down', '未连接到字幕操作台', hint);
    }
    updateSubtitleButtons();
    return d;
  } catch (e) {
    subtitleState.reachable = false;
    if (!probeOnly) subtitleState.running = false;
    setSubtitleStatus('down', '未连接到字幕操作台', escapeHtml(e.message));
    updateSubtitleButtons();
    return { reachable: false };
  }
}

// 已连接时不展示状态卡（页面本身就是操作台）；断线提示由 subtitleCheckHealth / 轮询的 catch 负责
function refreshSubtitleStatus() {
  if (subtitleState.reachable !== true) return;
  setSubtitleStatus('ok', '', '');
}

// 拉取可切换账号：需要现启 Playwright，约 10~30 秒；同一会话只自动拉一次
// 提示文案与操作台 webui.py 的 loadAccounts() 一致（加载中 / 共 N 个 / 只有 1 个 / 报错）
async function subtitleLoadAccounts(force) {
  const sel = $('#subtitleAccount');
  if (!sel) return;
  if (subtitleState.accountsLoaded && !force) return;
  // 拉取是独占动作（操作台要起浏览器占 profile），并发来两次必有一次撞锁报错
  if (subtitleState.accountsLoading) return;
  subtitleState.accountsLoading = true;

  const hint = $('#subtitleAccountHint');
  const setHint = (text, isErr) => {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.toggle('err', !!isErr);
  };

  if (subtitleState.reachable !== true) {
    setHint('⚠ 字幕操作台未连接，无法拉取账号列表', true);
    return;
  }

  const btn = $('#subtitleReloadAccounts');
  const prev = sel.value;
  const defaultOpt = '<option value="">当前账号（不切换）</option>';
  setHint('正在加载可切换账号（拉起浏览器约 5-10 秒）…', false);
  if (btn) { btn.disabled = true; btn.textContent = '拉取中…'; }
  sel.disabled = true;
  sel.innerHTML = defaultOpt;

  try {
    const d = await subtitleApi('/api/subtitle/accounts');
    const list = Array.isArray(d.accounts) ? d.accounts : [];
    sel.innerHTML = defaultOpt + list.map(a => `<option value="${escapeHtml(a.text)}">${escapeHtml(a.text)}</option>`).join('');
    if (prev) sel.value = prev;
    if (d.ok && list.length) {
      setHint(`共 ${list.length} 个可切换账号/频道。选了具体账号后，任务执行前会自动切过去。`, false);
      subtitleState.accountsLoaded = true;
    } else if (d.error) {
      setHint('⚠ ' + d.error, true);
    } else {
      setHint('当前登录态中只有 1 个账号，无可切换目标。', false);
    }
  } catch (e) {
    sel.innerHTML = defaultOpt;
    setHint('⚠ 拉取失败：' + e.message, true);
  } finally {
    subtitleState.accountsLoading = false;
    sel.disabled = false;
    if (btn) { btn.disabled = false; btn.textContent = '刷新账号列表'; }
  }
}

// 日志着色规则与操作台 webui.py 一致（顺序也一致：先判成功，再判失败，最后警告）
function subtitleLogClass(line) {
  const s = String(line);
  if (/✓|成功/.test(s)) return 'lg-ok';
  if (/✗|失败|错误|Traceback/.test(s)) return 'lg-err';
  if (/⚠|警告|→/.test(s)) return 'lg-warn';
  return '';
}

function appendSubtitleLog(lines) {
  const box = $('#subtitleLog');
  if (!box || !lines || !lines.length) return;
  const empty = $('.lg-empty', box);
  if (empty) empty.remove();
  // 只有原本就贴着底部时才自动滚动，避免用户往上翻日志时被拽回来
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const frag = document.createDocumentFragment();
  lines.forEach(line => {
    // 原始行留档：任务结束后解析「自动翻译成功」的语言回写列表「字幕语言」列
    subtitleState.logLines.push(String(line));
    const div = document.createElement('div');
    div.className = subtitleLogClass(line);
    div.textContent = line;
    frag.appendChild(div);
  });
  // 防长任务内存膨胀：只保留最近 3000 行（解析只关心本任务,足够）
  if (subtitleState.logLines.length > 3000) subtitleState.logLines = subtitleState.logLines.slice(-3000);
  box.appendChild(frag);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function startSubtitlePolling() {
  if (subtitleState.timer) return;
  subtitleState.timer = setInterval(subtitlePollLog, SUBTITLE_POLL_MS);
}

function stopSubtitlePolling() {
  if (subtitleState.timer) {
    clearInterval(subtitleState.timer);
    subtitleState.timer = null;
  }
}

let subtitlePollBusy = false;

async function subtitlePollLog() {
  if (subtitlePollBusy || !subtitleIsOpen()) return;
  subtitlePollBusy = true;
  try {
    const d = await subtitleApi(`/api/subtitle/log?seq=${subtitleState.seq}`);
    if (Array.isArray(d.lines)) appendSubtitleLog(d.lines);
    if (typeof d.seq === 'number') subtitleState.seq = d.seq;
    subtitleState.cmdShort = String(d.cmd_short || '').trim();
    const cmdEl = $('#subtitleCmd');
    // 操作台给的 cmd_short 是 "main.py" 之后的部分（已 strip），这里补上命令名与空格
    if (cmdEl && subtitleState.cmdShort) {
      cmdEl.innerHTML = `<b>python main.py</b> ${escapeHtml(subtitleState.cmdShort)}`;
    }

    const wasRunning = subtitleState.running;
    if (subtitleState.reachable !== true) subtitleState.reachable = true;
    subtitleState.running = !!d.running;
    subtitleState.exitCode = d.exit_code === undefined ? null : d.exit_code;
    if (wasRunning && !subtitleState.running) {
      // 任务结束。操作台的日志里已自带「── 进程结束（退出码 N）──」，这里不再重复追加，
      // 只补一条提醒，并把状态切到「已结束（退出码 N）」
      const code = subtitleState.exitCode;
      const done = code === 0;
      showToast(done ? '任务已完成（退出码 0）' : `任务已结束，退出码 ${code === null ? '未知' : code}，请查看日志`,
        done ? 'success' : 'error');
      // 结算字幕语言（单条任务用 runVideoId；批量任务 runVideoId 已随当前条目更新）。
      // 与批量循环里的结算重复触发也没关系：合并是幂等的。
      subtitleFinalizeLangs();
    }
    refreshSubtitleStatus();
  } catch (e) {
    subtitleState.reachable = false;
    subtitleState.running = false;
    stopSubtitlePolling();
    setSubtitleStatus('down', '与字幕操作台的连接已断开', escapeHtml(e.message));
  } finally {
    subtitlePollBusy = false;
    updateSubtitleButtons();
  }
}

async function openSubtitleDrawer(idx) {
  const records = getHistoryRecords();
  const r = records[idx];
  if (!r) {
    showToast('记录不存在，可能已被删除', 'error');
    return;
  }
  // 批量正在跑时不允许切到单条模式（避免抢操作台）
  if (subtitleState.batch && subtitleState.batch.active) {
    showToast('批量任务正在执行，请等当前批次结束后再操作单条记录', 'error');
    return;
  }
  subtitleExitBatchMode();   // 从批量模式切回单条模式

  subtitleState.recordIdx = idx;
  subtitleState.seq = 0;
  subtitleState.running = false;
  subtitleState.reachable = null;
  subtitleState.hadRun = false;
  subtitleState.exitCode = null;
  subtitleState.cmdShort = '';

  const mask = $('#subtitleDrawerMask');
  if (mask) mask.style.display = 'block';
  document.body.style.overflow = 'hidden';
  updateSubtitleButtons();

  // 副标题带上内容ID / 合集组 / 视频ID，避免在多行之间搞混
  const sub = $('#subtitleDrawerSub');
  if (sub) {
    const parts = [];
    if (r.contentId) parts.push(`内容ID ${r.contentId}`);
    if (r.collectionName) parts.push(`合集组 ${r.collectionName}`);
    if (r.videoId) parts.push(`视频ID ${r.videoId}`);
    sub.textContent = parts.length ? parts.join(' · ') : '未关联视频';
  }

  // 视频地址：优先用记录里的 url，没有就用视频ID拼一个
  const urlEl = $('#subtitleUrl');
  if (urlEl) urlEl.value = r.url || (r.videoId ? `https://www.youtube.com/watch?v=${r.videoId}` : '');

  // 频道 ID：优先用记录里保存的频道ID（自动路由到归属账号），没有才留空手填
  const chEl = $('#subtitleChannel');
  if (chEl) chEl.value = r.channelId || '';

  // 反查视频真实归属频道（= 发布频道）修正预填值：记录里的 channelId 可能存错
  if (r.videoId) {
    const probe = { videoId: r.videoId, channelId: r.channelId || '', channelTitle: r.channelTitle || '' };
    verifyBatchItemChannel(probe).then(changed => {
      if (changed && subtitleState.recordIdx === idx) {
        if (chEl) chEl.value = probe.channelId;
        showToast(`已按视频真实归属频道修正频道ID → ${probe.channelTitle || ''}（${probe.channelId}）`, 'warning');
      }
    });
  }

  // 源语言置灰；目标语言默认预选「常用组合」（排除源语言本身）
  subtitleState.srcLang = SUBTITLE_SRC_LANG_MAP[String(r.language || '').trim()] || '';

  // 语言清单：首次打开时拉一次，失败用本地兜底
  if (!subtitleState.langs.length) {
    try {
      const d = await subtitleApi('/api/subtitle/langs');
      subtitleState.langs = (Array.isArray(d.langs) && d.langs.length) ? d.langs : SUBTITLE_LANGS_FALLBACK;
    } catch (e) {
      subtitleState.langs = SUBTITLE_LANGS_FALLBACK;
    }
  }
  // 预选只取语言表里真实存在的代码（与批量抽屉同规则），排除源语言
  const knownCodes = new Set(subtitleState.langs.map(l => l.code));
  subtitleState.selected = new Set(SUBTITLE_COMMON_LANGS.filter(c => knownCodes.has(c) && c !== subtitleState.srcLang));
  renderSubtitleLangs();

  // 日志与命令区每次打开都重置（文案与操作台 webui.py 的日志空态一致）
  const logEl = $('#subtitleLog');
  if (logEl) {
    logEl.innerHTML = '<div class="lg-empty">尚未执行任务。填写视频地址、勾选语言后点击「开始执行」。<br>首次使用请先在操作台完成浏览器登录（见上方「打开浏览器登录」）。</div>';
  }
  const cmdEl = $('#subtitleCmd');
  if (cmdEl) cmdEl.textContent = '—';

  const sel = $('#subtitleAccount');
  if (sel) sel.innerHTML = '<option value="">当前账号（不切换）</option>';
  const hint = $('#subtitleAccountHint');
  if (hint) {
    hint.textContent = '正在加载可切换账号（拉起浏览器约 5-10 秒）…';
    hint.classList.remove('err');
  }

  // 进入抽屉默认不执行：只轻探测连通性（不接管操作台残留任务的执行状态、不轮询拉日志），
  // 等用户手动点「开始执行」后才启动轮询与任务
  const d = await subtitleCheckHealth(true);
  if (d.reachable && !d.running) {
    // 操作台空闲才自动拉账号列表；有任务占着浏览器时拉会撞 profile 锁，留给手动「刷新账号列表」
    subtitleLoadAccounts();   // 同会话只自动拉一次
  }
}

function closeSubtitleDrawer() {
  const mask = $('#subtitleDrawerMask');
  if (mask) mask.style.display = 'none';
  document.body.style.overflow = '';
  // 关掉抽屉就停轮询；后台任务不受影响，重新打开会从 seq=0 拉回完整日志
  stopSubtitlePolling();
  // 批量任务继续在后台顺序执行，不因关抽屉而中断
  if (subtitleState.batch && subtitleState.batch.active) {
    showToast('批量任务仍在后台执行，结束后会提示结果', 'info');
  }
}

// ─────────────────────────────────────────────
// 批量模式：勾选多条记录 → 逐个执行字幕翻译
// 每条带视频ID + 频道ID（有频道ID时操作台按归属账号自动切换）
// ─────────────────────────────────────────────
// 反查视频真实归属频道（= 发布频道），修正批量队列项与记录里的频道ID。
// 记录里存的 channelId 可能与视频真实频道不符（老记录/手工导入等），
// 批量切换账号必须以 YouTube 反查结果为准。
async function verifyBatchItemChannel(it) {
  try {
    const res = await fetch(`/api/video/${encodeURIComponent(it.videoId)}/owner`);
    const d = await res.json();
    if (d && d.success && d.channelId) {
      it.checkError = '';
      if (d.channelId !== it.channelId || (d.channelTitle || '') !== (it.channelTitle || '')) {
        it.channelId = d.channelId;
        it.channelTitle = d.channelTitle || '';
        // 回写记录，根治数据源错误（下次批量/单条直接是对的）
        try {
          const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
          const rec = records.find(r => r.videoId === it.videoId);
          if (rec) {
            rec.channelId = it.channelId;
            rec.channelTitle = it.channelTitle;
            localStorage.setItem('yt_upload_records', JSON.stringify(records));
          }
        } catch (e) { /* 回写失败不影响本次执行 */ }
        return true;   // 有修正
      }
      return false;
    }
    it.checkError = (d && d.error) || '核对失败';
  } catch (e) {
    it.checkError = e.message;
  }
  return false;
}

// 对整个批量队列做频道核对（打开抽屉时跑一次；执行中不再跑）
function verifyBatchChannels(batch) {
  (async () => {
    let fixed = 0;
    for (const it of batch.items) {
      if (subtitleState.batch !== batch || batch.active) return;   // 抽屉已重开/已开跑，终止旧核对
      const changed = await verifyBatchItemChannel(it);
      if (changed) fixed++;
      it.checking = false;
      renderSubtitleQueue();
    }
    if (fixed > 0) {
      showToast(`已按视频真实归属频道修正 ${fixed} 条记录的频道ID`, 'warning');
      appendSubtitleLog([`⚠ ${fixed} 条记录的频道ID与视频真实频道不符，已按 YouTube 反查结果修正`]);
    }
  })();
}

async function openSubtitleBatchDrawer(items) {
  // 已有批量在跑时不允许重开（避免两个循环抢同一个操作台）
  if (subtitleState.batch && subtitleState.batch.active) {
    showToast('批量任务正在执行，请等当前批次结束后再操作', 'error');
    return;
  }
  subtitleState.batch = { items, active: false, abort: false, cur: 0, done: 0, fail: 0 };
  subtitleState.recordIdx = -1;
  subtitleState.seq = 0;
  subtitleState.running = false;
  subtitleState.reachable = null;
  subtitleState.hadRun = false;
  subtitleState.exitCode = null;
  subtitleState.cmdShort = '';

  // 单条模式的卡片隐藏，批量队列卡片显示
  const urlCard = $('#subtitleCardUrl');
  const acctCard = $('#subtitleCardAccount');
  const batchCard = $('#subtitleBatchCard');
  if (urlCard) urlCard.style.display = 'none';
  if (acctCard) acctCard.style.display = 'none';
  if (batchCard) batchCard.style.display = '';

  const mask = $('#subtitleDrawerMask');
  if (mask) mask.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const sub = $('#subtitleDrawerSub');
  if (sub) sub.textContent = `批量模式 · ${items.length} 个视频 · 按列表顺序执行`;
  const startBtn = $('#subtitleStart');
  if (startBtn) startBtn.textContent = '开始批量执行';

  // 批量里各视频源语言不同，不做源语言置灰；默认预选常用组合
  subtitleState.srcLang = '';
  if (!subtitleState.langs.length) {
    try {
      const d = await subtitleApi('/api/subtitle/langs');
      subtitleState.langs = (Array.isArray(d.langs) && d.langs.length) ? d.langs : SUBTITLE_LANGS_FALLBACK;
    } catch (e) {
      subtitleState.langs = SUBTITLE_LANGS_FALLBACK;
    }
  }
  // 预选只取语言表里真实存在的：操作台语言表不全时，预选不存在的代码
  // 会出现「DOM 无卡片可取消、payload 却带未知语言」的脏状态
  const knownCodes = new Set(subtitleState.langs.map(l => l.code));
  subtitleState.selected = new Set(SUBTITLE_COMMON_LANGS.filter(c => knownCodes.has(c)));
  renderSubtitleLangs();
  renderSubtitleQueue();

  const logEl = $('#subtitleLog');
  if (logEl) {
    logEl.innerHTML = `<div class="lg-empty">尚未开始。勾选目标语言后点击「开始批量执行」，将按顺序处理 ${items.length} 个视频。<br>每个视频自动带频道ID，操作台按归属账号切换后执行。</div>`;
  }
  const cmdEl = $('#subtitleCmd');
  if (cmdEl) cmdEl.textContent = '—';

  updateSubtitleButtons();
  // 进入抽屉默认不执行：只轻探测连通性，不自动轮询；点「开始批量执行」后才启动
  await subtitleCheckHealth(true);
  // 核对各视频的真实归属频道（= 发布频道）：记录里的 channelId 可能存错，
  // 以 YouTube 反查结果为准并回写修正记录
  const batch = subtitleState.batch;
  batch.items.forEach(it => { it.checking = true; });
  renderSubtitleQueue();
  verifyBatchChannels(batch);
}

// 恢复抽屉为单条模式（openSubtitleDrawer 用）
function subtitleExitBatchMode() {
  const b = subtitleState.batch;
  if (b && b.active) b.abort = true;   // 当前视频跑完后停止，不硬杀
  subtitleState.batch = null;
  const urlCard = $('#subtitleCardUrl');
  const acctCard = $('#subtitleCardAccount');
  const batchCard = $('#subtitleBatchCard');
  if (urlCard) urlCard.style.display = '';
  if (acctCard) acctCard.style.display = '';
  if (batchCard) batchCard.style.display = 'none';
  const startBtn = $('#subtitleStart');
  if (startBtn) startBtn.textContent = '开始执行';
}

function renderSubtitleQueue() {
  const q = $('#subtitleQueue');
  const b = subtitleState.batch;
  if (!q || !b) return;
  const stMap = { wait: '等待', running: '执行中', done: '成功', fail: '失败' };
  q.innerHTML = b.items.map((it, i) => {
    const st = it.status || 'wait';
    const ch = it.checking
      ? '核对视频真实频道中…'
      : (it.channelId
        ? `${it.channelTitle || '频道'}（${it.channelId}）`
        : '当前账号（未记录频道ID）');
    return `<div class="q-item q-${st}">
      <span class="q-no">${i + 1}</span>
      <div class="q-main">
        <div class="q-title">${escapeHtml(it.videoId)}${it.collectionName ? ' · ' + escapeHtml(it.collectionName) : ''}</div>
        <div class="q-sub">账号：${escapeHtml(ch)}${it.error ? ' · ' + escapeHtml(it.error) : ''}</div>
      </div>
      <span class="q-status">${stMap[st] || st}</span>
    </div>`;
  }).join('');
  const prog = $('#subtitleBatchProgress');
  if (prog) {
    const done = b.items.filter(x => x.status === 'done').length;
    const fail = b.items.filter(x => x.status === 'fail').length;
    prog.textContent = `共 ${b.items.length} 个 · 成功 ${done} · 失败 ${fail}`;
  }
}

// 等当前操作台任务结束，返回退出码；中途断连抛错
function subtitleWaitRunEnd(timeoutMs) {
  return new Promise((resolve, reject) => {
    const limit = timeoutMs || 30 * 60 * 1000;   // 单视频多语言最长 30 分钟兜底
    const started = Date.now();
    let sawRunning = false;
    let errCount = 0;
    const timer = setInterval(async () => {
      if (Date.now() - started > limit) {
        clearInterval(timer);
        reject(new Error('等待任务结束超时（30 分钟）'));
        return;
      }
      let d;
      try {
        d = await subtitleApi('/api/subtitle/health');
        errCount = 0;
      } catch (e) {
        // 瞬时网络抖动重试；连续 10 次（约 20s）算操作台真挂了
        if (++errCount >= 10) {
          clearInterval(timer);
          reject(new Error('操作台连接中断：' + e.message));
        }
        return;
      }
      if (d.running) {
        sawRunning = true;
        return;
      }
      // running=false：要么跑完了，要么还没开始（上一个任务的 exitCode 残留）
      if (sawRunning || (d.exitCode !== null && d.exitCode !== undefined && d.cmdShort)) {
        clearInterval(timer);
        resolve(d.exitCode);
      } else if (Date.now() - started > 60000) {
        clearInterval(timer);
        reject(new Error('任务提交后迟迟未开始执行'));
      }
    }, 2000);
  });
}

async function subtitleBatchRun() {
  const batch = subtitleState.batch;
  if (!batch || batch.active) return;
  const langs = Array.from(subtitleState.selected);
  if (!langs.length) {
    showToast('请至少选择一种目标语言', 'error');
    return;
  }
  const health = await subtitleCheckHealth();
  if (!health.reachable) {
    showToast(subtitleErrText('无法开始批量任务', health.error ? { message: health.error } : new Error('未连接')), 'error');
    return;
  }

  batch.active = true;
  batch.abort = false;
  batch.done = 0;
  batch.fail = 0;
  updateSubtitleButtons();

  // 没有频道ID的记录无法自动切账号，只能用当前登录账号跑——如果该视频不属于当前账号，
  // Studio 会报「糟糕，出了点问题」（无权限）。开始前显式警告，避免用户以为会自动切换。
  const noChannel = batch.items.filter(it => !it.channelId);
  if (noChannel.length) {
    showToast(`⚠ ${noChannel.length} 条记录没有频道ID（${noChannel.map(it => it.videoId).join('、')}），将用当前登录账号执行；若视频不属于该账号会无权限失败`,
      'error');
    appendSubtitleLog([`⚠ ${noChannel.length} 条记录未记录频道ID，无法自动切换归属账号，将用当前登录账号执行`]);
  }

  for (let i = 0; i < batch.items.length; i++) {
    if (batch.abort) {
      appendSubtitleLog([`━━ 已停止：剩余 ${batch.items.length - i} 个视频未执行 ━━`]);
      break;
    }
    const it = batch.items[i];
    batch.cur = i + 1;
    it.status = 'running';
    it.error = '';
    renderSubtitleQueue();
    updateSubtitleButtons();

    resetSubtitleRun();          // seq 归零 + 清日志区，保证每条任务的日志独立完整
    subtitleState.runVideoId = it.videoId;   // 轮询结束点据此结算字幕语言
    appendSubtitleLog([`━━ [${i + 1}/${batch.items.length}] ${it.videoId} · ${it.channelId ? '频道 ' + it.channelId : '当前账号'} ━━`]);

    try {
      const payload = {
        url: `https://www.youtube.com/watch?v=${it.videoId}`,
        langs,
        mode: 'metadata'
      };
      if (it.channelId) payload.channel = it.channelId;   // 操作台按 channel_map 切归属账号
      await subtitleApi('/api/subtitle/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      subtitleState.running = true;
      startSubtitlePolling();
      subtitlePollLog();

      const exitCode = await subtitleWaitRunEnd();
      subtitleState.running = false;
      // 结算本条任务的字幕语言（补拉日志尾巴 → 解析成功语言 → 合并进记录）
      await subtitleFinalizeLangs(it.videoId);
      if (batch.abort) {
        // 停止按钮触发的终止：当前视频按停止处理
        it.status = 'fail';
        it.error = '已停止';
        batch.fail++;
        appendSubtitleLog(['✗ 已手动停止']);
        renderSubtitleQueue();
        break;
      }
      if (exitCode === 0) {
        it.status = 'done';
        batch.done++;
      } else {
        it.status = 'fail';
        it.error = `退出码 ${exitCode}`;
        batch.fail++;
      }
    } catch (e) {
      subtitleState.running = false;
      it.status = 'fail';
      it.error = e.message;
      batch.fail++;
      // 操作台挂了：继续下一个大概率也失败，直接终止整批
      if (e.data && e.data.reachable === false) {
        appendSubtitleLog(['✗ 操作台连接中断，批量终止：' + e.message]);
        renderSubtitleQueue();
        break;
      }
    }
    renderSubtitleQueue();
  }

  batch.active = false;
  subtitleState.running = false;
  updateSubtitleButtons();
  appendSubtitleLog([`━━ 批量结束：成功 ${batch.done} · 失败 ${batch.fail} ━━`]);
  showToast(`批量翻译结束：成功 ${batch.done}，失败 ${batch.fail}`, batch.fail ? 'error' : 'success');
}

async function subtitleBatchStop() {
  const batch = subtitleState.batch;
  if (!batch || !batch.active) return;
  batch.abort = true;
  try {
    await subtitleApi('/api/subtitle/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (e) { /* 停止失败也标记 abort，等待当前任务自然结束 */ }
  showToast('正在停止当前视频，结束后批量任务将终止', 'info');
}

async function subtitleStartRun() {
  const url = ($('#subtitleUrl')?.value || '').trim();
  if (!url) {
    showToast('请先填写视频地址', 'error');
    return;
  }
  const langs = Array.from(subtitleState.selected);
  if (!langs.length) {
    showToast('请至少选择一种目标语言', 'error');
    return;
  }
  const account = ($('#subtitleAccount')?.value || '').trim();
  const channel = ($('#subtitleChannel')?.value || '').trim();

  const startBtn = $('#subtitleStart');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = '提交中…';
  }
  try {
    // 请求体与操作台 webui.py 的 run 一致：mode 固定 metadata（标准流程）
    const payload = { url, langs, mode: 'metadata' };
    if (account) payload.account = account;   // 选了具体账号才传，后端据此自动切换
    if (channel) payload.channel = channel;   // 填了频道 ID 才传，后端按映射表路由账号
    const d = await subtitleApi('/api/subtitle/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!d.ok) throw new Error(d.msg || '启动失败');
    showToast(d.msg || '已启动任务', 'success');
    resetSubtitleRun();
    // 记住本任务的视频：结束时解析日志回写「字幕语言」列
    subtitleState.runVideoId = subtitleExtractVideoId(url);
    subtitleState.running = true;
    refreshSubtitleStatus();
    startSubtitlePolling();
    subtitlePollLog();
  } catch (e) {
    showToast(subtitleErrText('启动失败', e), 'error');
    // 服务端明确说连不上时，顺手刷新一次状态条，把启动指引亮出来
    if (e.data && e.data.reachable === false) subtitleCheckHealth();
  } finally {
    if (startBtn) startBtn.textContent = '开始执行';
    updateSubtitleButtons();
  }
}

async function subtitleStopRun() {
  const btn = $('#subtitleStop');
  if (btn) btn.disabled = true;
  try {
    const d = await subtitleApi('/api/subtitle/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    showToast(d.msg || '已发送停止信号', 'info');
  } catch (e) {
    showToast(subtitleErrText('停止失败', e), 'error');
  } finally {
    updateSubtitleButtons();
  }
}

async function subtitleLoginGoogle() {
  try {
    const d = await subtitleApi('/api/subtitle/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!d.ok) {
      showToast(d.msg || '打开登录窗口失败', 'error');
      return;
    }
    showToast(d.msg || '已打开浏览器，请在窗口中完成 Google 登录', 'info');
    resetSubtitleRun();
    startSubtitlePolling();
    subtitlePollLog();
  } catch (e) {
    showToast(subtitleErrText('打开登录窗口失败', e), 'error');
  }
}

// 自检配置（对应操作台 webui.py 的「自检配置」→ POST /api/doctor）
async function subtitleDoctor() {
  try {
    const d = await subtitleApi('/api/subtitle/doctor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!d.ok) {
      showToast(d.msg || '自检启动失败', 'error');
      return;
    }
    showToast(d.msg || '正在自检 config.json 与 LLM 连通性（结果见下方日志）', 'info');
    resetSubtitleRun();
    startSubtitlePolling();
    subtitlePollLog();
  } catch (e) {
    showToast(subtitleErrText('自检启动失败', e), 'error');
  }
}

// 右上角按钮：已连接 → 打开操作台网页；未连接 → 一键把操作台拉起来
async function subtitleOpenOrLaunchConsole() {
  if (subtitleState.reachable === true) {
    window.open(subtitleState.base || SUBTITLE_CONSOLE_URL, '_blank');
    return;
  }
  if (subtitleState.launching) return;
  subtitleState.launching = true;
  updateSubtitleButtons();
  setSubtitleStatus('busy', '正在启动字幕操作台…', '首次启动要拉起浏览器内核，大约需要 5-15 秒，请稍候。');
  try {
    const d = await subtitleApi('/api/subtitle/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (d.base) subtitleState.base = d.base;
    subtitleState.reachable = true;
    setSubtitleStatus('ok', d.already ? '字幕操作台已在运行' : '字幕操作台已启动', escapeHtml(d.base || ''));
    showToast(d.message || '字幕操作台已就绪', 'success');
    refreshSubtitleStatus();
    subtitlePollLog();
    startSubtitlePolling();
    subtitleLoadAccounts(true);   // 强刷一次，清掉断连期间留下的报错提示
  } catch (e) {
    const hint = e.data && e.data.hint ? `（${e.data.hint}）` : '';
    setSubtitleStatus('down', '启动字幕操作台失败', escapeHtml(e.message + hint));
    showToast('启动字幕操作台失败：' + e.message, 'error');
    refreshSubtitleStatus();
  } finally {
    subtitleState.launching = false;
    updateSubtitleButtons();
  }
}

(function bindSubtitleDrawer() {
  const bind = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
  };
  bind('subtitleRecheck', 'click', async () => {
    setSubtitleStatus('', '正在检测字幕操作台…', '');
    const d = await subtitleCheckHealth();
    if (d.reachable) {
      subtitlePollLog();
      startSubtitlePolling();
      subtitleLoadAccounts();   // 同会话只自动拉一次
    }
  });
  bind('subtitleStart', 'click', () => {
    // 批量模式走批量引擎（按队列逐个执行），单条模式走原有流程
    if (subtitleState.batch) subtitleBatchRun();
    else subtitleStartRun();
  });
  bind('subtitleStop', 'click', () => {
    if (subtitleState.batch && subtitleState.batch.active) subtitleBatchStop();
    else subtitleStopRun();
  });
  bind('subtitleLogin', 'click', subtitleLoginGoogle);
  bind('subtitleDoctor', 'click', subtitleDoctor);
  bind('subtitleReloadAccounts', 'click', () => subtitleLoadAccounts(true));
  bind('subtitleConsoleAction', 'click', subtitleOpenOrLaunchConsole);
  bind('subtitleLangAll', 'click', () => {
    subtitleState.langs.forEach(l => {
      if (l.code !== subtitleState.srcLang) subtitleState.selected.add(l.code);
    });
    renderSubtitleLangs();
    updateSubtitleButtons();
  });
  bind('subtitleLangClear', 'click', () => {
    subtitleState.selected.clear();
    renderSubtitleLangs();
    updateSubtitleButtons();
  });
  bind('subtitleLangCommon', 'click', () => {
    subtitleState.selected.clear();
    SUBTITLE_COMMON_LANGS.forEach(c => {
      if (c !== subtitleState.srcLang) subtitleState.selected.add(c);
    });
    renderSubtitleLangs();
    updateSubtitleButtons();
  });
  // 语言模板：选择/应用/保存/删除
  bind('subtitleTplApply', 'click', applySubtitleTemplate);
  bind('subtitleTplSave', 'click', saveSubtitleTemplate);
  bind('subtitleTplDelete', 'click', deleteSubtitleTemplate);
  bind('subtitleTplSelect', 'change', () => {
    // 下拉直接选中即应用（快捷路径）；「应用」按钮作为明确操作保留
    if ($('#subtitleTplSelect')?.value) applySubtitleTemplate();
  });
  bind('subtitleTplName', 'keydown', (e) => {
    // 名称框里回车直接保存
    if (e.key === 'Enter') { e.preventDefault(); saveSubtitleTemplate(); }
  });
  renderSubtitleTemplates();   // 初始化模板下拉
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && subtitleIsOpen()) closeSubtitleDrawer();
  });
})();

// ─── YT视频列表 ───────────────────────────────
// 数据来源：本地（发布任务 yt_publish_tasks / 上传记录 yt_upload_records）提供 videoId 与「关联合集组」，
// 实时标题/简介/封面/频道信息由服务端 /api/yt-videos/by-ids 从 YouTube 拉取后合并展示。
let _ytvRows = [];
let _ytvBound = false;
// 筛选条件与过滤后视图（渲染和编辑索引都基于视图）
const _ytvFilters = { channelTitle: '', channelId: '', owner: '', collection: '' };
let _ytvView = [];
// 当前编辑弹窗对应的行索引（-1 = 未打开），供 AI 生成取宏参上下文
let _ytvEditIdx = -1;

// 归属人：取「社媒账号采集表」里该频道的 meta.owner（发布频道上面维护的归属人）
// state.channels 由 /api/auth/status 下发；若尚未就绪则回源拉 /api/channels
async function ytvEnsureChannels() {
  // 每次都回源（本地接口，毫秒级）：保证在「社媒账号采集表」改了归属人后切回来即时生效
  try {
    const res = await fetch('/api/channels');
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.channels) && data.channels.length) state.channels = data.channels;
    }
  } catch (e) { /* 网络异常时退回内存缓存 */ }
  return Array.isArray(state.channels) ? state.channels : [];
}

function ytvOwnerMap() {
  const m = new Map();
  (Array.isArray(state.channels) ? state.channels : []).forEach(c => {
    const id = String((c && c.id) || '').trim();
    if (!id) return;
    const owner = String(((c && c.meta) ? c.meta.owner : '') || '').trim();
    if (owner) m.set(id, owner);
  });
  return m;
}

function ytvCollectLocal() {
  const map = new Map();
  const put = (vidRaw, info) => {
    const vid = String(vidRaw || '').trim();
    if (!vid) return;
    const prev = map.get(vid) || {};
    map.set(vid, {
      linkedCollection: prev.linkedCollection || info.linkedCollection || '',
      channelId: prev.channelId || info.channelId || '',
      channelTitle: prev.channelTitle || info.channelTitle || '',
      language: prev.language || info.language || ''
    });
  };
  try {
    (typeof getPublishTasks === 'function' ? getPublishTasks() : []).forEach(t => {
      put(t.videoId, {
        linkedCollection: t.linkedCollection || '',
        channelId: t.channelId || '',
        channelTitle: t.channelTitle || '',
        language: t.language || ''
      });
    });
  } catch (e) { /* 本地数据异常时跳过 */ }
  try {
    const recs = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
    (Array.isArray(recs) ? recs : []).forEach(r => {
      put(r.videoId, {
        linkedCollection: r.collectionName || r.linkedCollection || '',
        channelId: r.channelId || '',
        channelTitle: '',
        language: r.language || ''
      });
    });
  } catch (e) { /* 本地数据异常时跳过 */ }
  return map;
}

async function loadYtVideos() {
  const body = $('#ytvTableBody');
  if (!body) return;

  const local = ytvCollectLocal();
  const ids = Array.from(local.keys());
  body.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:18px">正在从 YouTube 拉取…</td></tr>';

  if (!ids.length) {
    _ytvRows = [];
    ytvRebuildFilterOptions();
    ytvRender();
    return;
  }

  try {
    // 归属人来自频道表，先确保 state.channels 就绪
    await ytvEnsureChannels();
    const ownerMap = ytvOwnerMap();
    const res = await fetch('/api/yt-videos/by-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const items = Array.isArray(data.items) ? data.items : [];
    _ytvRows = items.map(it => {
      const l = local.get(it.videoId) || {};
      const cid = String(it.channelId || l.channelId || '').trim();
      return {
        videoId: it.videoId,
        channelTitle: it.channelTitle || l.channelTitle || '',
        channelId: cid,
        owner: ownerMap.get(cid) || '',
        title: it.title || '',
        description: it.description || '',
        thumbnailUrl: it.thumbnailUrl || '',
        linkedCollection: l.linkedCollection || '',
        language: l.language || ''
      };
    });
    ytvRebuildFilterOptions();
    ytvRender();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger);padding:18px">加载失败：${escapeHtml(err.message)}</td></tr>`;
  }
}

// ─── 筛选 ───────────────────────────────
// 用 _ytvRows 的去重值回填筛选下拉（保留当前选中项；数据里已不存在的选中值自动回落到"全部"）
function ytvRebuildFilterOptions() {
  const conf = [
    { key: 'channelTitle', selId: 'ytvFilterChannelTitle', allLabel: '全部频道', pick: r => r.channelTitle },
    { key: 'channelId',    selId: 'ytvFilterChannelId',    allLabel: '全部频道ID', pick: r => r.channelId },
    { key: 'owner',        selId: 'ytvFilterOwner',        allLabel: '全部归属人', pick: r => r.owner },
    { key: 'collection',   selId: 'ytvFilterCollection',   allLabel: '全部合集组', pick: r => r.linkedCollection }
  ];
  for (const c of conf) {
    const sel = $('#' + c.selId);
    if (!sel) continue;
    const vals = Array.from(new Set(_ytvRows.map(c.pick).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh'));
    if (!vals.includes(_ytvFilters[c.key])) _ytvFilters[c.key] = '';
    sel.innerHTML = `<option value="">${c.allLabel}</option>` +
      vals.map(v => `<option value="${escapeHtml(v)}" ${v === _ytvFilters[c.key] ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
  }
}

// 过滤生成视图并渲染
function ytvRender() {
  const body = $('#ytvTableBody');
  const table = $('#ytvTable');
  const empty = $('#ytvEmpty');
  const hint = $('#ytvCountHint');
  if (!body) return;

  const f = _ytvFilters;
  _ytvView = _ytvRows.filter(r =>
    (!f.channelTitle || r.channelTitle === f.channelTitle) &&
    (!f.channelId || r.channelId === f.channelId) &&
    (!f.owner || r.owner === f.owner) &&
    (!f.collection || r.linkedCollection === f.collection)
  );

  const hasFilter = !!(f.channelTitle || f.channelId || f.owner || f.collection);
  if (hint) hint.textContent = _ytvView.length === _ytvRows.length
    ? `共 ${_ytvRows.length} 个视频`
    : `${_ytvView.length} / ${_ytvRows.length} 个视频`;

  if (!_ytvRows.length) {
    body.innerHTML = '';
    if (table) table.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.querySelector('h3').textContent = '暂无视频记录';
      empty.querySelector('p').textContent = '发布过的视频会出现在这里（来源：发布任务 / 上传记录，实时信息取自 YouTube）';
    }
    return;
  }
  if (!_ytvView.length) {
    body.innerHTML = '';
    if (table) table.style.display = 'none';
    if (empty) {
      empty.style.display = 'block';
      empty.querySelector('h3').textContent = '没有符合筛选条件的视频';
      empty.querySelector('p').textContent = '当前筛选条件下没有匹配记录，请调整或清除筛选';
    }
    return;
  }
  if (table) table.style.display = '';
  if (empty) empty.style.display = 'none';
  const cell = v => v ? escapeHtml(String(v)) : '<span class="cell-empty">—</span>';
  const clip = (v, n) => {
    const s = String(v || '');
    if (!s) return '<span class="cell-empty">—</span>';
    return `<span title="${escapeHtml(s)}">${escapeHtml(s.length > n ? s.slice(0, n) + '…' : s)}</span>`;
  };
  body.innerHTML = _ytvView.map((r, i) => `
    <tr>
      <td>${cell(r.channelTitle)}</td>
      <td>${clip(r.channelId, 18)}</td>
      <td class="cell-video-id">${clip(r.videoId, 18)}</td>
      <td class="col-owner">${cell(r.owner)}</td>
      <td>${cell(r.linkedCollection)}</td>
      <td>${clip(r.title, 40)}</td>
      <td>${clip(r.description, 60)}</td>
      <td>${r.thumbnailUrl
        ? `<img src="${escapeHtml(r.thumbnailUrl)}" alt="封面" style="width:96px;height:54px;object-fit:cover;border-radius:4px">`
        : '<span class="cell-empty">—</span>'}</td>
      <td class="col-action"><div class="action-btns"><button class="btn-edit" data-ytv-edit="${i}">编辑</button></div></td>
    </tr>
  `).join('');
  $$('[data-ytv-edit]', body).forEach(btn => {
    btn.addEventListener('click', () => ytvOpenEdit(Number(btn.dataset.ytvEdit)));
  });
}

function ytvOpenEdit(idx) {
  const r = _ytvView[idx];
  if (!r) return;
  _ytvEditIdx = idx;
  $('#ytvEditVideoId').value = r.videoId;
  // 可编辑字段
  $('#ytvEditTitleInput').value = r.title || '';
  $('#ytvEditDescInput').value = r.description || '';
  const fileEl = $('#ytvEditThumbFile');
  if (fileEl) fileEl.value = '';
  const prev = $('#ytvEditThumbPreview');
  const img = $('#ytvEditThumbImg');
  if (img) img.src = r.thumbnailUrl || '';
  if (prev) prev.classList.toggle('ytv-has-img', !!r.thumbnailUrl);
  const upBtn = $('#ytvThumbUploadBtn');
  if (upBtn) upBtn.classList.remove('ytv-picked');
  const upText = $('#ytvThumbUploadText');
  if (upText) upText.textContent = '更换封面';
  ytvUpdateCounters();
  // 归属预判：视频不属于当前授权频道 → 黄色警告（保存会被 YouTube 403 拒绝）
  const warn = $('#ytvEditOwnerWarn');
  const warnText = $('#ytvEditOwnerWarnText');
  const activeId = (typeof state !== 'undefined' && state && state.activeChannelId) || '';
  if (warn && warnText) {
    const mismatch = r.channelId && activeId && r.channelId !== activeId;
    warn.style.display = mismatch ? 'flex' : 'none';
    if (mismatch) warnText.textContent = `此视频属于频道「${r.channelTitle || r.channelId}」，不是当前授权频道，保存修改将被 YouTube 拒绝。请先在「频道管理」中切换到该频道后再编辑。`;
  }
  $('#ytvEditMask').style.display = 'flex';
}

// 标题/简介字符计数（简介同时校验 UTF-8 字节数，YouTube 上限 5000 字节）
function ytvUpdateCounters() {
  const title = $('#ytvEditTitleInput');
  const tCount = $('#ytvTitleCount');
  if (title && tCount) {
    tCount.textContent = `${(title.value || '').length} / 100`;
    tCount.classList.toggle('ytv-over', (title.value || '').length > 100);
  }
  const desc = $('#ytvEditDescInput');
  const dCount = $('#ytvDescCount');
  if (desc && dCount) {
    const len = (desc.value || '').length;
    let bytes = 0;
    try { bytes = new TextEncoder().encode(desc.value || '').length; } catch (e) { bytes = len; }
    dCount.textContent = bytes > 5000
      ? `${len} 字符 / ${bytes} 字节（超过 YouTube 5000 字节上限！）`
      : `${len} / 5000（${bytes} 字节）`;
    dCount.classList.toggle('ytv-over', bytes > 5000);
  }
}

function ytvCloseEdit() {
  const mask = $('#ytvEditMask');
  if (mask) mask.style.display = 'none';
  _ytvEditIdx = -1;
}

async function ytvSaveEdit() {
  const videoId = ($('#ytvEditVideoId').value || '').trim();
  if (!videoId) { showToast('缺少视频ID', 'error'); return; }
  const title = ($('#ytvEditTitleInput').value || '').trim();
  if (!title) { showToast('视频标题不能为空', 'error'); return; }
  const description = $('#ytvEditDescInput').value || '';
  // YouTube 简介上限是 5000 字节（UTF-8），中文约 1667 字就会触顶，前端先拦截
  let descBytes = description.length;
  try { descBytes = new TextEncoder().encode(description).length; } catch (e) { /* 退化为字符数 */ }
  if (descBytes > 5000) {
    showToast(`视频简介 ${descBytes} 字节，超过 YouTube 5000 字节上限（中文约1667字），请删减`, 'error');
    return;
  }
  const fileEl = $('#ytvEditThumbFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  const btn = $('#ytvEditSaveBtn');
  const errMsg = d => [d.error, d.detail && d.detail !== d.error ? d.detail : '']
    .filter(Boolean).join('：');
  try {
    if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = '同步中…'; }
    // 1) 标题 / 简介 → 同步到 YouTube
    const res = await fetch(`/api/video/${encodeURIComponent(videoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errMsg(data) || `HTTP ${res.status}`);
    // 2) 封面（仅在选择了新文件时同步）
    if (file) {
      const fd = new FormData();
      fd.append('videoId', videoId);
      fd.append('thumbnail', file);
      const tRes = await fetch('/api/thumbnails/set', { method: 'POST', body: fd });
      const tData = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error('封面同步失败：' + (errMsg(tData) || `HTTP ${tRes.status}`));
    }
    showToast('已同步到 YouTube', 'success');
    ytvCloseEdit();
    await loadYtVideos();
  } catch (err) {
    showToast('同步失败：' + err.message, 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = '保存并同步到 YouTube'; }
  }
}

// 发布任务成功后，把该视频同步到「发布内容关联表」(yt_upload_records)：
// 按 videoId 去重（同 videoId 已存在则合并更新，不新增重复行），并刷新关联表。
function ytvSyncPublishTaskToHistory(taskId, videoId, url) {
  try {
    const vid = String(videoId || '').trim();
    if (!vid) return;
    const task = (typeof getPublishTasks === 'function' ? getPublishTasks() : [])
      .find(t => t.id === taskId) || {};
    const records = JSON.parse(localStorage.getItem('yt_upload_records') || '[]');
    const existing = records.find(r => r && r.videoId === vid);
    const base = {
      videoId: vid,
      channelId: task.channelId || existing?.channelId || '',
      channelTitle: task.channelTitle || existing?.channelTitle || '',
      title: task.title || taskTitle || existing?.title || '',
      url: url || task.url || existing?.url || '',
      time: new Date().toISOString(),
      collectionName: task.linkedCollection || existing?.collectionName || '',
      owner: task.operator || existing?.owner || '—',
      language: task.language || existing?.language || '—',
      gender: existing?.gender || '—',
      // 业务费用字段当前发布任务流程暂无来源，沿用已有或留空
      supplier: existing?.supplier || '',
      purchaseVersion: existing?.purchaseVersion || '',
      producePlatform: existing?.producePlatform || '',
      baseFee: existing?.baseFee || '',
      checkFee: existing?.checkFee || '',
      dubFee: existing?.dubFee || '',
      aiDubUnit: existing?.aiDubUnit || '',
      aiDubFee: existing?.aiDubFee || '',
      subtitleLangs: existing?.subtitleLangs || [],
      authTime: existing?.authTime || new Date().toISOString().slice(0, 10),
      remark: existing?.remark || '',
      publishStatus: 'completed'
    };
    if (existing) {
      // 同 videoId 已存在：合并更新（保留旧 contentId/未变字段，补齐频道/合集组/状态等）
      base.contentId = existing.contentId || (typeof generateContentId === 'function' ? generateContentId() : '');
      Object.assign(existing, base);
    } else {
      base.contentId = (typeof generateContentId === 'function' ? generateContentId() : '');
      records.unshift(base);
      if (records.length > 50) records.length = 50;
    }
    localStorage.setItem('yt_upload_records', JSON.stringify(records));
    if (typeof renderHistory === 'function') renderHistory();
  } catch (e) {
    console.warn('同步发布任务到关联表失败：', e && e.message);
  }
}

function bindYtVideos() {
  if (_ytvBound) return;
  _ytvBound = true;
  const refresh = $('#ytvRefreshBtn');
  if (refresh) refresh.addEventListener('click', () => loadYtVideos());
  const closeBtn = $('#ytvEditCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', ytvCloseEdit);
  const cancel = $('#ytvEditCancelBtn');
  if (cancel) cancel.addEventListener('click', ytvCloseEdit);
  const save = $('#ytvEditSaveBtn');
  if (save) save.addEventListener('click', ytvSaveEdit);
  // AI生成：按「指令库」里匹配该视频所属频道的模板生成 标题 / 简介 / 封面
  const ytvGen = [
    ['#ytvAiGenTitle', { tab: 'title', scope: 'ytv', btnId: 'ytvAiGenTitle', fill: insFillYtvTitle }],
    ['#ytvAiGenDesc', { tab: 'description', scope: 'ytv', btnId: 'ytvAiGenDesc', fill: insFillYtvDesc }],
    ['#ytvAiGenThumb', { tab: 'thumbnail', scope: 'ytv', btnId: 'ytvAiGenThumb', fill: insFillYtvThumb }]
  ];
  ytvGen.forEach(([sel, cfg]) => {
    const btn = $(sel);
    if (btn) btn.addEventListener('click', () => insGenAndFill(cfg));
  });
  const mask = $('#ytvEditMask');
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) ytvCloseEdit(); });
  const nav = $('.nav-item[data-page="ytvideos"]');
  if (nav) nav.addEventListener('click', () => loadYtVideos());
  // 筛选下拉：变更即过滤重渲染（选项由 ytvRebuildFilterOptions 动态回填）
  const fChannelTitle = $('#ytvFilterChannelTitle');
  if (fChannelTitle) fChannelTitle.addEventListener('change', () => {
    _ytvFilters.channelTitle = fChannelTitle.value;
    ytvRender();
  });
  const fChannelId = $('#ytvFilterChannelId');
  if (fChannelId) fChannelId.addEventListener('change', () => {
    _ytvFilters.channelId = fChannelId.value;
    ytvRender();
  });
  const fOwner = $('#ytvFilterOwner');
  if (fOwner) fOwner.addEventListener('change', () => {
    _ytvFilters.owner = fOwner.value;
    ytvRender();
  });
  const fCollection = $('#ytvFilterCollection');
  if (fCollection) fCollection.addEventListener('change', () => {
    _ytvFilters.collection = fCollection.value;
    ytvRender();
  });
  // 封面文件选择：预览 + 按钮态
  const fileEl = $('#ytvEditThumbFile');
  if (fileEl) fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    const img = $('#ytvEditThumbImg');
    const prev = $('#ytvEditThumbPreview');
    const upBtn = $('#ytvThumbUploadBtn');
    const upText = $('#ytvThumbUploadText');
    const hint = $('#ytvThumbHint');
    if (f) {
      if (img && prev) {
        img.src = URL.createObjectURL(f);
        prev.classList.add('ytv-has-img');
      }
      if (upBtn) upBtn.classList.add('ytv-picked');
      if (upText) upText.textContent = '已选择新封面';
      if (hint) hint.textContent = '保存时将同步新封面到 YouTube';
    } else {
      if (prev) prev.classList.remove('ytv-has-img');
      if (upBtn) upBtn.classList.remove('ytv-picked');
      if (upText) upText.textContent = '更换封面';
      if (hint) hint.textContent = '不选则保持现有封面';
    }
  });
  // 标题/简介字符计数
  const tInput = $('#ytvEditTitleInput');
  if (tInput) tInput.addEventListener('input', ytvUpdateCounters);
  const dInput = $('#ytvEditDescInput');
  if (dInput) dInput.addEventListener('input', ytvUpdateCounters);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindYtVideos);
} else {
  bindYtVideos();
}


// ════════════════════════════════════════════════════════
//  指令库（标题 / 简介 / 封面 三个 tab 各一组指令模板）
// ════════════════════════════════════════════════════════
const INS_TAB_LABEL = { title: '标题指令', description: '简介指令', thumbnail: '封面指令' };
const INS_TAB_TIP = {
  title: '生成/改写视频标题时使用的提示词模板',
  description: '生成/改写视频简介时使用的提示词模板',
  thumbnail: '生成视频封面图时使用的提示词模板'
};
let _insData = { title: [], description: [], thumbnail: [] };
let _insTab = 'title';
let _insMacros = [];
let _insModels = [];
let _insChannels = [];
let _insBound = false;

async function loadInstructions() {
  const hint = $('#insCountHint');
  const list = $('#insList');
  if (!list) return;
  list.innerHTML = '<div class="ins-loading">加载中…</div>';
  try {
    const res = await fetch('/api/instructions');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    _insData = Object.assign({ title: [], description: [], thumbnail: [] }, data.instructions || {});
    _insMacros = Array.isArray(data.macros) ? data.macros : [];
    _insModels = Array.isArray(data.models) ? data.models : [];
    await loadInsChannels();
    insRenderMacros();
    insRenderModelOptions();
    insRenderList();
    if (hint) {
      const total = ['title', 'description', 'thumbnail'].reduce((n, k) => n + (_insData[k] || []).length, 0);
      hint.textContent = `共 ${total} 条指令`;
    }
  } catch (err) {
    list.innerHTML = `<div class="ins-error">加载失败：${escapeHtml(err.message)}</div>`;
  }
}

// 适用频道候选：优先复用全局 state.channels，否则单独拉一次
async function loadInsChannels() {
  try {
    let channels = (typeof state !== 'undefined' && Array.isArray(state.channels) && state.channels.length)
      ? state.channels : null;
    if (!channels) {
      const res = await fetch('/api/channels');
      const data = await res.json().catch(() => ({}));
      channels = Array.isArray(data.channels) ? data.channels : [];
    }
    _insChannels = channels.map(c => ({ id: c.id, title: c.title || c.name || c.id }));
  } catch (e) {
    _insChannels = [];
  }
}

// 宏参按钮条：点击把 {{宏参}} 插入到指令内容的光标处
function insRenderMacros() {
  const bar = $('#insMacroBar');
  if (!bar) return;
  if (!_insMacros.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = _insMacros.map(m =>
    `<button class="ins-macro-btn" type="button" data-ins-macro="${escapeHtml(m.key)}" title="${escapeHtml(m.desc || '')}">${escapeHtml(m.key)}</button>`
  ).join('') + '<span class="ins-macro-tip">点击插入宏参</span>';
  $$('[data-ins-macro]', bar).forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = $('#insEditContent');
      if (!ta) return;
      insInsertMacro(ta, `{{${btn.dataset.insMacro}}}`);
      insUpdateContentUI();
    });
  });
}

function insInsertMacro(ta, text) {
  const start = (ta.selectionStart != null) ? ta.selectionStart : ta.value.length;
  const end = (ta.selectionEnd != null) ? ta.selectionEnd : ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.focus();
  const pos = start + text.length;
  try { ta.setSelectionRange(pos, pos); } catch (e) { /* 忽略 */ }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function insRenderModelOptions() {
  const sel = $('#insEditModel');
  if (!sel) return;
  sel.innerHTML = (_insModels.length ? _insModels : [{ value: 'deepseek-chat', label: 'DeepSeek · deepseek-chat' }])
    .map(m => `<option value="${escapeHtml(m.value)}">${escapeHtml(m.label)}</option>`).join('');
}

// 宏参高亮渲染：把 {{xxx}} 包成 <span class="ins-macro">，其它文本转义
// 同时在末尾追加一个零宽空格 \u200B，保证 textarea 末尾空行也能撑出高亮
function insHighlightContent(text) {
  const safe = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text || '').replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (m, key) => {
    return `<span class="ins-macro">{{${safe(key)}}}</span>`;
  });
}

function insSyncHighlight() {
  const ta = $('#insEditContent');
  const hl = $('#insContentHighlight');
  if (!ta || !hl) return;
  // 在文本末尾追加一个零宽 + 换行，确保高亮行数 ≥ textarea 视觉行数
  hl.innerHTML = insHighlightContent(ta.value) + '<br>';
  // 同步滚动
  hl.scrollTop = ta.scrollTop;
  hl.scrollLeft = ta.scrollLeft;
}

// 列表：卡片形式（名称 / 模型 / 适用频道 / 内容摘要 + 编辑删除）
function insRenderList() {
  const list = $('#insList');
  const empty = $('#insEmpty');
  const tip = $('#insTip');
  if (!list) return;
  if (tip) tip.textContent = INS_TAB_TIP[_insTab] || '';
  const items = _insData[_insTab] || [];
  if (!items.length) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = 'block';
      empty.querySelector('h3').textContent = `暂无${INS_TAB_LABEL[_insTab] || '指令'}`;
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  list.innerHTML = items.map(it => `
    <div class="ins-item">
      <div class="ins-item-head">
        <div class="ins-item-name">${escapeHtml(it.name || '未命名指令')}</div>
        <div class="ins-item-actions">
          <button class="btn-edit" data-ins-edit="${escapeHtml(it.id)}">编辑</button>
          <button class="btn-delete" data-ins-del="${escapeHtml(it.id)}">删除</button>
        </div>
      </div>
      <div class="ins-item-content">${escapeHtml((it.content || '').slice(0, 160))}${(it.content || '').length > 160 ? '…' : ''}</div>
    </div>
  `).join('');
  $$('[data-ins-edit]', list).forEach(b => b.addEventListener('click', () => insOpenEdit(b.dataset.insEdit)));
  $$('[data-ins-del]', list).forEach(b => b.addEventListener('click', () => insDelete(b.dataset.insDel)));
}

async function insSaveAll() {
  const res = await fetch('/api/instructions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions: _insData })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  _insData = Object.assign({ title: [], description: [], thumbnail: [] }, data.instructions || _insData);
}

async function insDelete(id) {
  const item = (_insData[_insTab] || []).find(x => x.id === id);
  if (!item) return;
  if (!confirm(`确定删除指令「${item.name || '未命名'}」？`)) return;
  _insData[_insTab] = (_insData[_insTab] || []).filter(x => x.id !== id);
  try {
    await insSaveAll();
    insRenderList();
    showToast('指令已删除', 'success');
  } catch (err) {
    showToast('删除失败：' + err.message, 'error');
    loadInstructions();
  }
}

// 打开编辑弹窗；id 为空=新增
function insOpenEdit(id) {
  const isNew = !id;
  const item = isNew
    ? { id: '', name: '', model: 'deepseek-chat', channels: [], content: '' }
    : ((_insData[_insTab] || []).find(x => x.id === id) || { id, name: '', model: 'deepseek-chat', channels: [], content: '' });
  $('#insEditTitle').textContent = isNew ? `新增${INS_TAB_LABEL[_insTab] || '指令'}` : '编辑指令';
  $('#insEditId').value = item.id || '';
  $('#insEditTab').value = _insTab;
  $('#insEditName').value = item.name || '';
  $('#insEditContent').value = item.content || '';
  // 模型：必须是预设之一；空值或未知值时回落到第一个预设
  const sel = $('#insEditModel');
  const modelVal = (item.model && _insModels.some(m => m.value === item.model) && item.model)
    || (_insModels[0] && _insModels[0].value) || 'deepseek-chat';
  if (sel) sel.value = modelVal;
  // 适用频道：写入抽屉缓存 → 触发器显示
  _insEditChannelsSelected = Array.isArray(item.channels) ? item.channels.slice() : [];
  insUpdateChannelTrigger();
  insUpdateContentUI();
  $('#insEditMask').style.display = 'flex';
  // 滚动到顶部以防之前有滚动位置
  setTimeout(() => {
    const ta = $('#insEditContent');
    if (ta) { ta.scrollTop = 0; insSyncHighlight(); }
  }, 0);
}

function insCloseEdit() {
  // 必须先收掉「适用频道」抽屉，再关编辑弹窗。
  // 抽屉遮罩 z-index 1000 且 inset:0，若只关弹窗，它会变成孤立全屏遮罩把整页锁死。
  const dMask = $('#insChDrawerMask');
  if (dMask) dMask.style.display = 'none';
  _insDrawerBackup = null;
  const mask = $('#insEditMask');
  if (mask) mask.style.display = 'none';
}

// ─── 适用频道：触发器 + 抽屉 ──────────────────────────────
let _insEditChannelsSelected = [];   // 弹窗内当前已选（待保存到指令）
let _insDrawerBackup = null;          // 抽屉打开前的备份，关闭取消时回滚

// 刷新触发器按钮文字 + 已选 chip
function insUpdateChannelTrigger() {
  const text = $('#insChTriggerText');
  const chips = $('#insChChips');
  const hint = $('#insChHint');
  const n = _insEditChannelsSelected.length;
  const total = _insChannels.length;
  if (text) {
    if (!n) text.textContent = '全部频道（不限制）';
    else if (n === total) text.textContent = `已选全部 ${total} 个频道`;
    else text.textContent = `已选 ${n} / ${total} 个频道`;
  }
  if (hint) hint.textContent = n ? `已选 ${n} 个频道` : '不选则适用于全部频道';
  if (chips) {
    if (!n || n > 8) { chips.style.display = 'none'; chips.innerHTML = ''; return; }
    chips.style.display = 'flex';
    chips.innerHTML = _insEditChannelsSelected.map(id => {
      const c = _insChannels.find(x => x.id === id);
      const name = c ? c.title : id;
      return `<span class="ins-chip" data-chip-id="${escapeHtml(id)}">${escapeHtml(name)}<button type="button" class="ins-chip-remove" data-chip-remove="${escapeHtml(id)}" aria-label="移除">×</button></span>`;
    }).join('');
  }
}

function insRemoveChannelFromTrigger(id) {
  _insEditChannelsSelected = _insEditChannelsSelected.filter(x => x !== id);
  insUpdateChannelTrigger();
}

// 打开抽屉：把当前选择同步进抽屉 checkbox（带备份，按"取消"可回滚）
function insOpenChannelDrawer() {
  const mask = $('#insChDrawerMask');
  if (!mask) return;
  _insDrawerBackup = _insEditChannelsSelected.slice();
  insRenderChannelDrawerList();
  insUpdateDrawerSummary();
  $('#insChDrawerSearch').value = '';
  mask.style.display = 'flex';
  setTimeout(() => { const s = $('#insChDrawerSearch'); if (s) s.focus(); }, 50);
}

function insCloseChannelDrawer(confirm) {
  const mask = $('#insChDrawerMask');
  if (!mask) return;
  if (!confirm && _insDrawerBackup) {
    // 取消：回滚到抽屉打开前
    _insEditChannelsSelected = _insDrawerBackup.slice();
    insUpdateChannelTrigger();
  }
  _insDrawerBackup = null;
  mask.style.display = 'none';
}

function insApplyChannelDrawerSelection() {
  // 确认：把抽屉内已勾选同步到缓存
  const checked = Array.from($$('#insChDrawerList input[type="checkbox"]:checked')).map(cb => cb.value);
  _insEditChannelsSelected = checked;
  insUpdateChannelTrigger();
  insCloseChannelDrawer(true);
}

function insRenderChannelDrawerList() {
  const list = $('#insChDrawerList');
  if (!list) return;
  if (!_insChannels.length) {
    list.innerHTML = '<div class="ins-drawer-empty">未获取到频道列表</div>';
    return;
  }
  list.innerHTML = _insChannels.map(c => {
    const checked = _insEditChannelsSelected.includes(c.id) ? 'checked' : '';
    return `
      <label class="ins-drawer-item" data-drawer-item="${escapeHtml(c.id)}">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${checked}>
        <span class="ins-drawer-item-title">${escapeHtml(c.title)}</span>
        <span class="ins-drawer-item-id">${escapeHtml(c.id)}</span>
      </label>
    `;
  }).join('');
  // 搜索过滤 + 每次重渲染后重写 summary（勾选变化要即时反映）
  $$('#insChDrawerList input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', insUpdateDrawerSummary);
  });
}

function insUpdateDrawerSummary() {
  const summary = $('#insChDrawerSummary');
  const total = _insChannels.length;
  const sel = $$('#insChDrawerList input[type="checkbox"]:checked').length;
  const vis = $$('#insChDrawerList .ins-drawer-item').length;
  if (summary) {
    const visText = vis === total ? '' : ` · 可见 ${vis}`;
    summary.textContent = `已选 ${sel} / 共 ${total}${visText}`;
  }
}

function insFilterDrawerList(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  $$('#insChDrawerList .ins-drawer-item').forEach(item => {
    const id = item.dataset.drawerItem || '';
    const titleEl = item.querySelector('.ins-drawer-item-title');
    const title = titleEl ? titleEl.textContent.toLowerCase() : '';
    const match = !kw || title.includes(kw) || id.toLowerCase().includes(kw);
    item.style.display = match ? '' : 'none';
  });
  insUpdateDrawerSummary();
}

// 抽屉批量操作
function insDrawerSelectAll() {
  const visible = $$('#insChDrawerList .ins-drawer-item').filter(it => it.style.display !== 'none');
  visible.forEach(it => { const cb = it.querySelector('input[type="checkbox"]'); if (cb) cb.checked = true; });
  insUpdateDrawerSummary();
}
function insDrawerSelectNone() {
  $$('#insChDrawerList input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  insUpdateDrawerSummary();
}
function insDrawerSelectInvert() {
  $$('#insChDrawerList .ins-drawer-item').forEach(it => {
    if (it.style.display === 'none') return;
    const cb = it.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = !cb.checked;
  });
  insUpdateDrawerSummary();
}

// 内容计数 + 宏参高亮同步
function insUpdateContentUI() {
  const ta = $('#insEditContent');
  const count = $('#insContentCount');
  if (ta && count) count.textContent = `${(ta.value || '').length} 字符`;
  insSyncHighlight();
}

async function insSaveEdit() {
  const name = ($('#insEditName').value || '').trim();
  if (!name) { showToast('请填写指令标题', 'error'); return; }
  const tab = $('#insEditTab').value || _insTab;
  const sel = $('#insEditModel');
  const model = sel ? sel.value : '';
  const channels = _insEditChannelsSelected.slice();
  const content = ($('#insEditContent').value || '');
  const id = $('#insEditId').value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const record = { id, name, model, channels, content };
  const list = Array.isArray(_insData[tab]) ? _insData[tab].slice() : [];
  const idx = list.findIndex(x => x.id === id);
  if (idx >= 0) list[idx] = record; else list.unshift(record);
  _insData[tab] = list;
  const btn = $('#insEditSaveBtn');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    await insSaveAll();
    _insTab = tab;
    $$('.ins-tab').forEach(t => t.classList.toggle('active', t.dataset.insTab === tab));
    insRenderList();
    insCloseEdit();
    showToast('指令已保存', 'success');
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '保 存'; }
  }
}

function bindInstructions() {
  if (_insBound) return;
  _insBound = true;
  const refresh = $('#insRefreshBtn');
  if (refresh) refresh.addEventListener('click', loadInstructions);
  const add = $('#insAddBtn');
  if (add) add.addEventListener('click', () => insOpenEdit(''));
  const closeBtn = $('#insEditCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', insCloseEdit);
  const cancel = $('#insEditCancelBtn');
  if (cancel) cancel.addEventListener('click', insCloseEdit);
  const save = $('#insEditSaveBtn');
  if (save) save.addEventListener('click', insSaveEdit);
  const mask = $('#insEditMask');
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) insCloseEdit(); });
  // 三个 tab 切换
  $$('.ins-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _insTab = tab.dataset.insTab || 'title';
      $$('.ins-tab').forEach(t => t.classList.toggle('active', t === tab));
      insRenderList();
    });
  });
  // 指令内容：输入即刷新计数 + 宏参高亮
  const content = $('#insEditContent');
  if (content) {
    content.addEventListener('input', insUpdateContentUI);
    content.addEventListener('scroll', insSyncHighlight);
  }
  // 适用频道触发器
  const trigger = $('#insChTrigger');
  if (trigger) trigger.addEventListener('click', insOpenChannelDrawer);
  // 抽屉：关闭 / mask / 取消 / 确定 / 搜索 / 全选反选清空
  const drawerClose = $('#insChDrawerClose');
  if (drawerClose) drawerClose.addEventListener('click', () => insCloseChannelDrawer(false));
  const drawerMask = $('#insChDrawerMask');
  if (drawerMask) drawerMask.addEventListener('click', e => { if (e.target === drawerMask) insCloseChannelDrawer(false); });
  const drawerCancel = $('#insChDrawerCancel');
  if (drawerCancel) drawerCancel.addEventListener('click', () => insCloseChannelDrawer(false));
  const drawerConfirm = $('#insChDrawerConfirm');
  if (drawerConfirm) drawerConfirm.addEventListener('click', insApplyChannelDrawerSelection);
  const drawerSearch = $('#insChDrawerSearch');
  if (drawerSearch) drawerSearch.addEventListener('input', () => insFilterDrawerList(drawerSearch.value));
  const dAll = $('#insChDrawerAll'); if (dAll) dAll.addEventListener('click', insDrawerSelectAll);
  const dNone = $('#insChDrawerNone'); if (dNone) dNone.addEventListener('click', insDrawerSelectNone);
  const dInvert = $('#insChDrawerInvert'); if (dInvert) dInvert.addEventListener('click', insDrawerSelectInvert);
  // 已选 chip 移除按钮（事件委托到 chips 容器）
  const chips = $('#insChChips');
  if (chips) chips.addEventListener('click', e => {
    const rm = e.target.closest && e.target.closest('[data-chip-remove]');
    if (rm) { e.preventDefault(); e.stopPropagation(); insRemoveChannelFromTrigger(rm.dataset.chipRemove); }
  });
  // 弹窗内按 Esc 关闭抽屉优先
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const dMask = $('#insChDrawerMask');
      if (dMask && dMask.style.display !== 'none') insCloseChannelDrawer(false);
    }
  });
  // 进入页面时加载
  const nav = $('.nav-item[data-page="instructions"]');
  if (nav) nav.addEventListener('click', () => loadInstructions());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindInstructions);
} else {
  bindInstructions();
}
