export const SCHEDULE_TEXT = {
  title: ['專案排程', 'Project schedule'],
  previous: ['查看較早日期', 'View earlier dates'],
  next: ['查看較晚日期', 'View later dates'],
  today: ['今天', 'Today'],
  workspace: ['工作區', 'Workspace'],
  production: ['製作', 'Production'],
  correction: ['修正', 'Revisions'],
  reservation: ['時段預約', 'Reserved period'],
  followUp: ['後續追蹤', 'Follow-up'],
  'customer-confirmation': ['客戶確認中', 'Awaiting client confirmation'],
  payment: ['待收款中', 'Awaiting payment'],
  monthPrecision: ['（月份）', '(month)'],
  followUpNote: ['追蹤至今天；等待事項不延長製作期間。', 'Tracked through today; pending follow-up does not extend production.'],
  pending: ['待排與待確認', 'To be scheduled / confirmed'],
  loading: ['正在讀取排程', 'Loading schedule'],
  loadError: ['無法讀取排程，請稍後重試。', 'Unable to load the schedule. Please try again.'],
  staleError: ['更新失敗，目前顯示上次讀取的資料。', 'Reload failed. Showing the last successful read.'],
  retry: ['重試', 'Retry'],
  empty: ['目前沒有專案資料。', 'No projects are available yet.'],
  warning: ['部分資料待確認，排程可能不完整。', 'Some data needs confirmation; the schedule may be incomplete.'],
  loaded: ['讀取時間', 'Read at'],
  stale: ['上次讀取', 'Previous read'],
  visible: ['目前區間 {count} 案', '{count} projects in view'],
  footer: ['空白時段不代表可預約，檔期須由團隊確認。', 'Empty time spans do not confirm availability. Please contact the team.'],
  timeline: ['排程時間軸，可左右捲動', 'Schedule timeline; scroll horizontally to explore dates'],
  customer: ['客戶 {code}', 'Client {code}'],
  missingCustomer: ['客戶編號待確認', 'Client code pending'],
  unspecified: ['未定', 'Pending'],
  noWork: ['此區間未排工作', 'No work in this period'],
  preview: ['示意預覽 · 所有資料皆為虛構', 'Preview · All data is fictional'],
  'no-workspace': ['工作區未安排', 'Workspace not assigned'],
  'workspace-values': ['工作區占用待確認', 'Workspace allocation needs confirmation'],
  'production-dates': ['製作日期待確認', 'Production dates need confirmation'],
  'correction-dates': ['修正日期待確認', 'Revision dates need confirmation'],
  'customer-code': ['客戶編號待確認', 'Client code needs confirmation'],
  'schedule-kind': ['排程性質待確認', 'Schedule type needs confirmation'],
  'follow-up-values': ['未結事項待確認', 'Follow-up details need confirmation'],
};
let scheduleLanguage = 'zh-Hant';
export function setScheduleLanguage(language) { scheduleLanguage = language === 'en' ? 'en' : 'zh-Hant'; return scheduleLanguage; }
export function getScheduleLanguage() { return scheduleLanguage; }
export function scheduleText(key, values = {}) {
  return (SCHEDULE_TEXT[key]?.[scheduleLanguage === 'en' ? 1 : 0] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}
export function workspaceText(id) {
  return ({ A: ['角色模型', 'Characters'], B: ['角色模型', 'Characters'], C: ['角色・場景', 'Characters / scenes'], D: ['CT 美術', 'CT art'] })[id]?.[scheduleLanguage === 'en' ? 1 : 0] || id;
}
export function scheduleMonth(day) {
  return new Intl.DateTimeFormat(scheduleLanguage === 'en' ? 'en-US' : 'zh-TW', { timeZone: 'UTC', year: 'numeric', month: 'short' }).format(new Date(day * 86400000));
}
export function scheduleReadTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(scheduleLanguage === 'en' ? 'en-GB' : 'zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
