const fs = require("node:fs");
const path = require("node:path");

const API_URL = "https://api.nextop.com/ticketOrder/wOrder/custom/report";
const DEFAULT_TEMPLATE_ID = "790040313888268288";
const OUTPUT_PATH = path.join(process.cwd(), "data", "report.json");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function defaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    createStartTime: start.getTime(),
    createEndTime: end.getTime(),
  };
}

function buildPayload() {
  const timeRange = defaultTimeRange();
  const payload = {
    createStartTime: Number(process.env.NEXTOP_CREATE_START_TIME || timeRange.createStartTime),
    createEndTime: Number(process.env.NEXTOP_CREATE_END_TIME || timeRange.createEndTime),
    templateId: process.env.NEXTOP_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
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

async function main() {
  const authorization = requireEnv("NEXTOP_AUTHORIZATION");
  const cookie = requireEnv("NEXTOP_COOKIE");
  const satoken = requireEnv("NEXTOP_SATOKEN");
  const payload = buildPayload();

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
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
      "x-ca-reqid": `${Math.random()}-${Date.now()}`,
      "x-ca-reqtime": `${Date.now()}`,
    },
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

  const records = extractRecords(json);
  const output = {
    ...json,
    fetchedAt: new Date().toISOString(),
    request: {
      url: API_URL,
      body: payload,
    },
    data: {
      ...(json.data && typeof json.data === "object" && !Array.isArray(json.data) ? json.data : {}),
      records,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${records.length} records to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
