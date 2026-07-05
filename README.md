# 工单报表数据台

这是一个最小可运行的“后台数据库 + 在线表格页面”：

- 后端：Flask + SQLite
- 前端：React + Vite
- 数据源：`POST https://openapi.nextop.com/ticketOrder/wOrder/custom/report`

## 目录

```text
server/  后端接口、SQLite 数据库、同步逻辑
client/  在线表格页面
```

## 配置接口鉴权

复制 `server/.env.example` 为 `server/.env`，按实际接口要求填写：

```env
NEXTOP_AUTH_TOKEN=
NEXTOP_COOKIE=
NEXTOP_TEMPLATE_ID=
NEXTOP_EXTRA_HEADERS={}
NEXTOP_DEFAULT_BODY={"current":1,"size":50,"searchCount":true}
PORT=5088
```

如果接口用的是非 `Authorization` 的鉴权方式，可以把额外请求头写进 `NEXTOP_EXTRA_HEADERS`，例如：

```env
NEXTOP_EXTRA_HEADERS={"x-api-key":"your-key","tenant-id":"your-tenant"}
```

未配置 token 或 cookie 时，点击“手动同步”会写入示例数据，方便先验证网格功能。

## 启动

后端：

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python app.py
```

前端：

```powershell
cd client
npm.cmd install
npm.cmd run dev
```

访问：

```text
http://127.0.0.1:5178
```

## 主要接口

- `POST /api/sync` 手动同步数据到 SQLite
- `GET /api/rows` 分页查询表格数据
- `GET /api/stats` 获取记录数和最近同步状态
- `GET /api/export.csv` 导出 CSV
