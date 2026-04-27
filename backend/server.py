from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import asyncio
import logging
import bcrypt
import jwt
import resend
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

# ---- Setup ----
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = "HS256"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@timesheet.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

resend.api_key = RESEND_API_KEY

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Timesheet API")
api_router = APIRouter(prefix="/api")
scheduler = AsyncIOScheduler(timezone="UTC")


# ---- Helpers ----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_week_start(d: Optional[date] = None) -> date:
    """Return Monday of the given (or today's) ISO week."""
    if d is None:
        d = datetime.now(timezone.utc).date()
    return d - timedelta(days=d.weekday())


def is_friday_or_later(d: Optional[date] = None) -> bool:
    if d is None:
        d = datetime.now(timezone.utc).date()
    return d.weekday() >= 4  # Fri=4, Sat=5, Sun=6


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---- Models ----
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class CreateEmployeeRequest(BaseModel):
    employee_id: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=4)
    department: Optional[str] = ""
    position: Optional[str] = ""


class UpdateEmployeeRequest(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    active: Optional[bool] = None


class TimesheetSubmit(BaseModel):
    week_start: str  # YYYY-MM-DD (Monday)
    total_hours: float = Field(..., ge=0, le=168)
    tasks: str = Field(..., min_length=1, max_length=4000)
    notes: Optional[str] = ""


class TimesheetReview(BaseModel):
    action: Literal["approve", "reject"]
    review_note: Optional[str] = ""


# ---- Auth Endpoints ----
@api_router.post("/auth/login")
async def login(payload: LoginRequest, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")
    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
            "employee_id": user.get("employee_id"),
        }
    }


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"message": "Logged out"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
        "employee_id": user.get("employee_id"),
        "department": user.get("department", ""), "position": user.get("position", ""),
    }


# ---- Employee Management (Admin) ----
@api_router.get("/employees")
async def list_employees(_: dict = Depends(require_admin)):
    docs = await db.users.find({"role": "employee"}, {"_id": 0, "password_hash": 0}).sort("employee_id", 1).to_list(1000)
    return docs


@api_router.post("/employees", status_code=201)
async def create_employee(payload: CreateEmployeeRequest, _: dict = Depends(require_admin)):
    email = payload.email.lower().strip()
    emp_id = payload.employee_id.strip().upper()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if await db.users.find_one({"employee_id": emp_id}):
        raise HTTPException(status_code=400, detail="Employee ID already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "employee_id": emp_id,
        "email": email,
        "name": payload.name.strip(),
        "password_hash": hash_password(payload.password),
        "role": "employee",
        "department": payload.department or "",
        "position": payload.position or "",
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None); doc.pop("password_hash", None)
    return doc


@api_router.patch("/employees/{employee_id}")
async def update_employee(employee_id: str, payload: UpdateEmployeeRequest, _: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.users.update_one({"employee_id": employee_id.upper(), "role": "employee"}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    doc = await db.users.find_one({"employee_id": employee_id.upper()}, {"_id": 0, "password_hash": 0})
    return doc


@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, _: dict = Depends(require_admin)):
    res = await db.users.delete_one({"employee_id": employee_id.upper(), "role": "employee"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    await db.timesheets.delete_many({"employee_id": employee_id.upper()})
    return {"message": "Employee deleted"}


# ---- Timesheets (Employee) ----
@api_router.get("/timesheets/status")
async def timesheet_status(user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today)
    last_week = current_week - timedelta(days=7)
    last_ts = await db.timesheets.find_one(
        {"employee_id": user["employee_id"], "week_start": last_week.isoformat()}, {"_id": 0}
    )
    current_ts = await db.timesheets.find_one(
        {"employee_id": user["employee_id"], "week_start": current_week.isoformat()}, {"_id": 0}
    )
    locked = last_ts is None  # lock current-week submission until last week is submitted
    return {
        "today": today.isoformat(),
        "is_friday_or_later": is_friday_or_later(today),
        "current_week_start": current_week.isoformat(),
        "last_week_start": last_week.isoformat(),
        "last_week_submitted": last_ts is not None,
        "last_week_status": last_ts.get("status") if last_ts else None,
        "current_week_submitted": current_ts is not None,
        "current_week_status": current_ts.get("status") if current_ts else None,
        "locked": locked,
    }


@api_router.get("/timesheets/me")
async def my_timesheets(user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    docs = await db.timesheets.find({"employee_id": user["employee_id"]}, {"_id": 0}).sort("week_start", -1).to_list(500)
    return docs


@api_router.post("/timesheets/submit", status_code=201)
async def submit_timesheet(payload: TimesheetSubmit, user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    try:
        ws = datetime.strptime(payload.week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid week_start (YYYY-MM-DD)")
    if ws.weekday() != 0:
        raise HTTPException(status_code=400, detail="week_start must be a Monday")

    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today)
    last_week = current_week - timedelta(days=7)

    # Lock: cannot submit current week's timesheet if last week is unsubmitted (unless ws is the last_week)
    last_ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": last_week.isoformat()})
    if last_ts is None and ws == current_week:
        raise HTTPException(status_code=423, detail=f"Submit last week's timesheet ({last_week.isoformat()}) first")

    # No future weeks
    if ws > current_week:
        raise HTTPException(status_code=400, detail="Cannot submit timesheet for a future week")

    existing = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": ws.isoformat()})
    if existing and existing.get("status") in ("pending", "approved"):
        raise HTTPException(status_code=400, detail=f"Timesheet already {existing['status']} for this week")

    doc = {
        "id": str(uuid.uuid4()),
        "employee_id": user["employee_id"],
        "user_id": user["id"],
        "employee_name": user["name"],
        "week_start": ws.isoformat(),
        "week_end": (ws + timedelta(days=6)).isoformat(),
        "total_hours": payload.total_hours,
        "tasks": payload.tasks.strip(),
        "notes": (payload.notes or "").strip(),
        "status": "pending",
        "review_note": "",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
    }
    if existing and existing.get("status") == "rejected":
        await db.timesheets.delete_one({"id": existing["id"]})
    await db.timesheets.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ---- Timesheets (Admin) ----
@api_router.get("/admin/timesheets")
async def list_all_timesheets(
    status_filter: Optional[str] = None,
    employee_id: Optional[str] = None,
    week_start: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    query = {}
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    if employee_id:
        query["employee_id"] = employee_id.upper()
    if week_start:
        query["week_start"] = week_start
    docs = await db.timesheets.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(2000)
    return docs


@api_router.post("/admin/timesheets/{ts_id}/review")
async def review_timesheet(ts_id: str, payload: TimesheetReview, admin: dict = Depends(require_admin)):
    ts = await db.timesheets.find_one({"id": ts_id})
    if not ts:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    if ts.get("status") != "pending":
        raise HTTPException(status_code=400, detail=f"Already {ts['status']}")
    new_status = "approved" if payload.action == "approve" else "rejected"
    await db.timesheets.update_one(
        {"id": ts_id},
        {"$set": {
            "status": new_status,
            "review_note": payload.review_note or "",
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_by": admin["email"],
        }},
    )
    doc = await db.timesheets.find_one({"id": ts_id}, {"_id": 0})
    return doc


@api_router.get("/admin/reports/summary")
async def reports_summary(_: dict = Depends(require_admin)):
    employees = await db.users.count_documents({"role": "employee"})
    pending = await db.timesheets.count_documents({"status": "pending"})
    approved = await db.timesheets.count_documents({"status": "approved"})
    rejected = await db.timesheets.count_documents({"status": "rejected"})
    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today).isoformat()
    submitted_this_week = len(await db.timesheets.distinct("employee_id", {"week_start": current_week}))
    return {
        "total_employees": employees,
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "submitted_this_week": submitted_this_week,
        "missing_this_week": max(0, employees - submitted_this_week),
        "current_week_start": current_week,
    }


@api_router.get("/admin/reports/csv")
async def export_csv(
    status_filter: Optional[str] = None,
    employee_id: Optional[str] = None,
    week_start: Optional[str] = None,
    _: dict = Depends(require_admin),
):
    query = {}
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    if employee_id:
        query["employee_id"] = employee_id.upper()
    if week_start:
        query["week_start"] = week_start
    docs = await db.timesheets.find(query, {"_id": 0}).sort("week_start", -1).to_list(5000)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Employee ID", "Name", "Week Start", "Week End", "Total Hours", "Status", "Tasks", "Notes", "Submitted At", "Reviewed At", "Review Note"])
    for d in docs:
        writer.writerow([
            d.get("employee_id", ""), d.get("employee_name", ""),
            d.get("week_start", ""), d.get("week_end", ""),
            d.get("total_hours", 0), d.get("status", ""),
            (d.get("tasks", "") or "").replace("\n", " | "),
            (d.get("notes", "") or "").replace("\n", " | "),
            d.get("submitted_at", ""), d.get("reviewed_at", "") or "",
            d.get("review_note", "") or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=timesheets_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"},
    )


# ---- Email Reminders ----
async def send_friday_reminders():
    """Run every Friday morning. Email all employees who haven't submitted current week's timesheet."""
    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today)
    employees = await db.users.find({"role": "employee", "active": True}).to_list(1000)
    submitted_ids = set(await db.timesheets.distinct("employee_id", {"week_start": current_week.isoformat()}))
    missing = [e for e in employees if e["employee_id"] not in submitted_ids]
    logger.info(f"[Friday reminder] {len(missing)} employees missing for week {current_week}")
    if not RESEND_API_KEY or RESEND_API_KEY.startswith("re_placeholder"):
        logger.warning("RESEND_API_KEY not configured — skipping email send (placeholder).")
        return {"sent": 0, "skipped": len(missing), "reason": "no_api_key"}
    sent = 0
    for emp in missing:
        html = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; border: 1px solid #D1D1D1;">
          <tr><td style="background:#0033CC; color:#fff; padding:24px; font-size:18px; font-weight:bold;">Timesheet Reminder</td></tr>
          <tr><td style="padding:24px; color:#1A1A1A;">
            <p>Hi {emp['name']},</p>
            <p>It's Friday. Please submit your timesheet for the week starting <b>{current_week.isoformat()}</b>.</p>
            <p><a href="{FRONTEND_URL}/login" style="display:inline-block;background:#0033CC;color:#fff;padding:12px 24px;text-decoration:none;">Submit now</a></p>
            <p style="color:#5C5C5C;font-size:12px;">Employee ID: {emp['employee_id']}</p>
          </td></tr>
        </table>
        """
        try:
            await asyncio.to_thread(resend.Emails.send, {
                "from": SENDER_EMAIL, "to": [emp["email"]],
                "subject": f"Submit your timesheet — week of {current_week.isoformat()}",
                "html": html,
            })
            sent += 1
        except Exception as e:
            logger.error(f"Email failed for {emp['email']}: {e}")
    return {"sent": sent, "missing": len(missing)}


@api_router.post("/admin/send-reminders-now")
async def trigger_reminders(_: dict = Depends(require_admin)):
    result = await send_friday_reminders()
    return result


# ---- Startup ----
async def seed_admin():
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "name": "Admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "active": True,
            "employee_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {ADMIN_EMAIL}")
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}})
        logger.info("Updated admin password from .env")


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("employee_id", unique=True, sparse=True)
    await db.timesheets.create_index([("employee_id", 1), ("week_start", 1)])
    await seed_admin()
    # Friday 09:00 UTC reminder
    scheduler.add_job(send_friday_reminders, CronTrigger(day_of_week="fri", hour=9, minute=0))
    scheduler.start()
    logger.info("Scheduler started — Friday reminders @ 09:00 UTC")


@app.on_event("shutdown")
async def on_shutdown():
    scheduler.shutdown(wait=False)
    client.close()


# ---- Mount ----
@api_router.get("/")
async def root():
    return {"message": "Timesheet API", "version": "1.0"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
