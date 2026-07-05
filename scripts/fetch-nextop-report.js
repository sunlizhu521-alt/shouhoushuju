const fs = require("node:fs");
const path = require("node:path");

const API_URL = "https://api.nextop.com/ticketOrder/wOrder/custom/report";
const DEFAULT_TEMPLATE_ID = "790040313888268288";
const OUTPUT_PATH = path.join(process.cwd(), "data", "report.json");
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 500;

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function buildPayload(page) {
  const pageSize = Number(process.env.NEXTOP_PAGE_SIZE || DEFAULT_PAGE_SIZE);
  const payload = {
    templateId: process.env.NEXTOP_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
    current: page,
    size: pageSize,
    searchCount: true,
  };

  if (process.env.NEXTOP_EXTRA_BODY_JSON) {
    Object.assign(payload, JSON.parse(process.env.NEXTOP_EXTRA_BODY_JSON));
  }

  return payload;
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

async function fetchPage(payload, headers) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Nextop returned non-JSON response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`Nextop HTTP ${response.status}: ${json.msg || json.message || text.slice(0, 500)}`);
  }

  return json;
}

function totalFromPayload(payload) {
  const candidates = [
    payload?.data?.total,
    payload?.data?.totalCount,
    payload?.data?.count,
    payload?.total,
    payload?.totalCount,
  ];
  const total = candidates.find((value) => Number.isFinite(Number(value)));
  return total === undefined ? undefined : Number(total);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function dedupeRecords(records) {
  const seen = new Set();
  const unique = [];
  for (const record of records) {
    const key = record?.repairOrderId
      ? `repairOrderId:${record.repairOrderId}`
      : record?.repairOrderNo
        ? `repairOrderNo:${record.repairOrderNo}`
        : `raw:${stableStringify(record)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}

async function main() {
  const authorization = requireEnv("NEXTOP_AUTHORIZATION");
  const cookie = requireEnv("NEXTOP_COOKIE");
  const satoken = requireEnv("NEXTOP_SATOKEN");
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Authorization: authorization,
    Connection: "keep-alive",
    "Content-Type": "application/json;charset=UTF-8",
    Cookie: cookie,
    Origin: "https://saas.nextop.com",
    Referer: "https://saas.nextop.com/crm/orderManage/workOrderReport/customization/index",
    saToken: satoken,
    "x-ca-language": "zh_CN",
  };

  const allRecords = [];
  let lastPayload;
  let expectedTotal;
  let page = 1;

  while (page <= MAX_PAGES) {
    const payload = buildPayload(page);
    const requestTime = Date.now();
    headers["x-ca-reqid"] = `${Math.random()}-${requestTime}`;
    headers["x-ca-reqtime"] = `${requestTime}`;

    const json = await fetchPage(payload, headers);
    const records = extractRecords(json);
    const total = totalFromPayload(json);
    if (total !== undefined) expectedTotal = total;
    lastPayload = json;
    allRecords.push(...records);

    console.log(`Fetched page ${page}: ${records.length} records${total !== undefined ? `, total ${total}` : ""}`);

    if (!records.length) break;
    if (expectedTotal !== undefined && allRecords.length >= expectedTotal) break;
    if (records.length < payload.size) break;
    page += 1;
  }

  if (page > MAX_PAGES) {
    throw new Error(`Stopped after ${MAX_PAGES} pages to avoid an infinite loop.`);
  }

  const records = dedupeRecords(allRecords);
  const output = {
    ...lastPayload,
    fetchedAt: new Date().toISOString(),
    request: {
      url: API_URL,
      body: {
        templateId: process.env.NEXTOP_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
        size: Number(process.env.NEXTOP_PAGE_SIZE || DEFAULT_PAGE_SIZE),
        searchCount: true,
      },
      pagesFetched: page,
      rawRecordsFetched: allRecords.length,
      dedupeKeys: ["repairOrderId", "repairOrderNo", "record content"],
    },
    data: {
      ...(lastPayload?.data && typeof lastPayload.data === "object" && !Array.isArray(lastPayload.data) ? lastPayload.data : {}),
      total: expectedTotal ?? records.length,
      records,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${records.length} unique records to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
