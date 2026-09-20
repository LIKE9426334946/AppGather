const $ = selector => document.querySelector(selector);
const groups = $('#tag-groups');
const addDialog = $('#add-dialog');
const deleteDialog = $('#delete-dialog');
const tagDialog = $('#tag-dialog');
const form = $('#add-form');
const nameInput = $('#link-name');
const urlInput = $('#link-url');
const tagInput = $('#link-tag');
const manageButton = $('#manage-button');
const DEFAULT_TAG_ID = 'default';
const tones = ['blue', 'violet', 'teal', 'orange', 'rose', 'cyan'];
const arrowSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
const plusSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const trashSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
let links = [];
let tags = [];
let loaded = false;
let managing = false;
let saving = false;
let deleting = false;
let creatingTag = false;
let groupBusy = false;
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
  anchor.append(arrow, makeIcon(link), element('h3', 'app-name', link.name), element('p', 'app-address', new URL(link.url).host));

  const remove = element('button', 'remove-button');
  remove.type = 'button';
  remove.innerHTML = trashSvg;
  remove.setAttribute('aria-label', `移除 ${link.name}`);
  remove.title = `移除 ${link.name}`;
  remove.hidden = !managing;
  remove.addEventListener('click', () => openDelete(link));
  const move = element('label', 'move-control', '所属标签');
  move.hidden = !managing;
  const select = element('select', 'move-select');
  select.dataset.move = link.id;
  select.setAttribute('aria-label', `将 ${link.name} 移动到标签`);
  fillTagOptions(select, link.tagId);
  select.addEventListener('change', () => moveLink(link, select));
  move.append(select);
  card.append(anchor, remove, move);
  return card;
}

function fillTagOptions(select, selectedId) {
  select.replaceChildren(...tags.map(tag => {
    const option = element('option', '', tag.name);
    option.value = tag.id;
    return option;
  }));
  select.value = selectedId;
}

function visibleTags() {
  return tags.filter(tag => tag.id !== DEFAULT_TAG_ID || links.some(link => link.tagId === tag.id));
}

function updateControls() {
  const displayed = visibleTags();
  manageButton.disabled = !loaded || groupBusy || !links.length;
  $('#add-tag-button').disabled = !loaded || groupBusy;
  $('#collapse-all').disabled = !loaded || groupBusy || !displayed.some(tag => !tag.collapsed);
  $('#expand-all').disabled = !loaded || groupBusy || !displayed.some(tag => tag.collapsed);
  document.querySelectorAll('[data-add], .tag-toggle, .remove-button, [data-move]').forEach(control => {
    control.disabled = !loaded || groupBusy;
  });
}

function updateCollapseUI() {
  for (const section of groups.children) {
    const tag = tags.find(item => item.id === section.dataset.tagId);
    const toggle = section.querySelector('.tag-toggle');
    toggle.setAttribute('aria-expanded', String(!tag.collapsed));
    toggle.setAttribute('aria-label', `${tag.collapsed ? '展开' : '折叠'}标签「${tag.name}」`);
    section.querySelector('.tag-content').hidden = tag.collapsed;
    section.classList.toggle('is-collapsed', tag.collapsed);
  }
}

function makeGroup(tag) {
  const section = element('section', 'tag-section');
  section.dataset.tagId = tag.id;
  const header = element('div', 'tag-header');
  const heading = element('h2', 'tag-heading');
  const toggle = element('button', 'tag-toggle');
  toggle.id = `tag-toggle-${tag.id}`;
  toggle.setAttribute('aria-controls', `tag-content-${tag.id}`);
  const chevron = element('span', 'tag-chevron');
  chevron.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  const tagLinks = links.filter(link => link.tagId === tag.id);
  toggle.append(chevron, element('span', 'tag-name', tag.name), element('span', 'tag-count', `${tagLinks.length} 个网页`));
  toggle.title = tag.name;
  toggle.addEventListener('click', () => setCollapsed(!tags.find(item => item.id === tag.id).collapsed, tag.id));
  heading.append(toggle);

  const add = element('button', 'button button-secondary tag-add');
  add.dataset.add = '';
  add.innerHTML = plusSvg;
  add.append(element('span', '', '添加网页'));
  add.setAttribute('aria-label', `在 ${tag.name} 下添加网页`);
  add.addEventListener('click', () => openAdd(tag.id));
  header.append(heading, add);

  const content = element('div', 'tag-content link-grid');
  content.id = `tag-content-${tag.id}`;
  content.setAttribute('aria-labelledby', toggle.id);
  content.append(...tagLinks.map(makeCard));
  const addCard = element('button', 'add-card');
  addCard.dataset.add = '';
  const mark = element('span', 'add-card-icon');
  mark.innerHTML = plusSvg;
  addCard.append(mark, element('span', 'add-card-label', tagLinks.length ? '添加网页' : '添加第一个网页'));
  addCard.addEventListener('click', () => openAdd(tag.id));
  content.append(addCard);
  section.append(header, content);
  return section;
}

function updateManage() {
  groups.classList.toggle('is-managing', managing);
  manageButton.setAttribute('aria-pressed', String(managing));
  manageButton.querySelector('span').textContent = managing ? '完成整理' : '整理网页';
  $('#workspace-hint').textContent = managing ? '选择网页所属标签，或点击右上角的按钮移除网页。' : '点击标签折叠或展开，点击卡片打开网页。';
  groups.querySelectorAll('.remove-button, .move-control').forEach(control => { control.hidden = !managing; });
}

function render() {
  if (!links.length) managing = false;
  const displayed = visibleTags();
  $('#link-count').hidden = false;
  $('#link-count').textContent = links.length;
  $('#link-count').setAttribute('aria-label', `${links.length} 个网页`);
  $('#empty-state').hidden = displayed.length > 0;
  groups.hidden = !displayed.length;
  groups.replaceChildren(...displayed.map(makeGroup));
  updateManage();
  updateCollapseUI();
  updateControls();
}

async function loadLinks() {
  loaded = false;
  $('#loading-state').hidden = false;
  $('#error-state').hidden = true;
  $('#empty-state').hidden = true;
  groups.hidden = true;
  updateControls();
  try {
    const data = await api('/api/links');
    links = data.links;
    tags = data.tags;
    loaded = true;
    render();
  } catch (error) {
    $('#load-error').textContent = error.message;
    $('#error-state').hidden = false;
  } finally {
    $('#loading-state').hidden = true;
  }
}

async function setCollapsed(collapsed, tagId) {
  if (groupBusy) return;
  groupBusy = true;
  const before = tags;
  tags = tags.map(tag => !tagId || tag.id === tagId ? { ...tag, collapsed } : tag);
  updateCollapseUI();
  updateControls();
  try {
    await api(tagId ? `/api/tags/${tagId}` : '/api/tags', { method: 'PATCH', body: JSON.stringify({ collapsed }) });
  } catch (error) {
    tags = before;
    updateCollapseUI();
    showToast(error.message);
  } finally {
    groupBusy = false;
    updateControls();
  }
}

async function moveLink(original, select) {
  if (groupBusy || select.value === original.tagId) return;
  let destination;
  groupBusy = true;
  updateControls();
  try {
    const { link, tag } = await api(`/api/links/${original.id}`, { method: 'PATCH', body: JSON.stringify({ tagId: select.value }) });
    links = links.map(item => item.id === link.id ? link : item);
    tags = tags.map(item => item.id === tag.id ? tag : item);
    render();
    destination = tag.id;
    showToast(`已移到「${tag.name}」`);
  } catch (error) {
    select.value = original.tagId;
    showToast(error.message);
  } finally {
    groupBusy = false;
    updateControls();
    if (destination) document.getElementById(`tag-toggle-${destination}`).focus();
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

function openAdd(tagId = DEFAULT_TAG_ID) {
  form.reset();
  fillTagOptions(tagInput, tagId);
  updatePreview();
  openModal(addDialog);
  nameInput.focus();
}

function setSaving(busy) {
  saving = busy;
  $('#save-button').textContent = busy ? '正在添加…' : '添加网页';
  addDialog.querySelectorAll('input, select, button').forEach(control => { control.disabled = busy; });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  $('#form-error').hidden = true;
  try {
    const url = normalizeUrl(urlInput.value);
    setSaving(true);
    const { link, tag } = await api('/api/links', { method: 'POST', body: JSON.stringify({ name: nameInput.value.trim(), url, tagId: tagInput.value }) });
    links.push(link);
    tags = tags.map(item => item.id === tag.id ? tag : item);
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

function openTag() {
  $('#tag-form').reset();
  $('#tag-error').hidden = true;
  openModal(tagDialog);
  $('#tag-name').focus();
}

$('#tag-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (creatingTag) return;
  creatingTag = true;
  $('#tag-error').hidden = true;
  tagDialog.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
  $('#save-tag-button').textContent = '正在创建…';
  try {
    const { tag } = await api('/api/tags', { method: 'POST', body: JSON.stringify({ name: $('#tag-name').value.trim() }) });
    tags.push(tag);
    render();
    tagDialog.close();
    document.getElementById(`tag-toggle-${tag.id}`).focus();
    showToast(`已创建标签「${tag.name}」`);
  } catch (error) {
    $('#tag-error').textContent = error.message;
    $('#tag-error').hidden = false;
  } finally {
    creatingTag = false;
    tagDialog.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    $('#save-tag-button').textContent = '创建标签';
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

for (const dialog of [addDialog, deleteDialog, tagDialog]) {
  const busy = () => dialog === addDialog ? saving : dialog === tagDialog ? creatingTag : deleting;
  dialog.addEventListener('cancel', event => { if (busy()) event.preventDefault(); });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (event.target === dialog && outside && !busy()) dialog.close();
  });
  dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
}

document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => openAdd()));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { if (!saving) addDialog.close(); }));
document.querySelectorAll('.close-tag-dialog').forEach(button => button.addEventListener('click', () => { if (!creatingTag) tagDialog.close(); }));
$('#add-tag-button').addEventListener('click', openTag);
$('#collapse-all').addEventListener('click', () => setCollapsed(true));
$('#expand-all').addEventListener('click', () => setCollapsed(false));
$('#cancel-delete').addEventListener('click', () => { if (!deleting) deleteDialog.close(); });
$('#retry-button').addEventListener('click', loadLinks);
nameInput.addEventListener('input', updatePreview);
urlInput.addEventListener('input', updatePreview);
manageButton.addEventListener('click', () => { managing = !managing; updateManage(); });
loadLinks();
