const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'timesheet.sqlite');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('employee', 'admin')),
    color TEXT NOT NULL DEFAULT '#0033cc',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    project TEXT NOT NULL,
    task TEXT NOT NULL,
    hours REAL NOT NULL CHECK(hours > 0 AND hours <= 24),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
function hasColumn(table, column) { return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column); }
function addColumn(table, definition) { const column = definition.split(/\s+/)[0]; if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`); }
addColumn('employees', 'employee_code TEXT');
addColumn('employees', 'password_hash TEXT');
addColumn('employees', 'active INTEGER NOT NULL DEFAULT 1');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_unique ON employees(employee_code) WHERE employee_code IS NOT NULL');
db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_timesheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'approved', 'rejected')),
    notes TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
    submitted_at TEXT, reviewed_at TEXT, reviewed_by INTEGER REFERENCES employees(id),
    UNIQUE(employee_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS daily_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    entry_type TEXT NOT NULL DEFAULT 'work' CHECK(entry_type IN ('work', 'wfh', 'leave')),
    project TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    hours REAL NOT NULL DEFAULT 0 CHECK(hours >= 0 AND hours <= 24),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, entry_date)
  );
  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK(leave_type IN ('sick', 'casual', 'earned', 'wfh', 'other')),
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    review_note TEXT NOT NULL DEFAULT '', reviewed_by INTEGER REFERENCES employees(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
  );
`);
function passwordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password, stored) { if (!stored || !stored.includes(':')) return false; const [salt, expected] = stored.split(':'); const actual = crypto.scryptSync(password, salt, 64).toString('hex'); return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')); }
function seedData() {
  if (db.prepare('SELECT COUNT(*) AS count FROM employees').get().count === 0) {
    const add = db.prepare('INSERT INTO employees (name, email, role, color) VALUES (?, ?, ?, ?)');
    add.run('Jenna Parker', 'admin@example.local', 'admin', '#0033cc'); add.run('Arun Shah', 'arun@example.local', 'employee', '#2563eb'); add.run('Maya Chen', 'maya@example.local', 'employee', '#d946ef'); add.run('Leo Martins', 'leo@example.local', 'employee', '#0891b2');
  }
  const people = db.prepare('SELECT id, role, employee_code, password_hash FROM employees ORDER BY id').all();
  const update = db.prepare('UPDATE employees SET employee_code = ?, password_hash = ? WHERE id = ?');
  for (const person of people) { const code = person.employee_code || (person.role === 'admin' ? `ADM${String(person.id).padStart(3, '0')}` : `EMP${String(person.id).padStart(3, '0')}`); update.run(code, person.password_hash || passwordHash(person.role === 'admin' ? 'Admin@123' : 'Welcome@123'), person.id); }
}
seedData();

function dateOnly(date) { const pad = (value) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()); }
function toDate(value) { return new Date(`${value}T12:00:00`); }
function addDays(value, amount) { const date = toDate(value); date.setDate(date.getDate() + amount); return dateOnly(date); }
function monday(value = new Date()) { const date = value instanceof Date ? new Date(value) : toDate(value); const day = date.getDay(); date.setDate(date.getDate() - (day === 0 ? 6 : day - 1)); return dateOnly(date); }
function isWeekday(value) { const day = toDate(value).getDay(); return day >= 1 && day <= 5; }
function weekDays(start) { return Array.from({ length: 5 }, (_, index) => addDays(start, index)); }
function nowIso() { return new Date().toISOString(); }
function safeEmployee(row) { return row && { id: row.id, name: row.name, email: row.email, role: row.role, employeeCode: row.employee_code, color: row.color, active: Boolean(row.active) }; }
function getEmployee(id) { return db.prepare('SELECT * FROM employees WHERE id = ? AND active = 1').get(Number(id)); }
function getEmployeeByEmail(email) { return db.prepare('SELECT * FROM employees WHERE LOWER(email) = LOWER(?) AND active = 1').get(String(email || '').trim()); }
function getSheet(employeeId, start) { return db.prepare('SELECT * FROM weekly_timesheets WHERE employee_id = ? AND week_start = ?').get(employeeId, start); }
function ensureSheet(employeeId, start) { db.prepare('INSERT OR IGNORE INTO weekly_timesheets (employee_id, week_start) VALUES (?, ?)').run(employeeId, start); return getSheet(employeeId, start); }
function sheetWithTotal(sheet) { const row = db.prepare("SELECT COALESCE(ROUND(SUM(hours), 2), 0) AS total FROM daily_entries WHERE employee_id = ? AND entry_date BETWEEN ? AND ?").get(sheet.employee_id, sheet.week_start, addDays(sheet.week_start, 4)); return { id: sheet.id, employeeId: sheet.employee_id, weekStart: sheet.week_start, status: sheet.status, notes: sheet.notes, reviewNote: sheet.review_note, totalHours: Number(row.total) }; }
function currentStatus(employeeId) { const currentWeekStart = monday(); const previousWeekStart = addDays(currentWeekStart, -7); const prior = getSheet(employeeId, previousWeekStart); return { currentWeekStart, previousWeekStart, locked: !prior || !['pending', 'approved'].includes(prior.status), priorStatus: prior?.status || 'not-started' }; }
function getEmployeeWeek(employeeId, requestedStart) {
  const status = currentStatus(employeeId); const start = requestedStart || status.previousWeekStart;
  if (!validDate(start) || monday(start) !== start || ![status.previousWeekStart, status.currentWeekStart].includes(start)) return null;
  const sheet = ensureSheet(employeeId, start); const rows = db.prepare('SELECT entry_date, entry_type, project, description, hours FROM daily_entries WHERE employee_id = ? AND entry_date BETWEEN ? AND ?').all(employeeId, start, addDays(start, 4)); const entries = new Map(rows.map((row) => [row.entry_date, row]));
  return { status, editable: ['draft', 'rejected'].includes(sheet.status) && !(start === status.currentWeekStart && status.locked), sheet: sheetWithTotal(sheet), days: weekDays(start).map((entryDate) => { const entry = entries.get(entryDate); return { entryDate, type: entry?.entry_type || 'work', project: entry?.project || '', description: entry?.description || '', hours: entry?.hours ?? 0, isLeave: entry?.entry_type === 'leave' }; }) };
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => { const index = part.indexOf('='); return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; })); }
function auth(req) { const token = cookies(req).timesheet_session; const session = token && sessions.get(token); if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; } return getEmployee(session.employeeId); }
function json(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
function text(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(body); }
function requireUser(req, res) { const user = auth(req); if (!user) { json(res, 401, { error: 'Please sign in to continue.' }); return null; } return user; }
function requireAdmin(req, res) { const user = requireUser(req, res); if (!user) return null; if (user.role !== 'admin') { json(res, 403, { error: 'Administrator access is required.' }); return null; } return user; }
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', (chunk) => { raw += chunk; if (raw.length > 100000) reject(new Error('Request is too large.')); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid request.')); } }); req.on('error', reject); }); }
function escapeCsv(value) { const string = String(value ?? ''); return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string; }
function listTimesheets(statusFilter = 'pending', employeeCode = '') {
  const values = []; const clauses = []; if (statusFilter && statusFilter !== 'all') { clauses.push('w.status = ?'); values.push(statusFilter); } if (employeeCode) { clauses.push('e.employee_code = ?'); values.push(employeeCode.toUpperCase()); } const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT w.*, e.name AS employee_name, e.email AS employee_email, e.employee_code, COALESCE((SELECT ROUND(SUM(d.hours), 2) FROM daily_entries d WHERE d.employee_id = w.employee_id AND d.entry_date BETWEEN w.week_start AND date(w.week_start, '+4 day')), 0) AS total_hours FROM weekly_timesheets w JOIN employees e ON e.id = w.employee_id ${where} ORDER BY w.week_start DESC, w.submitted_at DESC`).all(...values).map((row) => ({ id: row.id, employeeId: row.employee_id, employeeName: row.employee_name, employeeEmail: row.employee_email, employeeCode: row.employee_code, weekStart: row.week_start, status: row.status, notes: row.notes, reviewNote: row.review_note, totalHours: Number(row.total_hours), submittedAt: row.submitted_at }));
}
async function api(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'POST' && pathname === '/api/auth/login') { const data = await readBody(req); const employee = getEmployeeByEmail(data.email); if (!employee || !passwordMatches(String(data.password || ''), employee.password_hash)) return json(res, 401, { error: 'Incorrect email or password.' }); const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { employeeId: employee.id, expires: Date.now() + SESSION_TTL_MS }); return json(res, 200, { user: safeEmployee(employee) }, { 'Set-Cookie': `timesheet_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` }); }
  if (req.method === 'POST' && pathname === '/api/auth/logout') { const token = cookies(req).timesheet_session; if (token) sessions.delete(token); return json(res, 200, { ok: true }, { 'Set-Cookie': 'timesheet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }); }
  if (req.method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: safeEmployee(auth(req)) });
  if (req.method === 'GET' && pathname === '/api/employee/status') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); return json(res, 200, currentStatus(user.id)); }
  if (req.method === 'GET' && pathname === '/api/employee/week') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); const week = getEmployeeWeek(user.id, url.searchParams.get('week')); return week ? json(res, 200, week) : json(res, 400, { error: 'Choose either the current or previous Monday.' }); }
  const dayMatch = pathname.match(/^\/api\/employee\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (req.method === 'PUT' && dayMatch) { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); const entryDate = dayMatch[1]; const data = await readBody(req); const hours = Number(data.hours); const type = data.type === 'wfh' ? 'wfh' : 'work'; const project = String(data.project || '').trim(); const description = String(data.description || '').trim(); const week = getEmployeeWeek(user.id, monday(entryDate)); if (!validDate(entryDate) || !isWeekday(entryDate) || !week?.editable || !Number.isFinite(hours) || hours < 0 || hours > 24 || !project || !description) return json(res, 400, { error: 'Enter a project, description, and 0–24 hours on an editable weekday.' }); const existing = db.prepare('SELECT entry_type FROM daily_entries WHERE employee_id = ? AND entry_date = ?').get(user.id, entryDate); if (existing?.entry_type === 'leave') return json(res, 409, { error: 'Approved leave days cannot be changed.' }); db.prepare(`INSERT INTO daily_entries (employee_id, entry_date, entry_type, project, description, hours, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(employee_id, entry_date) DO UPDATE SET entry_type=excluded.entry_type, project=excluded.project, description=excluded.description, hours=excluded.hours, updated_at=excluded.updated_at`).run(user.id, entryDate, type, project, description, hours, nowIso()); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && pathname === '/api/employee/submit-week') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); const data = await readBody(req); const week = getEmployeeWeek(user.id, data.weekStart); if (!week?.editable) return json(res, 400, { error: 'This week cannot be submitted.' }); const missing = week.days.filter((day) => Number(day.hours) <= 0).map((day) => day.entryDate); if (missing.length) return json(res, 400, { error: `Complete all five weekdays before submitting. Missing: ${missing.join(', ')}` }); db.prepare("UPDATE weekly_timesheets SET status='pending', notes=?, review_note='', submitted_at=?, reviewed_at=NULL, reviewed_by=NULL WHERE id=?").run(String(data.notes || '').trim().slice(0, 1000), nowIso(), week.sheet.id); return json(res, 200, { ok: true }); }
  if (req.method === 'GET' && pathname === '/api/employee/history') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); return json(res, 200, db.prepare('SELECT * FROM weekly_timesheets WHERE employee_id = ? ORDER BY week_start DESC LIMIT 20').all(user.id).map(sheetWithTotal)); }
  if (req.method === 'GET' && pathname === '/api/employee/leaves') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); return json(res, 200, db.prepare('SELECT id, leave_type AS leaveType, start_date AS startDate, end_date AS endDate, reason, status, review_note AS reviewNote, created_at AS createdAt FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC').all(user.id)); }
  if (req.method === 'POST' && pathname === '/api/employee/leaves') { const user = requireUser(req, res); if (!user) return; if (user.role !== 'employee') return json(res, 403, { error: 'Employee access is required.' }); const data = await readBody(req); const allowed = ['sick', 'casual', 'earned', 'wfh', 'other']; const startDate = String(data.startDate || ''); const endDate = String(data.endDate || ''); if (!allowed.includes(data.leaveType) || !validDate(startDate) || !validDate(endDate) || startDate > endDate || !String(data.reason || '').trim()) return json(res, 400, { error: 'Complete the leave type, date range, and reason.' }); db.prepare('INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)').run(user.id, data.leaveType, startDate, endDate, String(data.reason).trim().slice(0, 1000)); return json(res, 201, { ok: true }); }
  if (req.method === 'GET' && pathname === '/api/admin/summary') { const admin = requireAdmin(req, res); if (!admin) return; const current = monday(); const employees = db.prepare("SELECT COUNT(*) AS count FROM employees WHERE role='employee' AND active=1").get().count; const missing = db.prepare("SELECT COUNT(*) AS count FROM employees e WHERE e.role='employee' AND e.active=1 AND NOT EXISTS (SELECT 1 FROM weekly_timesheets w WHERE w.employee_id=e.id AND w.week_start=? AND w.status IN ('pending','approved'))").get(current).count; const count = (status) => db.prepare('SELECT COUNT(*) AS count FROM weekly_timesheets WHERE status = ?').get(status).count; return json(res, 200, { employees, pending: count('pending'), approved: count('approved'), rejected: count('rejected'), submittedThisWeek: db.prepare("SELECT COUNT(*) AS count FROM weekly_timesheets WHERE week_start=? AND status IN ('pending','approved')").get(current).count, missingThisWeek: missing, pendingLeaves: db.prepare("SELECT COUNT(*) AS count FROM leave_requests WHERE status='pending'").get().count }); }
  if (req.method === 'GET' && pathname === '/api/admin/timesheets') { const admin = requireAdmin(req, res); if (!admin) return; return json(res, 200, listTimesheets(url.searchParams.get('status') || 'pending', url.searchParams.get('employeeCode') || '')); }
  const detailMatch = pathname.match(/^\/api\/admin\/timesheets\/(\d+)$/);
  if (req.method === 'GET' && detailMatch) { const admin = requireAdmin(req, res); if (!admin) return; const row = db.prepare('SELECT w.*, e.name AS employee_name, e.email AS employee_email, e.employee_code FROM weekly_timesheets w JOIN employees e ON e.id=w.employee_id WHERE w.id=?').get(Number(detailMatch[1])); if (!row) return json(res, 404, { error: 'Timesheet not found.' }); const days = db.prepare('SELECT entry_date AS entryDate, entry_type AS type, project, description, hours FROM daily_entries WHERE employee_id=? AND entry_date BETWEEN ? AND ? ORDER BY entry_date').all(row.employee_id, row.week_start, addDays(row.week_start, 4)); return json(res, 200, { item: { id: row.id, employeeName: row.employee_name, employeeEmail: row.employee_email, employeeCode: row.employee_code, weekStart: row.week_start, status: row.status, notes: row.notes, reviewNote: row.review_note, totalHours: sheetWithTotal(row).totalHours }, days }); }
  const decisionMatch = pathname.match(/^\/api\/admin\/timesheets\/(\d+)\/decision$/);
  if (req.method === 'POST' && decisionMatch) { const admin = requireAdmin(req, res); if (!admin) return; const data = await readBody(req); const status = data.decision === 'approve' ? 'approved' : data.decision === 'reject' ? 'rejected' : null; if (!status) return json(res, 400, { error: 'Choose approve or reject.' }); const result = db.prepare("UPDATE weekly_timesheets SET status=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE id=? AND status='pending'").run(status, String(data.reviewNote || '').trim().slice(0, 1000), admin.id, nowIso(), Number(decisionMatch[1])); return result.changes ? json(res, 200, { ok: true }) : json(res, 409, { error: 'Only pending timesheets can be reviewed.' }); }
  if (req.method === 'GET' && pathname === '/api/admin/leaves') { const admin = requireAdmin(req, res); if (!admin) return; const filter = url.searchParams.get('status') || 'pending'; const args = filter === 'all' ? [] : [filter]; const where = filter === 'all' ? '' : 'WHERE l.status=?'; return json(res, 200, db.prepare(`SELECT l.id, l.leave_type AS leaveType, l.start_date AS startDate, l.end_date AS endDate, l.reason, l.status, l.review_note AS reviewNote, e.name AS employeeName, e.employee_code AS employeeCode FROM leave_requests l JOIN employees e ON e.id=l.employee_id ${where} ORDER BY l.created_at DESC`).all(...args)); }
  const leaveDecisionMatch = pathname.match(/^\/api\/admin\/leaves\/(\d+)\/decision$/);
  if (req.method === 'POST' && leaveDecisionMatch) { const admin = requireAdmin(req, res); if (!admin) return; const data = await readBody(req); const status = data.decision === 'approve' ? 'approved' : data.decision === 'reject' ? 'rejected' : null; const leave = db.prepare("SELECT * FROM leave_requests WHERE id=? AND status='pending'").get(Number(leaveDecisionMatch[1])); if (!status || !leave) return json(res, 409, { error: 'This leave request cannot be reviewed.' }); db.prepare('UPDATE leave_requests SET status=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE id=?').run(status, String(data.reviewNote || '').trim().slice(0, 1000), admin.id, nowIso(), leave.id); if (status === 'approved') { const insert = db.prepare(`INSERT INTO daily_entries (employee_id, entry_date, entry_type, project, description, hours, updated_at) VALUES (?, ?, 'leave', ?, ?, 8, ?) ON CONFLICT(employee_id, entry_date) DO UPDATE SET entry_type='leave', project=excluded.project, description=excluded.description, hours=8, updated_at=excluded.updated_at`); for (let date = leave.start_date; date <= leave.end_date; date = addDays(date, 1)) if (isWeekday(date)) insert.run(leave.employee_id, date, `Leave — ${leave.leave_type}`, leave.reason, nowIso()); } return json(res, 200, { ok: true }); }
  if (req.method === 'GET' && pathname === '/api/admin/employees') { const admin = requireAdmin(req, res); if (!admin) return; return json(res, 200, db.prepare('SELECT id, name, email, role, employee_code AS employeeCode, color, active FROM employees ORDER BY role DESC, name').all().map((row) => ({ ...row, active: Boolean(row.active) }))); }
  if (req.method === 'POST' && pathname === '/api/admin/employees') { const admin = requireAdmin(req, res); if (!admin) return; const data = await readBody(req); const name = String(data.name || '').trim(); const email = String(data.email || '').trim().toLowerCase(); const code = String(data.employeeCode || '').trim().toUpperCase(); const password = String(data.password || ''); if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^[A-Z0-9_-]{3,20}$/.test(code) || password.length < 8) return json(res, 400, { error: 'Enter a name, valid email, 3–20 character employee ID, and 8+ character password.' }); try { const result = db.prepare("INSERT INTO employees (name, email, role, employee_code, password_hash, color, active) VALUES (?, ?, 'employee', ?, ?, '#0033cc', 1)").run(name, email, code, passwordHash(password)); return json(res, 201, { id: Number(result.lastInsertRowid) }); } catch { return json(res, 409, { error: 'That email address or employee ID is already in use.' }); } }
  if (req.method === 'GET' && pathname === '/api/admin/reports/csv') { const admin = requireAdmin(req, res); if (!admin) return; const rows = listTimesheets(url.searchParams.get('status') || 'all', url.searchParams.get('employeeCode') || ''); const output = ['Employee ID,Employee,Email,Week starting,Status,Total hours,Employee notes,Review note', ...rows.map((row) => [row.employeeCode, row.employeeName, row.employeeEmail, row.weekStart, row.status, row.totalHours, row.notes, row.reviewNote].map(escapeCsv).join(','))].join('\r\n'); res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="timesheets-${dateOnly(new Date())}.csv"`, 'Cache-Control': 'no-store' }); return res.end(output); }
  return json(res, 404, { error: 'Not found.' });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(res, pathname) { const requested = pathname === '/' ? '/index.html' : pathname; const filePath = path.join(PUBLIC_DIR, path.normalize(requested).replace(/^([.][.][\\/])+/,'')); if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return text(res, 404, 'Not found'); res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(filePath)); }
http.createServer(async (req, res) => { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); try { if (url.pathname.startsWith('/api/')) return await api(req, res, url); if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' }); return serveStatic(res, url.pathname); } catch (error) { console.error(error); return json(res, 500, { error: 'The local server encountered an error.' }); } }).listen(PORT, '127.0.0.1', () => { console.log(`Timesheet running locally at http://localhost:${PORT}`); console.log(`Local database: ${DB_PATH}`); });
