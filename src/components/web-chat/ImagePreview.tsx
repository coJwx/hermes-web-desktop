import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@nous-research/ui/ui/components/dialog";

interface ImagePreviewProps {
  source: string;
  name: string;
  label: string;
  onError?: () => void;
}

export function ImagePreview({ source, name, label, onError }: ImagePreviewProps) {
  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" aria-label={label + ": " + name} title={label}
        className="block h-full w-full cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500">
        <img src={source} alt={name} className="h-full w-full object-contain" onError={onError} />
      </button>
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] w-[min(92vw,64rem)] max-w-[64rem] rounded-2xl p-4" aria-describedby={undefined}>
      <DialogTitle className="truncate pr-8 text-sm">{name}</DialogTitle>
      <img src={source} alt={name} className="max-h-[75dvh] w-full object-contain" />
    </DialogContent>
  </Dialog>;
}
