# 步步高官方论坛时光机

Vue 3 纯静态前端。发布后不需要 Python 服务、数据库或 API，可直接放在 GitHub Pages 的项目子目录。Python 和 SQLite 仅用于发布前生成归档数据。

原始归档默认读取：

`D:\Downloads\步步高官方论坛帖子\帖子索引.csv`

## 首次运行

```powershell
cd webapp
npm ci
python export_static.py
npm run build
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8765>。

已有 `public/archive/manifest.json` 和完整分片时，不必重新导出；直接 `npm ci` 和 `npm run build` 即可。首次从零准备需先运行 `python build_index.py` 生成 `data/forum.db`。

## GitHub Pages 发布

本仓库根目录提供 `.github/workflows/pages.yml`，工作目录为 `webapp`。将 `webapp` 源码、锁文件、`public`（含生成的完整 `archive`）以及此工作流提交到你自己的 GitHub 仓库。不要提交 `data/forum.db`、原始 HTML、`node_modules` 或本机其他归档文件。

在仓库 Settings → Pages 选择 GitHub Actions，然后手动运行 **Publish forum to GitHub Pages**。构建使用预生成的数据，不访问本机 D 盘。不需要服务器密钥。若将 `webapp` 本身作为仓库根目录，需把工作流中的 `webapp/` 路径前缀和 `working-directory: webapp` 去掉。

也可以直接把 `dist` 内容发布到 Pages 分支根目录，保留 `.nojekyll`。所有资源均使用相对路径，支持 `https://用户名.github.io/仓库名/#post-157323`。

## 数据与搜索

旧式表情使用本地 `public/emot` GIF（来源见其中的 SOURCE.md），正文及签名中的 `[emNN]` 在显示时转换。未知编号保留原文。`archive/signatures` 保留原始签名经安全过滤后的 HTML，可用 `python restore_legacy_assets.py` 从本地原始 HTML 重建；完整导出也会自动生成。签名中的历史外链图片仍可能失效。

- `archive/posts/*.json.gz`：每 500 个 ID 一片的预解析帖子（包含已存档楼层、图片链接、附件、签名、历史用户资料）。
- `archive/catalog.json.gz`：压缩目录，第一次进入列表/搜索时加载；直达帖子不需要加载目录。
- `archive/search/*.json.gz`：按字符分桶的单字、双字倒排索引，由 Web Worker 按需读取。
- `archive/search-title/*.json.gz`、`archive/search-author/*.json.gz`：标题、作者专用倒排索引，各 256 个分片。对应范围先取索引交集，再核验目录里的连续匹配，不下载正文。完整导出会自动生成；已有目录可运行 `python build_field_indexes.py` 单独重建。
- `archive/texts/*.json.gz`：搜索核验文本。长关键词先求索引交集，再核验连续匹配；常见长词可能需要加载较多文本分片。重复查询和翻页复用结果。

全文检索范围延续原版：主题标题、作者、版块和首帖正文；不包含全部回复。现代浏览器需支持 Worker 和 DecompressionStream。第一次搜索需要下载目录与相关索引，速度取决于网络。图片和附件仍使用历史外链，离线不可用，原站删除的文件无法自动恢复。

导出错误记录在 `data/static-export-report.json`；缺失详情时保留数据库中的正文。新增数据后重新完整导出再构建，不要在导出过程中发布。
