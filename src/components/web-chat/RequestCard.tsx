import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import type { ApprovalRequestParams, ClarifyRequestParams, SecretRequestParams, SudoRequestParams, ServerRequest } from "@hermes/shared";
import type { WebChatCopy } from "@/lib/web-chat-copy";

interface RequestCardProps {
  request: ServerRequest;
  online?: boolean;
  copy: WebChatCopy;
  respond: (request: ServerRequest, result: Record<string, unknown>) => void;
}

const fieldClass = "w-full rounded-lg border border-current/20 bg-background-base px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-midground";

export function RequestCard({ request, copy, respond, online = true }: RequestCardProps) {
  const [value, setValue] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => { setValue(""); }, [request, online]);
  const reply = (result: Record<string, unknown>) => {
    setValue("");
    respond(request, result);
  };

  if (request.method === "approval") {
    const p = request.params as unknown as ApprovalRequestParams;
    const choices = (p.choices ?? ["once", "deny"]).filter((choice) =>
      !(choice === "always" && p.allow_permanent === false) && !(choice === "session" && p.allow_session === false));
    return <section aria-label={copy.approval} className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />{copy.approval}</h3>
      {p.description && <p className="mb-2 text-sm">{p.description}</p>}
      {p.command && <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background-base p-3 font-mono text-xs">{p.command}</pre>}
      <div className="flex flex-wrap gap-2">{choices.map((choice) =>
        <Button key={choice} size="sm" ghost={choice === "deny"} onClick={() => reply({ choice })}>{copy[choice]}</Button>)}
      </div>
    </section>;
  }

  if (request.method === "clarify") {
    const p = request.params as unknown as ClarifyRequestParams;
    const questions = p.questions?.length ? p.questions : [{ qid: "answer", question: p.question ?? copy.answer, choices: p.choices, multi_select: p.multi_select }];
    const submit = () => reply(p.questions?.length ? { answers: { ...p.answers, ...answers } } : { answer: answers.answer ?? "" });
    return <form aria-label={copy.clarify} className="space-y-3 rounded-xl border border-midground/25 bg-midground/5 p-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <h3 className="text-sm font-semibold">{copy.clarify}</h3>
      {questions.map((q) => <fieldset key={q.qid} className="space-y-2">
        <legend className="mb-2 text-sm">{q.question}</legend>
        {!!q.choices?.length && <div className="flex flex-wrap gap-2">{q.choices.map((choice) => {
          const selected = (answers[q.qid] ?? p.answers?.[q.qid] ?? "").split("\n").includes(choice);
          return <Button key={choice} type="button" size="sm" ghost={!selected} aria-pressed={selected} disabled={q.qid in (p.answers ?? {})}
            onClick={() => setAnswers((prev) => {
              const values = (prev[q.qid] ?? "").split("\n").filter(Boolean);
              const answer = q.multi_select ? (selected ? values.filter((item) => item !== choice) : [...values, choice]).join("\n") : choice;
              return { ...prev, [q.qid]: answer };
            })}>{choice}</Button>;
        })}</div>}
        <label className="block"><span className="sr-only">{q.question}</span>
          <textarea rows={2} className={fieldClass} value={answers[q.qid] ?? p.answers?.[q.qid] ?? ""} disabled={q.qid in (p.answers ?? {})}
            onChange={(event) => setAnswers((prev) => ({ ...prev, [q.qid]: event.target.value }))} />
        </label>
      </fieldset>)}
      <div className="flex gap-2"><Button type="submit" size="sm">{copy.respond}</Button><Button type="button" size="sm" ghost onClick={() => reply({})}>{copy.skip}</Button></div>
    </form>;
  }

  const secret = request.method === "secret" ? request.params as unknown as SecretRequestParams : null;
  const sudo = request.method === "sudo" ? request.params as unknown as SudoRequestParams : null;
  return <form aria-label={copy.secret} className="space-y-3 rounded-xl border border-midground/25 bg-midground/5 p-4" onSubmit={(event) => { event.preventDefault(); reply({ value }); }}>
    <h3 className="text-sm font-semibold">{copy.secret}</h3>
    <p className="break-words text-sm">{secret?.prompt ?? sudo?.command}</p>
    <label className="block"><span className="sr-only">{copy.password}</span>
      <input type="password" autoComplete="off" className={fieldClass} value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={!value}>{copy.respond}</Button><Button type="button" size="sm" ghost onClick={() => reply({ value: "" })}>{copy.skip}</Button></div>
  </form>;
}
