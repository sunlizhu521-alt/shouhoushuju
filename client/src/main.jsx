import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Filter,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:5088";
const PAGE_SIZE = 12;

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusTone(status = "") {
  if (status.includes("完成") || status.includes("关闭") || status.toLowerCase().includes("success")) return "green";
  if (status.includes("处理") || status.includes("进行")) return "blue";
  if (status.includes("待") || status.includes("pending")) return "amber";
  return "gray";
}

function App() {
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState({ total: 0, statuses: [], latestSync: null });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0], [rows, selectedId]);
  const rawJson = useMemo(() => {
    if (!selected?.raw_json) return {};
    try {
      return JSON.parse(selected.raw_json);
    } catch {
      return { raw_json: selected.raw_json };
    }
  }, [selected]);

  async function fetchJson(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
  }

  async function loadRows(nextPage = page) {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        search,
        status,
      });
      const payload = await fetchJson(`/api/rows?${query}`);
      setRows(payload.rows);
      setTotal(payload.total);
      setPage(payload.page);
      if (!selectedId && payload.rows[0]) setSelectedId(payload.rows[0].id);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    const [nextConfig, nextStats] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/stats")]);
    setConfig(nextConfig);
    setStats(nextStats);
  }

  async function syncData() {
    setSyncing(true);
    setNotice("");
    try {
      const payload = await fetchJson("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" } });
      setNotice(payload.message || `已同步 ${payload.rowsUpserted} 行`);
      await loadStats();
      await loadRows(1);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadStats().then(() => loadRows(1)).catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadRows(1).catch((error) => setNotice(error.message));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search, status]);

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Database size={22} />
          </div>
          <div>
            <h1>工单报表数据台</h1>
            <p>自定义报表</p>
          </div>
        </div>

        <section className="side-section">
          <div className="section-title">
            <Server size={16} />
            <span>数据同步</span>
          </div>
          <div className="endpoint">{config?.apiUrl || "加载中..."}</div>
          <button className="primary-button" onClick={syncData} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "spin" : ""} />
            <span>{syncing ? "同步中" : "手动同步"}</span>
          </button>
          {notice && <p className="notice">{notice}</p>}
        </section>

        <section className="side-section">
          <div className="section-title">
            <Activity size={16} />
            <span>接口状态</span>
          </div>
          <div className="status-stack">
            <div>
              <span className={config?.hasAuthToken || config?.hasCookie ? "dot ok" : "dot warn"} />
              {config?.hasAuthToken || config?.hasCookie ? "已配置鉴权" : "演示模式"}
            </div>
            <div>
              <span className="dot ok" />
              SQLite 已就绪
            </div>
            <div>
              <span className="dot neutral" />
              Template: {config?.templateId || "未设置"}
            </div>
          </div>
        </section>

        <section className="side-section metric-section">
          <div>
            <span>数据库记录</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>最近同步</span>
            <strong>{stats.latestSync ? stats.latestSync.status : "-"}</strong>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>报表网格</h2>
            <p>从接口抓取数据，落库后用于筛选、查看和导出。</p>
          </div>
          <a className="export-button" href={`${API_BASE}/api/export.csv?page=1&pageSize=200&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`}>
            <Download size={16} />
            <span>导出</span>
          </a>
        </header>

        <div className="toolbar">
          <label className="search-box">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工单、客户、处理人" />
          </label>
          <label className="select-box">
            <Filter size={17} />
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              {stats.statuses.map((item) => (
                <option key={item.status} value={item.status}>
                  {item.status} ({item.count})
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button" onClick={() => loadRows(page)} disabled={loading}>
            <SlidersHorizontal size={16} />
            <span>刷新</span>
          </button>
        </div>

        <div className="content-grid">
          <div className="table-panel">
            <table>
              <thead>
                <tr>
                  <th>工单号</th>
                  <th>客户邮箱</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>处理人</th>
                  <th>摘要</th>
                  <th>同步时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={selected?.id === row.id ? "selected" : ""}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td className="mono">{row.repair_order_no || "-"}</td>
                    <td>{row.customer_email || "-"}</td>
                    <td>
                      <span className={`chip ${statusTone(row.status)}`}>{row.status || "unknown"}</span>
                    </td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>{row.service_user || "-"}</td>
                    <td className="summary">{row.summary || "-"}</td>
                    <td>{formatDate(row.synced_at)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="empty" colSpan="7">
                      {loading ? "正在加载..." : "暂无数据，点击左侧手动同步。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <footer className="pager">
              <span>
                第 {page} / {totalPages} 页，共 {total} 行
              </span>
              <div>
                <button onClick={() => loadRows(Math.max(page - 1, 1))} disabled={page <= 1 || loading}>
                  <ChevronLeft size={16} />
                </button>
                <button onClick={() => loadRows(Math.min(page + 1, totalPages))} disabled={page >= totalPages || loading}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          </div>

          <aside className="detail-panel">
            <div className="detail-head">
              <span>详情</span>
              <strong>{selected?.repair_order_no || "-"}</strong>
            </div>
            <dl>
              <div>
                <dt>远端 ID</dt>
                <dd>{selected?.remote_id || "-"}</dd>
              </div>
              <div>
                <dt>客户</dt>
                <dd>{selected?.customer_email || "-"}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{selected?.status || "-"}</dd>
              </div>
            </dl>
            <pre>{JSON.stringify(rawJson, null, 2)}</pre>
          </aside>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
