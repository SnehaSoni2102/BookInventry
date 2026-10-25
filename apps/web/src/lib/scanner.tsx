import { handleScan, type ScanOutcome } from '@bookstall/api-client';
import { notifications } from '@mantine/notifications';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../app/api';
import { useAuth } from '../app/auth';
import { feedback } from './audio';
import { isEditable, WedgeDetector } from './wedge';

const CameraScanModal = lazy(() => import('../components/CameraScanModal'));

export type ScanSource = 'hardware' | 'camera' | 'box';
export type ScanHandler = (raw: string, source: ScanSource) => void | Promise<void>;

interface ScannerValue {
  /** Sends a scanned/typed value to the active page handler (or the default one). */
  dispatch: (raw: string, source: ScanSource) => void;
  /** Registers a handler for as long as a page/mode is mounted. The most recent one wins. */
  register: (handler: ScanHandler) => () => void;
  openCamera: (opts?: { continuous?: boolean; onScan?: (raw: string) => void }) => void;
}

const Ctx = createContext<ScannerValue | null>(null);
export const useScanner = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScanner must be used inside <ScannerProvider>');
  return v;
};

/** Registers `handler` while `enabled`. Use it in a scan-mode page (scan station, add book, ...). */
export function useScanHandler(handler: ScanHandler, enabled = true) {
  const { register } = useScanner();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return register((raw, source) => ref.current(raw, source));
  }, [register, enabled]);
}

/** Shows the right toast + sound for a default-context scan and navigates. */
export function useDefaultScanHandling() {
  const navigate = useNavigate();
  return useCallback(
    (outcome: ScanOutcome) => {
      switch (outcome.type) {
        case 'navigate':
          feedback.success();
          navigate(outcome.to);
          return;
        case 'add-book':
          feedback.success();
          navigate(`/books/new?isbn=${outcome.isbn13}`);
          return;
        case 'unknown':
          feedback.error();
          notifications.show({ color: 'red', title: 'Not a recognised code', message: outcome.raw.slice(0, 60) });
          return;
        case 'not-found':
          feedback.error();
          notifications.show({ color: 'red', title: 'Not found', message: `Nothing matches ${outcome.code}` });
          return;
        case 'blocked':
          feedback.error();
          notifications.show({ color: 'orange', title: "This book isn't at your stall", message: outcome.title });
          return;
        case 'error':
          feedback.error();
          notifications.show({ color: 'red', title: 'Scan failed', message: outcome.message });
          return;
        default:
          return;
      }
    },
    [navigate],
  );
}

export function ScannerProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const handlers = useRef<ScanHandler[]>([]);
  const showOutcome = useDefaultScanHandling();
  const [camera, setCamera] = useState<{ continuous: boolean; onScan?: (raw: string) => void } | null>(null);

  const dispatch = useCallback(
    (raw: string, source: ScanSource) => {
      const value = raw.trim();
      if (!value) return;
      const active = handlers.current.at(-1);
      if (active) {
        void active(value, source);
        return;
      }
      void handleScan(api, value, { mode: 'default' }).then(showOutcome);
    },
    [showOutcome],
  );

  const register = useCallback((h: ScanHandler) => {
    handlers.current.push(h);
    return () => {
      handlers.current = handlers.current.filter((x) => x !== h);
    };
  }, []);

  // Keyboard-wedge scanners (USB / Bluetooth) type the code and press Enter. Listen whenever nothing editable has focus.
  useEffect(() => {
    if (status !== 'authed') return;
    const detector = new WedgeDetector();
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const now = performance.now();
      const value = detector.push(e.key, now);
      if (value) {
        e.preventDefault();
        dispatch(value, 'hardware');
      } else if (detector.inBurst(now)) {
        e.stopPropagation(); // part of a scan: keep hotkeys such as "/" from firing
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [status, dispatch]);

  const value = useMemo<ScannerValue>(
    () => ({ dispatch, register, openCamera: (o) => setCamera({ continuous: o?.continuous ?? false, onScan: o?.onScan }) }),
    [dispatch, register],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {camera && (
        <Suspense fallback={null}>
          <CameraScanModal
            opened
            continuous={camera.continuous}
            onClose={() => setCamera(null)}
            onScan={(raw) => {
              if (camera.onScan) camera.onScan(raw);
              else dispatch(raw, 'camera');
              if (!camera.continuous) setCamera(null);
            }}
          />
        </Suspense>
      )}
    </Ctx.Provider>
  );
}
