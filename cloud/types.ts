export interface CloudEnv {
  DB: D1Database;
  FILES?: R2Bucket;
  EVENTS: Queue<{ id: string }>;
  ROOMS: DurableObjectNamespace;
}
