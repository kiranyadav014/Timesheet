"""Backend API tests for Timesheet app."""
import os, uuid, requests, pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://employee-hours-23.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@timesheet.com"
ADMIN_PASSWORD = "admin123"

EMP_ID = f"TEST{uuid.uuid4().hex[:4].upper()}"
EMP_EMAIL = f"test_{uuid.uuid4().hex[:6]}@timesheet.com"
EMP_PASS = "emp123"

state = {}

def _hdr(token): return {"Authorization": f"Bearer {token}"}

# ---- Auth ----
def test_admin_login():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "token" in d and d["user"]["role"] == "admin"
    state["admin_token"] = d["token"]

def test_auth_me_admin():
    r = requests.get(f"{API}/auth/me", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL

def test_login_invalid():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
    assert r.status_code == 401

# ---- Employees CRUD ----
def test_create_employee():
    r = requests.post(f"{API}/employees", headers=_hdr(state["admin_token"]),
        json={"employee_id": EMP_ID, "name": "Test Emp", "email": EMP_EMAIL, "password": EMP_PASS,
              "department": "Eng", "position": "Dev"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["employee_id"] == EMP_ID and d["email"] == EMP_EMAIL

def test_create_employee_duplicate_id():
    r = requests.post(f"{API}/employees", headers=_hdr(state["admin_token"]),
        json={"employee_id": EMP_ID, "name": "X", "email": f"x_{uuid.uuid4().hex[:6]}@a.com", "password": "pw1234"})
    assert r.status_code == 400

def test_create_employee_duplicate_email():
    r = requests.post(f"{API}/employees", headers=_hdr(state["admin_token"]),
        json={"employee_id": f"DUP{uuid.uuid4().hex[:4].upper()}", "name": "X", "email": EMP_EMAIL, "password": "pw1234"})
    assert r.status_code == 400

def test_list_employees_admin():
    r = requests.get(f"{API}/employees", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    assert any(e["employee_id"] == EMP_ID for e in r.json())

def test_employee_login():
    r = requests.post(f"{API}/auth/login", json={"email": EMP_EMAIL, "password": EMP_PASS})
    assert r.status_code == 200
    state["emp_token"] = r.json()["token"]

def test_list_employees_forbidden_for_employee():
    r = requests.get(f"{API}/employees", headers=_hdr(state["emp_token"]))
    assert r.status_code == 403

def test_patch_employee():
    r = requests.patch(f"{API}/employees/{EMP_ID}", headers=_hdr(state["admin_token"]),
        json={"department": "QA"})
    assert r.status_code == 200
    assert r.json()["department"] == "QA"

# ---- Timesheets ----
def test_status_locked_initially():
    r = requests.get(f"{API}/timesheets/status", headers=_hdr(state["emp_token"]))
    assert r.status_code == 200
    d = r.json()
    state["current_week"] = d["current_week_start"]
    state["last_week"] = d["last_week_start"]
    assert d["locked"] is True
    assert d["last_week_submitted"] is False

def test_submit_current_week_blocked_when_locked():
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": state["current_week"], "total_hours": 40, "tasks": "stuff"})
    assert r.status_code == 423, r.text

def test_submit_invalid_week_not_monday():
    # current_week is Monday; +1 day => Tuesday, should fail
    from datetime import date, timedelta
    cw = date.fromisoformat(state["current_week"])
    tue = (cw + timedelta(days=1)).isoformat()
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": tue, "total_hours": 10, "tasks": "x"})
    assert r.status_code == 400

def test_submit_future_week_blocked():
    from datetime import date, timedelta
    cw = date.fromisoformat(state["current_week"])
    fut = (cw + timedelta(days=7)).isoformat()
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": fut, "total_hours": 10, "tasks": "x"})
    assert r.status_code == 400

def test_submit_last_week():
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": state["last_week"], "total_hours": 40, "tasks": "Worked on backend",
              "notes": "ok"})
    assert r.status_code == 201, r.text
    state["last_ts_id"] = r.json()["id"]

def test_resubmit_pending_blocked():
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": state["last_week"], "total_hours": 30, "tasks": "again"})
    assert r.status_code == 400

def test_status_after_last_week_submitted():
    r = requests.get(f"{API}/timesheets/status", headers=_hdr(state["emp_token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["last_week_submitted"] is True
    assert d["locked"] is False

def test_submit_current_week_now_ok():
    r = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": state["current_week"], "total_hours": 35, "tasks": "current week tasks"})
    assert r.status_code == 201, r.text
    state["current_ts_id"] = r.json()["id"]

def test_my_timesheets():
    r = requests.get(f"{API}/timesheets/me", headers=_hdr(state["emp_token"]))
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 2
    # sorted desc by week_start
    assert arr[0]["week_start"] >= arr[-1]["week_start"]

# ---- Admin review ----
def test_admin_list_timesheets_filter():
    r = requests.get(f"{API}/admin/timesheets", headers=_hdr(state["admin_token"]),
        params={"employee_id": EMP_ID, "status_filter": "pending"})
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 2
    assert all(t["status"] == "pending" for t in arr)

def test_review_approve():
    r = requests.post(f"{API}/admin/timesheets/{state['last_ts_id']}/review",
        headers=_hdr(state["admin_token"]), json={"action": "approve", "review_note": "ok"})
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

def test_review_reject_then_resubmit():
    r = requests.post(f"{API}/admin/timesheets/{state['current_ts_id']}/review",
        headers=_hdr(state["admin_token"]), json={"action": "reject", "review_note": "redo"})
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    # Resubmit allowed
    r2 = requests.post(f"{API}/timesheets/submit", headers=_hdr(state["emp_token"]),
        json={"week_start": state["current_week"], "total_hours": 38, "tasks": "redone"})
    assert r2.status_code == 201, r2.text

def test_review_already_reviewed():
    r = requests.post(f"{API}/admin/timesheets/{state['last_ts_id']}/review",
        headers=_hdr(state["admin_token"]), json={"action": "approve"})
    assert r.status_code == 400

# ---- Reports ----
def test_summary_report():
    r = requests.get(f"{API}/admin/reports/summary", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    d = r.json()
    for k in ("total_employees","pending","approved","rejected","submitted_this_week","missing_this_week"):
        assert k in d

def test_csv_export():
    r = requests.get(f"{API}/admin/reports/csv", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type","")
    assert "attachment" in r.headers.get("content-disposition","").lower()
    assert "Employee ID" in r.text.splitlines()[0]

def test_send_reminders_placeholder():
    r = requests.post(f"{API}/admin/send-reminders-now", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    d = r.json()
    assert d.get("sent") == 0
    assert d.get("reason") == "no_api_key"

# ---- Cleanup ----
def test_delete_employee():
    r = requests.delete(f"{API}/employees/{EMP_ID}", headers=_hdr(state["admin_token"]))
    assert r.status_code == 200
    # Verify timesheets gone
    r2 = requests.get(f"{API}/admin/timesheets", headers=_hdr(state["admin_token"]),
        params={"employee_id": EMP_ID})
    assert r2.status_code == 200
    assert len(r2.json()) == 0
