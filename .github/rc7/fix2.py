from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one marker, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "electron/main/view/embeddedEventValidation.ts",
    "    expirySeconds: Math.round(expirySeconds),\n",
    "    expirySeconds: expirySeconds === null ? null : Math.round(expirySeconds),\n",
    "preserve nullable parsed duration",
)
replace_once(
    "electron/main/lifecycle/AnalysisController.ts",
    "  private buildActiveTradeContext(deterioration?: string, observation?: any) {\n",
    "  private buildActiveTradeContext(deterioration?: string, observation?: any): OverlayState['activeTradeContext'] {\n",
    "type active trade context",
)
print("RC7 follow-up type corrections applied")
