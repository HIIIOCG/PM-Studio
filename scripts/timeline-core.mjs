const DAY_MS = 86400000;
const text = value => value == null ? '' : String(value).trim();
const has = value => text(value) !== '';
const rescheduled = value => /改期|延期|延長|延後|順延|待排|待定|日期未定|日期待|排程待|尚未.*(?:日期|排程)|(?:日期|排程).*(?:未確定|待確認)/u.test(text(value));

export const WORKSPACES = Object.freeze([
  Object.freeze({ id: 'A', name: '3D角色模型 A', capacity: 2, unit: '角色', type: 'character' }),
  Object.freeze({ id: 'B', name: '3D角色模型 B', capacity: 2, unit: '角色', type: 'character' }),
  Object.freeze({ id: 'C', name: '額外模型項目', capacity: null, unit: '項目', type: 'additional-model' }),
  Object.freeze({ id: 'D', name: 'CT 遊戲美術外包', capacity: null, unit: '項目', type: 'ct-art' }),
]);

export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? Math.floor(date.getTime() / DAY_MS) : null;
}

export function formatDay(day) {
  if (!Number.isInteger(day)) throw new TypeError('day 必須是整數日期。');
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function taipeiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = name => parts.find(part => part.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function getProjectDates(project) {
  let start = text(project.start);
  let end = text(project.end);
  let basis = project.dateBasis || 'current';
  if (!has(start) && !has(end)) {
    if (rescheduled(project.supplement)) return null;
    start = text(project.originalStart);
    end = text(project.originalEnd);
    basis = 'original';
  }
  const startDay = parseDay(start);
  const endDay = parseDay(end);
  if (startDay === null || endDay === null || startDay > endDay) return null;
  return { start, end, startDay, endDay, basis };
}

export function adaptSheetRows(rows) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new TypeError('缺少專案列表表頭。');
  const header = rows[0].map(text);
  const required = ['案號', '目前交付目標', '客戶', '負責人', '狀態', '原始開始', '原始結束'];
  for (const label of required) if (!header.includes(label)) throw new Error(`專案列表缺少欄位：${label}`);
  if (!header.includes('專案名稱') && !header.includes('專案／範圍')) throw new Error('專案列表缺少專案名稱。');
  const ids = new Set();
  const projects = rows.slice(1).filter(row => has(row[header.indexOf('案號')])).map(row => {
    const field = label => text(row[header.indexOf(label)]);
    const id = field('案號');
    if (!/^(C|BG|P|D|O)-\d{3,}$/u.test(id) || ids.has(id)) throw new Error('專案列表的案號無效或重複。');
    ids.add(id);
    const mixed = field('專案／範圍');
    const lines = mixed.split(/\r?\n/u);
    const first = lines.shift() || '';
    const pieces = first.split('｜');
    const name = field('專案名稱') || pieces.shift() || mixed;
    const requirements = field('專案需求') || [...pieces, ...lines].join('；');
    const project = {
      id, name, requirements, goal: field('目前交付目標'), customer: field('客戶'),
      owner: field('負責人'), executor: field('執行者'), status: field('狀態'),
      originalStart: field('原始開始'), originalEnd: field('原始結束'),
      start: field('目前排程開始'), end: field('目前排程結束'),
      correctionStart: field('修正開始'), correctionEnd: field('修正結束'),
      supplement: field('延長修正／補充'), deliverySteps: field('交付步驟（參考）'),
      sourceLinks: [], workspaceIds: [], workspaceUnits: {}, dateBasis: 'current',
    };
    const dates = getProjectDates(project);
    if (dates) Object.assign(project, { start: dates.start, end: dates.end, dateBasis: dates.basis });
    return project;
  });
  return projects.sort((a, b) => (getProjectDates(a)?.startDay ?? Infinity)
    - (getProjectDates(b)?.startDay ?? Infinity) || a.id.localeCompare(b.id));
}

export function clipBlock(block, startDay, endDay) {
  if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay > endDay) throw new RangeError('可見時間範圍無效。');
  const left = Math.max(block.startDay, startDay);
  const right = Math.min(block.endDay, endDay);
  if (left > right) return null;
  return { ...block, visibleStartDay: left, visibleEndDay: right,
    clippedStart: left > block.startDay, clippedEnd: right < block.endDay,
    labelStartDay: left, duration: right - left + 1 };
}

// A split is needed only for nonadjacent resources; the underlying project stays one case.
export function planBlocks(projects, workspaces = WORKSPACES) {
  const allowed = new Map(workspaces.map((workspace, index) => [workspace.id, index]));
  const blocks = [];
  const pending = [];
  const unassigned = [];
  for (const project of projects) {
    const ranges = [];
    const dates = getProjectDates(project);
    if (dates) ranges.push({ ...dates, phase: 'production' });
    else pending.push({ projectId: project.id, reason: '排程日期未完整確定' });
    const cs = parseDay(project.correctionStart);
    const ce = parseDay(project.correctionEnd);
    if (cs !== null && ce !== null && cs <= ce) ranges.push({
      start: project.correctionStart, end: project.correctionEnd, startDay: cs, endDay: ce,
      basis: 'correction', phase: 'correction',
    });
    else if (has(project.correctionStart) || has(project.correctionEnd)
      || /修正.*(?:未定|待定)|(?:未定|待定).*修正|原期後持續修正/u.test(project.supplement || '')) {
      pending.push({ projectId: project.id, reason: '修正排程待定' });
    }
    const supplied = [...new Set(project.workspaceIds || [])];
    const ids = supplied.filter(id => allowed.has(id)).sort((a, b) => allowed.get(a) - allowed.get(b));
    if (!ids.length || ids.length !== supplied.length) {
      unassigned.push({ projectId: project.id, reason: ids.length ? '工作區設定包含未知工作區' : '尚未分配工作區' });
      continue;
    }
    const groups = [];
    for (const id of ids) {
      const group = groups.at(-1);
      if (group && allowed.get(id) === allowed.get(group.at(-1)) + 1) group.push(id);
      else groups.push([id]);
    }
    for (const range of ranges) for (const [groupIndex, group] of groups.entries()) blocks.push({
      ...range, key: `${project.id}:${range.phase}:${groupIndex}`, projectId: project.id,
      workspaceIds: [...group], firstWorkspaceIndex: allowed.get(group[0]),
      lastWorkspaceIndex: allowed.get(group.at(-1)),
      workspaceUnits: Object.fromEntries(group.map(id => [id, project.workspaceUnits?.[id] ?? 1])),
    });
  }
  blocks.sort((a, b) => a.startDay - b.startDay || a.projectId.localeCompare(b.projectId) || a.key.localeCompare(b.key));
  const placed = [];
  for (const block of blocks) {
    let stackIndex = 0;
    while (placed.some(other => other.stackIndex === stackIndex && other.startDay <= block.endDay
      && other.endDay >= block.startDay && block.workspaceIds.some(id => other.workspaceIds.includes(id)))) stackIndex++;
    block.stackIndex = stackIndex;
    placed.push(block);
  }
  const overloads = [];
  for (const workspace of workspaces) {
    if (!Number.isInteger(workspace.capacity) || workspace.capacity < 1) continue;
    const active = blocks.filter(block => block.workspaceIds.includes(workspace.id));
    const events = new Map();
    for (const block of active) {
      for (const day of [block.startDay, block.endDay + 1]) events.set(day, true);
    }
    const days = [...events.keys()].sort((a, b) => a - b);
    for (let i = 0; i < days.length - 1; i++) {
      const day = days[i];
      const covered = active.filter(block => block.startDay <= day && block.endDay >= day);
      const caseUnits = new Map();
      for (const block of covered) caseUnits.set(block.projectId,
        Math.max(caseUnits.get(block.projectId) || 0, block.workspaceUnits[workspace.id]));
      const used = [...caseUnits.values()].reduce((sum, units) => sum + units, 0);
      if (used > workspace.capacity) overloads.push({ workspaceId: workspace.id, startDay: day,
        endDay: days[i + 1] - 1, used, capacity: workspace.capacity,
        projectIds: [...new Set(covered.map(block => block.projectId))] });
    }
  }
  return { blocks, pending, unassigned, overloads };
}

export function createDemo(now = new Date()) {
  const today = parseDay(taipeiToday(now));
  const item = (id, name, start, end, workspaceIds, units, requirements) => ({
    id: `DEMO-${id}`, name, goal: '製作與交付（示意）', requirements,
    customer: `客戶 ${id}（示意）`, owner: '', executor: '', status: '示意',
    start: formatDay(today + start), end: formatDay(today + end),
    originalStart: formatDay(today + start), originalEnd: formatDay(today + end),
    correctionStart: '', correctionEnd: '', supplement: '', sourceLinks: [],
    workspaceIds, workspaceUnits: units, dateBasis: 'demo',
  });
  return {
    mode: 'demo', today: formatDay(today), syncedAt: '', sourceUrl: '', workspaces: WORKSPACES,
    warnings: [], projects: [
      item('001', '角色模型・角色甲', -24, 68, ['A'], { A: 1 }, '1角色'),
      item('002', '角色模型・角色乙', -4, 46, ['A'], { A: 1 }, '1角色'),
      item('003', '雙角色模型', 95, 176, ['A'], { A: 2 }, '2角色'),
      item('004', '雙角色＋演唱會場景', -8, 66, ['B', 'C'], { B: 2, C: 1 }, '2角色；場景與額外模型'),
      item('005', '角色模型・新衣裝', 77, 120, ['B'], { B: 1 }, '1角色'),
      item('006', 'CT 美術・立繪', -6, 40, ['D'], { D: 1 }, '遊戲CT美術外包'),
      item('007', 'CT 美術・差分', 47, 106, ['D'], { D: 1 }, '遊戲CT美術外包'),
      item('008', 'CT 美術・新角色', 112, 166, ['D'], { D: 1 }, '遊戲CT美術外包'),
      item('009', 'CT 美術・追加項目', 172, 238, ['D'], { D: 1 }, '遊戲CT美術外包'),
    ],
  };
}
