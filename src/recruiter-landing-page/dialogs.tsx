/**
 * The two module modals: the details read-out and the API playground. The live
 * interview demo is large enough to keep its own file.
 */
import * as React from "react"
import { Check, Play } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { modules } from "./data"
import { callModel } from "./lib"
import { BrandButton, BrandDialog, HighlightedCode } from "./ui"
/* ==========================================================================
   module-details-dialog.tsx
   ========================================================================== */

interface ModuleDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  moduleIndex: number
  onOpenPlayground: (index: number) => void
  onViewDocs: () => void
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <h4 className="mb-2.5 text-sm font-bold text-ink">{title}</h4>
      {children}
    </div>
  )
}

export function ModuleDetailsDialog({
  open,
  onOpenChange,
  moduleIndex,
  onOpenPlayground,
  onViewDocs,
}: ModuleDetailsDialogProps) {
  const active = modules[moduleIndex] ?? modules[0]

  return (
    <BrandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Module Details"
      width="max-w-[720px] sm:max-w-[720px]"
      bodyClassName="p-8 max-md:p-5"
    >
      <>
        <div className="mb-6 flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-[14px] border border-brand-blue/12 bg-brand-blue/5 text-brand-blue shadow-[0_4px_12px_rgba(0,82,255,0.06)] [&_svg]:size-6.5">
            <active.Icon strokeWidth={2} />
          </div>
          <div>
            <div className="text-[13px] font-bold text-brand-pink">
              MODULE {active.id}
            </div>
            <div className="text-[22px] font-extrabold text-ink">
              {active.name}
            </div>
          </div>
        </div>

        <Section title="Overview">
          <p className="text-sm leading-relaxed text-ink/60">{active.desc}</p>
        </Section>

        <Section title="Capabilities">
          <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
            {active.tags.map((tag) => (
              <div
                key={tag}
                className="flex items-start gap-2.5 rounded-[10px] bg-surface-alt p-3 text-[13px] text-ink"
              >
                <Check
                  className="mt-px size-4 shrink-0 text-brand-pink"
                  strokeWidth={2.5}
                />
                <span>{tag}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Endpoint">
          <div className="rounded-[10px] border border-hairline bg-surface-alt px-3.5 py-3 font-mono text-[13px] text-ink">
            POST https://api.yourplatform.ai{active.endpoint}
          </div>
        </Section>

        <Section title="Integration Notes">
          <p className="text-sm leading-relaxed text-ink/60">{active.notes}</p>
        </Section>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <BrandButton
            tone="primary"
            scale="sm"
            onClick={() => {
              onOpenChange(false)
              onOpenPlayground(moduleIndex)
            }}
          >
            Open Playground
          </BrandButton>
          <BrandButton
            tone="ghost"
            scale="sm"
            onClick={() => {
              onOpenChange(false)
              onViewDocs()
            }}
          >
            View in API Docs
          </BrandButton>
        </div>
      </>
    </BrandDialog>
  )
}

/* ==========================================================================
   playground-dialog.tsx
   ========================================================================== */

interface PlaygroundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  moduleIndex: number
  /** Demo session id, minted by the caller each time the playground opens. */
  sessionId: string
}

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; live: boolean; body: string }

function ParamField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <Label className="mb-1 block text-xs font-semibold text-ink/60">
        {label}
      </Label>
      <Input
        readOnly
        value={value}
        className="h-auto w-full rounded-lg border-hairline bg-surface px-2.5 py-2 text-[13px] text-ink"
      />
    </div>
  )
}

function CodePanel({ children }: { children: React.ReactNode }) {
  return (
    <pre className="m-0 min-h-50 flex-1 overflow-auto rounded-xl bg-surface-dark p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[#c8d5cf]">
      {children}
    </pre>
  )
}

/**
 * Sends the module's sample request to the live model and shows what came back,
 * falling back to the documented sample response when the model is unreachable.
 */
export function PlaygroundDialog({
  open,
  onOpenChange,
  moduleIndex,
  sessionId,
}: PlaygroundDialogProps) {
  const active = modules[moduleIndex] ?? modules[0]
  const [run, setRun] = React.useState<RunState>({ status: "idle" })

  const execute = async () => {
    setRun({ status: "running" })

    const result = await callModel(
      `You are an API endpoint simulating the ${active.name}. Return a realistic JSON response for the sample request provided. Do not include markdown formatting or backticks, just raw JSON.`,
      `Sample Request:\n${active.request}`
    )

    setRun({
      status: "done",
      live: Boolean(result),
      body: result ?? active.response,
    })
  }

  return (
    <BrandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="API Playground"
      width="max-w-[900px] sm:max-w-[900px]"
      bodyClassName="grid grid-cols-2 gap-5 p-7 max-lg:grid-cols-1 max-md:p-5"
    >
      <>
        <div className="flex flex-col">
          <div className="mb-2.5 text-xs font-bold tracking-[0.04em] text-ink/60 uppercase">
            Request
          </div>
          <div className="mb-3.5 rounded-xl bg-surface-alt p-4">
            <ParamField label="API Key" value={active.apiKey} />
            <ParamField
              label="Endpoint"
              value={`POST https://api.yourplatform.ai${active.endpoint}/start`}
            />
            <ParamField label="Session ID" value={sessionId} />
          </div>

          <CodePanel>
            <HighlightedCode code={active.request} />
          </CodePanel>

          <button
            type="button"
            disabled={run.status === "running"}
            onClick={() => void execute()}
            className="mt-2 flex cursor-pointer items-center gap-1.5 self-start rounded-[10px] brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            <Play className="size-3.5 fill-current" />
            Run Request
          </button>
        </div>

        <div className="flex flex-col">
          <div className="mb-2.5 text-xs font-bold tracking-[0.04em] text-ink/60 uppercase">
            Response
          </div>
          <CodePanel>
            {run.status === "idle" ? (
              '// Click "Run Request" to execute'
            ) : run.status === "running" ? (
              <span className="text-brand-blue">
                {"// Executing live model request..."}
              </span>
            ) : (
              <>
                <span className="text-brand-blue">
                  {run.live
                    ? "// 200 OK · Live Model Response"
                    : "// 200 OK · Illustrative Sample (Live model unavailable)"}
                </span>
                {"\n"}
                <HighlightedCode code={run.body} />
              </>
            )}
          </CodePanel>
        </div>
      </>
    </BrandDialog>
  )
}
