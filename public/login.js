const form = document.querySelector('#login-form');
const username = document.querySelector('#username');
const password = document.querySelector('#password');
const button = document.querySelector('#login-button');
const error = document.querySelector('#login-error');
let submitting = false;

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !form.reportValidity()) return;
  submitting = true;
  button.disabled = true;
  button.textContent = '正在登录…';
  error.hidden = true;
  form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败，请稍后重试。');
    password.value = '';
    window.location.replace('/');
  } catch (cause) {
    error.textContent = cause instanceof TypeError ? '连接失败，请检查网络后重试。' : cause.message;
    error.hidden = false;
    password.focus();
  } finally {
    submitting = false;
    button.disabled = false;
    button.textContent = '登录';
    form.removeAttribute('aria-busy');
  }
});
