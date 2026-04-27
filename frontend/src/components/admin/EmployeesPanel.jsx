import { useState } from "react";
import { api, formatApiErrorDetail } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../ui/dialog";
import { toast } from "sonner";
import { Plus, Trash } from "@phosphor-icons/react";

const EMPTY_FORM = { employee_id: "", name: "", email: "", password: "", department: "", position: "" };

export default function EmployeesPanel({ employees, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/employees", form);
      toast.success(`Created ${form.employee_id}`);
      setOpen(false);
      setForm(EMPTY_FORM);
      onChanged();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  const remove = async (emp_id) => {
    if (!window.confirm(`Delete ${emp_id}? This also deletes all their timesheets and leaves.`)) return;
    try {
      await api.delete(`/employees/${emp_id}`);
      toast.success("Employee deleted");
      onChanged();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  return (
    <div className="surface" data-testid="employees-panel">
      <div className="p-4 flex items-center justify-between border-b border-line2">
        <div>
          <div className="overline">Roster</div>
          <div className="font-heading font-bold text-xl tracking-tight">{employees.length} employees</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-sm btn-primary text-white" data-testid="add-employee-button">
              <Plus size={16} className="mr-2" /> Add employee
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm max-w-lg bg-white text-ink" data-testid="add-employee-dialog">
            <DialogHeader><DialogTitle className="font-heading">New employee</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Employee ID"  testid="emp-id-input" value={form.employee_id} onChange={(v) => setForm({ ...form, employee_id: v.toUpperCase() })} required mono placeholder="EMP001" />
                <Field label="Full name"    testid="emp-name-input" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
                <Field label="Email"        testid="emp-email-input" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
                <Field label="Initial password" testid="emp-password-input" value={form.password} onChange={(v) => setForm({ ...form, password: v })} required mono />
                <Field label="Department"   testid="emp-department-input" value={form.department} onChange={(v) => setForm({ ...form, department: v })} />
                <Field label="Position"     testid="emp-position-input" value={form.position} onChange={(v) => setForm({ ...form, position: v })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-sm btn-primary text-white" data-testid="create-employee-submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink2 uppercase tracking-wider text-xs border-b border-line2 bg-canvas">
            <tr>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-ink2">No employees yet. Add one to get started.</td></tr>
            )}
            {employees.map((e) => (
              <tr key={e.id} className="row-zebra border-b border-line" data-testid={`emp-row-${e.employee_id}`}>
                <td className="px-4 py-3 font-mono font-semibold">{e.employee_id}</td>
                <td className="px-4 py-3">{e.name}</td>
                <td className="px-4 py-3 text-ink2">{e.email}</td>
                <td className="px-4 py-3">{e.department || "—"}</td>
                <td className="px-4 py-3">{e.position || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg"
                    onClick={() => remove(e.employee_id)} data-testid={`delete-emp-${e.employee_id}`}>
                    <Trash size={14} className="mr-1" /> Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, testid, value, onChange, required = false, type = "text", mono = false, placeholder = "" }) {
  return (
    <div>
      <Label className="overline">{label}</Label>
      <Input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 rounded-sm ${mono ? "font-mono" : ""}`}
        data-testid={testid}
      />
    </div>
  );
}
