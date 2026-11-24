/**
 * Returns CPU, RAM, or disk usage from JavaScript monitor log entries.
 */
const db = require(`${APP_CONSTANTS.LIB_DIR}/db.js`);
const utils = require(`${APP_CONSTANTS.LIB_DIR}/utils.js`);

const PROPERTY_ALIASES = {
    cpu: ["cpu", "cpu_usage", "cpu_usage_percentage"],
    ram: ["ram", "mem", "memory", "ram_usage", "ram_usage_percentage", "mem_usage", "mem_usage_percentage"],
    disk: ["disk", "disk_usage", "disk_usage_percentage"]
};

exports.doService = async jsonReq => {
    const property = String(jsonReq?.property || "").toLowerCase();
    if (!validateRequest(jsonReq) || !PROPERTY_ALIASES[property]) {
        LOG.error("Validation failure: id, timeRange, and property (cpu, ram, or disk) are required.");
        return CONSTANTS.FALSE_RESULT;
    }

    const logIds = String(jsonReq.id).split(",").map(id => id.trim()).filter(Boolean);
    const range = utils.getTimeRangeForSQLite(jsonReq.timeRange);
    const result = {result: true, type: "linegraph", contents: {ys: [], infos: [], x: [], length: 0, legends: logIds}};

    for (const id of logIds) {
        const rows = await db.runGetQueryFromID("cpuRamDisk", [id, range.from, range.to]);
        if (!rows) { LOG.error(`DB read issue for log ID: ${id}`); return CONSTANTS.FALSE_RESULT; }

        const x = [], y = [], info = [];
        for (const row of rows) {
            const usage = getUsage(row.additional_status, property);
            if (usage === null) continue;
            x.push(utils.fromSQLiteToUTCOrLocalTime(row.timestamp, jsonReq.notUTC));
            y.push(usage);
            info.push(`${property} - ${usage}`);
        }

        if (!y.length) { LOG.warn(`No valid ${property} data found for log ID: ${id}`); continue; }
        result.contents.ys.push(y);
        result.contents.infos.push(info);
        if (x.length > result.contents.length) {
            result.contents.length = x.length;
            result.contents.x = x;
        }
    }

    if (jsonReq.title) result.contents.title = jsonReq.title;
    return result;
};

function getUsage(additionalStatus, property) {
    if (typeof additionalStatus !== "string" || !additionalStatus.trim()) return null;
    const aliases = PROPERTY_ALIASES[property];

    // Current MonBoss JavaScript monitors write entries such as "CPU=0.9% MEM=43.6% DISK=31.5%".
    for (const alias of aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = additionalStatus.match(new RegExp(`(?:^|\\b)${escaped}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)\\s*%?`, "i"));
        if (match) return Number(match[1]);
    }

    // Retain support for JSON-formatted monitor payloads and percentage labels.
    try {
        const data = JSON.parse(additionalStatus);
        if (data && typeof data === "object") {
            for (const key of aliases) {
                if (data[key] !== undefined && Number.isFinite(Number(data[key]))) return Number(data[key]);
            }
        }
    } catch (_) { /* Non-JSON log text is expected. */ }

    const label = property === "ram" ? "RAM|MEM(?:ORY)?" : property.toUpperCase();
    const labeled = additionalStatus.match(new RegExp(`(?:${label})\\s+Usage\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
    return labeled ? Number(labeled[1]) : null;
}

const validateRequest = jsonReq => jsonReq && jsonReq.id && jsonReq.timeRange && jsonReq.timeRange.from && jsonReq.timeRange.to;