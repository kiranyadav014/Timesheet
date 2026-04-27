# Timesheet Management System — PRD

## Original Problem Statement
Build a website for TIMESHEET. Employees fill working days; daily work updated. ~50 employees access; admin grants permission. Each employee has a unique Employee ID. Every employee must fill timesheet every Friday.

## User Choices (locked)
- Auth: JWT-based custom auth
- Employee ID: Admin manually assigns
- Entry style: **DAILY entries (Mon–Fri rows)** — switched from weekly summary on 2026-04-27
- Reminders: **Daily missed-day email + Friday reminder + lock until previous week submitted**; reminder email contains link `/employee?missing=DATES` that highlights missing days
- Leaves: Employees apply, admin approves; **approved leaves auto-fill timesheet days** as type=leave
- Admin: Approve/reject + CSV export

## Architecture
- Backend: FastAPI + Motor + APScheduler + Resend
- Frontend: React 19 + React Router + TailwindCSS + shadcn/ui + Phosphor Icons + Sonner

## What's Implemented
### v1 (2026-04-26)
- ✅ JWT auth (admin seeded), employee CRUD, weekly summary, lock system, Friday reminder, CSV export, admin approve/reject

### v2 (2026-04-27)
- ✅ **Daily entries (Mon–Fri rows)**: save-day endpoint per row, submit-week promotes to pending
- ✅ **Daily reminder cron** (Mon-Fri 18:00 UTC) emails missing-day employees with deep-link to portal
- ✅ **Friday reminder cron** (Fri 09:00 UTC) for unsubmitted weeks
- ✅ **Email link with `?missing=YYYY-MM-DD,...`**: portal highlights those rows + shows banner
- ✅ **Leave application**: employees apply (sick/casual/earned/wfh/other), admin approve/reject in Leaves tab, approved leaves auto-merge into timesheet
- ✅ Admin Review dialog shows daily breakdown table + employee notes
- ✅ Reports tab: 6 stat cards including pending leaves; CSV exports per-day rows

## Test Status
- 32/32 backend pytest tests passing
- Frontend admin + employee flows verified end-to-end
- Resend integration scaffolded (placeholder key — emails skipped silently)

## Backlog
### P0
- Real Resend API key from user → live email reminders

### P1
- Edit/reset employee password from admin
- Pagination on Timesheets table at 1k+ rows
- Per-employee detail drawer

### P2
- Slack/Teams reminder webhook
- Charts on Reports tab (recharts already installed)
- Public holiday calendar awareness
- Brute-force login lockout
- Time-zone handling (currently UTC)

## Files
- /app/backend/server.py
- /app/frontend/src/{App.js, contexts/AuthContext.jsx, components/ProtectedRoute.jsx}
- /app/frontend/src/pages/{Login, EmployeeDashboard, AdminDashboard}.jsx
- /app/memory/test_credentials.md
- /app/backend/tests/test_timesheet_api.py
