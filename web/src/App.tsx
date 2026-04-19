import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useMe } from './features/auth/useAuth'
import LoginPage from './features/auth/LoginPage'
import RegisterPage from './features/auth/RegisterPage'
import ForgotPasswordPage from './features/auth/ForgotPasswordPage'
import ResetPasswordPage from './features/auth/ResetPasswordPage'
import RoomCatalogPage from './features/rooms/RoomCatalogPage'
import ChatWindow from './features/chat/ChatWindow'
import FriendsPage from './features/friends/FriendsPage'
import DmWindow from './features/dms/DmWindow'
import SessionsPage from './features/sessions/SessionsPage'
import ChangePasswordPage from './features/auth/ChangePasswordPage'
import TopNav from './features/layout/TopNav'
import RightSidebar from './features/layout/RightSidebar'

function ProtectedRoute() {
  const { data: user, isPending, error } = useMe()

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  if (error || !user) return <Navigate to="/login" replace />

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <TopNav />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <Outlet />
        </div>
        <RightSidebar />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/rooms" replace />} />
        <Route path="/rooms" element={<RoomCatalogPage />} />
        <Route path="/rooms/:roomId" element={<ChatWindow />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/dms/:threadId" element={<DmWindow />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/auth/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
