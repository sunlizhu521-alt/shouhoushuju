const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const API_ORIGIN = "https://api.nextop.com";
const EXPORT_URL = `${API_ORIGIN}/ticketOrder/wOrder/custom/report/download/async`;
const TASK_DETAIL_URL = `${API_ORIGIN}/performance/importExport/task/importExportTaskDetail`;
const DEFAULT_TEMPLATE_ID = "790040313888268288";
const OUTPUT_PATH = path.join(process.cwd(), "data", "report.json");
const EXPORT_DIR = path.join(process.cwd(), "work", "exports");
const MAX_POLL_ATTEMPTS = Number(process.env.NEXTOP_EXPORT_MAX_POLLS || 180);
const POLL_INTERVAL_MS = Number(process.env.NEXTOP_EXPORT_POLL_MS || 1000);

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBaseHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Authorization: requireEnv("NEXTOP_AUTHORIZATION"),
    Connection: "keep-alive",
    "Content-Type": "application/json;charset=UTF-8",
    Cookie: requireEnv("NEXTOP_COOKIE"),
    Origin: "https://saas.nextop.com",
    Referer: "https://saas.nextop.com/crm/orderManage/workOrderReport/customization/index",
    saToken: requireEnv("NEXTOP_SATOKEN"),
    "x-ca-language": "zh_CN",
  };
}

function withRequestNonce(headers) {
  const requestTime = Date.now();
  return {
    ...headers,
    "x-ca-reqid": `${Math.random()}-${requestTime}`,
    "x-ca-reqtime": `${requestTime}`,
  };
}

function buildExportPayload() {
  return {
    templateId: process.env.NEXTOP_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
    orderIds: [],
    withHistoryColumn: process.env.NEXTOP_WITH_HISTORY_COLUMN === "true",
  };
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} returned non-JSON response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`${context} HTTP ${response.status}: ${json.msg || json.message || text.slice(0, 500)}`);
  }

  return json;
}

function unwrapData(payload) {
  if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
}

async function createExportTask(headers, payload) {
  const response = await fetch(EXPORT_URL, {
    method: "POST",
    headers: withRequestNonce(headers),
    body: JSON.stringify(payload),
  });
  const json = await readJsonResponse(response, "Create export task");
  const data = unwrapData(json);
  const taskId = typeof data === "string" || typeof data === "number"
    ? String(data)
    : data?.id || data?.taskId || data?.importExportTaskId;

  if (!taskId) {
    throw new Error(`Export task response did not include a task id: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return { taskId, raw: json };
}

async function fetchTaskDetail(headers, taskId) {
  const url = new URL(TASK_DETAIL_URL);
  url.searchParams.set("taskId", taskId);
  const response = await fetch(url, {
    method: "GET",
    headers: withRequestNonce(headers),
  });
  const json = await readJsonResponse(response, "Export task detail");
  return unwrapData(json);
}

async function waitForExport(headers, taskId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    const detail = await fetchTaskDetail(headers, taskId);
    const status = Number(detail?.executeStatus);

    if (status === 2) {
      const exportFileUrl = detail.exportFileUrl || detail.fileUrl || detail.downloadUrl || detail.url;
      if (!exportFileUrl) {
        throw new Error(`Export task completed but no file URL was returned: ${JSON.stringify(detail).slice(0, 500)}`);
      }
      console.log(`Export task ${taskId} completed on poll ${attempt}.`);
      return detail;
    }

    if (status !== 1) {
      throw new Error(detail?.errorReason || detail?.message || `Export task ${taskId} returned unexpected detail: ${JSON.stringify(sanitizeTaskDetail(detail)).slice(0, 800)}`);
    }

    console.log(`Export task ${taskId} is still running (${attempt}/${MAX_POLL_ATTEMPTS}).`);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Export task ${taskId} did not finish after ${MAX_POLL_ATTEMPTS} polls.`);
}

function sanitizeTaskDetail(detail) {
  if (!detail || typeof detail !== "object") return detail;
  const sanitized = { ...detail };
  for (const key of ["exportFileUrl", "fileUrl", "downloadUrl", "url"]) {
    if (sanitized[key]) sanitized[key] = "[hidden]";
  }
  return sanitized;
}

function filenameFromResponse(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch) return decodeURIComponent(plainMatch[1]);
  return fallback;
}

async function downloadExportFile(headers, exportFileUrl) {
  const url = new URL(exportFileUrl, API_ORIGIN).toString();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv, */*",
      Authorization: headers.Authorization,
      Cookie: headers.Cookie,
      saToken: headers.saToken,
      "x-ca-language": headers["x-ca-language"],
      ...withRequestNonce({}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download export file HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const filename = filenameFromResponse(response, `nextop-export-${Date.now()}.xlsx`);
  const filePath = path.join(EXPORT_DIR, filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_"));
  fs.writeFileSync(filePath, buffer);
  return { buffer, filePath, filename };
}

function normalizeCellValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function readWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const sheetRows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
    });
    for (const row of sheetRows) {
      const cleaned = {};
      for (const [key, value] of Object.entries(row)) {
        const cleanKey = normalizeCellValue(key);
        if (cleanKey) cleaned[cleanKey] = normalizeCellValue(value);
      }
      if (Object.values(cleaned).some(Boolean)) {
        cleaned.__sheetName = sheetName;
        rows.push(cleaned);
      }
    }
  }

  return rows;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function firstPresent(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function dedupeRecords(records) {
  const seen = new Set();
  const unique = [];
  const keyGroups = [
    ["repairOrderId", "工单ID", "工单Id", "工单id", "ID", "id"],
    ["repairOrderNo", "工单编号", "工单号", "工单号码", "工单单号", "订单号", "orderNo", "ticketNo"],
  ];

  for (const record of records) {
    const explicitKey = keyGroups.map((keys) => firstPresent(record, keys)).find(Boolean);
    const key = explicitKey ? `business:${explicitKey}` : `raw:${stableStringify(record)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }

  return unique;
}

async function main() {
  const headers = buildBaseHeaders();
  const exportPayload = buildExportPayload();
  const { taskId, raw: createTaskResponse } = await createExportTask(headers, exportPayload);
  console.log(`Created export task ${taskId}.`);

  const taskDetail = await waitForExport(headers, taskId);
  const exportFileUrl = taskDetail.exportFileUrl || taskDetail.fileUrl || taskDetail.downloadUrl || taskDetail.url;
  const downloaded = await downloadExportFile(headers, exportFileUrl);
  const parsedRows = readWorkbookRows(downloaded.buffer);
  const records = dedupeRecords(parsedRows);

  const output = {
    code: "000000",
    msg: "导出文件解析成功",
    fetchedAt: new Date().toISOString(),
    request: {
      mode: "export-then-parse",
      createTaskUrl: EXPORT_URL,
      taskDetailUrl: TASK_DETAIL_URL,
      body: exportPayload,
      taskId,
      downloadedFileName: downloaded.filename,
      rawRowsFetched: parsedRows.length,
      dedupeKeys: ["repairOrderId/工单ID", "repairOrderNo/工单编号", "record content"],
    },
    sourceTask: {
      createTaskResponse,
      taskDetail: {
        id: taskDetail.id,
        executeStatus: taskDetail.executeStatus,
        errorReason: taskDetail.errorReason || "",
        exportFileUrl: taskDetail.exportFileUrl ? "[hidden]" : undefined,
      },
    },
    data: {
      total: records.length,
      records,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Parsed ${parsedRows.length} exported rows, wrote ${records.length} unique records to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
