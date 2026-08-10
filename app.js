/**
 * 百炼文档分析工具
 * 支持上传文件或粘贴 URL，调用 DashScope 百炼 API 进行文档智能解析
 */

// ===== 常量 =====
const API_BASE = 'https://dashscope.aliyuncs.com';
const APPLY_UPLOAD_URL = `${API_BASE}/api/v2/apps/zhiwen-file/apply_upload_lease`;
const SUBMIT_PARSE_URL = `${API_BASE}/api/v2/apps/zhiwen-file/submit_parse_file`;

// 内置配置
const API_KEY = 'sk-ws-H.ERYREIY.WhXh.MEQCIB8iblLOVXE00QpZ5cs6EB5bsdlwOZz1VhUK2egWDV14AiA3NvQN12K3w0WNLdhOhjQ37vdmsegoSwMCZmVqp6BsZg';
const APP_ID = 'd6ab090ca8164e0795efa282a00bc808';
const PROMPT = '你是一位课程内容分析专家。请阅读用户提供的课程文稿，提取关键信息并按以下结构输出：\n1. 课程背景与概述\n2. 课程亮点\n3. 你将收获\n4. 配套服务';

// 支持的文件类型
const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword',              // .doc
  'application/pdf',                 // .pdf
  'text/plain',                      // .txt
  'text/markdown',                   // .md
  'application/json',                // .json
];
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB

// ===== DOM 元素 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // 模式
  modeTabs: $$('.mode-tab'),
  uploadSection: $('#upload-section'),
  urlSection: $('#url-section'),

  // 上传
  uploadArea: $('#upload-area'),
  fileInput: $('#file-input'),
  fileInfo: $('#file-info'),
  fileName: $('#file-name'),
  fileSize: $('#file-size'),
  btnClearFile: $('#btn-clear-file'),
  uploadProgress: $('#upload-progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),

  // URL
  urlInput: $('#url-input'),

  // 配置
  btnSubmit: $('#btn-submit'),
  btnText: $('#btn-submit .btn-text'),
  btnLoading: $('#btn-submit .btn-loading'),

  // 结果
  emptyState: $('#empty-state'),
  markdownBody: $('#markdown-body'),
  errorState: $('#error-state'),
  errorMessage: $('#error-message'),
  resultActions: $('#result-actions'),
  btnCopy: $('#btn-copy'),
  btnDownload: $('#btn-download'),
};

// ===== 状态 =====
let currentMode = 'upload';
let currentFile = null;
let currentMarkdown = '';

// ===== 初始化 =====
function init() {
  // 模式切换
  dom.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // 上传区域
  dom.uploadArea.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files[0]));

  // 拖拽
  dom.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.uploadArea.classList.add('drag-over');
  });
  dom.uploadArea.addEventListener('dragleave', () => {
    dom.uploadArea.classList.remove('drag-over');
  });
  dom.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.uploadArea.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files[0]);
  });

  // 清除文件
  dom.btnClearFile.addEventListener('click', clearFile);

  // URL 输入变化
  dom.urlInput.addEventListener('input', updateSubmitButton);

  // 提交
  dom.btnSubmit.addEventListener('click', handleSubmit);

  // 复制
  dom.btnCopy.addEventListener('click', copyResult);

  // 下载
  dom.btnDownload.addEventListener('click', downloadMarkdown);

  // 初始状态
  updateSubmitButton();
}

// ===== 模式切换 =====
function switchMode(mode) {
  currentMode = mode;
  dom.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  dom.uploadSection.classList.toggle('hidden', mode !== 'upload');
  dom.urlSection.classList.toggle('hidden', mode !== 'url');
  updateSubmitButton();
}

// ===== 文件处理 =====
function handleFileSelect(file) {
  if (!file) return;

  // 验证类型
  const ext = file.name.split('.').pop().toLowerCase();
  const isAllowedExt = ['docx', 'doc', 'pdf', 'txt', 'md', 'json'].includes(ext);
  if (!isAllowedExt && !ALLOWED_TYPES.includes(file.type)) {
    showError('不支持的文件格式，请上传 .docx .pdf .txt .md .json 文件');
    return;
  }

  // 验证大小
  if (file.size > MAX_FILE_SIZE) {
    showError(`文件过大（${formatSize(file.size)}），最大支持 30MB`);
    return;
  }

  currentFile = file;
  dom.fileInfo.classList.remove('hidden');
  dom.uploadArea.classList.add('hidden');
  dom.fileName.textContent = file.name;
  dom.fileSize.textContent = formatSize(file.size);
  hideError();
  updateSubmitButton();
}

function clearFile() {
  currentFile = null;
  dom.fileInput.value = '';
  dom.fileInfo.classList.add('hidden');
  dom.uploadArea.classList.remove('hidden');
  updateSubmitButton();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ===== 提交按钮 =====
function updateSubmitButton() {
  const hasFile = currentMode === 'upload' ? currentFile !== null : dom.urlInput.value.trim().length > 0;
  dom.btnSubmit.disabled = !hasFile;
}

// ===== 主流程 =====
async function handleSubmit() {
  if (dom.btnSubmit.disabled) return;

  setLoading(true);
  hideError();
  hideResult();

  try {
    let fileUrl;

    if (currentMode === 'upload') {
      // 三步上传流程
      fileUrl = await uploadFileFullFlow(API_KEY);
    } else {
      // URL 直传模式
      fileUrl = dom.urlInput.value.trim();
      if (!fileUrl) throw new Error('请输入文档 URL');
    }

    // 调用 Completion API
    const markdown = await callCompletionAPI(fileUrl);

    // 渲染结果
    currentMarkdown = markdown;
    renderMarkdown(markdown);

  } catch (err) {
    console.error('分析失败:', err);
    showError(formatError(err));
  } finally {
    setLoading(false);
  }
}

// ===== 三步文件上传流程 =====
async function uploadFileFullFlow(apiKey) {
  const file = currentFile;
  if (!file) throw new Error('请先选择文件');

  // Step 1: 计算 MD5
  updateProgress(10, '正在计算文件指纹...');
  const md5 = await computeMD5(file);

  // Step 2: 申请上传租约
  updateProgress(25, '正在申请上传租约...');
  const leaseInfo = await applyUploadLease(apiKey, file.name, file.size, md5);

  // Step 3: 上传到 OSS
  updateProgress(50, '正在上传文件到 OSS...');
  await uploadToOSS(leaseInfo, file);

  // Step 4: 提交解析
  updateProgress(75, '正在提交文件解析...');
  const parseResult = await submitParseFile(apiKey, leaseInfo.lease_id);

  // 轮询解析状态
  updateProgress(90, '正在等待解析完成...');
  const fileUrl = await waitForParse(apiKey, parseResult);

  updateProgress(100, '文件准备完成！');
  return fileUrl;
}

// ===== MD5 计算 =====
function computeMD5(file) {
  return new Promise((resolve, reject) => {
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks
    const chunks = Math.ceil(file.size / chunkSize);
    const spark = new SparkMD5.ArrayBuffer();
    const reader = new FileReader();
    let currentChunk = 0;

    reader.onload = (e) => {
      spark.append(e.target.result);
      currentChunk++;

      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve(spark.end());
      }
    };

    reader.onerror = () => reject(new Error('文件读取失败'));

    function loadNext() {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      reader.readAsArrayBuffer(file.slice(start, end));
    }

    loadNext();
  });
}

// ===== 申请上传租约 =====
async function applyUploadLease(apiKey, fileName, sizeBytes, md5) {
  const res = await fetch(APPLY_UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fileName, sizeBytes, md5 }),
  });

  const data = await res.json();

  if (data.code !== 200 || !data.success) {
    throw new Error(`申请上传租约失败: ${data.message || '未知错误'}`);
  }

  return {
    lease_id: data.data.lease_id,
    url: data.data.param.url,
    method: data.data.param.method,
    headers: data.data.param.headers,
  };
}

// ===== 上传到 OSS =====
async function uploadToOSS(leaseInfo, file) {
  try {
    const res = await fetch(leaseInfo.url, {
      method: leaseInfo.method || 'PUT',
      headers: {
        'x-bailian-extra': leaseInfo.headers['x-bailian-extra'] || '',
        'Content-Type': leaseInfo.headers['Content-Type'] || 'application/octet-stream',
      },
      body: file,
    });

    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`OSS 上传失败 (HTTP ${res.status}): ${text}`);
    }
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      throw new Error('OSS 上传被浏览器拦截（跨域限制）。请改用「粘贴 URL」模式，先在百炼控制台上传文件后粘贴 OSS 链接。');
    }
    throw err;
  }
}

// ===== 提交解析 =====
async function submitParseFile(apiKey, leaseId) {
  const res = await fetch(SUBMIT_PARSE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leaseId }),
  });

  const data = await res.json();

  if (data.code !== 200 || !data.success) {
    throw new Error(`提交解析失败: ${data.message || '未知错误'}`);
  }

  return data.data;
}

// ===== 等待解析完成 =====
async function waitForParse(apiKey, parseData) {
  // submit_parse_file 返回的 data.url 通常立即可用
  // 如果 url 存在，直接返回
  if (parseData.url) {
    return parseData.url;
  }

  // 否则轮询（最多等待 30 秒）
  const fileId = parseData.fileId;
  if (!fileId) {
    throw new Error('未获取到文件 URL，请确认文件上传成功');
  }

  // 返回 fileId，后续 completion 可能接受 fileId
  return fileId;
}

// ===== Completion API =====
async function callCompletionAPI(fileUrl) {
  const completionUrl = `${API_BASE}/api/v1/apps/${APP_ID}/completion`;

  const body = {
    input: {
      prompt: PROMPT,
      biz_params: {
        courseware: {
          url: fileUrl,
        },
      },
    },
    parameters: {},
  };

  const res = await fetch(completionUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let errMsg;
    try {
      const json = JSON.parse(text);
      errMsg = json.message || json.error || text;
    } catch {
      errMsg = text;
    }
    throw new Error(`API 请求失败 (HTTP ${res.status}): ${errMsg}`);
  }

  const data = await res.json();

  // 处理流式响应
  if (data.output && data.output.text) {
    return data.output.text;
  }

  // 处理可能的其他响应格式
  if (data.text) return data.text;

  throw new Error('API 返回格式异常：未找到 text 字段');
}

// ===== 渲染 Markdown =====
function renderMarkdown(md) {
  dom.emptyState.classList.add('hidden');
  dom.errorState.classList.add('hidden');
  dom.markdownBody.classList.remove('hidden');

  // 配置 marked
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  dom.markdownBody.innerHTML = marked.parse(md);
  dom.resultActions.classList.remove('hidden');

  // 滚动到顶部
  dom.markdownBody.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 复制结果 =====
function copyResult() {
  if (!currentMarkdown) return;
  navigator.clipboard.writeText(currentMarkdown).then(() => {
    const btn = dom.btnCopy;
    const original = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => btn.textContent = original, 2000);
  }).catch(() => {
    alert('复制失败，请手动复制');
  });
}

// ===== 下载 Markdown =====
function downloadMarkdown() {
  if (!currentMarkdown) return;
  const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `分析结果_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== UI 辅助 =====
function setLoading(isLoading) {
  dom.btnSubmit.disabled = isLoading;
  dom.btnText.classList.toggle('hidden', isLoading);
  dom.btnLoading.classList.toggle('hidden', !isLoading);
  dom.uploadProgress.classList.toggle('hidden', !isLoading || currentMode === 'url');
}

function updateProgress(percent, text) {
  dom.progressFill.style.width = percent + '%';
  dom.progressText.textContent = text;
}

function showError(message) {
  dom.emptyState.classList.add('hidden');
  dom.markdownBody.classList.add('hidden');
  dom.errorState.classList.remove('hidden');
  dom.errorMessage.textContent = message;
  dom.resultActions.classList.add('hidden');
}

function hideError() {
  dom.errorState.classList.add('hidden');
}

function hideResult() {
  dom.markdownBody.classList.add('hidden');
  dom.emptyState.classList.remove('hidden');
  dom.resultActions.classList.add('hidden');
}

function formatError(err) {
  const msg = err.message || String(err);

  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return '网络请求失败。可能原因：\n1. 网络连接异常\n2. API 地址无法访问\n3. 浏览器跨域拦截（请检查 CORS 配置）';
  }

  if (msg.includes('401') || msg.includes('Unauthorized')) {
    return 'API Key 无效或已过期，请检查后重试。';
  }

  if (msg.includes('404')) {
    return 'App ID 无效或资源不存在，请检查 App ID 是否正确。';
  }

  if (msg.includes('429') || msg.includes('Too Many')) {
    return '请求频率过高，请稍后重试。';
  }

  return msg;
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
