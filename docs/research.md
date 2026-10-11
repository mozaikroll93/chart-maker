# 调研：同类「生成图表」网站在 GitHub 上的发布与托管方式

> 调研日期：2026-10-11。目标：做一个 shipping chart（CP 关系图：角色头像圆圈 + 连线）生成器，
> 并能像「动画生涯个人喜好表 / 构成我的 X 部动画」那样直接从 Bangumi 等数据源拉取条目和角色图。

## 1. 参考项目

| 项目 | 类型 | 技术栈 | 数据来源 | 托管方式 |
|---|---|---|---|---|
| [itorr/anime-grid](https://github.com/itorr/anime-grid)（★277） | 动画生涯个人喜好表（格子图） | 原生 HTML/JS + Canvas，无构建 | Bangumi，经作者自建代理 `bgm-w.magiconch.com` | 自有域名 `lab.magiconch.com/anime-grid/`（仓库只放源码） |
| [xswt442-cmd/BGM-xswtier](https://github.com/xswt442-cmd/BGM-xswtier) | Bangumi Tier List | SvelteKit + Tailwind，`adapter-vercel` | Bangumi API + 少量 serverless 中转、封面图片代理 | Vercel，push `main` 自动部署，自定义域名 |
| [jerrylususu/9square](https://github.com/jerrylususu/9square)（★36） | 阵营九宫格 | 原生 HTML/JS/CSS | 用户上传图片 | GitHub Pages：`jerrylususu.github.io/9/`；Vue 重写版在 Vercel（square-9-vue.vercel.app） |
| [joeseesun/hangbang](https://github.com/joeseesun/hangbang) | 中文 Tier List | React 19 + Vite + Tailwind，PWA | 用户粘贴图片 | 纯静态，`dist/` 可放 Nginx / GitHub Pages；导出用 html2canvas-pro；数据存 IndexedDB |
| [Guesswhat-Studio/Calabash](https://github.com/Guesswhat-Studio/Calabash) | 角色/线索关系板 | Vite + React + TS（另有 Tauri 桌面版） | 本地数据 | GitHub Pages（`VITE_BASE_PATH=/Calabash/`），打 tag 后由 Actions 发布 |
| [FlaringK/quadrantmaker](https://github.com/FlaringK/quadrantmaker) | 象限图 | 原生 HTML/JS + gif.js | 用户上传 | GitHub Pages：`flaringk.github.io/quadrantmaker/` |
| [ANEWCAN/person-relation-graph-studio](https://github.com/ANEWCAN/person-relation-graph-studio) | 人物关系图（最接近 ship chart 的功能） | Python 标准库 server + 原生 JS Canvas | 本地 | 无在线版，仅本地运行（可参考其功能：环形/力导向布局、边的样式与标签、PNG/JSON 导出） |

现成的 ship chart 网站（shipchart.org、achartmaker.com、soukanzu.jp）**都是闭源的**，也都不接 Bangumi，需要用户自己上传头像。这正是可以切入的空位。

## 2. 托管方式的三种模式

1. **纯静态 + GitHub Pages**（9square、quadrantmaker、Calabash、hangbang）
   - 零成本、零运维，仓库即站点；用 Vite 时要设置 `base` 为 `/<repo>/`。
   - 局限：没有服务端，**不能做图片代理**。
2. **前端 + serverless 函数，托管在 Vercel**（BGM-xswtier、square-9-vue）
   - 一个仓库里同时放前端和 API 中转 / 图片代理，push 即部署。
   - 注意：`*.vercel.app` 在中国大陆访问不稳定，面向国内用户要绑自定义域名。
3. **自有域名 + 自建代理服务**（anime-grid）
   - 最灵活（还能做统计，比如 anime-grid 导出时会请求 `grid?ids=...` 做埋点），但要自己维护服务器。

## 3. 关键技术点：Bangumi 数据与图片

- **API 支持跨域**：[bangumi/server `web/new.go`](https://github.com/bangumi/server/blob/master/web/new.go) 全局配置了
  `AllowOrigins: ["*"]`，所以浏览器可以直接调 `https://api.bgm.tv/v0/...`（GET 和 `POST /v0/search/*`）。
  浏览器不能自定义 User-Agent；官方 [UA 建议](https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md)
  针对的是「非浏览器」调用方，所以服务端代理要设置 `开发者ID/应用名 (项目主页)` 格式的 UA。
- **做 ship chart 用得到的接口**（来自 OpenAPI `v0.yaml`）：
  - `POST /v0/search/subjects`：搜作品
  - `GET /v0/subjects/{id}/characters`：**一部作品的全部角色和头像**，可以一键把角色铺成圆圈
  - `POST /v0/search/characters`：直接搜角色
  - `GET /v0/characters/{id}/image?type=...`：角色图（302 跳转到 `lain.bgm.tv`）
- **图片导出是难点**：把跨域图片画进 `<canvas>` 后再 `toDataURL`/`toBlob`，要求图片带 CORS 头，否则画布会被污染，导出失败。
  anime-grid 和 BGM-xswtier **都单独做了图片代理**，说明直接用 `lain.bgm.tv` 的图导出很可能行不通
  （沙箱网络受限，没能实测 `lain.bgm.tv` 的响应头，需要在浏览器里验证）。
- **其他可接的数据源**（后续扩展）：AniList GraphQL（角色数据很全，欧美用户多）、Jikan（MyAnimeList 非官方 API）、VNDB（视觉小说）。

## 4. 对本项目的建议

- **前端**：Vite + 任意框架（或原生 JS），用 SVG 或 Canvas 画「圆形头像节点 + 连线」，支持连线类型（恋爱/友情/敌对……）、颜色、标签、图例。
- **托管**：**Cloudflare Pages + Pages Functions**（或 Worker）。静态页面和 `/img?url=` 图片代理放在同一个仓库、同一个域名下，免费额度足够；
  API 请求直接从浏览器发往 `api.bgm.tv`，只有图片走代理（代理要限定只允许 `lain.bgm.tv` 等白名单域名，防止被滥用成开放代理）。
  如果不想要后端，也可以先上 GitHub Pages，再让用户手动上传头像作为兜底。
- **数据存储**：学 hangbang / Calabash，全部存在本地（localStorage / IndexedDB），并提供 JSON 导入导出和「分享链接」（把角色 ID 和连线编码进 URL）。
