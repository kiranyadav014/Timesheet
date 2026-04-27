import { Warning, CheckCircle, LockKey, Info } from "@phosphor-icons/react";

const Banner = ({ tone = "warn", icon: Icon, title, children, testid }) => {
  const isOk = tone === "ok";
  const cls = isOk ? "bg-ok-bg border-ok" : "bg-warn-bg border-warn";
  const titleCls = isOk ? "text-ok" : "text-warn";
  return (
    <div className={`mt-8 ${cls} border-l-4 p-4 flex items-start gap-3`} data-testid={testid}>
      <Icon size={20} className={`${titleCls} mt-0.5`} weight={isOk ? "fill" : "bold"} />
      <div>
        <div className={`font-semibold ${titleCls}`}>{title}</div>
        {children && <div className="text-sm text-ink mt-1">{children}</div>}
      </div>
    </div>
  );
};

export default function StatusBanners({ status, week, missingFromUrl }) {
  return (
    <>
      {status.locked && (
        <Banner tone="warn" icon={LockKey} title="Last week pending" testid="lock-banner">
          Submit week <b>{status.last_week_start}</b> first to unlock the current week.
        </Banner>
      )}
      {missingFromUrl.length > 0 && (
        <Banner tone="warn" icon={Info} title="From your reminder email" testid="missing-link-banner">
          You're missing entries for: <b>{missingFromUrl.join(", ")}</b>. They are highlighted below.
        </Banner>
      )}
      {!status.locked && status.weekday >= 4 && week.status === "draft" && (
        <Banner tone="warn" icon={Warning} title="It's Friday — wrap up your timesheet" testid="friday-banner">
          Fill remaining days and click <b>Submit for review</b>.
        </Banner>
      )}
      {week.status === "pending" && (
        <Banner tone="ok" icon={CheckCircle} title="Submitted" testid="pending-banner">
          Awaiting admin approval.
        </Banner>
      )}
      {week.status === "approved" && (
        <Banner tone="ok" icon={CheckCircle} title="Week approved ✓" testid="approved-banner" />
      )}
      {week.status === "rejected" && (
        <Banner tone="warn" icon={Warning} title="Rejected — please revise and resubmit" testid="rejected-banner">
          {week.review_note && <><b>Reviewer note:</b> {week.review_note}</>}
        </Banner>
      )}
    </>
  );
}
