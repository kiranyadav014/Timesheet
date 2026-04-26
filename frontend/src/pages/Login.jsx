import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { ArrowRight, LockKey, Clock } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && user.role) nav(user.role === "admin" ? "/admin" : "/employee", { replace: true });
  }, [user, nav]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await login(email.trim().toLowerCase(), password);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error || "Login failed");
      return;
    }
    toast.success(`Welcome, ${res.user.name}`);
    nav(res.user.role === "admin" ? "/admin" : "/employee", { replace: true });
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-canvas">
      {/* Form side */}
      <div className="flex flex-col p-8 lg:p-16">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-ink text-white grid place-items-center">
            <Clock size={20} weight="bold" />
          </div>
          <div className="font-heading font-black text-xl tracking-tight">TIMESHEET<span className="text-brand">.</span></div>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto lg:mx-0">
          <div className="overline mb-3" data-testid="login-overline">Secure Sign In</div>
          <h1 className="font-heading font-black text-4xl sm:text-5xl tracking-tighter text-ink leading-[0.95]">
            Log your<br/>weekly hours.
          </h1>
          <p className="text-sm text-ink2 mt-4 mb-10 max-w-sm">
            Submit weekly timesheets every Friday. Admins approve and report.
          </p>

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <Label className="overline" htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="mt-2 rounded-sm h-11 border-line2 bg-white"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <Label className="overline" htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="mt-2 rounded-sm h-11 border-line2 bg-white"
                data-testid="login-password-input"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-sm btn-primary text-white font-medium"
              data-testid="login-submit-button"
            >
              {submitting ? "Signing in…" : "Sign in"}
              <ArrowRight size={18} weight="bold" className="ml-2" />
            </Button>
          </form>

          <div className="mt-10 pt-6 border-t border-line text-xs text-ink2 flex items-center gap-2">
            <LockKey size={14} /> Admin uses default seed creds. Employees are created by admin.
          </div>
        </div>

        <div className="text-xs text-ink2 mt-8">© {new Date().getFullYear()} Timesheet System</div>
      </div>

      {/* Image side */}
      <div className="hidden lg:block relative overflow-hidden bg-ink">
        <img
          src="https://images.unsplash.com/photo-1774229011996-c25c41fc0493?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-black/10 to-transparent" />
        <div className="relative z-10 h-full flex flex-col justify-end p-12 text-white">
          <div className="overline text-white/70 mb-4">Operations · Weekly</div>
          <div className="font-heading font-black text-3xl tracking-tighter max-w-md leading-tight">
            One source of truth for every hour worked across your team.
          </div>
        </div>
      </div>
    </div>
  );
}
