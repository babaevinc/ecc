'use strict';
// Role × action matrix shared by tests/e2e/access-control.spec.js and tests/unit/roles-doc.test.js.
// Must match the table in docs/architecture/roles.md (the unit test enforces it).
const ROLES = ['superadmin', 'owner', 'staff', 'manager', 'viewer'];

/** expected HTTP status per role, in ROLES order */
const MATRIX = [
  { action: 'list batches', expect: [200, 200, 200, 200, 200] },
  { action: 'receive stock', expect: [403, 201, 201, 403, 403] },
  { action: 'create request', expect: [403, 201, 201, 201, 403] },
  { action: 'write off spoilage', expect: [403, 201, 201, 403, 403] },
  { action: 'view finance', expect: [200, 200, 403, 403, 403] },
  { action: 'list all companies', expect: [200, 403, 403, 403, 403] },
];

module.exports = { ROLES, MATRIX };
