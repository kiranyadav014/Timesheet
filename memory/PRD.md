# Timesheet Management System — PRD

## Original Problem Statement
Build a website for TIMESHEET. Employees fill working days; daily work updated. ~50 employees access; admin grants permission. Each employee has a unique Employee ID. Every employee must fill timesheet every Friday.

## User Choices (locked)
- Auth: JWT-based custom auth (email/password)
- Employee ID: Admin manually assigns when creating employee
- Entry style: Weekly summary (total hours + tasks) — not daily
- Friday reminder: Email every Friday + lock system until previous week's timesheet submitted
- Admin features: Approve/reject + CSV export + reports

## Architecture
- Backend: FastAPI + Motor (MongoDB) + APScheduler + Resend
- Frontend: React 19 + React Router + TailwindCSS + shadcn/ui + Phosphor Icons + Sonner toasts
- Auth: bcrypt + PyJWT, token in localStorage (Bearer) and httpOnly cookie

## What's Implemented (2026-04-26)
- ✅ Auth: login / logout / me, admin auto-seeded (admin@timesheet.com / admin123)
- ✅ Employee CRUD (admin only): create with manual Employee ID, list, update, delete (cascades timesheets)
- ✅ Timesheet submit: Monday-only week_start, no future weeks, lock until previous week submitted (HTTP 423), rejected can be resubmitted, pending/approved cannot
- ✅ Employee dashboard: status banners (locked / Friday reminder / submitted), submission form, history table
- ✅ Admin dashboard: 3 tabs (Timesheets / Employees / Reports), summary stats, filters, review dialog (approve/reject), CSV export, manual reminder trigger
- ✅ APScheduler: weekly Friday 09:00 UTC cron that emails missing employees
- ✅ Resend integration scaffold (placeholder key — emails skipped silently until real key is set)
- ✅ Design: Swiss high-contrast theme with Cabinet Grotesk + IBM Plex Sans, sharp edges (rounded-sm), monochrome with brand blue + warning orange + success green
- ✅ data-testid on all interactive elements

## Test Status
- 27/27 backend pytest tests passing (auth, lock logic, CRUD, review state machine, CSV, summary, reminders)
- Frontend admin flow verified end-to-end via Playwright

## Backlog
### P0
- Real Resend API key from user → live email reminders

### P1
- Edit/reset employee password from admin panel
- Pagination on Timesheets table at 1k+ rows
- Per-employee detail drawer (timesheet history)

### P2
- Slack/Teams reminder webhook alternative to email
- Multi-week bulk approve
- Charts on Reports tab (recharts is installed)
- Daily entries mode toggle (currently weekly only)
- Public holiday calendar awareness

## Files
- /app/backend/server.py — all API + scheduler
- /app/frontend/src/App.js — router
- /app/frontend/src/contexts/AuthContext.jsx
- /app/frontend/src/pages/{Login,EmployeeDashboard,AdminDashboard}.jsx
- /app/memory/test_credentials.md — admin creds
