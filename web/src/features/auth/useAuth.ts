import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import type { UserDto } from './types'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<UserDto>('/api/auth/me'),
  })
}

export function useLogin() {
  return useMutation({
    mutationFn: (credentials: { email: string; password: string; keepMeSignedIn: boolean }) =>
      api.post<UserDto>('/api/auth/login', credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: (data: { username: string; email: string; password: string }) =>
      api.post<UserDto>('/api/auth/register', data),
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api.post<object>('/api/auth/logout'),
    onSuccess: () => {
      queryClient.clear()
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post<Record<string, never>>('/api/auth/change-password', data),
  })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) =>
      api.post<{ resetToken: string; expiresAt: string }>('/api/auth/forgot-password', { email }),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (data: { token: string; newPassword: string }) =>
      api.post<Record<string, never>>('/api/auth/reset-password', data),
  })
}

export function useUploadAvatar() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('avatar', file)
      return api.uploadForm<{ avatarUrl: string }>('/api/auth/me/avatar', form)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (password: string) =>
      api.delete<Record<string, never>>('/api/auth/me', { password }),
    onSuccess: () => queryClient.clear(),
  })
}
