// Payload-First Security Test Suite Blueprint for Nervis Club Firestore Rules
export const dirtyDozenPayloads = [
  { id: '01_anon_list_orders', path: '/orders', op: 'list', auth: null, expected: 'PERMISSION_DENIED' },
  { id: '02_nonadmin_get_order', path: '/orders/ord_1', op: 'get', auth: { uid: 'u1', email: 'buyer@test.com', email_verified: true }, expected: 'PERMISSION_DENIED' },
  { id: '03_status_shortcut', path: '/orders/ord_2', op: 'create', data: { status: 'selesai' }, expected: 'PERMISSION_DENIED' },
  { id: '04_price_tamper', path: '/orders/ord_3', op: 'create', data: { unitPrice: 1, totalPrice: 1 }, expected: 'PERMISSION_DENIED' },
  { id: '05_shadow_field', path: '/orders/ord_4', op: 'create', data: { isVerified: true }, expected: 'PERMISSION_DENIED' },
  { id: '06_invalid_doc_id', path: '/orders/bad$id', op: 'create', data: {}, expected: 'PERMISSION_DENIED' },
  { id: '07_forged_timestamp', path: '/orders/ord_5', op: 'create', data: { createdAt: '2020-01-01T00:00:00Z' }, expected: 'PERMISSION_DENIED' },
  { id: '08_qty_overflow', path: '/orders/ord_6', op: 'create', data: { qty: 99 }, expected: 'PERMISSION_DENIED' },
  { id: '09_inventory_tamper', path: '/inventory/drop01', op: 'update', data: { stockM: 0 }, expected: 'PERMISSION_DENIED' },
  { id: '10_inventory_bad_type', path: '/inventory/drop01', op: 'update', data: { stockM: 'habis' }, expected: 'PERMISSION_DENIED' },
  { id: '11_unverified_admin_spoof', path: '/orders', op: 'list', auth: { uid: 'a1', email: 'haroldlearning885@gmail.com', email_verified: false }, expected: 'PERMISSION_DENIED' },
  { id: '12_admin_escalation', path: '/admins/u1', op: 'create', auth: { uid: 'u1', email: 'buyer@test.com', email_verified: true }, expected: 'PERMISSION_DENIED' },
];
