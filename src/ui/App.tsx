import { useCallback, useEffect, useRef, useState } from 'react';
import { requestPersistence } from '../storage/gallery';
import { EditorView, type OpenRequest } from './EditorView';
import { Gallery } from './Gallery';

interface Toast {
  id: number;
  msg: string;
  action?: { label: string; run: () => void };
}

export function App({ registerUpdates }: { registerUpdates?: (onNeedRefresh: (apply: () => void) => void, onOfflineReady: () => void) => void }) {
  const [route, setRoute] = useState<{ view: 'gallery' } | { view: 'editor'; req: OpenRequest }>({ view: 'gallery' });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((msg: string, action?: Toast['action'], ms = 3500) => {
    const id = nextId.current++;
    setToasts((t) => [...t.filter((x) => x.msg !== msg), { id, msg, action }]);
    if (!action) window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  useEffect(() => {
    void requestPersistence();
    registerUpdates?.(
      (apply) => toast('A new version is ready.', { label: 'Reload', run: apply }),
      () => toast('Ready to work offline.'),
    );
  }, [registerUpdates, toast]);

  return (
    <>
      {route.view === 'gallery' ? (
        <Gallery onOpen={(req) => setRoute({ view: 'editor', req })} />
      ) : (
        <EditorView key={route.req.id} req={route.req} onExit={() => setRoute({ view: 'gallery' })} toast={(m) => toast(m)} />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
