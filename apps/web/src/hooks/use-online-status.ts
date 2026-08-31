import { useEffect, useState } from "react";

/**
 * Whether the browser currently believes it has a network connection.
 *
 * `navigator.onLine` is a floor, not a guarantee — it reports the link, not
 * whether anything is reachable — so this is only used to *tell the user* that
 * their requests will fail, never to decide whether to make one.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
