export const HEARTBEAT_INTERVAL_MS = 2_000;
export const HEARTBEAT_KEY = "heartbeatAt";

export function startHeartbeat(write: (timestamp: number) => Promise<void>) {
  const beat = () => {
    // Storage failure must not produce an unhandled rejection or expose data.
    // The worker may then expire normally; a heartbeat is never a session guarantee.
    void write(Date.now()).catch(() => {});
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
