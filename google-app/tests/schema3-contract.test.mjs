import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimelinePayload, SCHEDULE_KINDS, FOLLOW_UP_STATUSES, CUSTOMER_TYPES, PROJECT_DETAIL_FIELDS } from '../ui/common-contract.mjs';

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
