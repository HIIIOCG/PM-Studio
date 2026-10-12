import { WORKSPACES, parseDay, taipeiToday } from './timeline-core.mjs';

export const PUBLIC_FEED_HEADER = Object.freeze(['alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'workspaceIds', 'workspaceUnits']);

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label}的欄位不符。`);
  }
}

function publishedTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString() !== value) {
    throw new Error('公開資料缺少有效的發布時間。');
  }
  return value;
}

export function validatePublicSnapshot(value) {
  exactKeys(value, ['schemaVersion', 'publishedAt', 'projects'], '公開資料');
  if (value.schemaVersion !== 1 || !Array.isArray(value.projects) || value.projects.length > 995) {
    throw new Error('公開資料版本或筆數不符。');
  }
  const publishedAt = publishedTime(value.publishedAt);
  const aliases = new Set();
  const allowedSpaces = new Set(WORKSPACES.map((space) => space.id));
  const projects = value.projects.map((project) => {
    exactKeys(project, ['alias', 'goal', 'start', 'end', 'workspaceIds', 'workspaceUnits'], '公開案件');
    const { alias, goal, start, end, workspaceIds, workspaceUnits } = project;
    if (typeof alias !== 'string' || !/^專案 \d{3,}$/u.test(alias) || aliases.has(alias)) {
      throw new Error('匿名名稱無效或重複。');
    }
    aliases.add(alias);
    if (typeof goal !== 'string' || !goal || goal !== goal.trim() || goal.length > 500
      || /https?:\/\/|www\.|@|\b(?:C|BG|P|D|O)-\d{3,}\b|[\u0000-\u001f]|^[=+\-]/iu.test(goal)) {
      throw new Error('公開目標包含未允許的內容。');
    }
    const startDay = parseDay(start), endDay = parseDay(end);
    if (startDay === null || endDay === null || startDay > endDay) throw new Error('公開日期未完整確定。');
    if (!Array.isArray(workspaceIds) || !workspaceIds.length || workspaceIds.length > allowedSpaces.size
      || new Set(workspaceIds).size !== workspaceIds.length || workspaceIds.some((id) => !allowedSpaces.has(id))) {
      throw new Error('公開工作區無效。');
    }
    exactKeys(workspaceUnits, workspaceIds, '工作區占用量');
    if (workspaceIds.some((id) => !Number.isInteger(workspaceUnits[id]) || workspaceUnits[id] < 1 || workspaceUnits[id] > 1000)) {
      throw new Error('公開工作區占用量無效。');
    }
    return { alias, goal, start, end, workspaceIds: [...workspaceIds],
      workspaceUnits: Object.fromEntries(workspaceIds.map((id) => [id, workspaceUnits[id]])) };
  });
  return { schemaVersion: 1, publishedAt, projects };
}

export function createPublicPayload(snapshot, now = new Date()) {
  const validated = validatePublicSnapshot(snapshot);
  return { mode: 'public', today: taipeiToday(now), syncedAt: validated.publishedAt,
    projects: validated.projects, workspaces: WORKSPACES.map((space) => ({ ...space })),
    warnings: [], permissions: { canEditLayout: false } };
}

// Input is the readback/export of the independent approved anonymous feed only.
// This converts a publication artifact; it does not approve or publish projects.
export function snapshotFromFeedRows(rows, publishedAt) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) throw new Error('缺少匿名資料表表頭。');
  const normalized = rows.map((row) => {
    if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) throw new Error('匿名資料表必須包含純文字值。');
    const result = [...row];
    while (result.length > PUBLIC_FEED_HEADER.length && result.at(-1) === '') result.pop();
    if (result.length > PUBLIC_FEED_HEADER.length) throw new Error('匿名資料表包含額外欄位。');
    while (result.length < PUBLIC_FEED_HEADER.length) result.push('');
    return result;
  });
  if (JSON.stringify(normalized[0]) !== JSON.stringify(PUBLIC_FEED_HEADER)) throw new Error('匿名資料表表頭不符。');
  const projects = normalized.slice(1).filter((row) => row.some((cell) => cell !== '')).map((row) => {
    let workspaceIds, workspaceUnits;
    try { workspaceIds = JSON.parse(row[4]); workspaceUnits = JSON.parse(row[5]); }
    catch { throw new Error('匿名資料表的工作區內容無效。'); }
    return { alias: row[0], goal: row[1], start: row[2], end: row[3], workspaceIds, workspaceUnits };
  });
  return validatePublicSnapshot({ schemaVersion: 1, publishedAt, projects });
}

export function parseFeedCsv(source) {
  if (typeof source !== 'string') throw new Error('匿名匯出內容無效。');
  const text = source.replace(/^\uFEFF/u, '');
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  const pushField = () => { row.push(field); field = ''; closedQuote = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === '"' && !field && !closedQuote) quoted = true;
    else if (character === ',') pushField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      if (closedQuote || character === '"') throw new Error('匿名 CSV 格式無效。');
      field += character;
    }
  }
  if (quoted) throw new Error('匿名 CSV 引號未關閉。');
  if (field || closedQuote || row.length) pushRow();
  return rows;
}
