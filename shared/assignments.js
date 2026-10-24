// Labels and notes live in encrypted contents; IDs and control state authorize updates.
export const ASSIGNMENT_LIMITS = { initialItems: 20, items: 100, title: 100, task: 240, notes: 1000 };
export const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`Enter ${required ? '1–' : 'up to '}${max} characters.`);
  return value.trim();
}
export function assignmentDate(value) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Choose a valid due date.');
  return value;
}
export function validateAssignmentSettings(value) {
  if (typeof value?.allowMemberAdds !== 'boolean') throw new Error('Choose whether members can add assignments.');
  return { title: text(value.title, 100, true), description: text(value.description || '', 2000), dueDate: assignmentDate(value.dueDate), allowMemberAdds: value.allowMemberAdds };
}
export function validateAssignmentItem(value) {
  if (!isId(value?.id) || (value.assigneeId !== null && !isId(value.assigneeId))) throw new Error('Choose a valid assignment and member.');
  return { id: value.id, title: text(value.title, 240, true), notes: text(value.notes || '', 1000), dueDate: assignmentDate(value.dueDate), assigneeId: value.assigneeId };
}
export function validateAssignments(value) {
  const settings = validateAssignmentSettings(value);
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > ASSIGNMENT_LIMITS.initialItems) throw new Error('Start with 1–20 assignments. You can add more later.');
  const items = value.items.map(validateAssignmentItem);
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('Each assignment needs its own ID.');
  const result = { churp: 'assignments', version: 1, ...settings, items };
  if (JSON.stringify(result).length > 10000) throw new Error('This list is too long. Shorten the notes or add some assignments later.');
  return result;
}
export function parseAssignments(body) { try { const v = JSON.parse(body); return v.churp === 'assignments' && v.version === 1 ? validateAssignments(v) : null; } catch { return null; } }
export const assignmentSetup = list => ({ allowMemberAdds: list.allowMemberAdds, items: list.items.map(i => ({ id: i.id, assigneeId: i.assigneeId })) });
export function operationMetadata(value) {
  if (!Number.isSafeInteger(value?.expectedVersion) || value.expectedVersion < 0 || !['settings','add','edit','claim','release','complete','remove'].includes(value.action)) throw new Error('Choose a valid assignment update.');
  const result = { action: value.action, expectedVersion: value.expectedVersion };
  if (value.action === 'settings') { if (typeof value.allowMemberAdds !== 'boolean') throw new Error('Choose whether members can add assignments.'); result.allowMemberAdds = value.allowMemberAdds; }
  else {
    if (!isId(value.itemId)) throw new Error('Choose a valid assignment.'); result.itemId = value.itemId;
    if (['add','edit','claim'].includes(value.action)) { if (value.assigneeId !== null && !isId(value.assigneeId)) throw new Error('Choose a valid member.'); result.assigneeId = value.assigneeId; }
    if (value.action === 'complete') { if (typeof value.completed !== 'boolean') throw new Error('Choose To do or Done.'); result.completed = value.completed; }
  }
  return result;
}
export function validateAssignmentOperation(value) {
  const metadata = operationMetadata(value);
  if (metadata.action === 'settings') return { ...metadata, ...validateAssignmentSettings(value) };
  if (['add','edit'].includes(metadata.action)) return { ...metadata, item: validateAssignmentItem({ ...value.item, id: metadata.itemId, assigneeId: metadata.assigneeId }) };
  return metadata;
}
export function encodeAssignmentOperation(listId, operation) { return JSON.stringify({ churp: 'assignment-operation', version: 1, listId, ...validateAssignmentOperation(operation) }); }
export function parseAssignmentOperation(body, listId, metadata) {
  try {
    const v = JSON.parse(body);
    if (v.churp !== 'assignment-operation' || v.version !== 1 || v.listId !== listId) return null;
    const op = validateAssignmentOperation(v);
    return JSON.stringify(operationMetadata(op)) === JSON.stringify(operationMetadata(metadata)) ? op : null;
  } catch { return null; }
}
export const assignmentProof = ({ listId, clientId, cipherHash, metadata }) => ({ listId, clientId, cipherHash, metadata });
export function projectAssignments(initial, operations) {
  let settings = validateAssignmentSettings(initial), items = initial.items.map(i => ({ ...i, completed: false, deleted: false }));
  for (const op of operations) {
    if (op.action === 'settings') settings = validateAssignmentSettings(op);
    else if (op.action === 'add') { if (items.some(i => i.id === op.itemId)) throw new Error('An assignment ID was reused.'); items.push({ ...op.item, completed: false, deleted: false }); }
    else {
      const item = items.find(i => i.id === op.itemId && !i.deleted); if (!item) throw new Error('An assignment update is out of order.');
      if (op.action === 'edit') Object.assign(item, op.item);
      if (op.action === 'claim') item.assigneeId = op.assigneeId;
      if (op.action === 'release') item.assigneeId = null;
      if (op.action === 'complete') item.completed = op.completed;
      if (op.action === 'remove') item.deleted = true;
    }
  }
  return { ...settings, items };
}
