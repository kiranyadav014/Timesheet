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

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
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

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"]


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
    if d is None:
        d = datetime.now(timezone.utc).date()
    return d - timedelta(days=d.weekday())


def weekday_dates(week_start: date) -> List[date]:
    return [week_start + timedelta(days=i) for i in range(5)]


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


class DayEntry(BaseModel):
    date: str  # YYYY-MM-DD
    type: Literal["work", "leave", "holiday"] = "work"
    hours: float = Field(..., ge=0, le=24)
    tasks: Optional[str] = ""


class SaveDayRequest(BaseModel):
    week_start: str
    entry: DayEntry


class SubmitWeekRequest(BaseModel):
    week_start: str
    notes: Optional[str] = ""


class TimesheetReview(BaseModel):
    action: Literal["approve", "reject"]
    review_note: Optional[str] = ""


class LeaveCreate(BaseModel):
    leave_type: Literal["sick", "casual", "earned", "wfh", "other"]
    start_date: str  # YYYY-MM-DD
    end_date: str
    reason: str = Field(..., min_length=1, max_length=500)


class LeaveReview(BaseModel):
    action: Literal["approve", "reject"]
    review_note: Optional[str] = ""


# ---- Auth ----
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


# ---- Employees ----
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
    await db.leaves.delete_many({"employee_id": employee_id.upper()})
    return {"message": "Employee deleted"}


# ---- Timesheet helpers ----
async def _get_or_create_week(employee_id: str, user: dict, ws: date) -> dict:
    existing = await db.timesheets.find_one({"employee_id": employee_id, "week_start": ws.isoformat()}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        "employee_id": employee_id,
        "user_id": user["id"],
        "employee_name": user["name"],
        "week_start": ws.isoformat(),
        "week_end": (ws + timedelta(days=6)).isoformat(),
        "daily_entries": [],
        "total_hours": 0,
        "notes": "",
        "status": "draft",
        "review_note": "",
        "submitted_at": None,
        "reviewed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.timesheets.insert_one(dict(doc))
    return doc


def _recalc_total(entries: List[dict]) -> float:
    return round(sum(float(e.get("hours", 0)) for e in entries if e.get("type") == "work"), 2)


async def _approved_leave_dates(employee_id: str, week_start: date) -> List[dict]:
    """Return list of {date, leave_type, reason} for approved leaves intersecting weekdays Mon-Fri."""
    week_dates = [d.isoformat() for d in weekday_dates(week_start)]
    leaves = await db.leaves.find({"employee_id": employee_id, "status": "approved"}, {"_id": 0}).to_list(500)
    result = []
    for d in week_dates:
        for lv in leaves:
            if lv["start_date"] <= d <= lv["end_date"]:
                result.append({"date": d, "leave_type": lv["leave_type"], "reason": lv["reason"]})
                break
    return result


# ---- Timesheets (Employee) ----
@api_router.get("/timesheets/status")
async def timesheet_status(user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today)
    last_week = current_week - timedelta(days=7)

    last_ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": last_week.isoformat()}, {"_id": 0})
    current_ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": current_week.isoformat()}, {"_id": 0})

    last_submitted = bool(last_ts and last_ts.get("status") in ("pending", "approved"))
    locked = not last_submitted

    return {
        "today": today.isoformat(),
        "weekday": today.weekday(),
        "current_week_start": current_week.isoformat(),
        "last_week_start": last_week.isoformat(),
        "last_week_status": last_ts.get("status") if last_ts else None,
        "current_week_status": current_ts.get("status") if current_ts else None,
        "locked": locked,
    }


@api_router.get("/timesheets/week")
async def get_week(week_start: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    try:
        ws = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid week_start")
    if ws.weekday() != 0:
        raise HTTPException(status_code=400, detail="week_start must be Monday")

    ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": ws.isoformat()}, {"_id": 0})
    approved_leaves = await _approved_leave_dates(user["employee_id"], ws)
    leave_map = {lv["date"]: lv for lv in approved_leaves}

    days = []
    existing_map = {e["date"]: e for e in (ts.get("daily_entries", []) if ts else [])}
    for i, d in enumerate(weekday_dates(ws)):
        ds = d.isoformat()
        if ds in leave_map:
            days.append({
                "date": ds, "day": DAY_NAMES[i],
                "type": "leave",
                "hours": 0,
                "tasks": f"{leave_map[ds]['leave_type'].title()} leave: {leave_map[ds]['reason']}",
                "from_leave": True,
            })
        elif ds in existing_map:
            e = existing_map[ds]
            days.append({"date": ds, "day": DAY_NAMES[i], "type": e.get("type", "work"), "hours": e.get("hours", 0), "tasks": e.get("tasks", ""), "from_leave": False})
        else:
            days.append({"date": ds, "day": DAY_NAMES[i], "type": "work", "hours": 0, "tasks": "", "from_leave": False})

    return {
        "week_start": ws.isoformat(),
        "week_end": (ws + timedelta(days=6)).isoformat(),
        "status": ts.get("status") if ts else "draft",
        "review_note": ts.get("review_note", "") if ts else "",
        "notes": ts.get("notes", "") if ts else "",
        "days": days,
        "total_hours": _recalc_total([{"hours": d["hours"], "type": d["type"]} for d in days]),
    }


@api_router.post("/timesheets/save-day")
async def save_day(payload: SaveDayRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    try:
        ws = datetime.strptime(payload.week_start, "%Y-%m-%d").date()
        ed = datetime.strptime(payload.entry.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if ws.weekday() != 0:
        raise HTTPException(status_code=400, detail="week_start must be Monday")
    if not (ws <= ed <= ws + timedelta(days=4)):
        raise HTTPException(status_code=400, detail="Date must be within Mon-Fri of week_start")

    today = datetime.now(timezone.utc).date()
    if ws > get_week_start(today):
        raise HTTPException(status_code=400, detail="Cannot edit a future week")

    # Lock check: cannot edit current week if last week not submitted
    current_week = get_week_start(today)
    last_week = current_week - timedelta(days=7)
    if ws == current_week:
        last_ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": last_week.isoformat()})
        if not last_ts or last_ts.get("status") not in ("pending", "approved"):
            raise HTTPException(status_code=423, detail=f"Submit last week's timesheet ({last_week.isoformat()}) first")

    ts = await _get_or_create_week(user["employee_id"], user, ws)
    if ts["status"] in ("pending", "approved"):
        raise HTTPException(status_code=400, detail=f"Week already {ts['status']} — cannot edit")

    # Block editing dates that fall on approved leave (auto-managed)
    approved_leaves = await _approved_leave_dates(user["employee_id"], ws)
    leave_dates = {lv["date"] for lv in approved_leaves}
    if payload.entry.date in leave_dates and payload.entry.type != "leave":
        raise HTTPException(status_code=400, detail="This day is an approved leave; cannot mark as work")

    new_entries = [e for e in ts.get("daily_entries", []) if e["date"] != payload.entry.date]
    new_entries.append({
        "date": payload.entry.date,
        "type": payload.entry.type,
        "hours": float(payload.entry.hours),
        "tasks": (payload.entry.tasks or "").strip(),
    })
    new_entries.sort(key=lambda x: x["date"])
    total = _recalc_total(new_entries)

    await db.timesheets.update_one(
        {"id": ts["id"]},
        {"$set": {
            "daily_entries": new_entries,
            "total_hours": total,
            "status": "draft" if ts["status"] == "rejected" else ts["status"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "total_hours": total}


@api_router.post("/timesheets/submit-week")
async def submit_week(payload: SubmitWeekRequest, user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    try:
        ws = datetime.strptime(payload.week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid week_start")

    ts = await db.timesheets.find_one({"employee_id": user["employee_id"], "week_start": ws.isoformat()})
    if not ts:
        raise HTTPException(status_code=400, detail="Fill at least one day before submitting")
    if ts["status"] in ("pending", "approved"):
        raise HTTPException(status_code=400, detail=f"Already {ts['status']}")

    # Merge approved leaves automatically
    approved_leaves = await _approved_leave_dates(user["employee_id"], ws)
    leave_map = {lv["date"]: lv for lv in approved_leaves}
    entries = {e["date"]: e for e in ts.get("daily_entries", [])}
    for ds, lv in leave_map.items():
        entries[ds] = {"date": ds, "type": "leave", "hours": 0, "tasks": f"{lv['leave_type'].title()} leave: {lv['reason']}"}

    expected = [d.isoformat() for d in weekday_dates(ws)]
    missing = [d for d in expected if d not in entries]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing days: {', '.join(missing)}")

    final_entries = sorted(entries.values(), key=lambda x: x["date"])
    total = _recalc_total(final_entries)

    await db.timesheets.update_one(
        {"id": ts["id"]},
        {"$set": {
            "daily_entries": final_entries,
            "total_hours": total,
            "notes": (payload.notes or "").strip(),
            "status": "pending",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "review_note": "",
        }},
    )
    doc = await db.timesheets.find_one({"id": ts["id"]}, {"_id": 0})
    return doc


@api_router.get("/timesheets/me")
async def my_timesheets(user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    docs = await db.timesheets.find({"employee_id": user["employee_id"]}, {"_id": 0}).sort("week_start", -1).to_list(500)
    return docs


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
    submitted_this_week = await db.timesheets.count_documents({"week_start": current_week, "status": {"$in": ["pending", "approved"]}})
    pending_leaves = await db.leaves.count_documents({"status": "pending"})
    return {
        "total_employees": employees,
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "submitted_this_week": submitted_this_week,
        "missing_this_week": max(0, employees - submitted_this_week),
        "pending_leaves": pending_leaves,
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
    writer.writerow(["Employee ID", "Name", "Week Start", "Date", "Day", "Type", "Hours", "Tasks", "Week Status", "Submitted At", "Review Note"])
    for d in docs:
        for e in d.get("daily_entries", []):
            day_name = DAY_NAMES[(datetime.strptime(e["date"], "%Y-%m-%d").date().weekday())] if datetime.strptime(e["date"], "%Y-%m-%d").date().weekday() < 5 else "-"
            writer.writerow([
                d.get("employee_id", ""), d.get("employee_name", ""),
                d.get("week_start", ""), e.get("date", ""), day_name,
                e.get("type", ""), e.get("hours", 0),
                (e.get("tasks", "") or "").replace("\n", " | "),
                d.get("status", ""), d.get("submitted_at", "") or "",
                (d.get("review_note", "") or "").replace("\n", " | "),
            ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=timesheets_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"},
    )


# ---- Leaves ----
@api_router.post("/leaves", status_code=201)
async def create_leave(payload: LeaveCreate, user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    try:
        sd = datetime.strptime(payload.start_date, "%Y-%m-%d").date()
        ed = datetime.strptime(payload.end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if ed < sd:
        raise HTTPException(status_code=400, detail="end_date must be on/after start_date")
    doc = {
        "id": str(uuid.uuid4()),
        "employee_id": user["employee_id"],
        "employee_name": user["name"],
        "user_id": user["id"],
        "leave_type": payload.leave_type,
        "start_date": sd.isoformat(),
        "end_date": ed.isoformat(),
        "days": (ed - sd).days + 1,
        "reason": payload.reason.strip(),
        "status": "pending",
        "applied_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_at": None,
        "review_note": "",
    }
    await db.leaves.insert_one(dict(doc))
    return doc


@api_router.get("/leaves/me")
async def my_leaves(user: dict = Depends(get_current_user)):
    if user.get("role") != "employee":
        raise HTTPException(status_code=403, detail="Employee only")
    docs = await db.leaves.find({"employee_id": user["employee_id"]}, {"_id": 0}).sort("applied_at", -1).to_list(500)
    return docs


@api_router.delete("/leaves/{leave_id}")
async def cancel_leave(leave_id: str, user: dict = Depends(get_current_user)):
    lv = await db.leaves.find_one({"id": leave_id})
    if not lv:
        raise HTTPException(status_code=404, detail="Leave not found")
    if user.get("role") != "admin" and lv["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if lv["status"] != "pending" and user.get("role") != "admin":
        raise HTTPException(status_code=400, detail="Only pending leaves can be cancelled")
    await db.leaves.delete_one({"id": leave_id})
    return {"message": "Leave cancelled"}


@api_router.get("/admin/leaves")
async def admin_list_leaves(status_filter: Optional[str] = None, employee_id: Optional[str] = None, _: dict = Depends(require_admin)):
    q = {}
    if status_filter and status_filter != "all":
        q["status"] = status_filter
    if employee_id:
        q["employee_id"] = employee_id.upper()
    docs = await db.leaves.find(q, {"_id": 0}).sort("applied_at", -1).to_list(2000)
    return docs


@api_router.post("/admin/leaves/{leave_id}/review")
async def review_leave(leave_id: str, payload: LeaveReview, admin: dict = Depends(require_admin)):
    lv = await db.leaves.find_one({"id": leave_id})
    if not lv:
        raise HTTPException(status_code=404, detail="Leave not found")
    if lv["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Already {lv['status']}")
    new_status = "approved" if payload.action == "approve" else "rejected"
    await db.leaves.update_one(
        {"id": leave_id},
        {"$set": {
            "status": new_status,
            "review_note": payload.review_note or "",
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_by": admin["email"],
        }},
    )
    return await db.leaves.find_one({"id": leave_id}, {"_id": 0})


# ---- Email Reminders ----
def _email_html(name: str, missing_dates: List[str], emp_id: str) -> str:
    items = "".join(f"<li><b>{d}</b> ({datetime.strptime(d, '%Y-%m-%d').strftime('%A')})</li>" for d in missing_dates)
    link = f"{FRONTEND_URL}/employee?missing={','.join(missing_dates)}"
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #D1D1D1;">
      <tr><td style="background:#0033CC; color:#fff; padding:24px; font-size:18px; font-weight:bold;">Timesheet Reminder</td></tr>
      <tr><td style="padding:24px; color:#1A1A1A;">
        <p>Hi {name},</p>
        <p>You haven't logged hours for the following day(s):</p>
        <ul style="line-height:1.7;">{items}</ul>
        <p style="margin-top:24px;">
          <a href="{link}" style="display:inline-block;background:#0033CC;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;">Open my timesheet →</a>
        </p>
        <p style="color:#5C5C5C;font-size:12px;margin-top:24px;">Employee ID: {emp_id}</p>
      </td></tr>
    </table>
    """


async def _send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_API_KEY or RESEND_API_KEY.startswith("re_placeholder"):
        logger.warning(f"[email skipped] {to_email} — RESEND_API_KEY not configured")
        return False
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": SENDER_EMAIL, "to": [to_email], "subject": subject, "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"Email failed for {to_email}: {e}")
        return False


async def _missing_days_for_employee(emp: dict, week_start: date, up_to: date) -> List[str]:
    """Return list of weekday dates missing in current week up to and including `up_to`, excluding approved-leave dates."""
    ts = await db.timesheets.find_one({"employee_id": emp["employee_id"], "week_start": week_start.isoformat()})
    filled = {e["date"] for e in (ts.get("daily_entries", []) if ts else [])}
    leave_dates = {lv["date"] for lv in await _approved_leave_dates(emp["employee_id"], week_start)}
    missing = []
    for d in weekday_dates(week_start):
        if d > up_to:
            break
        if d.isoformat() in filled or d.isoformat() in leave_dates:
            continue
        missing.append(d.isoformat())
    return missing


async def send_daily_reminders():
    today = datetime.now(timezone.utc).date()
    if today.weekday() > 4:
        logger.info(f"[daily reminder] {today} is weekend, skipping")
        return {"sent": 0, "missing_employees": 0, "reason": "weekend"}
    current_week = get_week_start(today)
    employees = await db.users.find({"role": "employee", "active": True}).to_list(1000)
    sent = 0
    targeted = 0
    for emp in employees:
        missing = await _missing_days_for_employee(emp, current_week, today)
        if not missing:
            continue
        targeted += 1
        html = _email_html(emp["name"], missing, emp["employee_id"])
        ok = await _send_email(emp["email"], f"Timesheet missing — {len(missing)} day(s)", html)
        if ok:
            sent += 1
    logger.info(f"[daily reminder] {today} — targeted={targeted}, sent={sent}")
    return {"sent": sent, "missing_employees": targeted, "date": today.isoformat()}


async def send_friday_reminders():
    today = datetime.now(timezone.utc).date()
    current_week = get_week_start(today)
    friday = current_week + timedelta(days=4)
    employees = await db.users.find({"role": "employee", "active": True}).to_list(1000)
    submitted = set([t["employee_id"] for t in await db.timesheets.find(
        {"week_start": current_week.isoformat(), "status": {"$in": ["pending", "approved"]}}, {"employee_id": 1, "_id": 0}
    ).to_list(1000)])
    sent = 0
    targeted = 0
    for emp in employees:
        if emp["employee_id"] in submitted:
            continue
        targeted += 1
        missing = await _missing_days_for_employee(emp, current_week, friday)
        html = _email_html(emp["name"], missing or [friday.isoformat()], emp["employee_id"])
        ok = await _send_email(emp["email"], f"Friday reminder — submit week of {current_week.isoformat()}", html)
        if ok:
            sent += 1
    logger.info(f"[friday reminder] {today} — targeted={targeted}, sent={sent}")
    return {"sent": sent, "missing_employees": targeted, "date": today.isoformat()}


@api_router.post("/admin/send-daily-reminders")
async def trigger_daily(_: dict = Depends(require_admin)):
    return await send_daily_reminders()


@api_router.post("/admin/send-friday-reminders")
async def trigger_friday(_: dict = Depends(require_admin)):
    return await send_friday_reminders()


# ---- Startup ----
async def seed_admin():
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL, "name": "Admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin", "active": True, "employee_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {ADMIN_EMAIL}")
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}})


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("employee_id", unique=True, sparse=True)
    await db.timesheets.create_index([("employee_id", 1), ("week_start", 1)])
    await db.leaves.create_index([("employee_id", 1), ("start_date", 1)])
    await seed_admin()
    # Daily reminder Mon-Fri at 18:00 UTC
    scheduler.add_job(send_daily_reminders, CronTrigger(day_of_week="mon-fri", hour=18, minute=0))
    # Friday reminder at 09:00 UTC
    scheduler.add_job(send_friday_reminders, CronTrigger(day_of_week="fri", hour=9, minute=0))
    scheduler.start()
    logger.info("Scheduler started — daily Mon-Fri 18:00 UTC + Friday 09:00 UTC")


@app.on_event("shutdown")
async def on_shutdown():
    scheduler.shutdown(wait=False)
    client.close()


@api_router.get("/")
async def root():
    return {"message": "Timesheet API", "version": "2.0"}


# ---- Mount ----
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
