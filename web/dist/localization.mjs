const UI_TEXT = {
  title: ['工作區排程', 'Workspace schedule'],
  publicTitle: ['PM Studio｜公開排程', 'PM Studio | Public schedule'],
  workspace: ['工作區', 'Workspace'],
  scheduleLabel: ['工作區時間排程', 'Workspace production timeline'],
  timelineLabel: ['時間軸，可左右捲動', 'Timeline; scroll horizontally to explore dates'],
  zoomLabel: ['時間縮放', 'Timeline scale'],
  previous: ['往前查看日期', 'View earlier dates'],
  next: ['往後查看日期', 'View later dates'],
  today: ['今天', 'Today'],
  month: ['月', 'Month'],
  week: ['週', 'Week'],
  expandPast: ['展開過去日期', 'Show past dates'],
  collapsePast: ['收合過去日期', 'Hide past dates'],
  lightMode: ['切換亮色', 'Light mode'],
  darkMode: ['切換暗色', 'Dark mode'],
  refresh: ['重新讀取', 'Refresh'],
  refreshLabel: ['重新讀取公開排程', 'Reload the public schedule'],
  search: ['搜尋專案或交付目標', 'Search projects or delivery goals'],
  production: ['製作', 'Production'],
  productionSchedule: ['製作排程', 'Production schedule'],
  correction: ['追加修正', 'Additional revisions'],
  timelineHelp: ['左右捲動查看日期 · 點選方塊查看完整資訊', 'Scroll to explore dates · Select a project for details'],
  pending: ['待安排', 'To be scheduled'],
  pendingDescription: ['尚未指定工作區，或製作／修正日期仍需安排。', 'Workspace assignments or production/revision dates are awaiting confirmation.'],
  closeDetails: ['關閉專案詳情', 'Close project details'],
  publicView: ['公開排程', 'Public schedule'],
  teamView: ['團隊排程', 'Team schedule'],
  previewView: ['本機示意預覽', 'Local demo preview'],
  previewDescription: ['此畫面使用虛構案件，不代表實際檔期。', 'This preview uses fictional projects and does not show actual availability.'],
  publicDescription: ['選擇合適的時間後，聯繫團隊確認製作需求與預約。', 'Contact our team to discuss your production needs and confirm your preferred dates.'],
  teamDescription: ['每個方塊代表一段工作；點選案件查看資訊與安排工作區。', 'Each block represents a period of work; select a project for details and workspace assignments.'],
  publicFooter: ['檔期預留依團隊確認。', 'Schedule reservations require confirmation from our team.'],
  staticFooter: ['公開排程以團隊確認為準；空白時段不代表可預約。', 'Our team must confirm all bookings. Empty time spans do not indicate available production capacity.'],
  loading: ['正在讀取排程', 'Loading schedule'],
  loaded: ['已讀取排程', 'Schedule loaded'],
  updated: ['已更新', 'Updated'],
  notLoaded: ['尚未讀取', 'Schedule not loaded'],
  notLoadedPublic: ['尚未讀取公開排程', 'Public schedule not loaded'],
  lastPublished: ['最後發布', 'Last published'],
  previousPublished: ['讀取失敗 · 上次發布', 'Reload failed · Previous publication'],
  taipeiTime: ['台北時間', 'Taipei time'],
  publicLoadError: ['無法讀取公開排程，請稍後再試。', 'Unable to load the public schedule. Please try again later.'],
  publicReloadError: ['無法重新讀取公開排程；目前顯示上次成功讀取的資料，請稍後再試。', 'Unable to reload the public schedule. Showing the last successfully loaded data; please try again later.'],
  noPublicProjects: ['目前尚無已公開排程；請聯繫團隊確認檔期。', 'No schedules have been published yet. Contact our team to confirm availability.'],
  emptyPublicRange: ['目前區間無已公開排程', 'No published projects in this period'],
  emptyRange: ['目前區間未排工作', 'No work scheduled in this period'],
  unspecified: ['未定', 'To be confirmed'],
  missing: ['未填', 'Not provided'],
  unnamed: ['未命名專案', 'Untitled project'],
  projectCount: ['{count} 案', 'Projects: {count}'],
  visibleCount: ['{count} 案在目前區間', 'Projects in view: {count}'],
  visibleOverload: [' · 有工作區超過一般負荷，請確認安排', ' · Workspace load exceeds the usual level; confirm arrangements'],
  usualLoad: ['一般負荷 {count} {unit}，可彈性安排', 'Usual load: {count} {unit}; flexible allocation'],
  flexibleCapacity: ['彈性安排，容量待確認', 'Flexible allocation; capacity to be confirmed'],
  maxCapacity: ['最多 {count} {unit}', 'Up to {count} {unit}'],
  overload: ['超過一般負荷，請確認安排', 'Above usual load; confirm arrangements'],
  characters: ['3D角色模型', '3D character models'],
  charactersScenes: ['角色與場景模型', 'Characters and environments'],
  ctArt: ['CT 遊戲美術外包', 'CT game art outsourcing'],
  startDate: ['開始日期：{date}', 'Start date: {date}'],
  todayDate: ['今天 {date}', 'Today {date}'],
  deliveryGoal: ['交付目標', 'Delivery goal'],
  scheduleDates: ['排程日期', 'Schedule dates'],
  workspaceAllocation: ['工作區 {areas}', 'Workspace {areas}'],
  crossWorkspace: ['同案跨區 {all} · 本段 {areas}', 'Shared project across {all} · This block: {areas}'],
  cardLabel: ['{alias}，{goal}，{start} 至 {end}，工作區 {areas}', '{alias}, {goal}, {start} to {end}, workspace {areas}'],
};

let uiLanguage = 'zh-Hant';

export function t(key, values = {}) {
  const text = UI_TEXT[key][uiLanguage === 'en' ? 1 : 0];
  return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

export function workspaceDescription(space) {
  const name = space.name?.replace(new RegExp(`\\s+${space.id}$`), '') || '';
  const key = { '3D角色模型': 'characters', '角色與場景模型': 'charactersScenes', 'CT 遊戲美術外包': 'ctArt' }[name];
  return key ? t(key) : name;
}

export function unitText(space, count) {
  if (uiLanguage !== 'en') return space?.unit || '項目';
  return space?.unit === '角色' ? (count === 1 ? 'character' : 'characters') : (count === 1 ? 'item' : 'items');
}

export function weekdayText(day) {
  return (uiLanguage === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['日', '一', '二', '三', '四', '五', '六'])[day];
}

export function pendingReasonText(reason) {
  if (uiLanguage !== 'en') return reason;
  return ({ '尚未分配工作區': 'Workspace not assigned', '排程日期未完整確定': 'Production dates awaiting confirmation', '修正排程待定': 'Revision dates awaiting confirmation', '工作區設定包含未知工作區': 'Workspace assignment includes an unknown workspace' })[reason] || reason;
}

function applyPublicLanguage() {
  document.documentElement.lang = uiLanguage;
  document.title = t('publicTitle');
  const text = {
    'schedule-title': 'title', refresh: 'refresh', 'today-button': 'today',
    'month-view': 'month', 'week-view': 'week', 'legend-production': 'production',
    'legend-correction': 'correction', 'timeline-help': 'timelineHelp',
    'pending-title': 'pending', 'pending-description': 'pendingDescription',
  };
  for (const [id, key] of Object.entries(text)) { const node = $(id); if (node) node.textContent = t(key); }
  const labels = {
    'schedule-section': 'scheduleLabel', 'timeline-viewport': 'timelineLabel',
    'time-scale-controls': 'zoomLabel', previous: 'previous', next: 'next',
    refresh: 'refreshLabel', search: 'search', 'close-dialog': 'closeDetails',
  };
  for (const [id, key] of Object.entries(labels)) { const node = $(id); if (node) node.setAttribute('aria-label', t(key)); }
  $('search').placeholder = t('search');
  $('legend-today').textContent = `│ ${t('today')}`;
  $('page-footer').textContent = t(APP_TRANSPORT === 'static' ? 'staticFooter' : 'publicFooter');
  $('view-label').textContent = t('publicView');
  $('mode-description').textContent = t('publicDescription');
  $('past-toggle').textContent = t(state.pastExpanded ? 'collapsePast' : 'expandPast');
  const button = $('language-toggle');
  button.textContent = uiLanguage === 'en' ? '繁體中文' : 'English';
  button.lang = uiLanguage === 'en' ? 'zh-Hant' : 'en';
  button.setAttribute('aria-label', uiLanguage === 'en' ? '切換至繁體中文' : 'Switch to English');
  updateThemeControl();
  renderSyncStatus();
}

export function initializeLanguage() {
  if (APP_VIEW !== 'public') return;
  try { if (localStorage.getItem('pm-studio-language') === 'en') uiLanguage = 'en'; } catch { /* Language selection works without preference storage. */ }
  applyPublicLanguage();
  $('language-toggle').addEventListener('click', () => {
    uiLanguage = uiLanguage === 'en' ? 'zh-Hant' : 'en';
    try { localStorage.setItem('pm-studio-language', uiLanguage); } catch { /* Keep the selected language for this visit. */ }
    applyPublicLanguage();
    if (state.noticeKey) notifyLocalized(state.noticeKey, state.noticeError);
    render(true);
    if (state.activeProject && $('project-dialog').open) openProject(state.activeProject);
  });
}
