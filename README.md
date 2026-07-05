# 工单报表数据台

这是一个单文件静态页面版本，不再区分前端和后端。

- 页面文件：`index.html`
- 预览地址：`https://sunlizhu521-alt.github.io/shouhoushuju/`
- 数据能力：示例数据、JSON 导入、浏览器直连接口尝试、搜索筛选、分页、详情查看、CSV 导出

## 说明

页面可以在浏览器里尝试请求：

```text
POST https://openapi.nextop.com/ticketOrder/wOrder/custom/report
```

如果该接口不允许浏览器跨域请求，页面会提示失败；这种情况下可以把接口返回 JSON 粘贴到页面的“导入 JSON”区域使用。

不要把长期有效的密钥提交到仓库。页面里的请求头只存在于当前浏览器会话。
