import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { api, formatApiErrorDetail } from "../lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* non-fatal */ }
    setUser(false);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
