# 🎮 游戏攻略 & 作品展示站

基于 **Astro** 的内容型个人网站：Markdown 写攻略、自动生成页面、GitHub Actions 自动部署。

## 项目结构（只需要关心加 ⭐ 的部分）

```
game-guide-site/
├── .github/workflows/deploy.yml   ← 自动部署配置（不用动）
├── astro.config.mjs               ← 站点配置（上线时改一次）
├── public/
│   └── images/                  ⭐ 攻略图片、作品截图放这里
├── src/
│   ├── content/
│   │   └── guides/              ⭐ 攻略 .md 文件放这里（发文=加文件）
│   ├── data/
│   │   └── works.ts             ⭐ 作品数据（加作品=加一条数据）
│   ├── pages/                     页面（基本不用动）
│   ├── layouts/  components/      布局组件（基本不用动）
│   └── styles/global.css          全站样式（想换色改这里）
└── package.json
```

---

## 🚀 上线四步曲（只需做一次）

### 第 1 步：建仓库

在 GitHub 上新建仓库，**推荐命名为 `<你的用户名>.github.io`**（比如用户名是 `tomy`，仓库就叫 `tomy.github.io`）。
这样网站地址就是干净的 `https://tomy.github.io/`，且本项目默认配置零改动可用。

> 若仓库用了其他名字（如 `game-guide-site`）：打开 `astro.config.mjs`，把 `base` 改成 `'/game-guide-site'`。

### 第 2 步：上传项目文件

方式 A（零工具，推荐新手）：仓库页 → `Add file` → `Upload files` → 把本项目**除 `node_modules` 外**的所有文件/文件夹拖进去 → `Commit changes`。

方式 B（本地装了 Git）：

```bash
git init
git add .
git commit -m "init: 游戏攻略站上线"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 第 3 步：开启 Pages

仓库 → `Settings` → 左侧 `Pages` → `Build and deployment` 的 `Source` 选 **`GitHub Actions`** → 保存。

### 第 4 步：改站点名

打开 `astro.config.mjs`，把 `site` 里的 `yourusername` 改成你的 GitHub 用户名，push（或网页编辑）上去。

完成后等 1-2 分钟，访问 `https://<你的用户名>.github.io` 即可看到网站！🎉

---

## 📥 从语雀批量导入已有攻略（你已有内容，这个最省事）

### 一次性准备：安装 Node.js（如果还没装）

到 https://nodejs.org 下载 LTS 版本，一路下一步安装即可（Mac 也可用 `brew install node`）。
装完在终端输入 `node -v`，能显示版本号就行。

### 第 1 步：从语雀导出 Markdown

推荐用 **yuque-exporter**（开源、免费、下载即用，无需装任何运行时）：

1. 下载对应系统的可执行文件：https://github.com/bkm016/yuque-exporter/releases
   - Windows: `yuque-exporter-windows-amd64.exe`
   - Mac Intel: `yuque-exporter-darwin-amd64`
   - Mac M1/M2: `yuque-exporter-darwin-arm64`
2. 获取语雀 Token：登录语雀 → https://www.yuque.com/settings/tokens → 新建
3. 导出某个知识库（你的 URL 格式为 `yuque.com/{user}/{repo}`）：

```bash
# Mac/Linux
chmod +x yuque-exporter-*
./yuque-exporter-darwin-arm64 -token 你的Token -user 你的用户名 -repo 知识库路径 -format markdown

# Windows
yuque-exporter-windows-amd64.exe -token 你的Token -user 你的用户名 -repo 知识库路径 -format markdown
```

导出后会在 `./export/知识库名/` 下生成全部 `.md` 文件，保留原有目录结构。

> 每个游戏知识库重复执行一次，把不同游戏的内容分别导出。

### 第 2 步：批量导入到攻略站

把项目 clone 到本地（或下载 zip 解压），在项目根目录执行：

```bash
# 先安装依赖（只需一次）
npm install

# 导入某个游戏的攻略
node scripts/import-yuque.mjs ./export/原神 原神
node scripts/import-yuque.mjs ./export/黑神话悟空 黑神话悟空
```

脚本会自动：
- 扫描目录下所有 `.md` 文件
- 给每个文件**补上 frontmatter**（标题取自文件名，日期取今天，game 填你传入的游戏名）
- 复制到 `src/content/guides/` 目录
- 跳过已存在文件（安全，可重复执行）
- 生成 `import-report.json` 清单

### 第 3 步：处理图片（如有）

语雀导出的图片是外链（`cdn.yuque.com` 的 URL），通常可以直接用，无需处理。
如果图片失效或你想本地化：

1. 手动下载图片放到 `public/images/游戏名/`
2. 编辑 `.md` 文件，把图片 URL 改成 `/images/游戏名/xxx.jpg`

### 第 4 步：检查 & 微调 frontmatter

打开 `src/content/guides/` 下的文件，按需修改开头的信息头：

```md
---
title: 这里改成更好的标题      ← 默认取文件名，可手改
description: 摘要文字          ← 默认取正文第一段，可手改
game: 原神                     ← 已自动填好
date: 2026-08-15               ← 默认今天，可改成实际发布日期
tags: [新手, 开荒]             ← 可选，加上标签
---
```

### 第 5 步：推送上线

```bash
git add .
git commit -m "import: 导入语雀攻略"
git push
```

等 1-2 分钟，全部攻略自动上线！🎉

> **后续更新**：在语雀改完后，重新跑导出 + 导入脚本即可（增量导入，不会覆盖已改过的文件）。

---

## 🔄 语雀全自动同步（配置一次，以后只用语雀写作）

开启后效果：**你只在语雀里写/改文档，网站每天自动更新**（北京时间每天早上 8 点同步一次，也可手动立即同步）。

```
语雀编辑保存 → 每天 08:00 自动拉取 → 有变化自动提交 → 自动部署上线
                                    （Actions 页可随时手动触发）
```

### 开启步骤（各做一次）

**1. 配置语雀 Token**

- 获取 Token：语雀 → https://www.yuque.com/settings/tokens → 新建
- GitHub 仓库 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
  - Name: `YUQUE_TOKEN`
  - Value: 你的语雀 Token
  - Token 只存在加密的 Secrets 里，代码和日志中都不可见

**2. 填写同步配置**

编辑项目根目录的 `yuque.config.json`：

```json
{
  "user": "你的语雀用户名",
  "repos": [
    { "repo": "genshin", "game": "原神" },
    { "repo": "wukong", "game": "黑神话：悟空" }
  ]
}
```

- `user`：语雀主页地址 `yuque.com/{这里}/...` 里的那段
- `repo`：知识库地址 `yuque.com/用户名/{这里}` 里的那段
- `game`：显示在网站上的游戏名（中文可以）

新增游戏 = 加一条；提交这个文件的修改即可生效。

**3. 完成！**

之后每天早上 8 点自动同步。想立即同步：仓库 → `Actions` → 左侧 `Sync from Yuque` → `Run workflow`。

### 同步规则（重要）

- ✍️ **写作纪律：语雀是唯一源头**。不要直接改 GitHub 上的 .md 正文，下次同步会被语雀版本覆盖。
- 🏷️ **你在网站侧手改的信息头会保留**：同步只更新正文，`title / date / tags` 等字段以仓库里为准（首次导入自动生成，之后你可以手动润色，同步不会冲掉）。
- 🆕 语雀**新增**文档 → 自动出现在网站
- ♻️ 语雀**修改**文档 → 正文自动更新
- 🗑️ 语雀**删除**文档 → **不会**自动从网站移除（防止误删），需要手动删 `src/content/guides/` 下对应文件
- 🖼️ 图片沿用语雀外链，一般可直接访问；想本地化就下载到 `public/images/` 并修正正文里的路径

### 同步失败怎么排查

仓库 → `Actions` → `Sync from Yuque` → 点开最近一次红叉运行记录，看报错日志。常见原因：
- Token 过期/错误（重新生成并更新 Secret）
- `yuque.config.json` 里的 user/repo 拼错（对照语雀地址栏检查）
- 语雀 API 临时限流（等下一次定时重试即可）

---

## ✍️ 日常写新攻略（语雀之外的原创内容）

在 GitHub 网页进入 `src/content/guides/` → `Add file` → `Create new file`：

- 文件名用英文/拼音，如 `genshin-beginner.md`
- 开头写信息头，下面写正文（参考站内第一篇教程攻略）

```md
---
title: 新手开荒全攻略
description: 从零开始的完整路线
game: 原神
date: 2026-08-15
tags: [新手, 开荒]
---
正文用 Markdown 写……
```

点 `Commit changes`，1-2 分钟后自动上线。

### 上传攻略图片

GitHub 网页进入 `public/images/` → `Add file` → `Upload files` → 拖入截图。
正文里用 `![描述](/images/截图.jpg)` 引用。

### 添加/修改作品

编辑 `src/data/works.ts`，照着示例条目加一条即可。

### 修改站名/导航

编辑 `src/components/Header.astro` 里的文字。

---

## 💻 本地开发（可选，不想装环境可跳过）

```bash
npm install      # 安装依赖
npm run dev      # 启动开发服务器 → http://localhost:4321
npm run build    # 构建产物（dist/），GitHub Actions 会自动做这步
```

## 🔧 常见问题

**推了代码但网站没更新？**
仓库页 → `Actions` 标签 → 查看最近一次 workflow 是否报错（红叉）。

**图片不显示？**
确认图片在 `public/images/` 且路径以 `/images/` 开头；若你的仓库不是 `<用户名>.github.io` 命名，需要同步改 `base`（见上文）。

**想绑定自己的域名？**
仓库 → `Settings` → `Pages` → `Custom domain` 填入域名，DNS 加一条 CNAME 记录指向 `<用户名>.github.io`，再把域名填到 `astro.config.mjs` 的 `site` 里（此时 `base` 改回 `/`）。
