import { spawn } from "node:child_process";

/**
 * Kalder Claude Code på din maskine.
 *
 * VIGTIGT: ingen --bare. Bare mode læser hverken OAuth-credentials eller
 * nøgleringen og kræver ANTHROPIC_API_KEY — altså præcis det vi vil undgå,
 * når hele pointen er at bruge abonnementet.
 */
export function spoergClaude(opgave, skema, model) {
  return new Promise((klar, fejl) => {
    const args = [
      "-p", opgave,
      "--output-format", "json",
      "--json-schema", JSON.stringify(skema),
    ];
    if (model) args.push("--model", model);

    const proces = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });

    let ud = "", fejltekst = "";
    proces.stdout.on("data", (d) => (ud += d));
    proces.stderr.on("data", (d) => (fejltekst += d));

    proces.on("error", (e) =>
      fejl(new Error(
        e.code === "ENOENT"
          ? "Kunne ikke finde kommandoen 'claude'. Er Claude Code installeret og i din PATH?"
          : e.message,
      )),
    );

    proces.on("close", (kode) => {
      if (kode !== 0) {
        return fejl(new Error(`claude sluttede med kode ${kode}.\n${fejltekst || ud}`.trim()));
      }
      let svar;
      try {
        svar = JSON.parse(ud);
      } catch {
        return fejl(new Error(`Kunne ikke læse svaret fra claude:\n${ud.slice(0, 400)}`));
      }
      // structured_output når skemaet blev brugt; ellers result-teksten, som
      // læserne kan pakke ud af en kodeblok.
      klar(svar.structured_output ?? svar.result);
    });
  });
}
