import { createApp } from '../backend/server.js';

// This separate verifier is only used in temporary test servers.
export const TEST_PASSWORD = 'appgather-test-password-only';
export const testAuthOptions = {
  passwordSalt: 'd9cd6662c22372f0ddbcbb465a197419',
  passwordHash: 'e4871a01e897ca8f71f7f06575136fed2622d42dd25dbec0e4eadf6c67135ae027b8006d678e9ebe738ffead09a22558f312c0c244136c0f2e9b867a8df9b737',
};
export const post = data => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export async function start(dataDir, { authenticated = true, now } = {}) {
  const server = await createApp({ dataDir, authOptions: { ...testAuthOptions, ...(now ? { now } : {}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const request = (path, options = {}) => fetch(base + path, {
    redirect: 'manual', ...options,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  if (authenticated) {
    const response = await request('/api/auth/login', post({ username: 'noart', password: TEST_PASSWORD }));
    if (response.status !== 200) {
      await new Promise(resolve => server.close(resolve));
      throw new Error('Test login failed: ' + response.status);
    }
    cookie = response.headers.get('set-cookie').split(';')[0];
    await response.json();
  }
  return { base, request, close: () => new Promise(resolve => server.close(resolve)) };
}

