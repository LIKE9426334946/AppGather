import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_TAG_ID = 'default';
const emptyData = () => ({
  tags: [{ id: DEFAULT_TAG_ID, name: '未分类', collapsed: false }],
  links: [],
});

// 单进程内按顺序写入，临时文件写完后再替换，避免并发添加丢失数据。
export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = join(directory, 'links.json');
  let data;
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
    data = JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = emptyData();
    await persist(data);
  }

  // 旧版本只保存网页数组，迁移前保留原文件，网页本身的信息保持不变。
  if (Array.isArray(data)) {
    await copyFile(filename, join(directory, 'links.before-tags.json'), constants.COPYFILE_EXCL)
      .catch(error => { if (error.code !== 'EEXIST') throw error; });
    data = { ...emptyData(), links: data.map(link => ({ ...link, tagId: DEFAULT_TAG_ID })) };
    await persist(data);
  }
  if (!Array.isArray(data?.tags) || !Array.isArray(data?.links)) {
    throw new Error('links.json 的内容必须包含 tags 和 links 数组');
  }

  return {
    list: () => data,
    change(update) {
      const operation = pending.then(async () => {
        const next = update(data);
        await persist(next);
        data = next;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
