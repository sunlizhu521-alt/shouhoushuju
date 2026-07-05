# 工单报表数据台

这是一个 GitHub Pages 静态页面，数据由 GitHub Actions 定时抓取。

- 页面文件：`index.html`
- 预览地址：`https://sunlizhu521-alt.github.io/shouhoushuju/`
- 数据文件：`data/report.json`
- 数据能力：自动读取同步数据、示例数据、JSON 导入、搜索筛选、分页、详情查看、CSV 导出

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

把 cURL 里的值分别填进去。

## 自动同步

工作流文件：

```text
.github/workflows/fetch-nextop-report.yml
```

它会每 6 小时请求：

```text
POST https://api.nextop.com/ticketOrder/wOrder/custom/report
```

并把结果写入：

```text
data/report.json
```

页面会自动读取这个文件。

默认模板 ID：

```text
790040313888268288
```

如需覆盖，在 GitHub 仓库变量中配置：

```text
NEXTOP_TEMPLATE_ID
NEXTOP_CREATE_START_TIME
NEXTOP_CREATE_END_TIME
NEXTOP_EXTRA_BODY_JSON
```

## 注意

登录凭证会过期。过期后重新从 DevTools 复制 cURL，并更新 GitHub Secrets。
