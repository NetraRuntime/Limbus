import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function Sam3VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('sam3_version')
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  return <span className="wordmark-tag">SAM3 {version}</span>;
}
