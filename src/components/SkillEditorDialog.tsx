import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@nous-research/ui/ui/components/button";
import { Input } from "@nous-research/ui/ui/components/input";
import { Label } from "@nous-research/ui/ui/components/label";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Modal } from "@/components/Modal";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { errorMessage } from "@/lib/api-error";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useI18n } from "@/i18n";
import { en } from "@/i18n/en";

const CREATE_TEMPLATE = `---
name: my-skill
description: One-line description of when to use this skill.
---

# My Skill

Numbered steps, exact commands, and pitfalls go here.
`;

export interface SkillEditorDialogProps {
  open: boolean;
  /** Skill name to edit, or null for create mode. */
  editName: string | null;
  /** Profile to scope reads/writes to ("" = the dashboard's own profile). */
  profile?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}

export function SkillEditorDialog({ open, ...props }: SkillEditorDialogProps) {
  if (!open) return null;
  return <EditorBody key={JSON.stringify([props.profile, props.editName])} {...props} />;
}

/** State lives inside the keyed dialog so every close path sees the same draft guard. */
function EditorBody({ editName, profile, onClose, onSaved }: Omit<SkillEditorDialogProps, "open">) {
  const isEdit = editName !== null;
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState(isEdit ? "" : CREATE_TEMPLATE);
  const [baseline, setBaseline] = useState(content);
  const [loading, setLoading] = useState(isEdit);
  const [loaded, setLoaded] = useState(!isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = loaded && (content !== baseline || (!isEdit && (name !== "" || category !== "")));
  const confirmDiscard = useUnsavedChanges(dirty, saving);
  const requestClose = () => confirmDiscard(onClose);

  useEffect(() => {
    if (!editName) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void api.getSkillContent(editName, profile || undefined)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setBaseline(res.content);
        setLoaded(true);
      })
      .catch((e) => { if (!cancelled) setLoadError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editName, profile, attempt]);

  const handleSave = async () => {
    if (savingRef.current || !loaded) return;
    setError(null);
    if (!isEdit && !name.trim()) {
      setError("Skill name is required.");
      return;
    }
    if (!content.trim()) {
      setError("SKILL.md content is required.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateSkillContent(editName, content, profile || undefined);
      } else {
        await api.createSkill({ name: name.trim(), content, category: category.trim() || undefined }, profile || undefined);
      }
      onSaved(isEdit ? editName : name.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={requestClose} closeDisabled={saving} size="xl"
      title={isEdit ? `Edit skill: ${editName}` : "New skill"}
      subtitle={isEdit
        ? "Rewrite this skill's SKILL.md. Frontmatter (name, description) is validated on save."
        : "Author a custom skill — YAML frontmatter plus markdown instructions. It becomes available to the agent and attachable to cron jobs."}
      footer={<>
        <Button outlined size="sm" onClick={requestClose} disabled={saving}>{t.common.cancel}</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || loading || !loaded || (isEdit && !dirty)}
          prefix={saving ? <Spinner className="h-3.5 w-3.5" /> : undefined}>
          {saving ? t.common.saving : isEdit ? t.common.save : t.common.create}
        </Button>
      </>}
    >
      {dirty && <p role="status" className="text-sm text-warning">{t.common.unsavedChanges ?? en.common.unsavedChanges}</p>}
      {loading ? (
        <div role="status" aria-busy="true" className="flex items-center justify-center gap-2 py-16">
          <Spinner /><span>{t.common.loading}</span>
        </div>
      ) : loadError ? (
        <LoadErrorNotice what="SKILL.md" detail={loadError} onRetry={() => setAttempt((value) => value + 1)} />
      ) : (
        <fieldset disabled={saving} className="space-y-4 min-w-0" aria-busy={saving}>
          {!isEdit && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="skill-editor-name">Name</Label>
              <Input id="skill-editor-name" data-autofocus placeholder="my-skill" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-editor-category">Category (optional)</Label>
              <Input id="skill-editor-category" placeholder="devops" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>}
          <div className="space-y-1.5">
            <Label htmlFor="skill-editor-content">SKILL.md</Label>
            <textarea id="skill-editor-content" spellCheck={false}
              className="min-h-[min(300px,40dvh)] max-h-[50dvh] w-full resize-y border border-border bg-background/40 px-3 py-2 font-mono text-xs leading-relaxed shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          {error && <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">{error}</p>}
        </fieldset>
      )}
    </Modal>
  );
}
