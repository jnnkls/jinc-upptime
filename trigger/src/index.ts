interface Env {
  GH_TOKEN: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const res = await fetch("https://api.github.com/repos/jnnkls/jinc-upptime/dispatches", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GH_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "jinc-upptime-trigger",
      },
      body: JSON.stringify({ event_type: "uptime" }),
    });
    // throwing marks the cron invocation as failed in Workers logs
    if (res.status !== 204) throw new Error(`repository_dispatch failed: ${res.status} ${await res.text()}`);
  },
};
