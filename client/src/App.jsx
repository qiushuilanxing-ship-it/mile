import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DouyinAuditPage from "./DouyinAuditPage.jsx";
import EnginePage from "./EnginePage.jsx";
import HomePage from "./HomePage.jsx";

export default function App() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        setUser(response.ok ? payload?.user ?? null : null);
      })
      .catch(() => setUser(null))
      .finally(() => setIsCheckingAuth(false));
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    setUser(null);
  }

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  if (isCheckingAuth) {
    return (
      <main className="app-shell auth-loading">
        <div className="spinner" />
        <strong>正在进入 AI 内容引擎...</strong>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={setUser} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    );
  }

  return (
    <main className="app-shell authenticated-shell">
      <button
        className={`sidebar-overlay ${isSidebarOpen ? "visible" : ""}`}
        type="button"
        aria-label="关闭导航"
        onClick={() => setIsSidebarOpen(false)}
      />
      <Sidebar
        user={user}
        isOpen={isSidebarOpen}
        onLogout={logout}
      />
      <section className="app-main">
        <Header
          user={user}
          onLogout={logout}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />
        <div className="app-route-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tools/:toolId" element={<EnginePage />} />
            <Route path="/audit/douyin" element={<DouyinAuditPage user={user} />} />
            <Route
              path="/engine"
              element={<Navigate to="/tools/video_reverse" replace />}
            />
            <Route path="/dashboard" element={<PersonalDashboard />} />
            <Route path="/history" element={<HistoryPage user={user} />} />
            <Route
              path="/admin/dashboard"
              element={
                user.role === "admin" ? (
                  <AdminDashboard />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/admin"
              element={<Navigate to="/admin/dashboard" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </section>
    </main>
  );
}

function Pupil({
  size = 12,
  maxDistance = 5,
  pupilColor = "#2d2d2d",
  forceLookX,
  forceLookY,
}) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const pupilRef = useRef(null);

  useEffect(() => {
    function handleMouseMove(event) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  function getPosition() {
    if (!pupilRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const rect = pupilRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = mousePosition.x - centerX;
    const deltaY = mousePosition.y - centerY;
    const distance = Math.min(Math.hypot(deltaX, deltaY), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);

    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    };
  }

  const position = getPosition();

  return (
    <span
      ref={pupilRef}
      className="login-character-pupil"
      style={{
        width: size,
        height: size,
        backgroundColor: pupilColor,
        transform: `translate(${position.x}px, ${position.y}px)`,
      }}
    />
  );
}

function EyeBall({
  size = 48,
  pupilSize = 16,
  maxDistance = 10,
  eyeColor = "#fff",
  pupilColor = "#2d2d2d",
  isBlinking = false,
  forceLookX,
  forceLookY,
}) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const eyeRef = useRef(null);

  useEffect(() => {
    function handleMouseMove(event) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  function getPosition() {
    if (!eyeRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) {
      return { x: forceLookX, y: forceLookY };
    }

    const rect = eyeRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = mousePosition.x - centerX;
    const deltaY = mousePosition.y - centerY;
    const distance = Math.min(Math.hypot(deltaX, deltaY), maxDistance);
    const angle = Math.atan2(deltaY, deltaX);

    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    };
  }

  const position = getPosition();

  return (
    <span
      ref={eyeRef}
      className="login-character-eye"
      style={{
        width: size,
        height: isBlinking ? 2 : size,
        backgroundColor: eyeColor,
      }}
    >
      {!isBlinking && (
        <span
          className="login-character-pupil"
          style={{
            width: pupilSize,
            height: pupilSize,
            backgroundColor: pupilColor,
            transform: `translate(${position.x}px, ${position.y}px)`,
          }}
        />
      )}
    </span>
  );
}

function LoginPage({ onLogin }) {
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  const purpleRef = useRef(null);
  const blackRef = useRef(null);
  const yellowRef = useRef(null);
  const orangeRef = useRef(null);

  useEffect(() => {
    function handleMouseMove(event) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    let blinkTimeout;
    function scheduleBlink() {
      blinkTimeout = window.setTimeout(
        () => {
          setIsPurpleBlinking(true);
          window.setTimeout(() => {
            setIsPurpleBlinking(false);
            scheduleBlink();
          }, 150);
        },
        Math.random() * 4000 + 3000,
      );
    }

    scheduleBlink();
    return () => window.clearTimeout(blinkTimeout);
  }, []);

  useEffect(() => {
    let blinkTimeout;
    function scheduleBlink() {
      blinkTimeout = window.setTimeout(
        () => {
          setIsBlackBlinking(true);
          window.setTimeout(() => {
            setIsBlackBlinking(false);
            scheduleBlink();
          }, 150);
        },
        Math.random() * 4000 + 3000,
      );
    }

    scheduleBlink();
    return () => window.clearTimeout(blinkTimeout);
  }, []);

  useEffect(() => {
    if (!isTyping) {
      setIsLookingAtEachOther(false);
      return undefined;
    }

    setIsLookingAtEachOther(true);
    const timer = window.setTimeout(() => setIsLookingAtEachOther(false), 800);
    return () => window.clearTimeout(timer);
  }, [isTyping]);

  useEffect(() => {
    if (!password || !showPassword) {
      setIsPurplePeeking(false);
      return undefined;
    }

    const timer = window.setTimeout(
      () => {
        setIsPurplePeeking(true);
        window.setTimeout(() => setIsPurplePeeking(false), 800);
      },
      Math.random() * 3000 + 2000,
    );

    return () => window.clearTimeout(timer);
  }, [password, showPassword, isPurplePeeking]);

  function calculatePosition(ref) {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };

    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 3;
    const deltaX = mousePosition.x - centerX;
    const deltaY = mousePosition.y - centerY;

    return {
      faceX: Math.max(-15, Math.min(15, deltaX / 20)),
      faceY: Math.max(-10, Math.min(10, deltaY / 30)),
      bodySkew: Math.max(-6, Math.min(6, -deltaX / 120)),
    };
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError("请输入用户名");
      return;
    }

    if (!password) {
      setError("请输入密码");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUsername, password }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.user) {
        throw new Error(payload?.message || "登录失败，请检查账号和密码。");
      }

      onLogin(payload.user);
    } catch (requestError) {
      setError(requestError.message || "登录失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }

  const purplePos = calculatePosition(purpleRef);
  const blackPos = calculatePosition(blackRef);
  const yellowPos = calculatePosition(yellowRef);
  const orangePos = calculatePosition(orangeRef);
  const isPasswordVisible = password.length > 0 && showPassword;
  const isPasswordHidden = password.length > 0 && !showPassword;
  const canSubmit = username.trim().length > 0 && password.length > 0;

  return (
    <div className="login-v2-page">
      <section className="login-v2-showcase" aria-label="AI 内容引擎介绍">
        <div className="login-v2-brand">
          <span className="brand-mark">AI</span>
          <strong>AI 内容引擎</strong>
        </div>

        <div className="login-character-stage" aria-hidden="true">
          <div
            ref={purpleRef}
            className="login-character purple"
            style={{
              height: isTyping || isPasswordHidden ? 440 : 400,
              transform: isPasswordVisible
                ? "skewX(0deg)"
                : isTyping || isPasswordHidden
                  ? `skewX(${purplePos.bodySkew - 12}deg) translateX(40px)`
                  : `skewX(${purplePos.bodySkew}deg)`,
            }}
          >
            <span
              className="login-character-eyes purple-eyes"
              style={{
                left: isPasswordVisible
                  ? 20
                  : isLookingAtEachOther
                    ? 55
                    : 45 + purplePos.faceX,
                top: isPasswordVisible
                  ? 35
                  : isLookingAtEachOther
                    ? 65
                    : 40 + purplePos.faceY,
              }}
            >
              <EyeBall
                size={18}
                pupilSize={7}
                maxDistance={5}
                isBlinking={isPurpleBlinking}
                forceLookX={
                  isPasswordVisible
                    ? isPurplePeeking
                      ? 4
                      : -4
                    : isLookingAtEachOther
                      ? 3
                      : undefined
                }
                forceLookY={
                  isPasswordVisible
                    ? isPurplePeeking
                      ? 5
                      : -4
                    : isLookingAtEachOther
                      ? 4
                      : undefined
                }
              />
              <EyeBall
                size={18}
                pupilSize={7}
                maxDistance={5}
                isBlinking={isPurpleBlinking}
                forceLookX={
                  isPasswordVisible
                    ? isPurplePeeking
                      ? 4
                      : -4
                    : isLookingAtEachOther
                      ? 3
                      : undefined
                }
                forceLookY={
                  isPasswordVisible
                    ? isPurplePeeking
                      ? 5
                      : -4
                    : isLookingAtEachOther
                      ? 4
                      : undefined
                }
              />
            </span>
          </div>

          <div
            ref={blackRef}
            className="login-character black"
            style={{
              transform: isPasswordVisible
                ? "skewX(0deg)"
                : isLookingAtEachOther
                  ? `skewX(${blackPos.bodySkew * 1.5 + 10}deg) translateX(20px)`
                  : isTyping || isPasswordHidden
                    ? `skewX(${blackPos.bodySkew * 1.5}deg)`
                    : `skewX(${blackPos.bodySkew}deg)`,
            }}
          >
            <span
              className="login-character-eyes black-eyes"
              style={{
                left: isPasswordVisible
                  ? 10
                  : isLookingAtEachOther
                    ? 32
                    : 26 + blackPos.faceX,
                top: isPasswordVisible
                  ? 28
                  : isLookingAtEachOther
                    ? 12
                    : 32 + blackPos.faceY,
              }}
            >
              <EyeBall
                size={16}
                pupilSize={6}
                maxDistance={4}
                isBlinking={isBlackBlinking}
                forceLookX={
                  isPasswordVisible ? -4 : isLookingAtEachOther ? 0 : undefined
                }
                forceLookY={
                  isPasswordVisible ? -4 : isLookingAtEachOther ? -4 : undefined
                }
              />
              <EyeBall
                size={16}
                pupilSize={6}
                maxDistance={4}
                isBlinking={isBlackBlinking}
                forceLookX={
                  isPasswordVisible ? -4 : isLookingAtEachOther ? 0 : undefined
                }
                forceLookY={
                  isPasswordVisible ? -4 : isLookingAtEachOther ? -4 : undefined
                }
              />
            </span>
          </div>

          <div
            ref={orangeRef}
            className="login-character orange"
            style={{
              transform: isPasswordVisible
                ? "skewX(0deg)"
                : `skewX(${orangePos.bodySkew}deg)`,
            }}
          >
            <span
              className="login-character-eyes orange-eyes"
              style={{
                left: isPasswordVisible ? 50 : 82 + orangePos.faceX,
                top: isPasswordVisible ? 85 : 90 + orangePos.faceY,
              }}
            >
              <Pupil
                size={12}
                forceLookX={isPasswordVisible ? -5 : undefined}
                forceLookY={isPasswordVisible ? -4 : undefined}
              />
              <Pupil
                size={12}
                forceLookX={isPasswordVisible ? -5 : undefined}
                forceLookY={isPasswordVisible ? -4 : undefined}
              />
            </span>
          </div>

          <div
            ref={yellowRef}
            className="login-character yellow"
            style={{
              transform: isPasswordVisible
                ? "skewX(0deg)"
                : `skewX(${yellowPos.bodySkew}deg)`,
            }}
          >
            <span
              className="login-character-eyes yellow-eyes"
              style={{
                left: isPasswordVisible ? 20 : 52 + yellowPos.faceX,
                top: isPasswordVisible ? 35 : 40 + yellowPos.faceY,
              }}
            >
              <Pupil
                size={12}
                forceLookX={isPasswordVisible ? -5 : undefined}
                forceLookY={isPasswordVisible ? -4 : undefined}
              />
              <Pupil
                size={12}
                forceLookX={isPasswordVisible ? -5 : undefined}
                forceLookY={isPasswordVisible ? -4 : undefined}
              />
            </span>
            <span
              className="yellow-mouth"
              style={{
                left: isPasswordVisible ? 10 : 40 + yellowPos.faceX,
                top: isPasswordVisible ? 88 : 88 + yellowPos.faceY,
              }}
            />
          </div>
        </div>

        <div className="login-v2-copy">
          <span className="eyebrow">INPUT TO GENERATION</span>
          <h1>欢迎回来</h1>
          <p>上传参考视频与素材，让 AI 自动反推可复用的视频提示词。</p>
        </div>
      </section>

      <section className="login-v2-panel">
        <div className="login-v2-mobile-brand">
          <span className="brand-mark">AI</span>
          <strong>AI 内容引擎</strong>
        </div>

        <form
          className="login-v2-card"
          onSubmit={handleLogin}
          autoComplete="off"
        >
          <div className="login-v2-heading">
            <span className="card-kicker">INTERNAL LOGIN</span>
            <h2>登录内容引擎</h2>
            <p>请输入你的内部账号信息</p>
          </div>

          <label className="login-v2-field">
            <span>用户名</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onFocus={() => setIsTyping(true)}
              onBlur={() => setIsTyping(false)}
              disabled={isLoading}
              required
            />
          </label>

          <label className="login-v2-field">
            <span>密码</span>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isLoading}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                disabled={isLoading}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </label>

          <div className="login-v2-account-note">
            <strong>内部账号登录</strong>
            <span>请使用管理员分配的用户名和密码</span>
            <small>如忘记密码，请联系管理员在服务器端重置。</small>
          </div>

          {error && <div className="error-box">{error}</div>}

          <button
            className="login-v2-submit"
            type="submit"
            disabled={isLoading || !canSubmit}
          >
            {isLoading ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </div>
  );
}

function Sidebar({ user, isOpen, onLogout }) {
  return (
    <aside className={`app-sidebar ${isOpen ? "open" : ""}`}>
      <Link className="sidebar-brand" to="/">
        <span className="brand-mark">AI</span>
        <span>
          <strong>AI 内容引擎</strong>
          <small>INPUT TO GENERATION</small>
        </span>
      </Link>

      <nav className="sidebar-nav" aria-label="主导航">
        <NavLink to="/" end>
          <SidebarIcon type="home" />
          <span>首页</span>
        </NavLink>

        <span className="sidebar-group-label">创作工具</span>
        <NavLink to="/tools/video_reverse">
          <SidebarIcon type="video" />
          <span>视频反推提示词</span>
        </NavLink>

        <span className="sidebar-group-label">内容质检</span>
        <NavLink to="/audit/douyin">
          <SidebarIcon type="audit" />
          <span>短视频质检</span>
        </NavLink>

        <span className="sidebar-group-label">个人中心</span>
        <NavLink to="/dashboard">
          <SidebarIcon type="chart" />
          <span>我的数据</span>
        </NavLink>
        <NavLink to="/history">
          <SidebarIcon type="history" />
          <span>历史记录</span>
        </NavLink>

        {user.role === "admin" && (
          <>
            <span className="sidebar-group-label">管理中心</span>
            <NavLink to="/admin/dashboard">
              <SidebarIcon type="admin" />
              <span>全局数据</span>
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-account">
        <span className="account-avatar">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{user.username}</strong>
          <small>{roleLabel(user.role)}</small>
        </span>
        <button type="button" onClick={onLogout}>
          退出
        </button>
      </div>
    </aside>
  );
}

function Header({ user, onLogout, onOpenSidebar }) {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="topbar">
      <div className="topbar-page">
        <button
          className="mobile-menu-button"
          type="button"
          onClick={onOpenSidebar}
          aria-label="打开导航"
        >
          <span />
          <span />
          <span />
        </button>
        <div>
          <strong>{pageTitle}</strong>
          <small>AI CONTENT WORKSPACE</small>
        </div>
      </div>

      <div className="topbar-account">
        <span>
          {user.username} · {roleLabel(user.role)}
        </span>
        <button className="logout-button" type="button" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </header>
  );
}

function SidebarIcon({ type }) {
  const paths = {
    home: "M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1Z",
    video:
      "M3 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm11 4 3-2v6l-3-2Z",
    script:
      "M5 2h7l3 3v13H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm6 1v4h4M7 10h6M7 13h6",
    copy:
      "M4 3h9a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2Zm3 14h9a1 1 0 0 0 1-1V7M7 7h5M7 10h5",
    audit:
      "M10 2 16 4.5V9c0 4.2-2.5 7-6 8.5C6.5 16 4 13.2 4 9V4.5Zm-3 7 2 2 4-4",
    chart: "M3 17V9h3v8Zm6 0V3h3v14Zm6 0v-6h3v6Z",
    history:
      "M4.5 5.5A7 7 0 1 1 3 10M3 4v6h6M10 6v4l3 2",
    admin:
      "M10 2 17 5v5c0 4.5-3 7-7 8-4-1-7-3.5-7-8V5Zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-3 8c.7-1.5 1.7-2 3-2s2.3.5 3 2",
  };

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={paths[type]} />
    </svg>
  );
}

function getPageTitle(pathname) {
  if (pathname === "/") return "创作首页";
  if (pathname === "/audit/douyin") return "抖音短视频质检";
  if (pathname === "/dashboard") return "我的数据";
  if (pathname === "/history") return "历史记录";
  if (pathname === "/admin/dashboard") return "全局数据";
  if (pathname.includes("video_reverse")) return "视频反推提示词";
  return "AI 内容引擎";
}

function PersonalDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.dashboard) {
          throw new Error(payload?.message || "个人数据加载失败。");
        }

        setDashboard(payload.dashboard);
      })
      .catch((requestError) =>
        setError(requestError.message || "个人数据加载失败。"),
      );
  }, []);

  if (error) {
    return <PageError message={error} />;
  }

  if (!dashboard) {
    return <LoadingPage text="正在加载个人数据..." />;
  }

  const stats = dashboard.stats;

  return (
    <div className="page-content data-page">
      <PageHeading
        eyebrow="PERSONAL USAGE"
        title="我的数据"
        description="查看自己的调用次数、Token 消耗和最近生成记录。"
      />

      <section className="stats-grid">
        <StatCard
          label="今日调用"
          value={`${stats.today_count} / ${stats.daily_limit}`}
          hint="每日额度"
        />
        <StatCard label="本周调用" value={stats.week_count} hint="本周累计" />
        <StatCard label="总调用" value={stats.total_count} hint="历史累计" />
        <StatCard
          label="总 Token"
          value={formatNumber(stats.total_tokens)}
          hint="成本参考"
        />
      </section>

      <section className="data-panel">
        <div className="section-heading">
          <div>
            <span className="card-kicker">RECENT</span>
            <h2>最近生成</h2>
          </div>
          <Link className="text-link" to="/history">
            查看全部
          </Link>
        </div>
        {dashboard.recent_history.length === 0 ? (
          <EmptyText text="还没有生成记录。" />
        ) : (
          <div className="recent-list">
            {dashboard.recent_history.map((record) => (
              <Link to="/history" key={record.id}>
                <strong>{getInputPreview(record.input)}</strong>
                <span>{record.token_usage} Tokens</span>
                <time>{formatDate(record.created_at)}</time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [userForm, setUserForm] = useState({
    username: "",
    name: "",
    password: "",
    role: "viewer",
  });
  const [resetPasswords, setResetPasswords] = useState({});
  const [userMessage, setUserMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.dashboard) {
          throw new Error(payload?.message || "全局数据加载失败。");
        }

        setDashboard(payload.dashboard);
      })
      .catch((requestError) =>
        setError(requestError.message || "全局数据加载失败。"),
      );
  }, []);

  useEffect(() => {
    refreshUsers().catch(() => setUserMessage("用户列表加载失败。"));
  }, []);

  async function refreshUsers() {
    const response = await fetch("/api/admin/users");
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.message || "用户列表加载失败。");
    }

    setUsers(payload.users ?? []);
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    setUserMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userForm),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      setUserMessage(payload?.message || "账号开通失败。");
      return;
    }

    setUserForm({ username: "", name: "", password: "", role: "viewer" });
    setUserMessage("账号已开通或更新。");
    await refreshUsers();
  }

  async function handleResetPassword(user) {
    setUserMessage("");
    const password = resetPasswords[user.id] || "";
    const response = await fetch(`/api/admin/users/${user.id}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username: user.username }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      setUserMessage(payload?.message || "密码重置失败。");
      return;
    }

    setResetPasswords((current) => ({ ...current, [user.id]: "" }));
    setUserMessage(`已重置 ${user.username} 的密码。`);
    await refreshUsers();
  }

  if (error) {
    return <PageError message={error} />;
  }

  if (!dashboard) {
    return <LoadingPage text="正在加载全局数据..." />;
  }

  const summary = dashboard.summary;
  const maxTokens = Math.max(
    ...dashboard.token_trend.map((item) => Number(item.tokens) || 0),
    1,
  );

  return (
    <div className="page-content data-page">
      <PageHeading
        eyebrow="ADMIN OVERVIEW"
        title="全局数据"
        description="只保留调用、Token 和用户使用情况，不再按模板或内容类型分类。"
      />

      <section className="stats-grid">
        <StatCard
          label="今日调用"
          value={summary.today_calls}
          hint="全体用户"
        />
        <StatCard
          label="今日 Token"
          value={formatNumber(summary.today_tokens)}
          hint="今日消耗"
        />
        <StatCard
          label="总调用"
          value={summary.total_calls}
          hint="历史累计"
        />
        <StatCard
          label="总 Token"
          value={formatNumber(summary.total_tokens)}
          hint="历史消耗"
        />
      </section>

      <section className="admin-grid">
        <article className="data-panel">
          <div className="section-heading">
            <div>
              <span className="card-kicker">7 DAYS</span>
              <h2>Token 趋势</h2>
            </div>
          </div>
          <div className="trend-chart">
            {dashboard.token_trend.map((item) => (
              <div key={item.day}>
                <span
                  style={{
                    height: `${Math.max(
                      (Number(item.tokens) / maxTokens) * 100,
                      item.tokens ? 8 : 2,
                    )}%`,
                  }}
                />
                <strong>{formatNumber(item.tokens)}</strong>
                <small>{item.day.slice(5)}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="data-panel">
          <div className="section-heading">
            <div>
              <span className="card-kicker">USERS</span>
              <h2>用户使用排行</h2>
            </div>
          </div>
          <ol className="ranking-list">
            {dashboard.user_ranking.map((item) => (
              <li key={item.id}>
                <span>{item.username}</span>
                <strong>{item.call_count} 次</strong>
                <small>{formatNumber(item.token_count)} Tokens</small>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="data-panel admin-user-panel">
        <div className="section-heading">
          <div>
            <span className="card-kicker">USER ADMIN</span>
            <h2>账号开通与密码重置</h2>
          </div>
        </div>

        <form className="admin-user-form" onSubmit={handleCreateUser}>
          <label>
            <span>用户名</span>
            <input
              value={userForm.username}
              onChange={(event) =>
                setUserForm((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              placeholder="例如 content01"
            />
          </label>
          <label>
            <span>姓名</span>
            <input
              value={userForm.name}
              onChange={(event) =>
                setUserForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="同事姓名"
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              type="password"
              value={userForm.password}
              onChange={(event) =>
                setUserForm((current) => ({
                  ...current,
                  password: event.target.value,
                }))
              }
              placeholder="至少 8 位"
            />
          </label>
          <label>
            <span>角色</span>
            <select
              value={userForm.role}
              onChange={(event) =>
                setUserForm((current) => ({ ...current, role: event.target.value }))
              }
            >
              <option value="viewer">普通用户</option>
              <option value="content">内容用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button type="submit">开通 / 更新账号</button>
        </form>

        {userMessage && <div className="info-box">{userMessage}</div>}

        <div className="admin-user-table">
          {users.map((item) => (
            <div className="admin-user-row" key={item.id}>
              <div>
                <strong>{item.name || item.username}</strong>
                <span>
                  {item.username}｜{roleLabel(item.role)}｜调用 {item.call_count} 次
                </span>
              </div>
              <div className="admin-user-reset">
                <input
                  type="password"
                  value={resetPasswords[item.id] || ""}
                  onChange={(event) =>
                    setResetPasswords((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  placeholder="新密码"
                />
                <button type="button" onClick={() => handleResetPassword(item)}>
                  重置密码
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HistoryPage({ user }) {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/history")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);

        if (!response.ok || payload?.success === false) {
          throw new Error(payload?.message || "历史记录加载失败。");
        }

        setRecords(payload.records ?? []);
      })
      .catch((requestError) =>
        setError(requestError.message || "历史记录加载失败。"),
      )
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="page-content data-page">
      <PageHeading
        eyebrow="GENERATION HISTORY"
        title="历史记录"
        description={
          user.role === "admin"
            ? "管理员可查看全部用户的生成记录。"
            : "仅展示当前账号的生成记录。"
        }
      />

      {isLoading && <LoadingPage text="正在加载历史记录..." inline />}
      {error && <div className="error-box">{error}</div>}
      {!isLoading && !error && records.length === 0 && (
        <EmptyText text="还没有生成记录。" />
      )}

      <div className="history-list">
        {records.map((record) => (
          <details className="history-item" key={record.id}>
            <summary>
              <span className="history-type">
                {getToolLabel(record.input?.tool_type)}
              </span>
              <span className="history-preview">
                {getInputPreview(record.input)}
              </span>
              <span className="history-token">
                {record.token_usage} Tokens
              </span>
              <time>{formatDate(record.created_at)}</time>
            </summary>
            <div className="history-detail">
              <section>
                <span className="card-kicker">INPUT</span>
                <h3>输入内容</h3>
                <pre className="input-preview">
                  {formatHistoryInput(record.input)}
                </pre>
                {user.role === "admin" && (
                  <small className="record-owner">
                    使用人：{record.username}
                  </small>
                )}
              </section>
              <section>
                <div className="history-output-heading">
                  <div>
                    <span className="card-kicker">OUTPUT</span>
                    <h3>生成结果</h3>
                  </div>
                  <CopyButton value={formatOutput(record.output)} />
                </div>
                <MarkdownContent content={formatOutput(record.output)} />
              </section>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description }) {
  return (
    <header className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function MarkdownContent({ content }) {
  return (
    <article className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}

function CopyButton({ value }) {
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("已复制");
    } catch {
      setStatus("复制失败");
    }
  }

  return (
    <button className="small-button" type="button" onClick={copy}>
      {status || "复制结果"}
    </button>
  );
}

function LoadingPage({ text, inline = false }) {
  return (
    <div className={inline ? "loading-page inline" : "loading-page"}>
      <div className="spinner" />
      <strong>{text}</strong>
    </div>
  );
}

function PageError({ message }) {
  return (
    <div className="page-content">
      <div className="error-box">{message}</div>
    </div>
  );
}

function EmptyText({ text }) {
  return <div className="empty-text">{text}</div>;
}

function getInputPreview(input) {
  if (typeof input === "string") {
    return input.slice(0, 100);
  }

  return input?.prompt || `${getToolLabel(input?.tool_type)}生成任务`;
}

function formatHistoryInput(input) {
  if (typeof input === "string") {
    return input;
  }

  const lines = [input?.prompt || ""];

  if (Array.isArray(input?.images) && input.images.length > 0) {
    lines.push(
      `参考图片（${input.images.length} 张）：\n${input.images
        .map((image, index) => `${index + 1}. ${image.name || "未命名图片"}`)
        .join("\n")}`,
    );
  } else if (input?.image_file?.name) {
    lines.push(`图片：${input.image_file.name}`);
  }

  if (input?.video_file?.name) {
    lines.push(`视频：${input.video_file.name}`);
  } else if (input?.video_url) {
    lines.push(`视频链接：${input.video_url}`);
  }

  return lines.filter(Boolean).join("\n\n");
}

function getToolLabel(toolType) {
  return {
    video_reverse: "视频反推提示词",
  }[toolType] ?? "AI 内容";
}

function formatOutput(output) {
  return typeof output === "string"
    ? output
    : JSON.stringify(output, null, 2);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}

function roleLabel(role) {
  return {
    admin: "管理员",
    content: "内容用户",
    viewer: "普通用户",
  }[role] ?? "普通用户";
}
