# 单服务器 Node.js 项目部署要求

**前置信息**
- 项目名字就是Github仓库名字，直接操作main分支
- 外部和内部端口号后面两位数字一样，如16001对应3001，我说23号端口就代表外部使用16023，内部使用3023

## 一、服务器环境要求

### 系统环境

- Ubuntu 系统
- 使用 root 用户操作
- 不需要使用 `sudo` 命令
- 不考虑普通用户权限管理
- 所有项目统一部署在：

```bash
/opt/项目名称
```

例如：

```bash
/opt/StudyAPP
```

---

# 二、部署架构要求

整体架构：

```
公网访问
    |
    |
Nginx（公网端口）
    |
    |
Node.js（内部端口）
```

要求：

- Node.js 作为后端服务
- Nginx 作为统一入口反向代理
- Node.js 服务只监听内部端口
- 不直接暴露公网

---

# 三、Node.js 服务要求

## 1. 独立内部端口

每个 Node.js 项目必须使用独立内部端口。

例如：

| 项目 | Node.js端口 |
|---|---|
| StudyAPP | 3000 |

Node.js：

```
127.0.0.1:3000
```

仅允许本机访问。

---

# 四、Nginx 反向代理要求

## 1. 公网端口范围

Nginx 统一监听公网端口：

```
16000-16050
```

每个项目占用一个独立公网端口。


例如：

公网访问：

```
http://服务器IP:16000
```

请求转发：

```
Nginx:16000

        ↓

Node.js:3000
```

---

# 五、Nginx 配置要求

每个项目生成独立配置文件：

```
/etc/nginx/sites-available/项目配置文件
```

例如：

```
/etc/nginx/sites-available/StudyAPP
```

配置必须包含：

- 使用 `server` 块区分不同端口
- 使用 `proxy_pass` 转发 Node.js 请求
- 包含必要的 `proxy_header` 配置
- 支持 WebSocket
- 不使用域名
- 使用：

```
公网IP + 端口
```

访问项目


示例：

```
http://服务器IP:16000
```

---

# 六、systemd 服务管理要求

每个 Node.js 项目必须使用 systemd 管理。


服务文件位置：

```
/etc/systemd/system/项目名称.service
```

例如：

```
/etc/systemd/system/StudyAPP.service
```

---

# 七、systemd 配置要求


## 运行用户

必须使用 root：

```ini
User=root
```


## 工作目录

必须指定项目目录：

```ini
WorkingDirectory=/opt/StudyAPP
```


## Node.js 启动入口

指定 Node.js 文件：

```ini
ExecStart=/usr/bin/node /opt/StudyAPP/backend/server.js
```


## 环境变量

必须包含：

```ini
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
```


## 自动重启

服务异常退出后自动恢复：

```ini
Restart=always
```

---

# 八、部署流程要求

需要提供完整部署步骤。

包括：

## 1. 创建项目目录

例如：

```bash
mkdir -p /opt/StudyAPP
```


---

## 2. 创建 systemd 服务文件

创建：

```bash
/etc/systemd/system/项目名称.service
```


内容包含：

- root 用户运行
- WorkingDirectory
- ExecStart
- 环境变量
- 自动重启


---

## 3. 创建 Nginx 配置文件

创建：

```bash
/etc/nginx/sites-available/项目配置文件
```


配置内容包含：

- server 块
- 公网端口监听
- proxy_pass
- WebSocket 支持
- proxy header


---

## 4. 启用 systemd 服务

执行：

```bash
systemctl daemon-reload

systemctl enable 项目名称

systemctl start 项目名称
```


---

## 5. 启用 Nginx 配置


创建软链接：

```bash
ln -s /etc/nginx/sites-available/项目配置文件 \
/etc/nginx/sites-enabled/
```


---

## 6. 测试 Nginx 配置


执行：

```bash
nginx -t
```


确认配置无误。


---

## 7. 启动项目


启动 Node.js：

```bash
systemctl start 项目名称
```


查看状态：

```bash
systemctl status 项目名称
```


---

# 九、禁止使用内容

部署方案中不要包含：

- Docker
- Kubernetes
- 云数据库
- 用户权限系统


---

# 十、整体目标

保持：

- 单服务器
- 个人使用
- 简单可靠
- Node.js + Nginx + systemd 架构


最终结构：

```
Ubuntu服务器

/opt
 └── 项目名称
      └── Node.js项目


/etc/systemd/system
 └── 项目名称.service


/etc/nginx/sites-available
 └── 项目配置文件


公网访问：

服务器IP:16000

        ↓

Nginx

        ↓

127.0.0.1:3000

        ↓

Node.js服务
```