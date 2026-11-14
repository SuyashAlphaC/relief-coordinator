import { cloudGateway } from "../lib/cloud-gateway";
import { authenticateAccess } from "../lib/access";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    // Vite forwards upgrades outside its HTTP middleware. Mirror its localhost-only
    // development identity for upgrades; this branch is removed from production builds.
    if (import.meta.env.DEV && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const url = new URL(request.url), headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if(name.startsWith("oai-authenticated-user-")) headers.delete(name);
      if (["localhost","127.0.0.1","[::1]"].includes(url.hostname) &&
          request.headers.get("origin") === url.origin &&
          request.headers.get("cookie")?.split(";").filter(c=>c.trim()==="__sites_local_auth=1").length === 1) {
        headers.set("oai-authenticated-user-id","local_seedy");
        headers.set("oai-authenticated-user-email","seedy@sites.test");
      }
      request = new Request(request,{headers});
    }
    if (env.AUTH_MODE === "cloudflare-access") {
      const authenticated = await authenticateAccess(request, env);
      if (authenticated instanceof Response) return authenticated;
      request = authenticated;
      if (new URL(request.url).pathname === "/signin-with-chatgpt")
        return Response.redirect(new URL("/", request.url), 302);
    }
    const path = new URL(request.url).pathname;
    const pulse = (response: Response) => {
      if (
        env.CLOUD &&
        response.ok &&
        ["POST", "DELETE"].includes(request.method)
      ) {
        ctx.waitUntil(
          env.CLOUD.fetch("https://cloud/pulse", { method: "POST" })
            .then((r) => {
              if (!r.ok) console.error("Live update deferred", r.status);
            })
            .catch((e) => console.error("Cloud jobs deferred", String(e))),
        );
      }
      return response;
    };
    if (path === "/api/live" || path.startsWith("/api/cloud/")) {
      try {
        return pulse(await cloudGateway(request, env));
      } catch (e) {
        console.error("Cloud operation failed", String(e));
        return Response.json(
          { error: "Cloud operation could not be completed. Please retry." },
          { status: 500 },
        );
      }
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt)
            return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: "request_context_expired",
              message: "This request has expired. Please try again.",
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return pulse(
      await runWithConnectorBinding(binding, () =>
        handler.fetch(request, env, ctx),
      ),
    );
  },
};

export default worker;
