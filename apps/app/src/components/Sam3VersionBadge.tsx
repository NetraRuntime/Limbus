import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type State =
  | { status: 'loading' }
  | { status: 'ready'; version: string }
  | { status: 'error' };

export function Sam3VersionBadge() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    invoke<string>('sam3_version')
      .then((version) => {
        if (!cancelled) setState({ status: 'ready', version });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  switch (state.status) {
    case 'loading':
      return null;
    case 'ready':
      return <span className="wordmark-tag">SAM3 {state.version}</span>;
    case 'error':
      return (
        <span className="wordmark-tag" title="SAM3 runtime unavailable">
          SAM3 ?
        </span>
      );
  }
}
