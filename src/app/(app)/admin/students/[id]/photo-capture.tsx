"use client";

/**
 * Taking the counter photo with the device camera.
 *
 * The file picker alone assumed the admin already had a photograph of the
 * student. In practice the student is standing at the desk during enrolment,
 * and the photo that matters is the one taken right then.
 *
 * `capture="environment"` on the file input is not the answer: it opens a
 * camera on mobile and does nothing at all on desktop, which is where the admin
 * actually sits. So this drives `getUserMedia` directly, the same API the
 * counter scanner already uses.
 *
 * The captured frame is handed back as an ordinary `File`, so it travels
 * through exactly the same Server Action, validation, storage path and audit
 * entry as a picked file. Nothing about the storage model changes — a photo is
 * still an object in the private `student-photos` bucket, never a base64 blob
 * in a column.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Longest edge of the stored image.
 *
 * A counter photo is looked at in a 80px circle on the scanner, so anything
 * beyond this is bytes nobody sees. It also keeps a capture comfortably inside
 * the bucket's 2 MB ceiling without the admin ever meeting that limit.
 */
const MAX_EDGE_PX = 1024;
const JPEG_QUALITY = 0.85;

/** Turns a getUserMedia rejection into something an admin can act on. */
function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow it for this site in your browser's address bar, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device. Use “Choose file” instead.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and try again.";
    default:
      return "The camera could not be started. Use “Choose file” instead.";
  }
}

export function CapturePhotoDialog({
  onPhoto,
  hasPhoto,
}: {
  /** Receives the captured frame as a JPEG file, ready for the upload action. */
  onPhoto: (file: File) => void;
  hasPhoto: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const [starting, setStarting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Releases the camera.
   *
   * Not optional housekeeping: without this the recording indicator stays lit
   * after the dialog closes, which reads to the person being photographed as
   * the camera still watching them.
   */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("unsupported");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        // `ideal` rather than `exact`: a laptop has only a front camera and an
        // exact constraint would fail outright on the machine most admins use.
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      stopCamera();
      setError(cameraErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }, [stopCamera]);

  /**
   * Starts the camera the moment the <video> element exists.
   *
   * A ref callback rather than an effect on `open`: the element is not mounted
   * until the dialog content renders, so an effect would run with a null ref
   * and have to retry. This fires exactly once per mount, with the element in
   * hand — and it re-fires after a retake, because dropping the preview
   * remounts the video.
   */
  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      if (element && !streamRef.current) void startCamera();
    },
    [startCamera],
  );

  // Only releases the camera — never sets state — so an unmount mid-capture
  // cannot leave the recording indicator lit.
  useEffect(() => stopCamera, [stopCamera]);

  // A preview holds an object URL; leaking them accumulates across retakes.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    if (!context) {
      setError("This browser could not process the image. Use “Choose file” instead.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("The photo could not be captured. Try again.");
          return;
        }
        const file = new File([blob], "counter-photo.jpg", { type: "image/jpeg" });
        setPreview({ url: URL.createObjectURL(blob), file });
        // Freeze the frame the admin just approved, and drop the camera —
        // there is nothing left to film while they decide.
        stopCamera();
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }, [stopCamera]);

  const retake = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }, [preview]);

  const close = useCallback(() => {
    stopCamera();
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setError(null);
    setOpen(false);
  }, [preview, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Camera className="size-4" aria-hidden="true" />
            {hasPhoto ? "Retake with camera" : "Take photo"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{preview ? "Use this photo?" : "Take a photo"}</DialogTitle>
          <DialogDescription>
            Staff see this at the counter to check the phone belongs to the person holding it.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-xl border">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.url} alt="Captured photo" className="size-full object-cover" />
          ) : (
            <video
              ref={attachVideo}
              playsInline
              muted
              autoPlay
              className="size-full object-cover"
              aria-label="Camera preview"
            />
          )}

          {starting && !preview ? (
            <p className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
              Starting the camera…
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {preview ? (
            <>
              <Button type="button" variant="ghost" onClick={retake}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Retake
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onPhoto(preview.file);
                  close();
                }}
              >
                Use this photo
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={capture} disabled={Boolean(error) || starting}>
                <Camera className="size-4" aria-hidden="true" />
                Capture
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
