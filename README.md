# 售后工单导出数据

这是一个 GitHub Pages 静态页面，数据由 GitHub Actions 每小时从 Nextop 导出文件并解析生成。

- 页面文件：`index.html`
- 预览地址：`https://sunlizhu521-alt.github.io/shouhoushuju/`
- 数据文件：`data/report.json`
- 自动同步：每 1 小时运行一次，也支持手动运行 workflow

## 数据流程

当前脚本不再直接读取列表接口数据，而是模拟 Nextop 前端导出流程：

1. 创建导出任务：`POST https://api.nextop.com/ticketOrder/wOrder/custom/report/download/async`
2. 轮询任务详情：`GET https://api.nextop.com/performance/importExport/task/importExportTaskDetail?taskId=...`
3. 下载导出文件：读取任务返回的 `exportFileUrl`
4. 解析 Excel/CSV：写入 `data/report.json`
5. 自动去重：优先按 `repairOrderId/工单ID`，再按 `repairOrderNo/工单编号`，最后按整行内容

导出请求默认不带时间条件、不带状态条件、不带搜索条件。

## GitHub Secrets

仓库需要配置这些 Secrets，不能写进代码：

```text
NEXTOP_AUTHORIZATION
NEXTOP_COOKIE
NEXTOP_SATOKEN
```

进入 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

把浏览器 DevTools 里复制的 cURL 对应值分别填进去。

## 可选变量

如需覆盖默认模板或导出轮询参数，可在 GitHub Actions Variables 中配置：

```text
NEXTOP_TEMPLATE_ID
NEXTOP_WITH_HISTORY_COLUMN
NEXTOP_EXPORT_MAX_POLLS
NEXTOP_EXPORT_POLL_MS
```

默认模板 ID：

```text
790040313888268288
```

## 注意

登录凭证会过期。过期后需要重新从 DevTools 复制 cURL，并更新 GitHub Secrets。
