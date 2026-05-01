import { createContext, useContext } from 'react';
import type { useHistory } from '../../../lib/history';

export type CanvasPageValue = {
  projectId: string;
  history: ReturnType<typeof useHistory>;
};

const CanvasPageContextRef = createContext<CanvasPageValue | null>(null);
CanvasPageContextRef.displayName = 'CanvasPageContext';

export const CanvasPageProvider = CanvasPageContextRef.Provider;

export function useCanvasPage(): CanvasPageValue {
  const value = useContext(CanvasPageContextRef);
  if (!value) {
    throw new Error('useCanvasPage must be used inside a CanvasPage.');
  }
  return value;
}
