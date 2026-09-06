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

## Deploy to Vercel with Neon Postgres

The app automatically uses `DATABASE_URL` when it is set and falls back to the local SQLite database otherwise. For a hosted deployment, create a Neon Postgres database and add the connection string to Vercel as an environment variable named `DATABASE_URL`.

Example configuration:

```env
PORT=3000
DATABASE_URL=postgresql://user:password@host:5432/timesheet?sslmode=require
```

The project includes a `.env.example` file for this setup.

## Data privacy

The database is stored at `data/timesheet.sqlite`. It is excluded from Git, along with all local employee records. Email reminders are disabled in this offline edition because sending email requires an external provider.
