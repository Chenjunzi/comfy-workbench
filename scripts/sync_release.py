"""Preview or apply a curated export from the private development workspace."""
import argparse
import difflib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = {
    "agent_comfy_gateway": ("agent_comfy_gateway", [
        "server.py", "caption_worker.py", "llm_input_proxy.py", "measured_detailer.py",
        "MOSS_OPTIONS.md", "FACE_OPTIONS.md", "tests/test_*.py",
    ]),
    "workbench": ("comfy-preset-workflow-ui", [
        "package.json", "package-lock.json", "index.html", ".oxlintrc.json",
        "tsconfig*.json", "vite.config.ts", "public/favicon.svg",
        "src/*.tsx", "src/*.css", "shared/*.mjs", "shared/*.d.mts",
        "mcp/comfy-preset-mcp.mjs", "server/*.mjs", "test/*.test.mjs",
        "docs/examples/astrbot-linux-mcp_server.json",
    ]),
}
BLOCKED = re.compile(r"""(?ix)
    -----BEGIN\s+(?:[A-Z]+\s+)*PRIVATE\s+KEY-----
    |cwui_[A-Za-z0-9_-]{30,}
    |(?:ghp_|github_pat_|sk-proj-|sk-)[A-Za-z0-9_-]{20,}
    |[A-Z]:[\\/]+Users[\\/]+
    |\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b
    |\b(?:2[0-9a-f]{3}):[0-9a-f:]+:[0-9a-f:]+
""")

def public_text(name, text):
    if name in ("server.py", "caption_worker.py"):
        text = text.replace('COMFY_ROOT = PROJECT_ROOT / "ComfyUI-aki-v3" / "ComfyUI"',
                            'COMFY_ROOT = Path(os.environ.get("COMFY_ROOT", PROJECT_ROOT / "ComfyUI")).expanduser().resolve()')
    if name == "server.py":
        text = re.sub(r'"(?:image|video)_path": "([A-Z]:[^"\n]*?)(output|input)\\\\([^"\n]+)"',
                      lambda m: m[0].split(': "', 1)[0] + ': str(' + ('OUTPUT_DIR' if m[2] == 'output' else 'INPUT_DIR') + ' / "' + m[3].replace('\\\\', '/') + '")', text)
    if name == "server/comfy-server.mjs":
        text = text.replace("path.join(repoRoot, '..', 'ComfyUI-aki-v3', 'ComfyUI', 'output')",
                            "path.join(process.env.COMFY_ROOT || path.join(repoRoot, '..', 'ComfyUI'), 'output')")
    if name == "package.json":
        pkg = json.loads(text)
        pkg["scripts"] = {k: v for k, v in pkg["scripts"].items() if not k.startswith("web")}
        text = json.dumps(pkg, indent=2, ensure_ascii=False) + "\n"
    return text.rstrip('\r\n') + '\n' if name == 'server.py' else text

def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", type=Path)
    cli.add_argument("--apply", action="store_true", help="copy changes after validation (default: preview)")
    cli.add_argument("--diff", action="store_true", help="show unified diffs")
    args = cli.parse_args()
    source = args.source.resolve(strict=True)
    if ROOT == source or ROOT.is_relative_to(source) or source.is_relative_to(ROOT):
        cli.error("Use separate source and release directories")
    changes = []
    managed = set()
    for dest, (src, patterns) in MANIFEST.items():
        base = (source / src).resolve(strict=True)
        for pattern in patterns:
            paths = sorted(base.glob(pattern))
            if not paths:
                cli.error(f"No files matching {src}/{pattern}; review the manifest")
            for path in paths:
                if not path.resolve(strict=True).is_relative_to(base) or not path.is_file():
                    cli.error(f"Unexpected source: {path.name}")
                name = path.relative_to(base).as_posix()
                rel = Path(dest) / name
                target = ROOT / rel
                if not target.resolve().is_relative_to(ROOT):
                    cli.error(f"Unexpected destination: {rel}")
                managed.add(rel.as_posix())
                new = public_text(name, path.read_text(encoding='utf-8-sig'))
                if BLOCKED.search(new):
                    cli.error(f"Possible private value in {rel}; inspect locally (value omitted)")
                old = target.read_text(encoding='utf-8') if target.exists() else ''
                if new != old:
                    changes.append((rel, old, new))
    tracked = subprocess.check_output(['git','ls-files','--','agent_comfy_gateway','workbench'], cwd=ROOT, text=True).splitlines()
    for rel in sorted(set(tracked) - managed):
        print(f"REVIEW (not in export; retained): {rel}")
    for rel, old, new in changes:
        print(f"{'UPDATE' if old else 'ADD'} {rel}")
        if args.diff:
            sys.stdout.writelines(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile=str(rel), tofile=str(rel)))
    if args.apply:
        for rel, _, _ in changes:
            status = subprocess.check_output(['git','status','--porcelain','--',str(rel)], cwd=ROOT, text=True)
            if status.strip() and (ROOT / rel).exists():
                raw = source / MANIFEST[rel.parts[0]][0] / Path(*rel.parts[1:])
                if status.strip() != '?? ' + rel.as_posix() or (ROOT / rel).read_text(encoding='utf-8') != raw.read_text(encoding='utf-8-sig'):
                    cli.error(f"Local edits at {rel}; review and commit first")
        for rel, _, new in changes:
            (ROOT / rel).parent.mkdir(parents=True, exist_ok=True)
            (ROOT / rel).write_text(new, encoding='utf-8', newline='\n')
    print(f"{len(changes)} changed file(s); {'applied' if args.apply else 'preview only'}.")

if __name__ == '__main__':
    main()
