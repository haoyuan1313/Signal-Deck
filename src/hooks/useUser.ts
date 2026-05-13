import { useStore } from '../store/useStore';

export function useUser() {
  const userId = useStore(s => s.userId);
  return { userId, loading: false };
}
