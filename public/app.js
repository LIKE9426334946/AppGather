const $ = selector => document.querySelector(selector);
const grid = $('#link-grid');
const addDialog = $('#add-dialog');
const deleteDialog = $('#delete-dialog');
const form = $('#add-form');
const nameInput = $('#link-name');
const urlInput = $('#link-url');
const manageButton = $('#manage-button');
const tones = ['blue', 'violet', 'teal', 'orange', 'rose', 'cyan'];
const arrowSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
const plusSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const trashSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
let links = [];
let managing = false;
let saving = false;
let deleting = false;
let pendingDelete = null;
let toastTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new Error('连接失败，请检查网络后重试。');
  }
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。');
  return data;
}

function normalizeUrl(input) {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    // IP / localhost 默认使用 HTTP，普通域名默认使用 HTTPS。
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:\s]+:\d+(?:[/?#]|$)/.test(value)) {
      throw new Error('网址需要使用 http:// 或 https://。');
    }
    const local = /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[a-f\d:]+\])(?=[:/?#]|$)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error('请输入有效的网址，例如 https://example.com。');
  }
}

function toneFor(name, url = '') {
  const hash = Array.from(name + url).reduce((value, char) => ((value * 31) + char.codePointAt(0)) >>> 0, 0);
  return `tone-${tones[hash % tones.length]}`;
}

function makeIcon(link) {
  const icon = element('div', `app-icon ${toneFor(link.name, link.url)}`);
  icon.setAttribute('aria-hidden', 'true');
  const initial = element('span', 'icon-initial', Array.from(link.name)[0].toUpperCase());
  const image = element('img', 'site-icon');
  image.alt = '';
  image.hidden = true;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    if (image.naturalWidth > 0) {
      image.hidden = false;
      initial.hidden = true;
    }
  });
  image.addEventListener('error', () => image.remove());
  // 只由浏览器访问目标网站图标，不经过第三方图标服务。
  image.src = new URL('/favicon.ico', link.url).href;
  icon.append(initial, image);
  return icon;
}

function makeCard(link) {
  const card = element('article', 'app-card');
  const anchor = element('a', 'app-link');
  anchor.href = link.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.title = `${link.name}\n${link.url}`;
  anchor.setAttribute('aria-label', `${link.name}，在新标签页打开`);
  const arrow = element('span', 'card-arrow');
  arrow.innerHTML = arrowSvg;
  anchor.append(arrow, makeIcon(link), element('h2', 'app-name', link.name), element('p', 'app-address', new URL(link.url).host));

  const remove = element('button', 'remove-button');
  remove.type = 'button';
  remove.innerHTML = trashSvg;
  remove.setAttribute('aria-label', `移除 ${link.name}`);
  remove.title = `移除 ${link.name}`;
  remove.hidden = !managing;
  remove.addEventListener('click', () => openDelete(link));
  card.append(anchor, remove);
  return card;
}

function updateManage() {
  grid.classList.toggle('is-managing', managing);
  manageButton.setAttribute('aria-pressed', String(managing));
  manageButton.querySelector('span').textContent = managing ? '完成整理' : '整理网页';
  $('#workspace-hint').textContent = managing ? '点击卡片右上角的按钮，移除不再需要的网页。' : '点击卡片，在新标签页打开。';
  grid.querySelectorAll('.remove-button').forEach(button => { button.hidden = !managing; });
}

function render() {
  const hasLinks = links.length > 0;
  if (!hasLinks) managing = false;
  manageButton.disabled = !hasLinks;
  $('#link-count').hidden = false;
  $('#link-count').textContent = links.length;
  $('#link-count').setAttribute('aria-label', `${links.length} 个网页`);
  $('#empty-state').hidden = hasLinks;
  grid.hidden = !hasLinks;
  grid.replaceChildren(...links.map(makeCard));
  if (hasLinks) {
    const add = element('button', 'add-card');
    const mark = element('span', 'add-card-icon');
    mark.innerHTML = plusSvg;
    add.append(mark, element('span', 'add-card-label', '添加网页'));
    add.addEventListener('click', openAdd);
    grid.append(add);
  }
  updateManage();
}

async function loadLinks() {
  $('#loading-state').hidden = false;
  $('#error-state').hidden = true;
  $('#empty-state').hidden = true;
  grid.hidden = true;
  manageButton.disabled = true;
  document.querySelectorAll('[data-add]').forEach(button => { button.disabled = true; });
  try {
    const data = await api('/api/links');
    links = data.links;
    render();
    document.querySelectorAll('[data-add]').forEach(button => { button.disabled = false; });
  } catch (error) {
    $('#load-error').textContent = error.message;
    $('#error-state').hidden = false;
  } finally {
    $('#loading-state').hidden = true;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function openModal(dialog) {
  dialog.showModal();
  document.body.classList.add('modal-open');
}

function updatePreview() {
  const name = nameInput.value.trim();
  const icon = $('#preview-icon');
  icon.textContent = name ? Array.from(name)[0].toUpperCase() : 'A';
  let url = '';
  try { if (urlInput.value.trim()) url = normalizeUrl(urlInput.value); } catch {}
  icon.className = `app-icon ${toneFor(name || 'A', url)}`;
  $('#preview-name').textContent = name || '网页名称';
  $('#preview-url').textContent = url ? new URL(url).host : 'example.com';
  $('#form-error').hidden = true;
}

function openAdd() {
  form.reset();
  updatePreview();
  openModal(addDialog);
  nameInput.focus();
}

function setSaving(busy) {
  saving = busy;
  $('#save-button').textContent = busy ? '正在添加…' : '添加网页';
  addDialog.querySelectorAll('input, button').forEach(control => { control.disabled = busy; });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  $('#form-error').hidden = true;
  try {
    const url = normalizeUrl(urlInput.value);
    setSaving(true);
    const { link } = await api('/api/links', { method: 'POST', body: JSON.stringify({ name: nameInput.value.trim(), url }) });
    links.push(link);
    render();
    addDialog.close();
    $('.header-add').focus();
    showToast(`已添加「${link.name}」`);
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').hidden = false;
  } finally {
    setSaving(false);
  }
});

function openDelete(link) {
  pendingDelete = link;
  $('#delete-description').textContent = `「${link.name}」会从导航台移除，原网站不会受到影响。`;
  $('#delete-error').hidden = true;
  openModal(deleteDialog);
  $('#cancel-delete').focus();
}

$('#confirm-delete').addEventListener('click', async () => {
  if (deleting || !pendingDelete) return;
  deleting = true;
  const button = $('#confirm-delete');
  button.disabled = true;
  $('#cancel-delete').disabled = true;
  button.textContent = '正在移除…';
  try {
    await api(`/api/links/${pendingDelete.id}`, { method: 'DELETE' });
    links = links.filter(link => link.id !== pendingDelete.id);
    deleteDialog.close();
    render();
    (links.length ? manageButton : $('.header-add')).focus();
    showToast('网页已移除');
  } catch (error) {
    $('#delete-error').textContent = error.message;
    $('#delete-error').hidden = false;
  } finally {
    deleting = false;
    button.disabled = false;
    $('#cancel-delete').disabled = false;
    button.textContent = '确认移除';
  }
});

for (const dialog of [addDialog, deleteDialog]) {
  const busy = () => dialog === addDialog ? saving : deleting;
  dialog.addEventListener('cancel', event => { if (busy()) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (event.target === dialog && outside && !busy()) dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
}

document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', openAdd));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { if (!saving) addDialog.close(); }));
$('#cancel-delete').addEventListener('click', () => { if (!deleting) deleteDialog.close(); });
$('#retry-button').addEventListener('click', loadLinks);
nameInput.addEventListener('input', updatePreview);
urlInput.addEventListener('input', updatePreview);
manageButton.addEventListener('click', () => { managing = !managing; updateManage(); });
loadLinks();
