/**
 * prepareDemoDayBriefing.ts — the "prepare_demo_day_briefing" prompt.
 *
 * A saved instruction the project owner invokes on purpose ahead of demo
 * day — never something the model decides to run on its own. It reads
 * the project's own plan file fresh each time it's invoked (so an
 * enforced/unenforced guardrail flag can never go stale), then hands the
 * model an instruction to combine that with each system's status — via
 * the system-status resource or the refresh_system_status tool — into a
 * short, honest readiness briefing. The synthesis happens in the
 * model's own visible reasoning, not silently inside this function.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadPlan } from "../planFile.ts";
import { KNOWN_SYSTEMS } from "../systemStatusStore.ts";

export function registerPrepareDemoDayBriefing(server: McpServer): void {
  server.registerPrompt(
    "prepare_demo_day_briefing",
    {
      title: "Prepare demo day briefing",
      description:
        "Produce a short readiness briefing ahead of demo day: what's done, what's " +
        "outstanding, and which guardrails are still unenforced and why.",
    },
    async () => {
      const plan = loadPlan();

      const releaseLines = plan.releases
        .map(
          (r) =>
            `- ${r.id} "${r.name}": ${r.stories} stor${r.stories === 1 ? "y" : "ies"}, ${r.start} to ${r.end}`
        )
        .join("\n");

      const guardrailLines = plan.guardrails
        .map(
          (g) =>
            `- ${g.id} (${g.enforced ? "ENFORCED" : "NOT YET ENFORCED"}): "${g.text}"` +
            (g.note ? ` — ${g.note}` : "")
        )
        .join("\n");

      const text =
        `Demo day is ${plan.meta.demoDay} (build ends ${plan.meta.buildEnd}).\n\n` +
        `Releases:\n${releaseLines}\n\n` +
        `Guardrails:\n${guardrailLines}\n\n` +
        `For each of these tracked systems — ${KNOWN_SYSTEMS.join(", ")} — check its status ` +
        `using the plan://systems/{system_name}/status resource (last recorded) or the ` +
        `refresh_system_status tool (live check) if a fresh answer matters more here.\n\n` +
        `Using all of the above, write a short demo-day readiness briefing with three parts: ` +
        `what's done, what's still outstanding, and which guardrails remain unenforced and ` +
        `whether that's acceptable this close to demo day. Be specific, and don't round an ` +
        `unenforced guardrail up to "fine."`;

      return {
        messages: [
          {
            role: "user",
            content: { type: "text", text },
          },
        ],
      };
    }
  );
}
