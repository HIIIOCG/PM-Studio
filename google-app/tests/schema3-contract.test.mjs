import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimelinePayload, SCHEDULE_KINDS, FOLLOW_UP_STATUSES, CUSTOMER_TYPES, PROJECT_DETAIL_FIELDS } from '../ui/common-contract.mjs';
import { normalizeInternalTimelinePayload } from '../internal/ui/internal-contract.mjs';

const payload = () => ({
  schemaVersion: 3, today: '2026-10-13', syncedAt: '2026-10-13T00:00:00.000Z',
  workspaces: ['A', 'B', 'C', 'D'].map(id => ({ id, name: '工作區 ' + id })), warnings: [],
  projects: [{ id: 'C-999', customerCode: 'DEMO-001', customerType: 'VTuber個人', start: '2027-04', end: '2027-06',
    correctionStart: '', correctionEnd: '', scheduleKind: 'reservation',
    followUp: ['customer-confirmation', 'payment'], workspaceIds: ['A'], workspaceUnits: { A: 1 }, pendingReasons: [],
    ...Object.fromEntries(PROJECT_DETAIL_FIELDS.map(key => [key, 'Fictional ' + key])) }]
});

test('schema 3 preserves source month precision and independent public reservation/follow-up enums', () => {
  const source = payload();
  const result = normalizeTimelinePayload(source);
  assert.equal(result.schemaVersion, 3);
  assert.deepEqual(result.reservationSlots, []);
  assert.deepEqual(SCHEDULE_KINDS, ['production', 'reservation']);
  assert.deepEqual(FOLLOW_UP_STATUSES, ['customer-confirmation', 'payment']);
  assert.equal(result.projects[0].start, '2027-04');
  assert.equal(result.projects[0].end, '2027-06');
  assert.equal(result.projects[0].scheduleKind, 'reservation');
  assert.deepEqual(result.projects[0].followUp, ['customer-confirmation', 'payment']);
  result.projects[0].followUp.pop();
  assert.equal(source.projects[0].followUp.length, 2);
});

test('schema 3 refuses older versions, missing new keys and unknown free-form status values', () => {
  for (const version of [2, 4, '3', null]) {
    const source = payload(); source.schemaVersion = version;
    assert.throws(() => normalizeTimelinePayload(source));
  }
  for (const key of ['scheduleKind', 'followUp', 'customerType', ...PROJECT_DETAIL_FIELDS]) {
    const source = payload(); delete source.projects[0][key];
    assert.throws(() => normalizeTimelinePayload(source));
  }
  for (const value of ['', '時段預約', 'SecretProject', {}, null]) {
    const source = payload(); source.projects[0].scheduleKind = value;
    assert.throws(() => normalizeTimelinePayload(source));
  }
  for (const value of [['客戶確認中'], ['payment', 'SecretBankAccount'], ['payment', 'payment'], 'payment', null, {}]) {
    const source = payload(); source.projects[0].followUp = value;
    assert.throws(() => normalizeTimelinePayload(source));
  }
});

test('new source-data issues use fixed pending codes and public detail rejects unauthorized fields', () => {
  const source = payload(); source.projects[0].pendingReasons = ['schedule-kind', 'follow-up-values', 'customer-type'];
  assert.deepEqual(normalizeTimelinePayload(source).projects[0].pendingReasons, ['schedule-kind', 'follow-up-values', 'customer-type']);
  for (const key of ['name', 'customer', 'contact', 'assignee', 'followUpNote', 'paymentAmount', 'customerName', 'sourceUrl', '資料', 'rawRow', 'settings']) {
    const privateSource = payload(); privateSource.projects[0][key] = 'SecretValue';
    assert.throws(() => normalizeTimelinePayload(privateSource));
  }
});

test('both customer-type values and bounded project detail fields are validated explicitly', () => {
  assert.deepEqual(CUSTOMER_TYPES, ['VTuber個人', 'VTuber公司', '遊戲公司', '其他']);
  assert.deepEqual(PROJECT_DETAIL_FIELDS, ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']);
  for (const customerType of ['', ...CUSTOMER_TYPES]) {
    const source = payload(); source.projects[0].customerType = customerType;
    assert.equal(normalizeTimelinePayload(source).projects[0].customerType, customerType);
  }
  for (const customerType of ['VTuber', 'SecretValue', [], {}, null, 1]) {
    const source = payload(); source.projects[0].customerType = customerType;
    assert.throws(() => normalizeTimelinePayload(source));
  }
  for (const field of PROJECT_DETAIL_FIELDS) {
    for (const value of [undefined, null, 1, {}, 'x'.repeat(4001)]) {
      const source = payload(); source.projects[0][field] = value;
      assert.throws(() => normalizeTimelinePayload(source));
    }
    const source = payload(); source.projects[0][field] = '<script>' + 'x'.repeat(3983) + '</script>';
    assert.equal(normalizeTimelinePayload(source).projects[0][field], source.projects[0][field]);
  }
});

const slotPayload = () => ({ ...payload(), schemaVersion: 4, reservationSlots: [
  { workspaceId: 'D', start: '2026-11', end: '2026-11' },
  { workspaceId: 'A', start: '2028-02-29', end: '2028-03' },
] });

test('schema 4 keeps blank reservations independent and schema 3 retains its exact old wire keys', () => {
  const source = slotPayload(), original = JSON.stringify(source), result = normalizeTimelinePayload(source);
  assert.equal(result.schemaVersion, 4); assert.equal(result.projects.length, 1);
  assert.deepEqual(result.reservationSlots, source.reservationSlots);
  assert.deepEqual(result.reservationSlots.map((slot) => Object.keys(slot).sort()), [['end', 'start', 'workspaceId'], ['end', 'start', 'workspaceId']]);
  result.reservationSlots[0].start = '2026-10'; assert.equal(JSON.stringify(source), original);
  const old = payload(); old.reservationSlots = [];
  assert.throws(() => normalizeTimelinePayload(old), 'schema 3 must reject the new wire key, even if empty');
  const missing = slotPayload(); delete missing.reservationSlots; assert.throws(() => normalizeTimelinePayload(missing));
  for (const field of ['timeSlots', 'sourceRow', 'sourceId', 'reservationNote']) {
    const extra = slotPayload(); extra[field] = 'PrivateExtra'; assert.throws(() => normalizeTimelinePayload(extra));
  }
  for (const value of [null, {}, '2026-11', Array.from({ length: 1001 }, () => ({ workspaceId: 'D', start: '2026-11', end: '2026-11' }))]) {
    const bad = slotPayload(); bad.reservationSlots = value; assert.throws(() => normalizeTimelinePayload(bad));
  }
});

test('schema 4 slots reject identifiers, business text, invalid calendars, unknown workspaces and duplicate tuples', () => {
  for (const field of ['id', 'projectId', 'name', 'customer', 'owner', 'details', 'workspaceUnits', 'units', 'sourceRow', 'sourceUrl', 'pendingReasons']) {
    const bad = slotPayload(); bad.reservationSlots[0][field] = 'PrivateValue'; assert.throws(() => normalizeTimelinePayload(bad));
  }
  for (const field of ['workspaceId', 'start', 'end']) {
    const bad = slotPayload(); delete bad.reservationSlots[0][field]; assert.throws(() => normalizeTimelinePayload(bad));
  }
  for (const workspaceId of ['', 'E', 'D,A', ['D'], 1, null, ' D ']) {
    const bad = slotPayload(); bad.reservationSlots[0].workspaceId = workspaceId; assert.throws(() => normalizeTimelinePayload(bad));
  }
  for (const [start, end] of [['', '2026-11'], ['2026-11', ''], ['2027-02-29', '2027-03'], ['2026-13', '2027-01'], ['2027-03', '2027-02'], ['2026-11-31', '2026-12'], ['2027-02-28', '2027-02-27'], [null, '2027-01']]) {
    const bad = slotPayload(); Object.assign(bad.reservationSlots[0], { start, end }); assert.throws(() => normalizeTimelinePayload(bad));
  }
  const duplicate = slotPayload(); duplicate.reservationSlots.push({ ...duplicate.reservationSlots[0] }); assert.throws(() => normalizeTimelinePayload(duplicate));
  const distinct = slotPayload(); distinct.reservationSlots.push({ ...distinct.reservationSlots[0], workspaceId: 'B' });
  assert.equal(normalizeTimelinePayload(distinct).reservationSlots.length, 3);
  const warning = slotPayload(); warning.warnings = ['reservation-slot-invalid', 'reservation-slot-duplicate'];
  assert.deepEqual(normalizeTimelinePayload(warning).warnings, warning.warnings);
  const privateWarning = slotPayload(); privateWarning.warnings = ['SecretSlotValue']; assert.throws(() => normalizeTimelinePayload(privateWarning));
  const oldWarning = payload(); oldWarning.warnings = ['reservation-slot-invalid']; assert.throws(() => normalizeTimelinePayload(oldWarning));
});

test('teamspace inherits the same identity-free slot contract while adding its four authorized fields only to real projects', () => {
  const source = slotPayload();
  Object.assign(source.projects[0], { name: 'Fictional project', customer: 'Fictional customer', contact: 'Fictional contact', assignee: 'Fictional assignee' });
  const result = normalizeInternalTimelinePayload(source);
  assert.deepEqual(result.reservationSlots, source.reservationSlots); assert.equal(result.projects[0].name, 'Fictional project');
  assert.equal(result.projects.length, 1); assert.deepEqual(result.projects[0].pendingReasons, []);
  source.reservationSlots[0].name = 'PrivateSlotName'; assert.throws(() => normalizeInternalTimelinePayload(source));
});
