# AppGather

一个简洁的个人网页导航台。添加网页名称和地址，将常用网页排列成整齐的图标卡片，点击即可在新标签页打开。

## 功能

- 添加网页名称和链接，支持 HTTP、HTTPS、IP 地址和端口。
- 新增标签（例如「我的App」），每个标签下可以放置多个网页。
- 单独折叠、展开标签，也可以一键全部折叠或全部展开，状态保存在服务器。
- 网页图标自动加载，加载不到时使用彩色名称图标。
- 点击卡片左上角的星号添加或取消星标，星标网页集中显示在所有标签上方。
- 顶部搜索框按网页名称即时筛选，支持部分名称、中文和不区分英文大小写的匹配。
- 统一尺寸的卡片网格，适配电脑、平板和手机。
- 点击「整理网页」可编辑网页名称、链接和所属标签，也可确认删除对应入口。
- 数据保存在服务器 JSON 文件中，刷新页面、换设备或重启服务后仍然保留。
- 仅支持固定账号 `noart`，使用指定密码登录；不提供注册或创建账号功能。
- 登录有效期为 30 天，到期需重新登录，也可以随时退出。首次运行列表为空，由你添加自己的网页。

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
| 登录凭据文件 | `/opt/AppGather/backend/data/credentials.json`（仅服务器保存） |
| 登录会话文件 | `/opt/AppGather/backend/data/sessions.json` |
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

首次运行时，脚本会提示输入固定账号 `noart` 的密码，请输入已指定的密码；输入时不回显。密码摘要仅保存在服务器的 `backend/data/credentials.json`，不会写入代码仓库。以后更新会保留已有凭据，不再提示输入。

随后脚本会复制本项目的 systemd / Nginx 配置，启用 Nginx 配置链接，检查 Nginx 配置，设置开机自启并启动服务。最后检查 `16050` 端口的健康接口。

也可以手动执行与脚本对应的步骤：

```bash
cd /opt/AppGather

bash deploy/setup-auth.sh

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

打开网站后先使用固定账号 `noart` 和已指定的密码登录。登录成功后进入网页列表，右上角「退出登录」可结束当前设备的会话。

在「添加网页」左侧的搜索框输入网页名称即可筛选，星标区与标签列表同步显示匹配结果，计数显示「匹配数 / 总数」。搜索只匹配名称，不匹配网址或标签名称。匹配的标签会临时展开；点击叉号、按 Esc 或清空输入可恢复全部网页及原来的折叠状态。搜索期间手动折叠、展开也只影响当前搜索视图，不会改写服务器保存的折叠状态。

1. 点击「新增标签」，例如创建「我的App」「学习」；空标签可以先创建，再添加网页。
2. 点击「添加网页」，填写名称和地址，选择所属标签后保存。在标签标题右侧添加网页时，会自动选中该标签。
3. 如输入 `192.168.0.150:16025`，会自动补充为 `http://192.168.0.150:16025`；普通域名默认补充 `https://`。如果该网页使用 HTTP，请在地址中明确保留 `http://`。
4. 点击卡片，在新标签页打开网页。点击卡片左上角的星号可将网页加入顶部「星标网页」区域，再次点击取消星标。
5. 点击标签标题可折叠或展开其中的网页。页面顶部可以「全部折叠」「全部展开」；顶部星标区始终展示，不受标签折叠影响。
6. 点击「整理网页」，再点击卡片右上角的铅笔按钮进入「编辑网页」，可以修改名称、网址或所属标签。保存后，顶部星标区与标签中的同一网页同步更新，网址对应的图标也会重新加载。
7. 「整理网页」中也可以通过卡片下方的「所属标签」选择框移动网页，或点击右上角的移除按钮并确认后删除。点击「完成整理」回到普通视图。

新添加的网页排列在对应标签末尾，添加或移入网页时会自动展开目标标签。长名称在卡片内省略显示，电脑上悬停卡片可查看完整名称和网址。「未分类」标签为空时自动隐藏，添加网页时仍可选择它。

星标区是同一网页的快捷入口，网页仍保留在原标签下，网页总数不会重复计算。星标网页按原网页添加顺序展示；取消星标后只移除顶部快捷入口。编辑名称、网址和设置星标不会改变网页 ID、原有顺序或标签折叠状态。

## 更新代码

```bash
cd /opt/AppGather
git pull --ff-only origin main
bash deploy/deploy.sh
```

数据目录 `backend/data/` 已加入 `.gitignore`，不会被提交到 GitHub。更新代码不会重建已有的网页列表。

从无标签版本升级时，第一次启动会将旧网页自动放入「未分类」，保留原来的名称、地址、ID 和顺序，并在同一数据目录生成 `links.before-tags.json` 原始备份。已有网页可以在「整理网页」中移动到新标签。迁移只在读取到旧版数组格式时执行；标签、网页归属和折叠状态统一保存在 `links.json` 中。

已有网页未设置星标时默认不打星标，无须手动转换数据。星标状态和编辑后的信息也保存在同一个 `links.json` 文件中，刷新页面或重启服务后仍然保留。

首次升级到登录版本时，运行 `bash deploy/deploy.sh`，按提示输入已指定的密码，然后即可访问登录页。原有网页和标签会保留。之后更新只需拉取代码并执行 `systemctl restart AppGather`；服务重启不会提前结束尚未到期的登录。

## 单账号登录

本次按新增需求提供固定单账号登录：首页、网页和标签数据接口都由服务端验证会话，没有注册或账号管理接口。密码在服务端以加盐 scrypt 摘要校验；明文密码和生产密码摘要都不进入代码仓库。凭据文件仅文件所有者可读写，初始化脚本不会覆盖已有密码；未初始化时服务拒绝启动。健康检查 `/api/health` 保持公开，仅返回服务状态。

登录后有效 30 天，从本次登录成功时计算，日常访问不会延长期限。浏览器保存 HttpOnly、SameSite=Strict Cookie，服务器仅保存随机会话令牌的 SHA-256 摘要和到期时间。会话文件以原子替换方式写入且仅服务器文件所有者可读写。现有 HTTP 端口可继续使用；如通过 HTTPS 反向代理访问，会根据 Nginx 的 `X-Forwarded-Proto` 设置 Secure Cookie。

退出登录会立即撤销当前设备的令牌，其他设备仍可使用同一账号。连续输错 5 次后，该来源需要等待 15 分钟再试。清除浏览器 Cookie 也会需要重新登录。如需强制退出所有设备，先停止服务，删除 `backend/data/sessions.json`，再启动服务。

## 数据备份

网页和标签保存在 `/opt/AppGather/backend/data/links.json`，登录凭据与会话分别保存在同一目录的 `credentials.json`、`sessions.json`。可以把整个 `backend/data` 加入服务器备份任务，凭据和会话备份应只由服务器管理者保管。仅恢复网页数据时无需恢复会话文件；新服务器需恢复凭据文件或重新运行初始化脚本。

恢复备份时先停止 `AppGather`，替换 `links.json` 后再启动服务；运行中的服务会使用内存中的列表。

## 本地运行与测试

```bash
bash deploy/setup-auth.sh
npm start
```

本机访问 `http://127.0.0.1:3050`。

```bash
npm test
```

测试使用临时数据目录及独立测试密码，验证添加、读取、删除、并发保存、旧数据迁移、标签归类、折叠展开、星标与编辑、登录保护、30 天到期、会话重启恢复、退出撤销和请求边界，不会修改实际网页列表。

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
| `backend/auth.js` | 固定账号校验、登录限速、30 天会话和退出撤销 |
| `backend/credentials.js` | 从标准输入初始化服务器凭据，读取摘要并校验密码 |
| `public/index.html` | 页面与弹窗 |
| `public/login.html`、`public/login.js` | 登录页面和交互 |
| `public/styles.css` | 响应式布局和视觉样式 |
| `public/app.js` | 网页编辑、星标置顶、标签交互、折叠展开和图标回退 |
| `deploy/AppGather.service` | systemd 服务配置 |
| `deploy/AppGather.nginx` | 16050 → 3050 反向代理和 WebSocket 请求头 |
| `deploy/deploy.sh` | 配置安装与服务启动 |
| `deploy/setup-auth.sh` | 首次部署时隐藏输入密码，保留已有凭据 |
| `tests/app.test.js` | 独立临时目录中的接口集成测试 |
| `tests/auth.test.js` | 访问保护、Cookie、到期和退出集成测试 |
