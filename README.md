# New Timesheet — local-first edition

This branch contains the local-first Timesheet application built for a single laptop. It is intentionally separate from the existing React/FastAPI implementation in `frontend/` and `backend/`.

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`.

## What it includes

- Password-based employee and administrator sign-in
- Daily Monday–Friday work entries, weekly submission, and deadline locking
- Administrator review, approval/rejection, employee accounts, leave approvals, and CSV export
- An embedded SQLite database, kept only on the laptop

## First-run accounts

- Administrator: `admin@example.local` / `Admin@123`
- Employee examples: an `@example.local` email / `Welcome@123`

Change all starter passwords before using the system with real employees.

## Data privacy

The database is stored at `data/timesheet.sqlite`. It is excluded from Git, along with all local employee records. Email reminders are disabled in this offline edition because sending email requires an external provider.
