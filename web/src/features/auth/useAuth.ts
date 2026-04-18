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
    mutationFn: (credentials: { email: string; password: string }) =>
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
