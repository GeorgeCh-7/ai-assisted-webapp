import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useMe } from './features/auth/useAuth'
import LoginPage from './features/auth/LoginPage'
import RegisterPage from './features/auth/RegisterPage'
import RoomCatalogPage from './features/rooms/RoomCatalogPage'
import ChatWindow from './features/chat/ChatWindow'

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

  return <Outlet />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/rooms" replace />} />
        <Route path="/rooms" element={<RoomCatalogPage />} />
        <Route path="/rooms/:roomId" element={<ChatWindow />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
