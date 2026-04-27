import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { FloppyDisk } from "@phosphor-icons/react";

export default function DaysGrid({ days, editable, missingDates, onChange, onSave, dayRefsRef }) {
  return (
    <div className="surface overflow-hidden" data-testid="days-grid">
      <table className="w-full text-sm">
        <thead className="bg-canvas border-b border-line2">
          <tr className="text-left text-ink2 uppercase tracking-wider text-xs">
            <th className="px-4 py-3 w-[110px]">Day</th>
            <th className="px-4 py-3 w-[120px]">Type</th>
            <th className="px-4 py-3 w-[110px]">Hours</th>
            <th className="px-4 py-3">Tasks / Notes</th>
            <th className="px-4 py-3 w-[120px] text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <DayRow
              key={d.date}
              d={d}
              editable={editable}
              isMissing={missingDates.includes(d.date)}
              onChange={onChange}
              onSave={onSave}
              setRef={(el) => { if (dayRefsRef) dayRefsRef.current[d.date] = el; }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayRow({ d, editable, isMissing, onChange, onSave, setRef }) {
  const rowCls = `border-b border-line ${isMissing ? "bg-warn-bg/50" : ""}`;
  return (
    <tr className={rowCls} ref={setRef} data-testid={`day-row-${d.date}`}>
      <td className="px-4 py-3 align-top">
        <div className="font-heading font-bold">{d.day}</div>
        <div className="text-xs text-ink2 font-mono">{d.date}</div>
      </td>
      <td className="px-4 py-3 align-top">
        {d.from_leave ? (
          <span className="tag tag-approved" data-testid={`leave-tag-${d.date}`}>Leave</span>
        ) : (
          <select
            disabled={!editable}
            value={d.type}
            onChange={(e) => onChange(d.date, { type: e.target.value, hours: e.target.value === "work" ? d.hours : 0 })}
            className="h-9 px-2 bg-white border border-line2 rounded-sm text-sm focus:ring-1 focus:ring-brand"
            data-testid={`day-type-${d.date}`}
          >
            <option value="work">Work</option>
            <option value="leave">Leave</option>
            <option value="holiday">Holiday</option>
          </select>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <Input
          type="number" step="0.5" min="0" max="24"
          disabled={!editable || d.from_leave || d.type !== "work"}
          value={d.hours}
          onChange={(e) => onChange(d.date, { hours: e.target.value })}
          className="h-9 rounded-sm font-mono w-20"
          data-testid={`day-hours-${d.date}`}
        />
      </td>
      <td className="px-4 py-3 align-top">
        <Textarea
          rows={2}
          disabled={!editable || d.from_leave}
          value={d.tasks}
          onChange={(e) => onChange(d.date, { tasks: e.target.value })}
          placeholder={d.from_leave ? "" : "What did you work on?"}
          className="rounded-sm text-sm"
          data-testid={`day-tasks-${d.date}`}
        />
      </td>
      <td className="px-4 py-3 align-top text-right">
        {!d.from_leave && editable && (
          <Button size="sm" variant="outline" className="rounded-sm border-line2" onClick={() => onSave(d)} data-testid={`save-day-${d.date}`}>
            <FloppyDisk size={14} className="mr-1" /> Save
          </Button>
        )}
        {d.from_leave && <span className="text-xs text-ink2">Auto</span>}
      </td>
    </tr>
  );
}
