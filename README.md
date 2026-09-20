# AppGather

一个简洁的个人网页导航台。添加网页名称和地址，将常用网页排列成整齐的图标卡片，点击即可在新标签页打开。

## 功能

- 添加网页名称和链接，支持 HTTP、HTTPS、IP 地址和端口。
- 网页图标自动加载，加载不到时使用彩色名称图标。
- 统一尺寸的卡片网格，适配电脑、平板和手机。
- 点击「整理网页」显示移除按钮，确认后删除对应入口。
- 数据保存在服务器 JSON 文件中，刷新页面、换设备或重启服务后仍然保留。
- 不包含登录系统，首次运行列表为空，由你添加自己的网页。

## 部署配置

按 Development.MD 的单服务器方案部署：Node.js + Nginx + systemd。

| 项目 | 配置 |
| --- | --- |
| 仓库分支 | `main` |
| 项目路径 | `/opt/AppGather` |
| 公网入口 | `http://服务器IP:16050` |
| Node.js 监听 | `127.0.0.1:3050` |
| systemd 服务 | `AppGather.service` |
| 数据文件 | `/opt/AppGather/backend/data/links.json` |
| Nginx 配置 | `/etc/nginx/sites-available/AppGather` |

## 首次部署

以下命令在 Ubuntu 服务器上使用 root 执行。

### 1. 安装环境

```bash
apt update
apt install -y git curl ca-certificates nginx
node -v
```

项目使用 Node.js 22 或更高版本，没有第三方 npm 依赖，也不需要前端打包。如果已经安装符合要求的 Node.js，跳过下面这一组命令。

如未安装 Node.js，可按 [NodeSource 安装说明](https://github.com/nodesource/distributions/blob/master/DEV_README.md) 安装 22.x：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/appgather-nodesource-setup.sh
bash /tmp/appgather-nodesource-setup.sh
apt install -y nodejs
node -v
```

systemd 使用 `/usr/bin/node`。通过上述 apt 方式安装的 Node.js 位于此路径。

### 2. 下载 main 分支

```bash
mkdir -p /opt/AppGather
git clone -b main https://github.com/LIKE9426334946/AppGather.git /opt/AppGather
cd /opt/AppGather
```

### 3. 配置并启动

```bash
bash deploy/deploy.sh
```

脚本会复制本项目的 systemd / Nginx 配置，启用 Nginx 配置链接，检查 Nginx 配置，设置开机自启并启动服务。最后检查 `16050` 端口的健康接口。

也可以手动执行与脚本对应的步骤：

```bash
cd /opt/AppGather

cp deploy/AppGather.service /etc/systemd/system/AppGather.service
cp deploy/AppGather.nginx /etc/nginx/sites-available/AppGather
ln -sfn /etc/nginx/sites-available/AppGather /etc/nginx/sites-enabled/AppGather

nginx -t
systemctl daemon-reload
systemctl enable AppGather
systemctl start AppGather
systemctl enable --now nginx
systemctl reload nginx
```

### 4. 放行并访问端口

在云服务器安全组中放行入站 TCP `16050`。若服务器启用了 UFW，再执行：

```bash
ufw allow 16050/tcp
```

浏览器访问 `http://服务器IP:16050`。Node.js 的 `3050` 端口只监听本机，不需要在安全组中开放。

### 5. 查看运行状态

```bash
systemctl status AppGather --no-pager
curl http://127.0.0.1:3050/api/health
curl http://127.0.0.1:16050/api/health
```

接口正常时返回 `{"status":"ok"}`。

## 使用方式

1. 点击「添加网页」，填写名称和地址，然后保存。
2. 如输入 `192.168.0.150:16025`，会自动补充为 `http://192.168.0.150:16025`；普通域名默认补充 `https://`。如果该网页使用 HTTP，请在地址中明确保留 `http://`。
3. 点击卡片，在新标签页打开网页。
4. 点击「整理网页」，再点击卡片右上角的移除按钮，确认后删除。点击「完成整理」回到普通视图。

新添加的网页排列在列表末尾。长名称在卡片内省略显示，电脑上悬停卡片可查看完整名称和网址。

## 更新代码

```bash
cd /opt/AppGather
git pull --ff-only origin main
bash deploy/deploy.sh
```

数据目录 `backend/data/` 已加入 `.gitignore`，不会被提交到 GitHub。更新代码不会重建已有的网页列表。

## 数据备份

需要保存的数据只有 `/opt/AppGather/backend/data/links.json`。可以把 `/opt/AppGather/backend/data` 加入你的服务器备份任务。

恢复备份时先停止 `AppGather`，替换 `links.json` 后再启动服务；运行中的服务会使用内存中的列表。

## 本地运行与测试

```bash
npm start
```

本机访问 `http://127.0.0.1:3050`。

```bash
npm test
```

测试使用临时数据目录，验证添加、读取、删除、并发保存、重启恢复和基本请求边界，不会修改实际网页列表。

## 常用维护命令

```bash
systemctl restart AppGather
systemctl stop AppGather
journalctl -u AppGather -n 80 --no-pager
nginx -t
```

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `backend/server.js` | Node.js HTTP 服务、网页 API 和静态资源 |
| `backend/store.js` | JSON 读取、串行写入和原子替换 |
| `public/index.html` | 页面与弹窗 |
| `public/styles.css` | 响应式布局和视觉样式 |
| `public/app.js` | 添加、跳转、删除与图标回退 |
| `deploy/AppGather.service` | systemd 服务配置 |
| `deploy/AppGather.nginx` | 16050 → 3050 反向代理和 WebSocket 请求头 |
| `deploy/deploy.sh` | 配置安装与服务启动 |
| `tests/app.test.js` | 独立临时目录中的接口集成测试 |
