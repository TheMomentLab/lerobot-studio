import { toast } from "sonner";

type ProcessName = "teleop" | "record" | "train" | "eval";

const DESKTOP_NOTIFY_COOLDOWN_MS = 5000;
const desktopNotifyCooldown = new Map<string, number>();

function processLabel(process: ProcessName): string {
  if (process === "record") return "Recording";
  if (process === "train") return "Training";
  if (process === "eval") return "Evaluation";
  return "Teleop";
}

function shouldNotifyDesktop(key: string): boolean {
  const now = Date.now();
  const prev = desktopNotifyCooldown.get(key) ?? 0;
  if (now - prev < DESKTOP_NOTIFY_COOLDOWN_MS) return false;
  desktopNotifyCooldown.set(key, now);
  return true;
}

export function requestDesktopNotificationPermission(): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => {
    // noop in wireframe
  });
}

export function notifyDesktop(title: string, body: string, tag = ""): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const key = `${title}|${body}|${tag}`;
  if (!shouldNotifyDesktop(key)) return;

  try {
    const notice = new Notification(title, {
      body,
      tag: tag || undefined,
      silent: false,
    });
    notice.onclick = () => window.focus();
  } catch {
    // noop in wireframe
  }
}

export function notifyInfo(message: string): void {
  toast.info(message);
}

export function notifySuccess(message: string): void {
  toast.success(message);
}

export function notifyError(message: string): void {
  toast.error(message);
}

export function notifyProcessStarted(process: ProcessName): void {
  notifySuccess(`${processLabel(process)} started`);
}

export function notifyProcessStopRequested(process: ProcessName): void {
  notifyInfo(`${processLabel(process)} stop requested`);
}

export function notifyProcessCompleted(process: ProcessName): void {
  if (process === "train") {
    notifySuccess("Training completed.");
    notifyDesktop("LeStudio", "Training completed.", "proc-train-complete");
    return;
  }

  if (process === "record") {
    notifyInfo("Recording session ended.");
    notifyDesktop("LeStudio", "Recording session ended.", "proc-record-end");
  }
}

export function notifyProcessEndedWithError(
  process: ProcessName,
  message?: string,
  options?: { toast?: boolean },
): void {
  const label = processLabel(process);
  const body = `${label.toLowerCase()} ended with error. Check logs.`;
  if (options?.toast !== false) {
    notifyError(message ?? `${label} ended with error.`);
  }
  notifyDesktop("LeStudio", body, `proc-${process}-error`);
}
