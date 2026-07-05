from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "ticket_reports.db"
API_URL = "https://openapi.nextop.com/ticketOrder/wOrder/custom/report"

load_dotenv(ROOT / ".env")

app = Flask(__name__)
CORS(app)


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS report_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                remote_id TEXT,
                repair_order_no TEXT,
                customer_email TEXT,
                status TEXT,
                created_at TEXT,
                service_user TEXT,
                summary TEXT,
                raw_json TEXT NOT NULL,
                synced_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_report_rows_remote_id ON report_rows(remote_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_report_rows_status ON report_rows(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_report_rows_created_at ON report_rows(created_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                status TEXT NOT NULL,
                rows_upserted INTEGER NOT NULL DEFAULT 0,
                message TEXT
            )
            """
        )


def config_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = os.getenv("NEXTOP_AUTH_TOKEN", "").strip()
    cookie = os.getenv("NEXTOP_COOKIE", "").strip()
    extra_headers = os.getenv("NEXTOP_EXTRA_HEADERS", "").strip()

    if token:
        headers["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    if cookie:
        headers["Cookie"] = cookie
    if extra_headers:
        try:
            headers.update(json.loads(extra_headers))
        except json.JSONDecodeError:
            raise ValueError("NEXTOP_EXTRA_HEADERS must be valid JSON")

    return headers


def default_payload() -> dict[str, Any]:
    payload = {
        "createStartTime": None,
        "createEndTime": None,
        "createUserIds": [],
        "current": 1,
        "customerEmail": [],
        "customerMailAddrs": [],
        "orderItems": [],
        "orderStatuses": [],
        "queryType": None,
        "queryValue": "",
        "repairOrderNo": "",
        "searchCount": True,
        "serviceGroupIds": [],
        "serviceUserIds": [],
        "size": 50,
        "templateId": None,
    }
    env_payload = os.getenv("NEXTOP_DEFAULT_BODY", "").strip()
    if env_payload:
        payload.update(json.loads(env_payload))
    return payload


def extract_rows(response_json: dict[str, Any]) -> list[dict[str, Any]]:
    data = response_json.get("data")
    if isinstance(data, list):
        return data
    if not isinstance(data, dict):
        return []

    for key in ("records", "list", "rows", "data", "items"):
        value = data.get(key)
        if isinstance(value, list):
            return value
    return []


def first_value(row: dict[str, Any], keys: tuple[str, ...], fallback: str = "") -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and value != "":
            return str(value)
    return fallback


def normalize_row(row: dict[str, Any]) -> dict[str, str]:
    remote_id = first_value(row, ("id", "orderId", "repairOrderId", "orderNo", "repairOrderNo"))
    return {
        "remote_id": remote_id,
        "repair_order_no": first_value(row, ("repairOrderNo", "orderNo", "ticketNo", "code"), remote_id),
        "customer_email": first_value(row, ("customerEmail", "email", "customerMailAddr")),
        "status": first_value(row, ("status", "orderStatus", "statusName"), "unknown"),
        "created_at": first_value(row, ("createdAt", "createTime", "createdTime", "createDate")),
        "service_user": first_value(row, ("serviceUserName", "serviceUser", "assigneeName", "handlerName")),
        "summary": first_value(row, ("title", "subject", "summary", "description")),
        "raw_json": json.dumps(row, ensure_ascii=False),
        "synced_at": now_iso(),
    }


def upsert_rows(rows: list[dict[str, Any]]) -> int:
    normalized = [normalize_row(row) for row in rows]
    with get_conn() as conn:
        for row in normalized:
            existing = None
            if row["remote_id"]:
                existing = conn.execute(
                    "SELECT id FROM report_rows WHERE remote_id = ? LIMIT 1", (row["remote_id"],)
                ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE report_rows
                    SET repair_order_no = ?, customer_email = ?, status = ?, created_at = ?,
                        service_user = ?, summary = ?, raw_json = ?, synced_at = ?
                    WHERE id = ?
                    """,
                    (
                        row["repair_order_no"],
                        row["customer_email"],
                        row["status"],
                        row["created_at"],
                        row["service_user"],
                        row["summary"],
                        row["raw_json"],
                        row["synced_at"],
                        existing["id"],
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO report_rows (
                        remote_id, repair_order_no, customer_email, status, created_at,
                        service_user, summary, raw_json, synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["remote_id"],
                        row["repair_order_no"],
                        row["customer_email"],
                        row["status"],
                        row["created_at"],
                        row["service_user"],
                        row["summary"],
                        row["raw_json"],
                        row["synced_at"],
                    ),
                )
    return len(normalized)


def sample_rows() -> list[dict[str, Any]]:
    base = int(time.time())
    return [
        {
            "id": f"demo-{index}",
            "repairOrderNo": f"WO-20260705-{1000 + index}",
            "customerEmail": f"customer{index}@example.com",
            "statusName": ["待处理", "处理中", "已完成", "已关闭"][index % 4],
            "createTime": datetime.fromtimestamp(base - index * 5400).isoformat(timespec="seconds"),
            "serviceUserName": ["张敏", "李明", "王佳", "陈阳"][index % 4],
            "summary": f"示例工单报表记录 {index}",
            "templateId": os.getenv("NEXTOP_TEMPLATE_ID", "未配置"),
        }
        for index in range(1, 17)
    ]


def record_sync(status: str, rows_upserted: int = 0, message: str | None = None, run_id: int | None = None) -> int:
    with get_conn() as conn:
        if run_id:
            conn.execute(
                """
                UPDATE sync_runs
                SET finished_at = ?, status = ?, rows_upserted = ?, message = ?
                WHERE id = ?
                """,
                (now_iso(), status, rows_upserted, message, run_id),
            )
            return run_id
        cursor = conn.execute(
            "INSERT INTO sync_runs (started_at, status, message) VALUES (?, ?, ?)",
            (now_iso(), status, message),
        )
        return int(cursor.lastrowid)


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "database": str(DB_PATH), "apiUrl": API_URL})


@app.get("/api/config")
def config() -> Any:
    return jsonify(
        {
            "apiUrl": API_URL,
            "hasAuthToken": bool(os.getenv("NEXTOP_AUTH_TOKEN", "").strip()),
            "hasCookie": bool(os.getenv("NEXTOP_COOKIE", "").strip()),
            "templateId": os.getenv("NEXTOP_TEMPLATE_ID", ""),
        }
    )


@app.post("/api/sync")
def sync_report() -> Any:
    init_db()
    run_id = record_sync("running")
    body = default_payload()
    body.update(request.get_json(silent=True) or {})
    if os.getenv("NEXTOP_TEMPLATE_ID") and not body.get("templateId"):
        body["templateId"] = int(os.getenv("NEXTOP_TEMPLATE_ID", "0"))

    try:
        if not os.getenv("NEXTOP_AUTH_TOKEN") and not os.getenv("NEXTOP_COOKIE"):
            rows = sample_rows()
            rows_count = upsert_rows(rows)
            record_sync("demo", rows_count, "未配置鉴权，已写入示例数据。", run_id)
            return jsonify({"mode": "demo", "rowsUpserted": rows_count, "message": "未配置鉴权，已写入示例数据。"})

        response = requests.post(API_URL, headers=config_headers(), json=body, timeout=30)
        response.raise_for_status()
        response_json = response.json()
        rows = extract_rows(response_json)
        rows_count = upsert_rows(rows)
        message = f"接口返回 {len(rows)} 行，已写入数据库。"
        record_sync("success", rows_count, message, run_id)
        return jsonify({"mode": "live", "rowsUpserted": rows_count, "responseCode": response_json.get("code"), "message": message})
    except Exception as exc:
        record_sync("error", 0, str(exc), run_id)
        return jsonify({"error": str(exc)}), 500


@app.get("/api/rows")
def rows() -> Any:
    init_db()
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("pageSize", 25)), 1), 200)
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()

    clauses: list[str] = []
    params: list[Any] = []
    if search:
        clauses.append(
            "(repair_order_no LIKE ? OR customer_email LIKE ? OR service_user LIKE ? OR summary LIKE ? OR raw_json LIKE ?)"
        )
        params.extend([f"%{search}%"] * 5)
    if status:
        clauses.append("status = ?")
        params.append(status)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    offset = (page - 1) * page_size

    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS total FROM report_rows {where}", params).fetchone()["total"]
        records = conn.execute(
            f"""
            SELECT id, remote_id, repair_order_no, customer_email, status, created_at,
                   service_user, summary, raw_json, synced_at
            FROM report_rows
            {where}
            ORDER BY COALESCE(created_at, synced_at) DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

    return jsonify({"rows": [dict(row) for row in records], "total": total, "page": page, "pageSize": page_size})


@app.get("/api/stats")
def stats() -> Any:
    init_db()
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS total FROM report_rows").fetchone()["total"]
        statuses = conn.execute(
            "SELECT status, COUNT(*) AS count FROM report_rows GROUP BY status ORDER BY count DESC"
        ).fetchall()
        latest = conn.execute(
            "SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return jsonify(
        {
            "total": total,
            "statuses": [dict(row) for row in statuses],
            "latestSync": dict(latest) if latest else None,
        }
    )


@app.get("/api/export.csv")
def export_csv() -> Any:
    init_db()
    rows_response = rows().get_json()
    lines = ["id,repair_order_no,customer_email,status,created_at,service_user,summary,synced_at"]
    for row in rows_response["rows"]:
        values = [
            row["id"],
            row["repair_order_no"],
            row["customer_email"],
            row["status"],
            row["created_at"],
            row["service_user"],
            row["summary"],
            row["synced_at"],
        ]
        lines.append(",".join('"' + str(value or "").replace('"', '""') + '"' for value in values))
    return app.response_class("\n".join(lines), mimetype="text/csv")


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5088")), debug=True)
