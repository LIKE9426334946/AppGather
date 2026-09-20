import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

// 单进程内按顺序写入，临时文件写完后再替换，避免并发添加丢失数据。
export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = join(directory, 'links.json');
  let links;
  let pending = Promise.resolve();

  async function persist(next) {
    const temporary = `${filename}.tmp`;
    try {
      const file = await open(temporary, 'w', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(next, null, 2)}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  try {
    links = JSON.parse(await readFile(filename, 'utf8'));
    if (!Array.isArray(links)) throw new Error('links.json 的内容必须是数组');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    links = [];
    await persist(links);
  }

  return {
    list: () => links,
    change(update) {
      const operation = pending.then(async () => {
        const next = update(links);
        await persist(next);
        links = next;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
